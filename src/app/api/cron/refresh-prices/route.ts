import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { enrichFromMl, getMlToken } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { resolveLinkTarget } from '@/lib/link-check';
import { readAffiliateSettings } from '@/lib/settings';
import {
  PRICED_COLUMNS,
  applyPricing,
  hasVisibleChanges,
  priceProducts,
  summarizePricing,
  type PricedProduct,
} from '@/lib/pricing';

/**
 * Refresco de precios y disponibilidad.
 *
 * Corre cada 30 minutos desde Supabase (pg_cron, ver la migración 0011),
 * además de una vez al día desde Vercel Cron y de respaldo desde GitHub
 * Actions: el plan gratuito de Vercel solo permite crons diarios, y el
 * programador de GitHub resultó impuntual (corría cada 3 a 6 horas).
 *
 * El precio publicado es el del ganador de la caja de compra — lo que ve el
 * comprador en la ficha (ver lib/pricing). Cuando algo cambia, se invalida
 * la caché de las páginas para que el sitio lo refleje de inmediato en vez
 * de esperar los 5 minutos de revalidación.
 *
 * Los productos ocultados a mano no se tocan: esa decisión es humana.
 */

export const maxDuration = 60;

const TIME_BUDGET_MS = 45_000;

/**
 * Productos con datos incompletos que se reparan por corrida. Cada uno
 * cuesta una llamada extra a ML, y como esto ahora corre cada media hora no
 * hace falta apurarse: se van completando de a poco.
 */
const MAX_REPAIRS_PER_RUN = 8;

interface RepairRow {
  id: string;
  ml_product_id: string;
  name: string;
  brand: string | null;
  specs: Record<string, string> | null;
  description: string | null;
  ml_family_id: string | null;
  ml_domain_id: string | null;
  category: string;
}

function missingCatalogData(p: RepairRow): boolean {
  return (
    !p.brand?.trim() ||
    !p.description?.trim() ||
    !p.ml_family_id ||
    !p.ml_domain_id ||
    Object.keys(p.specs ?? {}).length === 0
  );
}

/**
 * Completa marca, specs, descripción, familia y dominio de los productos que
 * quedaron incompletos (aprobados antes de que existiera el enriquecimiento,
 * o con ML caído en ese momento). Solo rellena vacíos: nunca pisa datos.
 */
async function repairMissingData(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  rows: RepairRow[],
  token: string,
  outOfTime: () => boolean
): Promise<number> {
  const pending = rows.filter(missingCatalogData).slice(0, MAX_REPAIRS_PER_RUN);

  const results = await mapWithConcurrency(pending, 4, async (p) => {
    if (outOfTime()) return 0;
    const e = await enrichFromMl(p.ml_product_id, token, p.name);
    const patch: Record<string, unknown> = {};
    if (e.brand && !p.brand?.trim()) patch.brand = e.brand;
    if (e.description && !p.description?.trim()) patch.description = e.description;
    if (Object.keys(e.specs).length > 0 && Object.keys(p.specs ?? {}).length === 0) patch.specs = e.specs;
    if (e.familyId && !p.ml_family_id) patch.ml_family_id = e.familyId;
    if (e.domainId && !p.ml_domain_id) {
      patch.ml_domain_id = e.domainId;
      const mapped = categoryFromDomain(e.domainId);
      if (mapped && mapped !== p.category) patch.category = mapped;
    }
    if (Object.keys(patch).length === 0) return 0;
    const { error } = await admin.from('products').update(patch).eq('id', p.id);
    return error ? 0 : 1;
  });

  return results.reduce<number>((a, b) => a + b, 0);
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const { data, error } = await admin
    .from('products')
    .select(
      `${PRICED_COLUMNS}, name, brand, specs, description, ml_family_id, ml_domain_id, category`
    )
    .not('ml_product_id', 'is', null)
    .eq('is_hidden', false);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as unknown as (PricedProduct & RepairRow)[];
  if (rows.length === 0) return NextResponse.json({ ok: true, revisados: 0 });

  const token = await getMlToken();
  if (!token) {
    return NextResponse.json({ error: 'No se pudo obtener token de ML' }, { status: 502 });
  }

  const { directLinks } = await readAffiliateSettings(admin);
  const outcomes = await priceProducts(rows, token, {
    concurrency: 6,
    outOfTime,
    directLinks,
    verifyLink: (p) => resolveLinkTarget(p.affiliate_url, p.ml_product_id, token),
  });
  const writeErrors = await applyPricing(admin, outcomes);
  const repaired = await repairMissingData(admin, rows, token, outOfTime);

  const visible = hasVisibleChanges(outcomes) || repaired > 0;
  if (visible) revalidatePath('/', 'layout');

  return NextResponse.json({
    ok: true,
    ...summarizePricing(outcomes),
    datos_reparados: repaired,
    errores_de_escritura: writeErrors,
    sitio_actualizado: visible,
    elapsed_ms: Date.now() - startedAt,
  });
}
