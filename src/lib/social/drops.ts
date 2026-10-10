import { captionDiscount } from '@/lib/content/captions';
import { confirmedDrop } from '@/lib/deal-rank';
import { getPriceStatsMany } from '@/lib/queries/price-history';

/**
 * Bajas de precio comprobadas (en %), para los productos que no llegan al
 * descuento mínimo: a los demás no les hace falta para publicarse.
 *
 * Usa la misma lectura del historial que las páginas del sitio, que va por
 * tandas y no se corta a las 1.000 filas de Supabase.
 */
export async function readConfirmedDrops<
  T extends { id: string; price: number; original_price: number | null },
>(rows: T[], now: Date, minDiscount: number): Promise<Map<string, number>> {
  const drops = new Map<string, number>();
  const candidates = rows.filter((p) => captionDiscount(p) < minDiscount);
  if (candidates.length === 0) return drops;

  const stats = await getPriceStatsMany(candidates.map((p) => p.id));
  for (const p of candidates) {
    const drop = confirmedDrop(p, stats.get(p.id), now.getTime());
    if (drop) drops.set(p.id, drop.pct);
  }
  return drops;
}
