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
  /**
   * El precio más bajo que se sostuvo: el menor en que el producto pasó, en
   * total, al menos seis horas de los últimos 30 días (a ese precio o más
   * barato). Un precio que duró un rato baja `min30` pero no este. El primer
   * registro cuenta como sostenido aunque haya durado poco: es el precio que
   * el producto ya tenía cuando empezamos a anotar, no se sabe desde cuándo.
   */
  min30Held: number;
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
  /** Fecha del primer registro: desde cuándo hay historial. */
  firstSeenAt: string;
  /**
   * ¿El precio anterior al último cambio es el del primer registro? Si ese
   * primer registro no es el precio de partida (ver firstRecordIsStart), lo
   * que costaba antes no quedó anotado y una "baja" puede ser un regreso.
   */
  previousIsFirstRecord: boolean;
  /**
   * ¿El último precio es casi igual (1%) a uno que regía en la semana previa
   * al cambio? Como lastPriceSeenRecently, pero sin exigir el mismo precio al
   * peso: solo sirve para no afirmar una baja o un alza.
   */
  lastPriceNearRecent: boolean;
  /**
   * Cuánto historial hay antes del último cambio, en milisegundos. null si
   * nunca cambió. Con menos de un día no se afirma una baja: el "precio
   * anterior" puede ser uno que duró media hora.
   */
  trackedBeforeChangeMs: number | null;
  /**
   * El precio que más rigió en los 30 días anteriores al último cambio
   * (mediana ponderada por el tiempo que duró cada precio). null si nunca
   * cambió. Sirve para no medir una baja contra un precio que duró horas.
   */
  usualPriceBefore: number | null;
  /**
   * ¿El último precio ya había regido en la semana anterior a ese cambio?
   * Pasa cuando dos vendedores se turnan la caja de compra y el precio va y
   * vuelve entre los mismos dos valores.
   */
  lastPriceSeenRecently: boolean;
  /**
   * Cuántas veces cambió el precio en las últimas 48 horas. Un producto que
   * cambia seguido (varios vendedores peleando la caja de compra) puede
   * mostrar acá un precio que en Mercado Libre ya es otro. El primer registro
   * no se cuenta acá: puede ser el precio de partida o el primer cambio, y
   * eso lo sabe quien conoce cuándo se agregó el producto (lib/social/evidence).
   */
  changesLast48h: number;
}

const DAY_MS = 86_400_000;

/** Una baja de hace más de esto ya no es noticia. */
const DROP_WINDOW_DAYS = 30;

/** Cuánto se mira hacia atrás para reconocer un precio que va y vuelve. */
const SEESAW_WINDOW_DAYS = 7;

/** Ventana para contar los cambios recientes de precio. */
const RECENT_CHANGES_MS = 2 * DAY_MS;

/**
 * Cuánto tiene que haber durado un precio, en total, para contar como
 * sostenido. Medido el 12-10-2026: casi todo lo que estuvo más barato lo
 * estuvo por horas, no por minutos; con seis horas solo se descartan los
 * parpadeos (un vendedor que entra y sale de la caja de compra).
 */
const HELD_MS = 6 * 3_600_000;

/** Historial mínimo antes de un cambio para afirmar que el precio bajó o subió. */
const MIN_TRACKED_BEFORE_MS = DAY_MS;

/**
 * Cuándo se creó la tabla del historial (migración 0016). Ese día se anotó el
 * precio que cada producto ya tenía: esos primeros registros son precios de
 * partida aunque sean posteriores a la fecha en que se agregó el producto.
 */
const HISTORY_SEEDED_AT = Date.parse('2026-10-05T21:00:00Z');

/** El precio de partida se anota segundos después de agregar el producto. */
const START_SLACK_MS = 5 * 60_000;

/**
 * ¿El primer registro del historial es el precio de partida del producto?
 *
 * Lo es si se anotó cuando el producto se agregó al sitio (`createdAt`), o
 * cuando se creó la tabla. Si es posterior, es su primer cambio de precio y
 * lo que costaba antes no quedó anotado en ninguna parte (hasta octubre de
 * 2026 el historial no guardaba la partida; ahora sí, ver lib/pricing). Sin
 * la fecha de alta se supone lo segundo, que es el lado prudente.
 */
