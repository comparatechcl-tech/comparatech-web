/**
 * El historial de una página de modelo: el precio más bajo entre sus
 * versiones en cada momento, armado con el historial de cada una
 * (price_history, el mismo de las fichas). Es lo que responde "¿cuánto ha
 * costado el iPhone 17?": la versión de menor precio cambia de color o de
 * vendedor, pero el modelo se puede comprar desde ese precio.
 *
 * Qué cuenta:
 *  - cada registro rige hasta el siguiente, como en la ficha (lib/price-chart);
 *  - una versión fuera de venta cuenta hasta el día en que salió de venta;
 *  - una versión sin ningún cambio anotado tiene el mismo precio desde que
 *    entró al sitio (el historial anota solo los cambios), si ya se revisó
 *    contra Mercado Libre al menos una vez;
 *  - si el historial de alguna versión no se pudo leer, no se arma nada: el
 *    "más bajo registrado" podría estar en esa versión.
 *
 * Empieza cuando empieza la cobertura que llega hasta hoy sin cortes: antes
 * de eso hubo momentos sin ninguna versión anotada.
 *
 * Sin I/O: se prueba con datos fijos.
 */
import type { PricePoint } from '@/lib/deals';

export interface VersionHistory {
  id: string;
  /** Lo leído de price_history; null si no se pudo leer. */
  history: PricePoint[] | null;
  /** El precio de hoy (o el último, si está fuera de venta). */
  price: number;
  createdAt: string | null;
  /** La última revisión contra Mercado Libre. */
  checkedAt: string | null;
  onSale: boolean;
  /** Desde cuándo está fuera de venta (inactive_since). Fuera de venta y sin fecha, no se sabe hasta cuándo contó. */
  soldOutSince: string | null;
}

/**
 * Los registros que valen para una versión: los anotados o, si no hay
 * ninguno, el precio de hoy desde que entró al sitio. null si no se sabe.
 */
export function effectiveHistory(v: VersionHistory): PricePoint[] | null {
  if (v.history === null) return null;
  if (v.history.length > 0) return v.history;
  if (!v.checkedAt || !v.createdAt || !(v.price > 0)) return [];
  return [{ price: v.price, observed_at: v.createdAt }];
}

interface Stretch {
  price: number;
  from: number;
  to: number;
  id: string;
}

/** Hasta cuándo cuenta una versión: hoy, o el día en que salió de venta. NaN si no se sabe. */
function endOf(v: VersionHistory, now: number): number {
  if (v.onSale) return now;
  const soldOut = v.soldOutSince ? Date.parse(v.soldOutSince) : NaN;
  return Number.isFinite(soldOut) ? Math.min(soldOut, now) : NaN;
}

function stretchesOf(v: VersionHistory, history: PricePoint[], end: number): Stretch[] {
  const sorted = history
    .map((p) => ({ price: p.price, t: Date.parse(p.observed_at) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.t) && p.t < end)
    .sort((a, b) => a.t - b.t);
  const points = sorted.filter((p, i) => i === 0 || p.price !== sorted[i - 1].price);
  return points
    .map((p, i) => ({ price: p.price, from: p.t, to: i + 1 < points.length ? points[i + 1].t : end, id: v.id }))
    .filter((s) => s.to > s.from);
}

export interface LowestSeries {
  /** El precio más bajo entre las versiones, como un historial más (sirve para lib/price-chart). */
  points: PricePoint[];
  /** De qué versión es cada tramo: `from` es el inicio del tramo, igual que en `points`. */
  sources: { from: number; id: string }[];
}

/**
 * El precio más bajo entre las versiones en cada momento. null si no hay
 * ninguna versión a la venta con historial, o si de alguna no se sabe lo
 * suficiente (su historial no se pudo leer, o salió de venta sin fecha).
 */
export function lowestSeries(versions: VersionHistory[], now: number = Date.now()): LowestSeries | null {
  const all: Stretch[] = [];
  for (const v of versions) {
    const history = effectiveHistory(v);
    const end = endOf(v, now);
    if (history === null || Number.isNaN(end)) return null;
    all.push(...stretchesOf(v, history, end));
  }
  const onSale = new Set(versions.filter((v) => v.onSale).map((v) => v.id));
  if (!all.some((s) => onSale.has(s.id) && s.to === now)) return null;

  // La cobertura que llega hasta hoy sin cortes: desde ahí se arma.
  const spans = [...all].sort((a, b) => a.from - b.from);
  let blockStart = spans[0].from;
  let blockEnd = spans[0].to;
  for (const s of spans.slice(1)) {
    if (s.from > blockEnd) blockStart = s.from;
    blockEnd = Math.max(blockEnd, s.to);
  }
  const start = blockStart;

  const cuts = [...new Set([start, ...all.flatMap((s) => [s.from, s.to])])]
    .filter((t) => t >= start && t < now)
    .sort((a, b) => a - b);

  const points: PricePoint[] = [];
  const sources: LowestSeries['sources'] = [];
  for (const t of cuts) {
    const covering = all.filter((s) => s.from <= t && t < s.to);
    if (covering.length === 0) continue;
    const min = Math.min(...covering.map((s) => s.price));
    const last = points[points.length - 1];
    if (last && last.price === min) continue;
    // Ante un empate se queda la versión que ya estaba: el precio no cambió.
    const previous = sources[sources.length - 1]?.id;
    const at = covering.find((s) => s.price === min && s.id === previous) ?? covering.find((s) => s.price === min)!;
    points.push({ price: min, observed_at: new Date(t).toISOString() });
    sources.push({ from: t, id: at.id });
  }
  return points.length > 0 ? { points, sources } : null;
}

/** De qué versión era el precio más bajo en el instante `t` (el tramo que lo contiene). */
export function sourceAt(series: LowestSeries, t: number): string | null {
  let found: string | null = null;
  for (const s of series.sources) {
    if (s.from > t) break;
    found = s.id;
  }
  return found;
}
