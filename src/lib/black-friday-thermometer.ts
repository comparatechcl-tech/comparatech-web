/**
 * El termómetro del Black Friday (/datos/black-friday-2026, SEO etapa 3):
 * qué bajó de verdad en el evento según el historial de precios propio, qué
 * subió antes para "bajar" después y cuánto bajaron de verdad las ofertas
 * frente al descuento que anuncia el vendedor. Es el dato para la prensa: lo
 * que nadie más tiene ordenado para Mercado Libre.
 *
 * El método, que es el mismo que explica la página (si cambia acá, se cambia
 * allá):
 *
 *  - Precio habitual: el que más tiempo rigió entre el 1 y el 20 de noviembre
 *    (mediana ponderada por lo que duró cada precio, como usualPriceBefore en
 *    lib/deals). La semana del 21 al 26 queda fuera a propósito: es donde un
 *    precio sube para que el del evento parezca una baja.
 *  - Precio del Black Friday: el más bajo que se mantuvo al menos 6 horas en
 *    total entre el viernes 27 y el lunes 30 (las mismas 6 horas de min30Held
 *    en lib/deals: lo que duró menos fue un parpadeo de la caja de compra, no
 *    un precio al que alguien pudo comprar).
 *  - Bajó de verdad: quedó 5% o más bajo el habitual, y no es un precio que va
 *    y vuelve: si en la referencia ya estuvo a ese precio (o menos) un cuarto
 *    del tiempo o más, no cuenta (dos vendedores turnándose; ver
 *    lastPriceSeenRecently en lib/deals).
 *  - Más caro: hasta su precio más bajo del evento quedó 5% o más sobre el
 *    habitual.
 *  - Subió antes: entre el 21 y el 26 estuvo al menos un día (24 horas en
 *    total) 5% o más sobre el habitual. "Subió y después bajó": además, en el
 *    evento quedó 5% o más bajo ese precio alto, pero no bajó de verdad: para
 *    quien lo miró esa semana parecía una baja.
 *  - Descuento anunciado: el que informa el vendedor contra su precio de
 *    lista, en el precio del evento. Una oferta es 20% o más (MIN_DEAL_DISCOUNT,
 *    lo mismo que en todo el sitio).
 *  - Cada producto cuenta una vez: los colores de una familia de Mercado Libre
 *    (o fichas con el mismo nombre) cuentan como uno, el de historial más largo.
 *  - Para comparar, lo mismo con un fin de semana sin evento: el viernes 13 al
 *    lunes 16 de noviembre, con su propia referencia y su semana previa.
 *
 * El historial (price_history) guarda cada cambio del precio que se muestra:
 * cada registro rige desde su fecha hasta el siguiente, y el último hasta
 * ahora (las reglas de lib/price-chart). Un producto sin ningún registro no
 * cambió de precio desde que se agregó al sitio, y cuenta: dejarlo fuera
 * inflaría las bajas. Lo que no se sabe (un producto que se quedó sin
 * vendedor un rato no deja registro) no se inventa: su último precio sigue
 * rigiendo, y si hoy está sin vendedor, su línea termina cuando salió.
 *
 * Sin I/O: se prueba con datos fijos. Las lecturas están en
 * lib/queries/black-friday-thermometer.
 */
import { BLACK_FRIDAY } from '@/lib/black-friday';
import { CATEGORIES } from '@/lib/categories';
import { MIN_DEAL_DISCOUNT, confirmedDrop, type ConfirmedDrop } from '@/lib/deal-rank';
import { priceHeldFor, type PricePoint, type PriceStats } from '@/lib/deals';
import { MODELS, modelPath, versionsOf, type ModelDef } from '@/lib/models';
import { normalizeName } from '@/lib/text';
import type { Product } from '@/lib/types';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** La dirección de la página. Lleva el año: cada Black Friday tiene su balance. */
export const THERMOMETER_PATH = '/datos/black-friday-2026';