export function firstRecordIsStart(firstSeenAt: string | null | undefined, createdAt: string | null | undefined): boolean {
  const first = firstSeenAt ? new Date(firstSeenAt).getTime() : NaN;
  if (!Number.isFinite(first)) return false;
  if (first <= HISTORY_SEEDED_AT) return true;
  const created = createdAt ? new Date(createdAt).getTime() : NaN;
  return Number.isFinite(created) && first <= created + START_SLACK_MS;
}

/** Un cambio menor que esto ("bajó $1") no se informa. */
const MIN_CHANGE_PCT = 1;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * El precio más bajo en que se acumula `needed` de tiempo, sumando de los
 * tramos más baratos a los más caros. Si no se junta, el más caro. Con la
 * mitad del tiempo total es el precio que más rigió (mediana ponderada); lo
 * usa también el termómetro del Black Friday (lib/black-friday-thermometer).
 */
export function priceHeldFor(stretches: { price: number; ms: number }[], needed: number): number {
  const sorted = [...stretches].sort((a, b) => a.price - b.price);
  let held = 0;
  for (const stretch of sorted) {
    held += stretch.ms;
    if (held >= needed) return stretch.price;
  }
  return sorted[sorted.length - 1].price;
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

  // Cada registro rige hasta el siguiente: el último precio "ya se vio" si
  // algún tramo anterior con ese mismo precio seguía vigente dentro de la
  // semana previa al cambio.
  const seesawFrom = points[start].t - SEESAW_WINDOW_DAYS * DAY_MS;
  const seenRecently = points
    .slice(0, start)
    .some((p, i) => p.price === last.price && points[i + 1].t > seesawFrom);
  const nearRecently = points
    .slice(0, start)
    .some((p, i) => Math.abs(p.price - last.price) * 100 <= last.price * MIN_CHANGE_PCT && points[i + 1].t > seesawFrom);

  const recentFrom = now - RECENT_CHANGES_MS;
  const recentChanges = points.filter((p, i) => i > 0 && p.t >= recentFrom && p.price !== points[i - 1].price).length;

  // Cada registro rige desde su fecha hasta la del siguiente (el último, hasta ahora).
  const stretchesBetween = (from: number, to: number) =>
    points
      .map((p, i) => ({
        price: p.price,
        ms: Math.min(i + 1 < points.length ? points[i + 1].t : now, to) - Math.max(p.t, from),
        // Por fecha y no por posición: dos registros de la misma hora (dos corridas que se pisan) son el primero los dos.
        first: p.t === points[0].t,
      }))
      .filter((stretch) => stretch.ms > 0);

  // El primer registro pudo regir desde mucho antes de que se anotara: se da por sostenido.
  const held = stretchesBetween(windowStart, now).map((stretch) =>
    stretch.first ? { ...stretch, ms: Math.max(stretch.ms, HELD_MS) } : stretch
  );
  const changeAt = points[start].t;
  const before = changed ? stretchesBetween(changeAt - 30 * DAY_MS, changeAt) : [];
  const beforeMs = before.reduce((sum, stretch) => sum + stretch.ms, 0);

  return {
    min30: Math.min(...windowPrices),
    min30Held: held.length > 0 ? priceHeldFor(held, HELD_MS) : last.price,
    median30: median(windowPrices),
    max30: Math.max(...windowPrices),
    minTracked: Math.min(...allPrices),
    maxTracked: Math.max(...allPrices),
    daysTracked: Math.floor((now - points[0].t) / DAY_MS),
    lastPrice: last.price,
    previousPrice: changed ? points[start - 1].price : null,
    lastChangeAt: changed ? points[start].observed_at : null,
    firstSeenAt: points[0].observed_at,
    previousIsFirstRecord: changed && points.slice(0, start).every((p) => p.price === points[0].price),
    lastPriceNearRecent: nearRecently,
    trackedBeforeChangeMs: changed ? changeAt - points[0].t : null,
    usualPriceBefore: !changed ? null : before.length > 0 ? priceHeldFor(before, beforeMs / 2) : points[start - 1].price,
    lastPriceSeenRecently: seenRecently,
    changesLast48h: recentChanges,
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
 * Lo que el historial permite afirmar sobre el mínimo, con las mismas
 * palabras en la ficha y en el comparador. null si no alcanza para afirmar
 * nada.
 */
export function lowestPriceNote(stats: PriceStats | null, price: number): string | null {
  if (isLowestIn30Days(stats, price)) return 'El precio más bajo que registramos en los últimos 30 días';
  if (stats && isLowestSinceTracked(stats, price)) {
    return `Precio más bajo desde que lo seguimos (${stats.daysTracked} días)`;
  }
  return null;
}

/** El último cambio de precio que registramos, hacia abajo o hacia arriba. */
export interface PriceChange {
  direction: 'down' | 'up';
  amount: number;
  since: string;
}

/**
 * Cuánto cambió respecto del precio anterior y desde cuándo. Decir también
 * cuándo algo subió es lo que hace creíble el "bajó". null si nunca cambió,
 * si el cambio tiene más de 30 días, o si el precio de hoy no coincide con
 * el último registrado (entonces no se sabe desde cuándo rige).
 *
 * Tampoco cuenta un precio que va y vuelve entre los mismos valores (casi
 * la mitad de los cambios que se registran: dos vendedores turnándose), ni
 * un cambio de menos de 1%. Los dos serían ciertos contra el registro
 * anterior, pero nadie diría que ese producto "bajó".
 *
 * La baja se mide contra el menor entre el registro anterior y el precio que
 * más rigió antes del cambio: un televisor que costó $329.990 toda la
 * semana, pasó unas horas a $499.990 y quedó en $316.131 bajó $13.859, no
 * $183.859. Si contra ese precio habitual no bajó, no hay baja. Tampoco se
 * mide contra algo más alto que el precio de lista de hoy (`listPrice`): si
 * la ficha dice "8% de descuento", no puede decir al lado "bajó 48%". Un alza
 * se mide igual, contra el mayor de los dos.
 *
 * Y hace falta al menos un día de historial antes del cambio: con menos, el
 * "precio anterior" suele ser uno que duró minutos y el producto solo volvió
 * a lo que costaba. Por lo mismo no se afirma nada cuando el precio anterior
 * es el primer registro y ese registro no es el precio de partida
 * (`createdAt` dice cuándo se agregó el producto): más de la mitad de las
 * veces el producto solo vuelve a lo que costaba antes de ese registro.
 */
export function changeSince(
  stats: PriceStats | null,
  price: number,
  now: number = Date.now(),
  listPrice?: number | null,
  createdAt?: string | null
): PriceChange | null {
  if (!stats || stats.previousPrice === null || !stats.lastChangeAt) return null;
  if (price !== stats.lastPrice || price === stats.previousPrice) return null;
  if (stats.lastPriceSeenRecently || stats.lastPriceNearRecent === true) return null;
  if (
    typeof createdAt === 'string' &&
    stats.previousIsFirstRecord === true &&
    !firstRecordIsStart(stats.firstSeenAt, createdAt)
  ) {
    return null;
  }
  // Un resumen guardado por una versión anterior no trae el dato: no se afirma nada.
  if (!(typeof stats.trackedBeforeChangeMs === 'number' && stats.trackedBeforeChangeMs >= MIN_TRACKED_BEFORE_MS)) return null;

  const down = price < stats.previousPrice;
  const usual = typeof stats.usualPriceBefore === 'number' ? stats.usualPriceBefore : stats.previousPrice;
  let reference = down ? Math.min(stats.previousPrice, usual) : Math.max(stats.previousPrice, usual);
  if (down && typeof listPrice === 'number' && listPrice > price) reference = Math.min(reference, listPrice);
  if (down ? reference <= price : reference >= price) return null;
  if (Math.abs(price - reference) * 100 < reference * MIN_CHANGE_PCT) return null;

  const changedAt = new Date(stats.lastChangeAt).getTime();
  if (!Number.isFinite(changedAt) || now - changedAt > DROP_WINDOW_DAYS * DAY_MS) return null;

  return down
    ? { direction: 'down', amount: reference - price, since: stats.lastChangeAt }
    : { direction: 'up', amount: price - reference, since: stats.lastChangeAt };
}

/** Cuánto bajó y desde cuándo. null si no bajó (ver changeSince). */
export function dropSince(
  stats: PriceStats | null,
  price: number,
  now: number = Date.now(),
  listPrice?: number | null,
  createdAt?: string | null
): { amount: number; since: string } | null {
  const change = changeSince(stats, price, now, listPrice, createdAt);
  return change?.direction === 'down' ? { amount: change.amount, since: change.since } : null;
}
