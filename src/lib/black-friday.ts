/**
 * La página /black-friday: las fechas del evento, en qué momento estamos y
 * qué ofertas mostrar (SEO etapa 2, punto 3).
 *
 * La dirección es fija, sin año, para que lo que la página gane en Google le
 * sirva todos los años; lo que cambia cada año son estas fechas. Las de 2026
 * las anunciaron los organizadores de Black Friday Chile (decimocuarta
 * edición): del viernes 27 de noviembre a las 00:00 al lunes 30 (prensa del
 * 14-10-2026: Radio Agricultura, 13.cl, Chilevisión, Meganoticias). Cuando
 * termine, se cambian por las del año siguiente apenas se anuncien.
 *
 * Lo que se muestra sale del historial propio (lib/deal-rank, lib/deals):
 * las ofertas cuyo precio bajó según lo que registró el sitio y las que
 * están en el precio más bajo que se les ha visto. El "% de descuento" lo
 * informa el vendedor y no se presenta como prueba de nada.
 *
 * Sin I/O: se prueba con datos fijos.
 */
import { lowestPriceNote, type PriceStats } from '@/lib/deals';
import { discountOf, dropsById, rankDeals, type ConfirmedDrop } from '@/lib/deal-rank';
import type { Product } from '@/lib/types';

const DAY_MS = 86_400_000;

export const BLACK_FRIDAY = {
  year: 2026,
  /** Viernes 27-11-2026 a las 00:00 en Chile (horario de verano, UTC-3). */
  start: Date.parse('2026-11-27T03:00:00Z'),
  /** Termina al cerrar el lunes 30: martes 01-12-2026 a las 00:00 en Chile. */
  end: Date.parse('2026-12-01T03:00:00Z'),
  /** "del viernes 27 al lunes 30 de noviembre", para los textos. */
  label: 'del viernes 27 al lunes 30 de noviembre',
};

export type BlackFridayPhase = 'antes' | 'durante' | 'despues';

export function blackFridayPhase(now: number = Date.now()): BlackFridayPhase {
  if (now < BLACK_FRIDAY.start) return 'antes';
  return now < BLACK_FRIDAY.end ? 'durante' : 'despues';
}

/** El día en Chile de un instante, como número de días desde 1970 (para restar fechas sin horas). */
function chileDay(t: number): number {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(t))
    .split('-')
    .map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

/** Días que faltan para que empiece, por fecha en Chile: el jueves 26 falta 1. 0 si ya empezó. */
export function daysUntilBlackFriday(now: number = Date.now()): number {
  return Math.max(0, chileDay(BLACK_FRIDAY.start) - chileDay(now));
}

/** Cuántas tarjetas lleva cada lista de la página. */
export const PICKS_LIMIT = 12;

export interface BlackFridayPicks {
  /** Ofertas que bajaron según el historial propio, de mayor a menor baja. */
  dropped: Product[];
  /** Ofertas en el precio más bajo que se les ha visto (sin repetir las de arriba), de mayor a menor descuento. */
  lowest: Product[];
  /** Las bajas, por id, para el chip "Bajó $X" de las tarjetas. */
  drops: Record<string, ConfirmedDrop>;
}

export function blackFridayPicks(
  deals: Product[],
  stats: Map<string, PriceStats>,
  now: number = Date.now(),
  limit: number = PICKS_LIMIT,
): BlackFridayPicks {
  const drops = dropsById(deals, stats, now);
  const dropped = rankDeals(deals, stats, now)
    .filter((p) => drops[p.id])
    .slice(0, limit);
  const lowest = deals
    .filter((p) => !drops[p.id] && lowestPriceNote(stats.get(p.id) ?? null, p.price) !== null)
    .sort((a, b) => discountOf(b) - discountOf(a))
    .slice(0, limit);
  return { dropped, lowest, drops };
}

/** Ofertas por categoría, en el orden en que llegan las categorías. Solo las que tienen alguna. */
export function dealsByCategory<C extends { slug: string }>(
  deals: { category: string }[],
  categories: C[],
): (C & { count: number })[] {
  const counts = new Map<string, number>();
  for (const p of deals) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return categories.filter((c) => counts.has(c.slug)).map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }));
}