/** Desde cuánto bajo (o sobre) el precio habitual algo "bajó" (o "subió"), en %. */
export const CHANGE_PCT = 5;
/** Lo que tiene que haber durado el precio del evento, en total. */
export const EVENT_HOLD_MS = 6 * HOUR_MS;
/** Lo que tiene que haber durado el precio alto de la semana previa, en total. */
export const PRE_HOLD_MS = DAY_MS;
/** Si en la referencia ya estuvo a ese precio (o menos) esta parte del tiempo, es un precio que va y vuelve. */
export const SEESAW_SHARE = 0.25;
/** Días de precio conocido en la referencia para medir un producto. */
export const MIN_REF_DAYS = 7;
/** Las listas de ejemplos dejan fuera lo muy barato: un cable de $3.000 que baja a la mitad no dice nada del evento. */
export const LIST_MIN_PRICE = 10_000;
/** Cuántos ejemplos lleva cada lista. */
export const TOP_DROPS = 10;
export const ROSE_ITEMS = 8;
/** Una categoría entra a la tabla con al menos estos productos medidos. */
export const MIN_CATEGORY_MEASURED = 10;

/**
 * Desde cuándo el historial sirve de referencia. El 5 al 7 de octubre de 2026
 * fue el CyberMonday (cyber.cl) y el historial empezó el 5: esos días los
 * precios no eran los habituales (medido el 18-10: contra ellos, un tercio de
 * los productos "subió" en la semana siguiente).
 */
export const HISTORY_CLEAN_FROM = Date.parse('2026-10-08T03:00:00Z');

/** Las ventanas de una medición, en milisegundos. El fin de cada una no se incluye. */
export interface ThermometerWindows {
  /** Referencia: de acá sale el precio habitual. */
  refStart: number;
  refEnd: number;
  /** La semana previa: de refEnd al inicio del evento. */
  eventStart: number;
  eventEnd: number;
}

/**
 * Las ventanas de un evento: la referencia son los 20 días que terminan 6
 * días antes de que empiece (nunca antes de HISTORY_CLEAN_FROM), y la semana
 * previa, esos 6 días. Para el Black Friday 2026: referencia del 1 al 20 de
 * noviembre y semana previa del 21 al 26.
 */
export function windowsFor(eventStart: number, eventEnd: number): ThermometerWindows {
  return {
    refStart: Math.max(eventStart - 26 * DAY_MS, HISTORY_CLEAN_FROM),
    refEnd: eventStart - 6 * DAY_MS,
    eventStart,
    eventEnd,
  };
}

/** El Black Friday 2026: del viernes 27 al lunes 30 de noviembre. */
export const EVENT_WINDOWS = windowsFor(BLACK_FRIDAY.start, BLACK_FRIDAY.end);

/**
 * El fin de semana sin evento con que se compara: el mismo de dos semanas
 * antes, del viernes 13 al lunes 16 de noviembre (referencia del 18 de
 * octubre al 6 de noviembre, semana previa del 7 al 12).
 */
export const BASELINE_WINDOWS = windowsFor(BLACK_FRIDAY.start - 14 * DAY_MS, BLACK_FRIDAY.end - 14 * DAY_MS);

/**
 * El fin de semana con que se compara a esta hora: el último viernes a lunes
 * ya terminado, sin pasar de BASELINE_WINDOWS. Antes del evento es la prueba
 * del método con datos reales; desde el martes 17 de noviembre queda fijo.
 * null mientras no haya uno con referencia suficiente (el primero es el del
 * 23 al 26 de octubre, desde el martes 27).
 */
export function baselineWindows(now: number): ThermometerWindows | null {
  for (let week = 0; ; week++) {
    const start = BASELINE_WINDOWS.eventStart - week * 7 * DAY_MS;
    const windows = windowsFor(start, start + 4 * DAY_MS);
    if (windows.refEnd - windows.refStart < MIN_REF_DAYS * DAY_MS) return null;
    if (now >= windows.eventEnd) return windows;
  }
}

export type ThermometerPhase = 'antes' | 'preliminar' | 'balance';

/**
 * El primer dato sale el viernes 27 a las 8:00: antes, casi ningún precio del
 * evento alcanzó a durar 6 horas.
 */
export const PRELIMINARY_FROM = BLACK_FRIDAY.start + 8 * HOUR_MS;

/** Antes del dato preliminar, el preliminar (mientras dura el evento) o el balance (desde el martes 1 de diciembre). */
export function thermometerPhase(now: number): ThermometerPhase {
  if (now < PRELIMINARY_FROM) return 'antes';
  return now < BLACK_FRIDAY.end ? 'preliminar' : 'balance';
}

/** Desde cuándo se cuenta en vivo lo que subió en la semana previa: con un día ya puede haber algo. */
export const PRE_LIVE_FROM = EVENT_WINDOWS.refEnd + PRE_HOLD_MS;

// ---------------------------------------------------------------------------
// La línea de tiempo de cada producto.

