/**
 * Lo que el historial de precios permite afirmar sobre el precio de hoy.
 *
 * El descuento que muestra Mercado Libre se calcula contra el precio de
 * lista que informa el vendedor, y hay vendedores con el mismo "55% off"
 * todo el año. El historial (tabla price_history, ver lib/pricing) es lo
 * único que permite decir "bajó" sin riesgo: lo vimos con nuestros ojos.
 *
 * Sin imports y sin I/O a propósito: así se prueba con datos fijos y se
 * puede usar desde cualquier componente.
 *
 * El historial solo guarda los CAMBIOS de precio, no cada revisión. Por eso
 * el precio vigente al inicio de una ventana es el último registro anterior
 * a ella, y hay que contarlo aunque su fecha quede fuera.
 */

export interface PricePoint {
  price: number;
  observed_at: string;
}

export interface PriceStats {
  /** Mínimo de los precios vigentes en los últimos 30 días. */
  min30: number;
  /** Mediana de los precios vigentes en los últimos 30 días. */
  median30: number;
  /** Máximo de los precios vigentes en los últimos 30 días. */
  max30: number;
  /** Mínimo y máximo de todo el historial recibido. */
  minTracked: number;
  maxTracked: number;
  /**
   * Días desde el primer registro recibido. Si la consulta recortó el
   * historial, queda corto, nunca largo: lo que se afirme con él es cierto.
   */
  daysTracked: number;
  /** Último precio registrado. */
  lastPrice: number;
  /** Precio anterior al último cambio. null si nunca cambió. */
  previousPrice: number | null;
  /** Cuándo empezó a regir el último precio. null si nunca cambió. */
  lastChangeAt: string | null;
}

const DAY_MS = 86_400_000;

/** Una baja de hace más de esto ya no es noticia. */
const DROP_WINDOW_DAYS = 30;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function priceStats(history: PricePoint[], now: number = Date.now()): PriceStats | null {
  const points = history
    .map((p) => ({ price: p.price, observed_at: p.observed_at, t: new Date(p.observed_at).getTime() }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.t) && p.t <= now)
    .sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;

  const windowStart = now - 30 * DAY_MS;
  const inWindow = points.filter((p) => p.t >= windowStart);
  const carriedIn = [...points].reverse().find((p) => p.t < windowStart);
  const windowPrices = [...(carriedIn ? [carriedIn.price] : []), ...inWindow.map((p) => p.price)];
  const allPrices = points.map((p) => p.price);

  // El último cambio real: los registros que solo cambiaron el precio de
  // lista repiten el precio y no cuentan.
  const last = points[points.length - 1];
  let start = points.length - 1;
  while (start > 0 && points[start - 1].price === last.price) start--;
  const changed = start > 0;

  return {
    min30: Math.min(...windowPrices),
    median30: median(windowPrices),
    max30: Math.max(...windowPrices),
    minTracked: Math.min(...allPrices),
    maxTracked: Math.max(...allPrices),
    daysTracked: Math.floor((now - points[0].t) / DAY_MS),
    lastPrice: last.price,
    previousPrice: changed ? points[start - 1].price : null,
    lastChangeAt: changed ? points[start].observed_at : null,
  };
}

/**
 * ¿Es el precio más bajo de los últimos 30 días? Exige 30 días de historial
 * y que en ese tiempo haya habido un precio más alto: un precio que nunca se
 * movió es "el más bajo" solo en teoría, y anunciarlo así engaña.
 */
export function isLowestIn30Days(stats: PriceStats | null, price: number): boolean {
  if (!stats || stats.daysTracked < 30) return false;
  return price <= stats.min30 && price < stats.max30;
}

/**
 * ¿Es el precio más bajo desde que lo seguimos? Con menos de una semana de
 * historial la frase no dice nada.
 */
export function isLowestSinceTracked(stats: PriceStats | null, price: number): boolean {
  if (!stats || stats.daysTracked < 7) return false;
  return price <= stats.minTracked && price < stats.maxTracked;
}

/**
 * Cuánto bajó respecto del precio anterior y desde cuándo. null si no bajó,
 * si la baja tiene más de 30 días, o si el precio de hoy no coincide con el
 * último registrado (entonces no se sabe desde cuándo rige).
 */
export function dropSince(
  stats: PriceStats | null,
  price: number,
  now: number = Date.now()
): { amount: number; since: string } | null {
  if (!stats || stats.previousPrice === null || !stats.lastChangeAt) return null;
  if (price !== stats.lastPrice || price >= stats.previousPrice) return null;

  const changedAt = new Date(stats.lastChangeAt).getTime();
  if (!Number.isFinite(changedAt) || now - changedAt > DROP_WINDOW_DAYS * DAY_MS) return null;

  return { amount: stats.previousPrice - price, since: stats.lastChangeAt };
}
