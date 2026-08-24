import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { buildDescription } from '@/lib/product-description';

interface MlAttribute {
  name: string;
  value_name: string | null;
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

async function getMlToken(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.ML_CLIENT_ID ?? '',
        client_secret: process.env.ML_CLIENT_SECRET ?? '',
      }),
    }).then((r) => r.json());
    return res.access_token ?? null;
  } catch {
    return null;
  }
}

// Trae marca y specs reales desde /products/{id} — no confiamos en que Make
// arme esto en el body crudo del HTTP module (ahí es donde se rompió antes
// la fórmula de reputación, por comillas anidadas). Acá es TypeScript
// normal, mucho más confiable.
const FALLBACK_ENRICHMENT = { brand: null, specs: {}, description: '' } as const;

async function enrichFromMl(
  mlProductId: string,
  token: string,
  name: string
): Promise<{ brand: string | null; specs: Record<string, string>; description: string }> {
  try {
    const res = await fetchWithTimeout(`https://api.mercadolibre.com/products/${mlProductId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return FALLBACK_ENRICHMENT;

    const data = await res.json();
    const attributes: MlAttribute[] = data?.attributes ?? [];

    const SKIP_NAMES = new Set(['Marca', 'Modelo alfanumérico', 'Línea']);
    const brandAttr = attributes.find((a) => a.name === 'Marca');
    const specs: Record<string, string> = {};
    const seenValues = new Set<string>();
    for (const attr of attributes) {
      if (SKIP_NAMES.has(attr.name) || !attr.value_name) continue;
      if (seenValues.has(attr.value_name)) continue; // evita "Color"/"Color principal" repetidos
      if (Object.keys(specs).length >= 8) break;
      specs[attr.name] = attr.value_name;
      seenValues.add(attr.value_name);
    }

    const brand = brandAttr?.value_name ?? null;
    const features: string[] = (data?.main_features ?? [])
      .map((f: { text?: string }) => f?.text)
      .filter((t: unknown): t is string => typeof t === 'string');

    return {
      brand,
      specs,
      description: buildDescription({ name, brand, features, specs }),
    };
  } catch {
    // ML lento/caído para este producto puntual — no debe tirar abajo todo
    // el batch, se guarda el candidato igual sin marca/specs enriquecidas.
    return FALLBACK_ENRICHMENT;
  }
}

/**
 * Recibe candidatos prospectados por Make (highlights → products → items →
 * users de la API de ML) y los guarda en `product_candidates`, NUNCA en
 * `products` directo — nada llega al sitio público sin que un humano
 * complete affiliate_url a mano. INACTIVO por defecto, igual que
 * /api/catalog-sync.
 *
 * Body esperado (POST):
 *   { candidates: [ { ml_product_id, name, brand, category, price,
 *     original_price, image_url, description, specs, seller_id,
 *     seller_nickname, seller_reputation_raw, seller_sales_count } ] }
 *
 * `seller_reputation_raw` es el `level_id` crudo de ML (ej. "5_green") — el
 * cálculo de "verde" se hace acá, no en Make, para no depender de fórmulas
 * con comillas anidadas en el body crudo del módulo HTTP. Por la misma
 * razón, `brand`, `specs` y `description` reales se completan acá también
 * (ver enrichFromMl) en vez de intentar armarlos dentro del body crudo de
 * Make.
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_CATALOG_PROSPECT !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = req.headers.get('x-catalog-sync-token');
  if (!token || token !== process.env.CATALOG_PROSPECT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: 'Supabase admin client no configurado' },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body?.candidates || !Array.isArray(body.candidates)) {
    return NextResponse.json(
      { error: 'Body inválido, se espera { candidates: [...] }' },
      { status: 400 }
    );
  }

  // Solo vendedores con reputación verde entran a revisión, según la regla
  // del Programa de Afiliados de ML (CLAUDE.md).
  const greenCandidates = body.candidates.filter((c: { seller_reputation_raw?: string }) =>
    String(c.seller_reputation_raw ?? '').includes('green')
  );
  const skipped = body.candidates.length - greenCandidates.length;

  if (greenCandidates.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, skipped });
  }

  const mlToken = await getMlToken();

  const accepted = await Promise.all(
    greenCandidates.map(
      async (c: {
        seller_reputation_raw?: string;
        ml_product_id: string;
        name: string;
        [key: string]: unknown;
      }) => {
        const { seller_reputation_raw, ...rest } = c;
        const enrichment = mlToken
          ? await enrichFromMl(c.ml_product_id, mlToken, c.name)
          : FALLBACK_ENRICHMENT;
        return {
          ...rest,
          seller_reputation: 'verde',
          brand: enrichment.brand,
          specs: enrichment.specs,
          // Make no manda descripción y la columna default es '' — sin esto
          // la ficha del producto termina publicada sin meta description,
          // que es justo lo que Google necesita para posicionarla.
          description:
            enrichment.description || (typeof rest.description === 'string' ? rest.description : ''),
        };
      }
    )
  );

  // Un mismo producto puede aparecer en los destacados de más de una
  // categoría el mismo día (ej. un power bank en "celulares" y en
  // "computación") — Postgres no permite que ON CONFLICT toque la misma
  // fila dos veces dentro de un solo upsert, así que hay que deduplicar
  // por ml_product_id antes de guardar o se cae el lote completo.
  const dedupedByMlId = Array.from(
    new Map(accepted.map((c) => [c.ml_product_id, c])).values()
  );

  try {
    const { error } = await admin.from('product_candidates').upsert(dedupedByMlId, {
      onConflict: 'ml_product_id',
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
  } catch (e) {
    // Falla de red/conexión con Supabase (transitoria) — Make reintenta solo
    // con backoff creciente, así que basta con devolver un error claro.
    return NextResponse.json(
      { error: 'Fallo de conexión con Supabase', detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, inserted: dedupedByMlId.length, skipped });
}