export interface ThermometerProduct {
  id: string;
  slug: string;
  name: string;
  category: string;
  familyId: string | null;
  /** Cuándo se agregó al sitio. */
  createdAt: number;
  /** Precio y precio de lista de hoy: para el que no tiene registros, rigen desde que se agregó. */
  price: number;
  listPrice: number | null;
  active: boolean;
  /** Desde cuándo está sin vendedor (si hoy no está a la venta). */
  inactiveSince: number | null;
}

/** Un registro del historial: el precio que empezó a regir en `t`. */
export interface ThermometerRow {
  productId: string;
  price: number;
  /** El precio de lista que informaba el vendedor (null si no había uno mayor que el precio). */
  listPrice: number | null;
  t: number;
}

/** Un precio y el tiempo en que rigió, con el precio de lista que lo acompañaba. */
export interface Stretch {
  price: number;
  list: number | null;
  from: number;
  to: number;
}

/**
 * Los tramos de precio de un producto, desde que se conoce su precio hasta
 * `asOf` (o hasta que quedó sin vendedor). null si no se sabe nada:
 *
 *  - sin registros, el precio de hoy rige desde que se agregó (no cambió
 *    nunca: cada cambio deja un registro);
 *  - con registros, desde el primero: si el primero es un cambio y no la
 *    partida, lo que costaba antes no quedó anotado (ver missingStartRows en
 *    lib/pricing);
 *  - con registros solo después de `asOf`, no se sabe qué precio regía antes.
 */
export function timelineOf(product: ThermometerProduct, rows: ThermometerRow[], asOf: number): Stretch[] | null {
  const valid = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => Number.isFinite(row.price) && row.price > 0 && Number.isFinite(row.t))
    .sort((a, b) => a.row.t - b.row.t || a.i - b.i)
    .map(({ row }) => row);

  let points: { price: number; list: number | null; t: number }[];
  if (valid.length === 0) {
    if (!(product.price > 0) || !Number.isFinite(product.createdAt)) return null;
    points = [{ price: product.price, list: product.listPrice, t: product.createdAt }];
  } else {
    points = valid.filter((row) => row.t <= asOf).map((row) => ({ price: row.price, list: row.listPrice, t: row.t }));
  }
  if (points.length === 0 || points[0].t > asOf) return null;

  let end = asOf;
  if (!product.active) {
    if (product.inactiveSince === null || !Number.isFinite(product.inactiveSince)) return null;
    end = Math.min(end, product.inactiveSince);
  }

  const stretches = points
    .map((p, i) => ({
      price: p.price,
      list: typeof p.list === 'number' && p.list > p.price ? p.list : null,
      from: p.t,
      to: Math.min(i + 1 < points.length ? points[i + 1].t : end, end),
    }))
    .filter((s) => s.to > s.from);
  return stretches.length > 0 ? stretches : null;
}

function clip(stretches: Stretch[], from: number, to: number): Stretch[] {
  return stretches
    .map((s) => ({ ...s, from: Math.max(s.from, from), to: Math.min(s.to, to) }))
    .filter((s) => s.to > s.from);
}

function duration(stretches: Stretch[]): number {
  return stretches.reduce((sum, s) => sum + (s.to - s.from), 0);
}

function timed(stretches: Stretch[]): { price: number; ms: number }[] {
  return stretches.map((s) => ({ price: s.price, ms: s.to - s.from }));
}

/** El precio que más rigió (mediana ponderada por lo que duró cada uno). */
export function habitualPrice(stretches: Stretch[]): number {
  return priceHeldFor(timed(stretches), duration(stretches) / 2);
}

/** El precio más bajo en que pasó, en total, al menos `needed` (a ese precio o menos). null si no alcanza. */
export function lowestHeld(stretches: Stretch[], needed: number): number | null {
  return duration(stretches) >= needed ? priceHeldFor(timed(stretches), needed) : null;
}

/** El precio más alto en que pasó, en total, al menos `needed` (a ese precio o más). null si no alcanza. */
export function highestHeld(stretches: Stretch[], needed: number): number | null {
  if (duration(stretches) < needed) return null;
  return -priceHeldFor(
    stretches.map((s) => ({ price: -s.price, ms: s.to - s.from })),
    needed
  );
}

/** Qué parte del tiempo estuvo a `price` o menos. */
function shareAtOrBelow(stretches: Stretch[], price: number): number {
  const total = duration(stretches);
  return total > 0 ? duration(stretches.filter((s) => s.price <= price)) / total : 0;
}

