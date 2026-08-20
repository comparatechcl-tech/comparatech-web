import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

interface MlAttribute {
  name: string;
  value_name: string | null;
}

async function getMlToken(): Promise<string | null> {
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ML_CLIENT_ID ?? '',
      client_secret: process.env.ML_CLIENT_SECRET ?? '',
    }),
  }).then((r) => r.json());
  return res.access_token ?? null;
}

// Trae marca y specs reales desde /products/{id} — no confiamos en que Make
// arme esto en el body crudo del HTTP module (ahí es donde se rompió antes
// la fórmula de reputación, por comillas anidadas). Acá es TypeScript
// normal, mucho más confiable.
async function enrichFromMl(
  mlProductId: string,
  token: string
): Promise<{ brand: string | null; specs: Record<string, string> }> {
  const res = await fetch(`https://api.mercadolibre.com/products/${mlProductId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { brand: null, specs: {} };

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

  return { brand: brandAttr?.value_name ?? null, specs };
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
 * razón, `brand` y `specs` reales se completan acá también (ver
 * enrichFromMl) en vez de intentar armarlos dentro del body crudo de Make.
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
      async (c: { seller_reputation_raw?: string; ml_product_id: string; [key: string]: unknown }) => {
        const { seller_reputation_raw, ...rest } = c;
        const enrichment = mlToken
          ? await enrichFromMl(c.ml_product_id, mlToken)
          : { brand: null, specs: {} };
        return {
          ...rest,
          seller_reputation: 'verde',
          brand: enrichment.brand,
          specs: enrichment.specs,
        };
      }
    )
  );

  try {
    const { error } = await admin.from('product_candidates').upsert(accepted, {
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

  return NextResponse.json({ ok: true, inserted: accepted.length, skipped });
}
