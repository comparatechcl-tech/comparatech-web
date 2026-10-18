/**
 * El historial de precios de la ficha: el gráfico y los números que lo
 * resumen (SEO etapa 2: el dato propio que una página que solo copia a
 * Mercado Libre no tiene, y lo que la gente busca antes de Black Friday).
 *
 * Sale de price_history, que anota cada cambio del precio que se muestra y
 * no cada revisión: cada registro rige desde su fecha hasta el siguiente, y
 * el último, hasta ahora. Acá solo se resume lo que se vio (rango, promedio
 * ponderado por lo que duró cada precio, cuántas veces cambió). Las frases
 * sobre el precio de hoy ("el más bajo en 30 días", "bajó $X") siguen en
 * lib/deals, con sus resguardos.
 *
 * Sin I/O: se prueba con datos fijos.
 */
import type { PricePoint } from '@/lib/deals';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Lo que cubre el gráfico, como mucho: lo mismo que lee la ficha (lib/queries/price-history). */
export const CHART_DAYS = 90;
/** La ventana del promedio y del conteo de cambios. */
export const SUMMARY_DAYS = 30;
/** Cuántos cambios lista la tabla. */
export const TABLE_ROWS = 10;
/**
 * Desde cuántos cambios en 48 horas la ficha avisa que el precio cambia
 * seguido: pasa cuando dos vendedores se turnan la caja de compra, y el
 * "bajo el promedio" de hoy puede no durar ni una hora.
 */
export const BUSY_CHANGES_48H = 4;

/** Un precio y el tiempo en que rigió. */
export interface PriceStretch {
  price: number;
  from: number;
  to: number;
}

export interface PriceHistorySummary {
  /** Tramos dentro del gráfico, del más viejo al más nuevo. */
  stretches: PriceStretch[];
  /** Desde cuándo hay registro: el primero, aunque quede antes del gráfico. */
  trackedSince: number;
  /** Inicio y fin del gráfico. */
  start: number;
  end: number;
  min: number;
  max: number;
  /** Cuándo empezó la vez más reciente que rigió el mínimo, y cuánto rigió en total en el gráfico. */
  minAt: number;
  minHeldMs: number;
  /** Promedio de los últimos 30 días (o desde que hay registro), ponderado por lo que duró cada precio. */
  average: number;
  /** Desde cuándo cuenta el promedio: hace 30 días o el primer registro, lo más reciente. */
  averageFrom: number;
  /** Cambios de precio en los últimos 30 días (el primer registro no es un cambio). */
  changes: number;
  /** Cambios de precio en las últimas 48 horas. */
  changes48h: number;
  /** Los últimos cambios, del más nuevo al más viejo. `diff` es contra el precio anterior; null en el primer registro. */
  recent: { at: number; price: number; diff: number | null }[];
}

export function summarizeHistory(history: PricePoint[], now: number = Date.now()): PriceHistorySummary | null {
  const sorted = history
    .map((p) => ({ price: p.price, t: Date.parse(p.observed_at) }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && Number.isFinite(p.t) && p.t <= now)
    .sort((a, b) => a.t - b.t);
  // Dos registros seguidos con el mismo precio (cambió solo el precio de lista) son el mismo tramo.
  const points = sorted.filter((p, i) => i === 0 || p.price !== sorted[i - 1].price);
  if (points.length === 0) return null;

  const all: PriceStretch[] = points.map((p, i) => ({
    price: p.price,
    from: p.t,
    to: i + 1 < points.length ? points[i + 1].t : now,
  }));
  const trackedSince = points[0].t;
  const start = Math.max(trackedSince, now - CHART_DAYS * DAY_MS);
  const stretches = all.filter((s) => s.to > start || s === all[all.length - 1]).map((s) => ({ ...s, from: Math.max(s.from, start) }));

  const prices = stretches.map((s) => s.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const atMin = stretches.filter((s) => s.price === min);

  const averageFrom = Math.max(trackedSince, now - SUMMARY_DAYS * DAY_MS);
  const overlap = (s: PriceStretch) => Math.max(0, Math.min(s.to, now) - Math.max(s.from, averageFrom));
  const weight = all.reduce((sum, s) => sum + overlap(s), 0);
  // Con menos de un minuto de historia no hay nada que ponderar: rige el último precio.
  const average =
    weight > 60_000 ? Math.round(all.reduce((sum, s) => sum + s.price * overlap(s), 0) / weight) : all[all.length - 1].price;

  const changesSince = (from: number) => points.filter((p, i) => i > 0 && p.t >= from).length;
  const changes = changesSince(now - SUMMARY_DAYS * DAY_MS);
  const changes48h = changesSince(now - 2 * DAY_MS);
  const recent = points
    .map((p, i) => ({ at: p.t, price: p.price, diff: i > 0 ? p.price - points[i - 1].price : null }))
    .slice(-TABLE_ROWS)
    .reverse();

  return {
    stretches,
    trackedSince,
    start,
    end: now,
    min,
    max,
    minAt: atMin[atMin.length - 1].from,
    minHeldMs: atMin.reduce((sum, s) => sum + (s.to - s.from), 0),
    average,
    averageFrom,
    changes,
    changes48h,
    recent,
  };
}

/**
 * Cuánto está el precio de hoy sobre (+) o bajo (−) el promedio, en
 * porcentaje redondeado. 0 si la diferencia es menor a 1%: no se dice
 * "1% bajo el promedio" por $300.
 */
export function vsAverage(price: number, average: number): number {
  if (!(average > 0)) return 0;
  const pct = ((price - average) / average) * 100;
  return Math.abs(pct) < 1 ? 0 : Math.round(pct);
}

/** Cuánto duró el mínimo, dicho para la ficha. null si duró un día o más (no hace falta aclararlo). */
export function heldLabel(ms: number): string | null {
  if (ms >= DAY_MS) return null;
  if (ms < HOUR_MS) return 'por menos de una hora';
  const hours = Math.round(ms / HOUR_MS);
  return hours === 1 ? 'por cerca de una hora' : `por unas ${hours} horas`;
}

/**
 * El dibujo del gráfico en un lienzo de `width` × `height`: el trazo en
 * escalones (cada precio rige hasta el cambio), el área bajo él y la altura
 * del promedio. El precio más alto va arriba con un margen, el más bajo
 * abajo; si nunca cambió, una línea al medio.
 */
export function chartPaths(
  summary: PriceHistorySummary,
  width: number,
  height: number,
): { line: string; area: string; averageY: number } {
  const { stretches, start, end, min, max, average } = summary;
  const span = Math.max(end - start, 1);
  const pad = height * 0.12;
  const x = (t: number) => ((Math.min(Math.max(t, start), end) - start) / span) * width;
  const y = (price: number) =>
    max === min ? height / 2 : pad + ((max - Math.min(Math.max(price, min), max)) / (max - min)) * (height - 2 * pad);
  const f = (n: number) => Number(n.toFixed(1));

  let line = `M${f(x(stretches[0].from))} ${f(y(stretches[0].price))}`;
  for (const [i, s] of stretches.entries()) {
    if (i > 0) line += ` V${f(y(s.price))}`;
    line += ` H${f(x(i + 1 < stretches.length ? stretches[i + 1].from : s.to))}`;
  }
  const area = `${line} V${height} H${f(x(stretches[0].from))} Z`;
  return { line, area, averageY: f(y(average)) };
}