/** Descuento anunciado por el vendedor en ese precio, en % entero: el del tramo más largo a ese precio. */
function announcedAt(stretches: Stretch[], price: number): number {
  const atPrice = stretches.filter((s) => s.price === price).sort((a, b) => b.to - b.from - (a.to - a.from));
  const list = atPrice[0]?.list;
  return typeof list === 'number' && list > price ? Math.round((1 - price / list) * 100) : 0;
}

function pctBelow(reference: number, price: number): number {
  return ((reference - price) / reference) * 100;
}

// ---------------------------------------------------------------------------
// Lo que pasó con cada producto.

export type Verdict = 'bajo' | 'igual' | 'caro';

export interface ProductOutcome {
  id: string;
  slug: string;
  name: string;
  category: string;
  /** El precio que más rigió en la referencia. */
  habitual: number;
  /** El más bajo que duró 6 horas en el evento (hasta `asOf` si sigue en curso). */
  eventPrice: number;
  /** Cuánto bajo el habitual quedó el precio del evento, en %. Negativo: más caro. */
  realPct: number;
  /** El descuento que anunciaba el vendedor en el precio del evento, en %. */
  announcedPct: number;
  verdict: Verdict;
  /** El más alto que duró un día en la semana previa. null si no alcanzó a durar. */
  prePrice: number | null;
  roseBefore: boolean;
  /** Subió antes y en el evento quedó 5% o más bajo ese precio alto, sin bajar de verdad. */
  roseThenDropped: boolean;
}

/** Lo que pasó con un producto en una medición, o null si no se puede medir (poca referencia, o no estuvo a la venta en el evento). */
export function measureProduct(
  product: ThermometerProduct,
  stretches: Stretch[],
  windows: ThermometerWindows,
  asOf: number
): ProductOutcome | null {
  const ref = clip(stretches, windows.refStart, windows.refEnd);
  if (duration(ref) < MIN_REF_DAYS * DAY_MS) return null;
  const eventEnd = Math.min(asOf, windows.eventEnd);
  const event = clip(stretches, windows.eventStart, eventEnd);
  const eventPrice = lowestHeld(event, EVENT_HOLD_MS);
  if (eventPrice === null) return null;

  const habitual = habitualPrice(ref);
  const realPct = pctBelow(habitual, eventPrice);
  const isDrop = realPct >= CHANGE_PCT && shareAtOrBelow(ref, eventPrice) < SEESAW_SHARE;
  const verdict: Verdict = isDrop ? 'bajo' : realPct <= -CHANGE_PCT ? 'caro' : 'igual';

  const prePrice = highestHeld(clip(stretches, windows.refEnd, windows.eventStart), PRE_HOLD_MS);
  const roseBefore = prePrice !== null && -pctBelow(habitual, prePrice) >= CHANGE_PCT;
  const roseThenDropped = roseBefore && !isDrop && prePrice !== null && pctBelow(prePrice, eventPrice) >= CHANGE_PCT;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    habitual,
    eventPrice,
    realPct,
    announcedPct: announcedAt(event, eventPrice),
    verdict,
    prePrice,
    roseBefore,
    roseThenDropped,
  };
}

/** Lo que subió en la semana previa, para contarlo en vivo antes del evento. */
export interface PreOutcome {
  id: string;
  slug: string;
  name: string;
  category: string;
  habitual: number;
  prePrice: number;
  roseBefore: boolean;
}

export function measurePre(
  product: ThermometerProduct,
  stretches: Stretch[],
  windows: ThermometerWindows,
  asOf: number
): PreOutcome | null {
  const ref = clip(stretches, windows.refStart, windows.refEnd);
  if (duration(ref) < MIN_REF_DAYS * DAY_MS) return null;
  const prePrice = highestHeld(clip(stretches, windows.refEnd, Math.min(asOf, windows.eventStart)), PRE_HOLD_MS);
  if (prePrice === null) return null;
  const habitual = habitualPrice(ref);
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    habitual,
    prePrice,
    roseBefore: -pctBelow(habitual, prePrice) >= CHANGE_PCT,
  };
}

/**
 * Uno por producto real: de cada familia de Mercado Libre (los colores, y en
 * algunos casos las capacidades) y de cada nombre repetido queda el de
 * historial más largo. Mismo criterio de grupos que collapseVariants
 * (lib/queries/products), pero sin elegir por el precio de hoy: el balance
 * no puede cambiar porque mañana otro color esté más barato.
 */
export function onePerProduct<T extends { product: ThermometerProduct; stretches: Stretch[] }>(items: T[]): T[] {
  const better = (a: T, b: T) =>
    a.stretches[0].from < b.stretches[0].from || (a.stretches[0].from === b.stretches[0].from && a.product.id < b.product.id);
  const keepBest = (list: T[], keyOf: (item: T) => string) => {
    const best = new Map<string, T>();
    for (const item of list) {
      const key = keyOf(item);
      const current = best.get(key);
      if (!current || better(item, current)) best.set(key, item);
    }
    return list.filter((item) => best.get(keyOf(item)) === item);
  };
  const byFamily = keepBest(items, (item) => item.product.familyId || `id:${item.product.id}`);
  return keepBest(byFamily, (item) => normalizeName(item.product.name));
}

// ---------------------------------------------------------------------------
// El resumen que se guarda en el caché y dibuja la página.

/** Un producto de las listas de ejemplos. */
export interface OutcomeItem {
  slug: string;
  name: string;
  category: string;
  habitual: number;
  eventPrice: number;
  prePrice: number | null;
  realPct: number;
  announcedPct: number;
}

export interface CategorySummary {
  slug: string;
  name: string;
  measured: number;
  dropped: number;
  /** Ofertas (20% o más anunciado) y, de ellas, el descuento anunciado y el cambio real promedio. */
  offers: number;
  offersAnnouncedAvg: number | null;
  offersRealAvg: number | null;
}

export interface WindowSummary {
  windows: ThermometerWindows;
  measured: number;
  dropped: number;
  pricier: number;
  flat: number;
  roseBefore: number;
  roseThenDropped: number;
  /** Cambio real promedio de todos los medidos, en % (positivo: bajó). */
  realAvg: number;
  offers: number;
  offersAnnouncedAvg: number | null;
  offersRealAvg: number | null;
  byCategory: CategorySummary[];
  topDrops: OutcomeItem[];
  roseThenDroppedItems: OutcomeItem[];
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

function item(o: ProductOutcome): OutcomeItem {
  return {
    slug: o.slug,
    name: o.name,
    category: o.category,
    habitual: o.habitual,
    eventPrice: o.eventPrice,
    prePrice: o.prePrice,
    realPct: o.realPct,
    announcedPct: o.announcedPct,
  };
}

/** Las cuentas de una medición. null si no se pudo medir ningún producto. */
export function summarizeOutcomes(outcomes: ProductOutcome[], windows: ThermometerWindows): WindowSummary | null {
  if (outcomes.length === 0) return null;
  const offers = outcomes.filter((o) => o.announcedPct >= MIN_DEAL_DISCOUNT);

  const byCategory: CategorySummary[] = [];
  for (const category of CATEGORIES) {
    const inCategory = outcomes.filter((o) => o.category === category.slug);
    if (inCategory.length < MIN_CATEGORY_MEASURED) continue;
    const categoryOffers = inCategory.filter((o) => o.announcedPct >= MIN_DEAL_DISCOUNT);
    byCategory.push({
      slug: category.slug,
      name: category.name,
      measured: inCategory.length,
      dropped: inCategory.filter((o) => o.verdict === 'bajo').length,
      offers: categoryOffers.length,
      offersAnnouncedAvg: average(categoryOffers.map((o) => o.announcedPct)),
      offersRealAvg: average(categoryOffers.map((o) => o.realPct)),
    });
  }

  const listed = outcomes.filter((o) => o.habitual >= LIST_MIN_PRICE);
  const topDrops = listed
    .filter((o) => o.verdict === 'bajo')
    .sort((a, b) => b.realPct - a.realPct || b.habitual - a.habitual)
    .slice(0, TOP_DROPS)
    .map(item);
  const rise = (o: ProductOutcome) => (o.prePrice === null ? 0 : -pctBelow(o.habitual, o.prePrice));
  const roseThenDroppedItems = listed
    .filter((o) => o.roseThenDropped)
    .sort((a, b) => rise(b) - rise(a) || b.habitual - a.habitual)
    .slice(0, ROSE_ITEMS)
    .map(item);

  return {
    windows,
    measured: outcomes.length,
    dropped: outcomes.filter((o) => o.verdict === 'bajo').length,
    pricier: outcomes.filter((o) => o.verdict === 'caro').length,
    flat: outcomes.filter((o) => o.verdict === 'igual').length,
    roseBefore: outcomes.filter((o) => o.roseBefore).length,
    roseThenDropped: outcomes.filter((o) => o.roseThenDropped).length,
    realAvg: average(outcomes.map((o) => o.realPct)) ?? 0,
    offers: offers.length,
    offersAnnouncedAvg: average(offers.map((o) => o.announcedPct)),
    offersRealAvg: average(offers.map((o) => o.realPct)),
    byCategory,
    topDrops,
    roseThenDroppedItems,
  };
}

/** Lo que subió en la semana previa, contado en vivo. */
export interface PreLiveSummary {
  measured: number;
  roseBefore: number;
  items: { slug: string; name: string; category: string; habitual: number; prePrice: number }[];
}

export interface ThermometerSummary {
  /** Hasta cuándo hay precios en la cuenta. */
  asOf: number;
  phase: ThermometerPhase;
  /** El Black Friday: preliminar mientras dura, balance desde el martes 1 de diciembre. */
  event: WindowSummary | null;
  /** El fin de semana sin evento con que se compara (o la prueba del método, antes). */
  baseline: WindowSummary | null;
  /** Lo que ya subió en la semana previa (solo antes del dato preliminar). */
  preLive: PreLiveSummary | null;
}

interface Tracked {
  product: ThermometerProduct;
  stretches: Stretch[];
}

function measureWindow(tracked: Tracked[], windows: ThermometerWindows, asOf: number): WindowSummary | null {
  const measured: (Tracked & { outcome: ProductOutcome })[] = [];
  for (const t of tracked) {
    const outcome = measureProduct(t.product, t.stretches, windows, asOf);
    if (outcome) measured.push({ ...t, outcome });
  }
  return summarizeOutcomes(
    onePerProduct(measured).map((m) => m.outcome),
    windows
  );
}

function measurePreLive(tracked: Tracked[], asOf: number): PreLiveSummary | null {
  const measured: (Tracked & { outcome: PreOutcome })[] = [];
  for (const t of tracked) {
    const outcome = measurePre(t.product, t.stretches, EVENT_WINDOWS, asOf);
    if (outcome) measured.push({ ...t, outcome });
  }
  const outcomes = onePerProduct(measured).map((m) => m.outcome);
  if (outcomes.length === 0) return null;
  const rose = outcomes.filter((o) => o.roseBefore);
  const risePct = (o: PreOutcome) => -pctBelow(o.habitual, o.prePrice);
  return {
    measured: outcomes.length,
    roseBefore: rose.length,
    items: rose
      .filter((o) => o.habitual >= LIST_MIN_PRICE)
      .sort((a, b) => risePct(b) - risePct(a) || b.habitual - a.habitual)
      .slice(0, ROSE_ITEMS)
      .map(({ slug, name, category, habitual, prePrice }) => ({ slug, name, category, habitual, prePrice })),
  };
}

/**
 * Todo lo que muestra la página, a partir del catálogo y del historial
 * completo hasta ahora. Pesa unos pocos KB: es lo único que se guarda en el
 * caché (el de Vercel no acepta entradas de más de 2 MB).
 */
export function buildThermometer(products: ThermometerProduct[], rows: ThermometerRow[], now: number): ThermometerSummary {
  const asOf = Math.min(now, BLACK_FRIDAY.end);
  const phase = thermometerPhase(now);

  const rowsById = new Map<string, ThermometerRow[]>();
  for (const row of rows) {
    const list = rowsById.get(row.productId);
    if (list) list.push(row);
    else rowsById.set(row.productId, [row]);
  }
  const tracked: Tracked[] = [];
  for (const product of products) {
    const stretches = timelineOf(product, rowsById.get(product.id) ?? [], asOf);
    if (stretches) tracked.push({ product, stretches });
  }

  const baseline = baselineWindows(now);
  return {
    asOf,
    phase,
    event: phase === 'antes' ? null : measureWindow(tracked, EVENT_WINDOWS, asOf),
    baseline: baseline ? measureWindow(tracked, baseline, asOf) : null,
    preLive: phase === 'antes' && now >= PRE_LIVE_FROM ? measurePreLive(tracked, asOf) : null,
  };
}

// ---------------------------------------------------------------------------
// Caché, sitemap y textos.

/** El día en Chile de un instante ("2026-11-27"). */
function chileDate(t: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/**
 * La llave del caché a esta hora: cambia cuando el dato tiene que cambiar.
 * Antes del 21 de noviembre, una vez al día (la prueba del método cambia los
 * martes); desde la semana previa y durante el evento, cada hora; el balance,
 * una sola.
 */
export function thermometerSlot(now: number): string {
  const phase = thermometerPhase(now);
  if (phase === 'balance') return 'balance';
  if (phase === 'preliminar' || now >= EVENT_WINDOWS.refEnd) return `hora:${Math.floor(now / HOUR_MS)}`;
  return `dia:${chileDate(now)}`;
}

/** La fecha del último cambio visible, para el sitemap. undefined si todavía no muestra datos. */
export function thermometerLastModified(now: number): Date | undefined {
  const phase = thermometerPhase(now);
  if (phase === 'balance') return new Date(BLACK_FRIDAY.end);
  if (phase === 'preliminar' || now >= PRE_LIVE_FROM) return new Date(Math.floor(now / HOUR_MS) * HOUR_MS);
  const baseline = baselineWindows(now);
  return baseline ? new Date(baseline.eventEnd) : undefined;
}

function dateParts(t: number, withWeekday: boolean): { weekday: string; day: string; month: string } {
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'long',
    ...(withWeekday ? { weekday: 'long' as const } : {}),
  }).formatToParts(new Date(t));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), day: get('day'), month: get('month') };
}

/**
 * "del viernes 13 al lunes 16 de noviembre", "del 1 al 20 de noviembre", "del
 * viernes 30 de octubre al lunes 2 de noviembre". `end` no se incluye: el
 * último día es el anterior.
 */
export function rangeLabel(start: number, end: number, withWeekday = false): string {
  const a = dateParts(start, withWeekday);
  const b = dateParts(end - 1, withWeekday);
  const first = withWeekday ? `${a.weekday} ${a.day}` : a.day;
  const last = withWeekday ? `${b.weekday} ${b.day}` : b.day;
  return a.month === b.month ? `del ${first} al ${last} de ${b.month}` : `del ${first} de ${a.month} al ${last} de ${b.month}`;
}

/** "las 09:30 del viernes 27 de noviembre", en hora de Chile. */
export function asOfLabel(t: number): string {
  const time = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(t));
  const { weekday, day, month } = dateParts(t, true);
  return `las ${time} del ${weekday} ${day} de ${month}`;
}

/** Un porcentaje de productos, entero: "23%". Con menos de 1% y algo adentro, "menos de 1%". */
export function shareLabel(part: number, total: number): string {
  if (total <= 0) return '0%';
  const pct = (part / total) * 100;
  if (part > 0 && pct < 1) return 'menos de 1%';
  return `${Math.round(pct)}%`;
}

/**
 * "De cada 100": las partes redondeadas para que sumen 100 (al que más
 * perdió al redondear se le suma lo que falta). Todo en 0 si no hay nada.
 */
export function perHundred(parts: number[]): number[] {
  const total = parts.reduce((sum, p) => sum + p, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => (p / total) * 100);
  const out = exact.map(Math.floor);
  const order = exact.map((x, i) => ({ i, rest: x - Math.floor(x) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  const missing = 100 - out.reduce((sum, p) => sum + p, 0);
  for (let k = 0; k < missing; k++) out[order[k].i]++;
  return out;
}

/** El cambio real promedio dicho en palabras: bajó, subió o quedó igual (menos de 1%), con el % entero. */
export function averageChange(avg: number): { direction: 'bajo' | 'subio' | 'igual'; pct: number } {
  const pct = Math.round(Math.abs(avg));
  if (pct < 1) return { direction: 'igual', pct: 0 };
  return { direction: avg > 0 ? 'bajo' : 'subio', pct };
}

// ---------------------------------------------------------------------------
// "Lo que vamos a vigilar" en /black-friday.

/** Desde cuándo /black-friday muestra la lista: el lunes 23 de noviembre a las 00:00. */
export const WATCH_FROM = BLACK_FRIDAY.start - 4 * DAY_MS;

/** La lista va del lunes 23 hasta que termina el evento. */
export function showWatchList(now: number): boolean {
  return now >= WATCH_FROM && now < BLACK_FRIDAY.end;
}

export interface WatchNote {
  /** El precio que más rigió del 1 al 20 de noviembre. */
  habitual: number;
  /** Subió antes del Black Friday según la regla del termómetro, y hoy no está bajo su habitual. */
  roseBefore: boolean;
  /** Cuánto bajo el habitual está hoy, en % entero, si bajó de verdad; null si no. */
  belowPct: number | null;
}

/**
 * Lo que el historial confirma del precio de hoy de un producto vigilado,
 * con las reglas del termómetro: el precio habitual del 1 al 20 de
 * noviembre, si subió en la semana previa y, durante el evento, si el precio
 * de hoy está de verdad bajo el habitual. null si no hay referencia
 * suficiente (no se dice nada).
 */
export function watchNote(product: ThermometerProduct, rows: ThermometerRow[], now: number): WatchNote | null {
  const asOf = Math.min(now, BLACK_FRIDAY.end);
  const stretches = timelineOf(product, rows, asOf);
  if (!stretches) return null;
  const ref = clip(stretches, EVENT_WINDOWS.refStart, EVENT_WINDOWS.refEnd);
  if (duration(ref) < MIN_REF_DAYS * DAY_MS) return null;
  const habitual = habitualPrice(ref);

  const today = product.price;
  const below = pctBelow(habitual, today);
  const isDrop = below >= CHANGE_PCT && shareAtOrBelow(ref, today) < SEESAW_SHARE;
  const prePrice = highestHeld(clip(stretches, EVENT_WINDOWS.refEnd, Math.min(asOf, EVENT_WINDOWS.eventStart)), PRE_HOLD_MS);
  const rose = prePrice !== null && -pctBelow(habitual, prePrice) >= CHANGE_PCT;
  const inEvent = now >= EVENT_WINDOWS.eventStart;

  return {
    habitual,
    roseBefore: rose && below < CHANGE_PCT,
    belowPct: inEvent && isDrop ? Math.round(below) : null,
  };
}

/** Un producto del catálogo, como lo mide el termómetro. */
export function thermometerProductOf(p: Product): ThermometerProduct {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    familyId: p.ml_family_id,
    createdAt: Date.parse(p.created_at),
    price: p.price,
    listPrice: p.original_price,
    active: p.is_active,
    inactiveSince: p.inactive_since ? Date.parse(p.inactive_since) : null,
  };
}

/** Los registros de la lectura de la ficha (lib/queries/price-history) como los usa el termómetro. */
export function historyRowsOf(productId: string, points: PricePoint[]): ThermometerRow[] {
  return points.map((p) => ({ productId, price: p.price, listPrice: null, t: Date.parse(p.observed_at) }));
}

/** Un modelo de la lista: su versión a la venta de menor precio hoy (la que se vigila). */
export interface WatchCandidate {
  model: ModelDef;
  cheapest: Product;
  versions: number;
}

/** Los modelos muy buscados (lib/models) con alguna versión a la venta hoy, en el orden de la lista. */
export function watchCandidates(products: Product[]): WatchCandidate[] {
  const out: WatchCandidate[] = [];
  for (const model of MODELS) {
    const onSale = versionsOf(model, products.filter((p) => p.is_active));
    if (onSale.length > 0) out.push({ model, cheapest: onSale[0], versions: onSale.length });
  }
  return out;
}

export interface WatchItem {
  name: string;
  path: string;
  /** Versiones a la venta hoy. */
  versions: number;
  /** El precio de hoy de la versión de menor precio. */
  price: number;
  /** Lo que confirma el historial con las reglas del termómetro; null si no alcanza. */
  note: WatchNote | null;
  /** La baja del precio de hoy según el resto del sitio (confirmedDrop), solo si no hay nada del termómetro que decir. */
  drop: ConfirmedDrop | null;
}

/**
 * "Lo que vamos a vigilar" en /black-friday: cada modelo con el precio de hoy
 * de su versión de menor precio, su precio habitual del 1 al 20 de noviembre
 * y, si el historial lo confirma, "subió antes del Black Friday" o, durante
 * el evento, cuánto bajo el habitual está. Si no hay nada de eso, la baja
 * que el sitio ya muestra en las tarjetas ("Bajó $X", lib/deal-rank).
 */
export function buildWatchList(
  candidates: WatchCandidate[],
  histories: Map<string, PricePoint[] | null>,
  stats: Map<string, PriceStats>,
  now: number
): WatchItem[] {
  return candidates.map(({ model, cheapest, versions }) => {
    const history = histories.get(cheapest.id);
    const note = history ? watchNote(thermometerProductOf(cheapest), historyRowsOf(cheapest.id, history), now) : null;
    const saysSomething = note !== null && (note.roseBefore || note.belowPct !== null);
    return {
      name: model.name,
      path: modelPath(model.slug),
      versions,
      price: cheapest.price,
      note,
      drop: saysSomething ? null : confirmedDrop(cheapest, stats.get(cheapest.id), now),
    };
  });
}
