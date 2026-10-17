import type { PricedProduct, PricingOutcome } from '@/lib/pricing';
import type { OfferInfo } from '@/lib/types';
import { captionDiscount, formatPrice } from '@/lib/content/captions';

/**
 * Revisión en vivo del precio de las tarjetas de /admin/historias y
 * /admin/videos, antes de subir algo a las redes con el precio escrito.
 *
 * El precio de la tarjeta es el que tenía la base al cargar la página, y la
 * base se actualiza cada 30 minutos: puede ir atrasada respecto de Mercado
 * Libre. La página le pide a checkLivePrices (app/admin/live-price-actions)
 * que pregunte a Mercado Libre por cada tarjeta, igual que el refresco de
 * precios (priceProducts de lib/pricing: el ganador de la caja de compra de la
 * ficha /p/), y compara lo que la tarjeta muestra con lo que hay ahora.
 *
 * Cuenta como cambio cualquier diferencia en lo que la tarjeta y la pieza
 * dicen: el precio (aunque sea $1), el precio sin descuento o el descuento
 * redondeado, el envío gratis y Full. Con un cambio no se sube nada: la
 * página bloquea Compartir hasta tocar Actualizar.
 *
 * Nunca se abre el link de afiliado ni el meli.la para esto: cada apertura
 * cuenta como un clic de afiliado. El botón "Ver en Mercado Libre" de la
 * tarjeta usa mlCheckUrl, la ficha sin parámetros.
 *
 * Solo tipos y cuentas puras: los componentes de cliente importan de acá los
 * tipos y las constantes. Lo que lee y escribe la base está en la acción.
 */

/** Lo que la tarjeta (y la imagen o el video) muestra de la oferta. */
export interface ShownOffer {
  price: number;
  /** El precio sin descuento que se muestra, o null si no se muestra descuento. */
  listPrice: number | null;
  freeShipping: boolean;
  full: boolean;
}

export type LiveCheck =
  | { status: 'same'; checkedAt: string }
  | {
      status: 'changed';
      checkedAt: string;
      price: number;
      listPrice: number | null;
      freeShipping: boolean;
      full: boolean;
      /** La base ya tiene lo de ahora (se guardó en esta revisión o ya estaba): al tocar Actualizar sale bien. */
      saved: boolean;
      what: string;
    }
  | { status: 'unavailable'; checkedAt: string; what: string }
  | { status: 'unknown'; what: string };

/** Tarjetas por llamada: una página tiene 8 ofertas más las ya publicadas. */
export const LIVE_CHECK_MAX_ITEMS = 16;
/** Consultas a Mercado Libre a la vez. */
export const LIVE_CHECK_CONCURRENCY = 4;
/** Lo más que se espera por cada producto. Pasado esto, la tarjeta queda "no pude revisar". */
export const LIVE_CHECK_TIMEOUT_MS = 8_000;
/** Lo más que se espera el token de Mercado Libre. */
export const LIVE_CHECK_TOKEN_TIMEOUT_MS = 8_000;
/** Lo más que se espera que quede guardado un cambio encontrado. */
export const LIVE_SAVE_TIMEOUT_MS = 5_000;
/** Desde aquí no se empieza a revisar otro producto: la acción tiene 60 s (layout del admin). */
export const LIVE_CHECK_BUDGET_MS = 36_000;
/** Un "mismo precio" sirve para compartir hasta esto. */
export const LIVE_SAME_MAX_AGE_MS = 15 * 60_000;
/** Al volver a la pestaña, se revisa de nuevo si la última revisión tiene más que esto. */
export const LIVE_RECHECK_AFTER_MS = 5 * 60_000;
/**
 * Lo ya subido se avisa en rojo si ahora está más caro desde esto (1%): la
 * publicación promete un precio que ya no existe. Menos que eso es el vaivén
 * de dos vendedores.
 */
export const POSTED_RISE_ALERT = 0.01;
/**
 * Y se avisa (sin rojo) si ahora está más barato desde esto (3%, lo mismo que
 * hace volver una historia a la lista): no engaña a nadie, pero se puede
 * volver a subir con el precio nuevo.
 */
export const POSTED_DROP_NOTICE = 0.03;

/** Las frases que se muestran, listas para leer. */
export const LIVE_TEXT = {
  offline: 'La revisión en vivo funciona solo en el sitio publicado.',
  mlDown: 'No pude revisar Mercado Libre ahora.',
  mlSlow: 'Mercado Libre se demoró en responder.',
  mlConnect: 'No pude conectarme con Mercado Libre ahora.',
  siteDown: 'No pude leer el producto en el sitio ahora.',
  noMl: 'Este producto no tiene ficha de Mercado Libre para revisar.',
  badCard: 'No pude leer el precio de la tarjeta.',
  tooMany: 'Son muchas para revisar de una vez: esta quedó sin revisar.',
  outOfTime: 'No alcancé a revisarla a tiempo.',
  gone: 'Ya no está en el sitio.',
  notOnSale: 'Ya no está a la venta en el sitio.',
  noWinner: 'Ya no está a la venta en Mercado Libre: la ficha no tiene vendedor.',
  notGreen: 'Ya no está a la venta con un vendedor de reputación verde.',
  otherProduct: 'Ya no está a la venta en el sitio: su link lleva a otro producto.',
} as const;

/** posted_price y price son enteros de 32 bits en la base. */
const MAX_PRICE = 2_147_483_647;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ML_ID_RE = /^[A-Z]{3}\d{1,20}$/;

/**
 * La ficha de Mercado Libre para mirar el precio: https://www.mercadolibre.cl/p/{id},
 * sin parámetros de afiliado (mirar no es un clic de afiliado). Es la misma
 * ficha cuyo ganador guarda el sitio. null si no hay un id que sirva.
 */
export function mlCheckUrl(mlProductId: string | null | undefined): string | null {
  return typeof mlProductId === 'string' && ML_ID_RE.test(mlProductId) ? `https://www.mercadolibre.cl/p/${mlProductId}` : null;
}

function validPrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_PRICE ? Math.round(value) : null;
}

/** Lo que llega del navegador, revisado. null si el precio no sirve. Puro. */
export function normalizeShown(raw: unknown): ShownOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const price = validPrice(r.price);
  if (price === null) return null;
  return { price, listPrice: validPrice(r.listPrice), freeShipping: r.freeShipping === true, full: r.full === true };
}

/** El precio sin descuento como lo muestra una tarjeta: solo si el descuento redondeado no es 0. */
function shownList(offer: Pick<ShownOffer, 'price' | 'listPrice'>): { discount: number; list: number | null } {
  const discount = captionDiscount({ price: offer.price, original_price: offer.listPrice });
  return { discount, list: discount > 0 ? offer.listPrice : null };
}

/**
 * Qué cambió entre lo que muestra la tarjeta y lo que hay ahora, en frases
 * listas para leer; null si nada. Puro.
 */
export function describeOfferChange(shown: ShownOffer, live: ShownOffer): string | null {
  const parts: string[] = [];
  if (live.price !== shown.price) parts.push(`El precio cambió de ${formatPrice(shown.price)} a ${formatPrice(live.price)}.`);

  const before = shownList(shown);
  const now = shownList(live);
  if (before.discount > 0 && now.discount === 0) parts.push('Ya no trae descuento.');
  else if (before.discount === 0 && now.discount > 0 && now.list !== null) {
    parts.push(`Ahora trae ${now.discount}% de descuento (sin descuento ${formatPrice(now.list)}).`);
  } else if (before.discount !== now.discount) parts.push(`El descuento cambió: ahora es ${now.discount}%.`);
  else if (before.list !== null && now.list !== null && before.list !== now.list) {
    parts.push(`El precio sin descuento cambió de ${formatPrice(before.list)} a ${formatPrice(now.list)}.`);
  }

  if (shown.freeShipping && !live.freeShipping) parts.push('Ya no trae envío gratis.');
  else if (!shown.freeShipping && live.freeShipping) parts.push('Ahora trae envío gratis.');
  if (shown.full && !live.full) parts.push('Ya no llega con Full.');
  else if (!shown.full && live.full) parts.push('Ahora llega con Full.');

  return parts.length > 0 ? parts.join(' ') : null;
}

/** La fila del producto que se revisa: lo que necesita priceProducts, más si se puede mostrar. */
export type LiveRow = PricedProduct & { is_hidden?: boolean | null; deleted_at?: string | null };

/**
 * Lo que hay ahora en Mercado Libre, en los términos de la tarjeta: lo que
 * cambia según el resultado de priceProducts, y lo demás como está en la
 * base (si no cambió, es porque ML dice lo mismo). Solo tiene sentido con el
 * resultado 'activo'. Puro.
 */
export function liveOfferFrom(row: LiveRow, outcome: PricingOutcome): ShownOffer {
  const patch = outcome.patch;
  const price = typeof patch.price === 'number' ? patch.price : row.price;
  const original = 'original_price' in patch ? (patch.original_price as number | null) : row.original_price;
  const info = ('offer_info' in patch ? patch.offer_info : row.offer_info) as OfferInfo | null | undefined;
  const { list } = shownList({ price, listPrice: original });
  return { price, listPrice: list, freeShipping: info?.free_shipping === true, full: info?.is_full === true };
}

/**
 * Lo mostrado frente a lo que devolvió priceProducts para ese producto. `saved`
 * va en false: lo decide quien guarda. `now` solo se usa si el resultado no
 * trae la hora de revisión. Puro.
 */
export function liveCheckFrom(shown: ShownOffer, row: LiveRow, outcome: PricingOutcome, now: Date): LiveCheck {
  // Un tropiezo de ML (o sin la reputación del ganador) no dice nada del producto.
  if (outcome.result === 'error_transitorio') return { status: 'unknown', what: LIVE_TEXT.mlDown };
  const at = outcome.patch.price_checked_at;
  const checkedAt = typeof at === 'string' && at ? at : now.toISOString();

  if (outcome.result === 'sin_ganador') return { status: 'unavailable', checkedAt, what: LIVE_TEXT.noWinner };
  if (outcome.result === 'ganador_no_verde') return { status: 'unavailable', checkedAt, what: LIVE_TEXT.notGreen };
  if (outcome.result !== 'activo') return { status: 'unavailable', checkedAt, what: LIVE_TEXT.otherProduct };

  const live = liveOfferFrom(row, outcome);
  const what = describeOfferChange(shown, live);
  if (what === null) return { status: 'same', checkedAt };
  return { status: 'changed', checkedAt, ...live, saved: false, what };
}

/** ¿Hay algo que guardar además de la hora de revisión? (La hora sola no se escribe desde acá.) */
export function needsWrite(outcome: PricingOutcome): boolean {
  return Object.keys(outcome.patch).some((key) => key !== 'price_checked_at');
}

/**
 * El aviso de una marca ("ya la subí") hecha con un precio que ya no es el de
 * la base: la marca se guarda igual (puede que ya esté arriba), pero conviene
 * mirar la publicación. `it` es "la" (historia) o "lo" (video). null si el
 * precio es el mismo. Puro.
 */
export function markPriceWarning(shownPrice: number, priceNow: number, it: 'la' | 'lo' = 'la'): string | null {
  if (!Number.isFinite(shownPrice) || !Number.isFinite(priceNow) || priceNow <= 0) return null;
  if (Math.round(shownPrice) === Math.round(priceNow)) return null;
  return `Ojo: el precio cambió a ${formatPrice(priceNow)} desde que cargaste la lista. Si ya ${it} subiste, revisa la publicación.`;
}

/**
 * Cómo quedó el precio de algo ya subido frente al que dice la publicación:
 * 'gone' si ya no está a la venta (priceNow null), 'higher' si subió 1% o
 * más (la publicación promete un precio que ya no existe), 'lower' si bajó 3%
 * o más (se puede volver a subir) y null si no cambió lo suficiente. Puro.
 */
export function postedPriceShift(postedPrice: number, priceNow: number | null): 'gone' | 'higher' | 'lower' | null {
  if (priceNow === null) return 'gone';
  if (!Number.isFinite(postedPrice) || postedPrice <= 0 || !Number.isFinite(priceNow) || priceNow <= 0) return null;
  if (priceNow >= postedPrice * (1 + POSTED_RISE_ALERT)) return 'higher';
  if (priceNow <= postedPrice * (1 - POSTED_DROP_NOTICE)) return 'lower';
  return null;
}

// ---------------------------------------------------------------------------
// Lo que dicen las dos pantallas (/admin/historias y /admin/videos), igual en
// las dos. Puro y sin servidor: lo importan los componentes de cliente.

export const LIVE_LINE = {
  checking: 'Revisando en Mercado Libre…',
  unknown: 'No pude revisar en Mercado Libre: mira el precio con el botón antes de subir.',
  /** Lo mismo, cuando la tarjeta no tiene botón (falta la ficha de Mercado Libre). */
  unknownNoButton: 'No pude revisar en Mercado Libre: revisa el precio antes de subir.',
} as const;

/** "hace N min", con el reloj de este teléfono. Puro. */
export function minutesAgo(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes < 1 ? 'hace menos de 1 min' : `hace ${minutes} min`;
}

/**
 * La línea de un "mismo precio" que ya pasó su plazo: dejó de servir para
 * subir, así que no va en verde. Puro.
 */
export function staleSameLine(ageMs: number): string {
  return `Mismo precio ${minutesAgo(ageMs)}: como pasaron más de 15 minutos, lo reviso de nuevo al tocar Compartir.`;
}

/** El texto con su punto final, aunque llegue sin él. Puro. */
export function asSentence(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * Lo que dice una tarjeta cuya revisión encontró otra cosa en Mercado Libre.
 * `it` es "la" (historia) o "lo" (video). "El sitio ya tiene el precio nuevo"
 * solo con `saved`: es cierto tanto si lo guardó esta revisión como si ya lo
 * había guardado el refresco. Puro.
 */
export function liveChangedText(result: Extract<LiveCheck, { status: 'changed' | 'unavailable' }>, it: 'la' | 'lo'): string {
  const what = asSentence(result.what);
  const saved = result.status === 'changed' && result.saved ? ' El sitio ya tiene el precio nuevo.' : '';
  return `${what ? `${what} ` : ''}No ${it} subas: toca Actualizar.${saved}`;
}

/**
 * Solo una dirección de Mercado Libre Chile, nunca otro esquema ni otro
 * dominio en un href, y sin nada después de la ruta: así nunca lleva los
 * parámetros del link de afiliado (mirar la ficha no debe contar como clic). Puro.
 */
export function safeMlUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const bare = url.trim().split(/[?#]/)[0];
  return /^https:\/\/([a-z0-9-]+\.)*mercadolibre\.cl\/[^\s"'<>]+$/i.test(bare) ? bare : null;
}

const LIVE_STATUSES = ['same', 'changed', 'unavailable', 'unknown'];

/**
 * Lo que llega del servidor, solo si tiene la forma acordada; si no, "no se
 * pudo revisar" (nunca "mismo precio"). Llega por la red: no se da por
 * sentado. Puro.
 */
export function readLiveCheck(value: unknown): LiveCheck {
  const failed: LiveCheck = { status: 'unknown', what: LIVE_TEXT.mlDown };
  if (!value || typeof value !== 'object') return failed;
  const v = value as { status?: unknown; what?: unknown; price?: unknown };
  if (typeof v.status !== 'string' || LIVE_STATUSES.indexOf(v.status) < 0) return failed;
  if (v.status !== 'same' && typeof v.what !== 'string') return failed;
  if (v.status === 'changed' && (typeof v.price !== 'number' || !Number.isFinite(v.price))) return failed;
  return value as LiveCheck;
}

// ---------------------------------------------------------------------------
// La revisión de varias tarjetas.

export interface LiveCheckItem {
  productId: string;
  shown: ShownOffer;
}

/**
 * Lo que llega del navegador, revisado: hasta LIVE_CHECK_MAX_ITEMS tarjetas
 * para revisar (una por producto: si se repite, vale la primera) y la
 * respuesta ya decidida de las demás (precio que no sirve, o demasiadas).
 * Lo que no trae un id válido se descarta sin respuesta. Puro.
 */
export function parseLiveItems(raw: unknown): { items: LiveCheckItem[]; results: Record<string, LiveCheck> } {
  const items: LiveCheckItem[] = [];
  const results: Record<string, LiveCheck> = {};
  if (!Array.isArray(raw)) return { items, results };
  const seen = new Set<string>();
  // Un tope también para lo que se descarta: la respuesta no crece sin límite.
  for (const entry of raw.slice(0, LIVE_CHECK_MAX_ITEMS * 4)) {
    const productId = entry && typeof entry === 'object' ? (entry as { productId?: unknown }).productId : undefined;
    if (typeof productId !== 'string' || !UUID_RE.test(productId) || seen.has(productId)) continue;
    seen.add(productId);
    const shown = normalizeShown((entry as { shown?: unknown }).shown);
    if (!shown) results[productId] = { status: 'unknown', what: LIVE_TEXT.badCard };
    else if (items.length >= LIVE_CHECK_MAX_ITEMS) results[productId] = { status: 'unknown', what: LIVE_TEXT.tooMany };
    else items.push({ productId, shown });
  }
  return { items, results };
}

/** Un cambio encontrado, para la bitácora. */
export interface FoundChange {
  productId: string;
  status: 'changed' | 'unavailable';
  what: string;
  saved: boolean;
  shown: ShownOffer;
  /** Lo de ahora en ML, si sigue a la venta. */
  live: ShownOffer | null;
}

export interface LiveCheckDeps {
  /** Las filas de esos productos (las que existan). Si lanza, ninguna se puede revisar. */
  readRows(ids: string[]): Promise<LiveRow[]>;
  /** Token de Mercado Libre, o null si no se pudo. */
  token(): Promise<string | null>;
  /** El resultado de priceProducts para un producto. Nunca con verifyLink. */
  price(row: LiveRow, token: string): Promise<PricingOutcome>;
  /**
   * Guarda un cambio igual que el refresco de precios; true si quedó. Sin
   * esto no se escribe nada. Solo se llama con un cambio que la tarjeta
   * muestra (o con el producto ya no a la venta), nunca para volver a
   * publicar un producto: eso lo decide el refresco, que antes verifica el link.
   */
  save?: (outcome: PricingOutcome) => Promise<boolean>;
}

/**
 * ¿Se guarda lo que encontró la revisión? Solo si hay algo que escribir, si
 * la tarjeta o la pieza dicen otra cosa (un "mismo precio" con otro vendedor
 * o con otras ventas lo guarda el refresco de cada media hora) y si no es la
 * vuelta al sitio de un producto en pausa (el refresco la hace verificando el
 * link). Puro.
 */
export function shouldSave(check: LiveCheck, outcome: PricingOutcome): boolean {
  if (check.status !== 'changed' && check.status !== 'unavailable') return false;
  return needsWrite(outcome) && !outcome.reactivated;
}

export interface LiveCheckOptions {
  timeoutMs?: number;
  tokenTimeoutMs?: number;
  concurrency?: number;
  budgetMs?: number;
  now?: () => Date;
}

type Settled<T> = { kind: 'ok'; value: T } | { kind: 'error' } | { kind: 'timeout' };

/** La promesa o el plazo, lo que llegue primero. Nunca lanza; una falla tardía no queda suelta. */
function within<T>(promise: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded: Promise<Settled<T>> = promise.then(
    (value) => ({ kind: 'ok', value }),
    () => ({ kind: 'error' })
  );
  const late = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
  });
  return Promise.race([guarded, late]).then((settled) => {
    if (timer !== undefined) clearTimeout(timer);
    return settled;
  });
}

async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(Math.max(1, limit), items.length); i++) workers.push(worker());
  await Promise.all(workers);
}

/**
 * Revisa cada tarjeta en Mercado Libre, con un tope de consultas a la vez y
 * un plazo propio por producto: lo que falla o se demora queda 'unknown' sin
 * arrastrar a las demás. Si se pasa `save`, se guarda lo que cambió en lo que
 * la tarjeta muestra (ver shouldSave). Devuelve la respuesta de cada tarjeta
 * y los cambios encontrados.
 */
export async function runLiveChecks(
  items: LiveCheckItem[],
  deps: LiveCheckDeps,
  options: LiveCheckOptions = {}
): Promise<{ results: Record<string, LiveCheck>; changes: FoundChange[]; checked: number }> {
  const timeoutMs = options.timeoutMs ?? LIVE_CHECK_TIMEOUT_MS;
  const tokenTimeoutMs = options.tokenTimeoutMs ?? LIVE_CHECK_TOKEN_TIMEOUT_MS;
  const concurrency = options.concurrency ?? LIVE_CHECK_CONCURRENCY;
  const budgetMs = options.budgetMs ?? LIVE_CHECK_BUDGET_MS;
  const now = options.now ?? (() => new Date());
  const results: Record<string, LiveCheck> = {};
  const changes: FoundChange[] = [];
  if (items.length === 0) return { results, changes, checked: 0 };
  const startedAt = now().getTime();

  const ids = items.map((item) => item.productId);
  const read = await within(
    Promise.resolve().then(() => deps.readRows(ids)),
    timeoutMs
  );
  if (read.kind !== 'ok') {
    for (const item of items) results[item.productId] = { status: 'unknown', what: LIVE_TEXT.siteDown };
    return { results, changes, checked: 0 };
  }
  const rows = new Map<string, LiveRow>();
  for (const row of read.value) if (row && typeof row.id === 'string') rows.set(row.id, row);

  // Lo que se responde sin preguntarle a ML.
  const toCheck: { item: LiveCheckItem; row: LiveRow }[] = [];
  for (const item of items) {
    const row = rows.get(item.productId);
    const at = now().toISOString();
    if (!row) results[item.productId] = { status: 'unavailable', checkedAt: at, what: LIVE_TEXT.gone };
    // Ocultado o borrado a mano: es una decisión de una persona y el refresco tampoco lo toca.
    else if (row.is_hidden === true || row.deleted_at) {
      results[item.productId] = { status: 'unavailable', checkedAt: at, what: LIVE_TEXT.notOnSale };
    } else if (!row.ml_product_id) results[item.productId] = { status: 'unknown', what: LIVE_TEXT.noMl };
    else toCheck.push({ item, row });
  }
  if (toCheck.length === 0) return { results, changes, checked: 0 };

  const token = await within(
    Promise.resolve().then(() => deps.token()),
    tokenTimeoutMs
  );
  if (token.kind !== 'ok' || !token.value) {
    for (const { item } of toCheck) results[item.productId] = { status: 'unknown', what: LIVE_TEXT.mlConnect };
    return { results, changes, checked: 0 };
  }
  const mlToken = token.value;

  const save = deps.save;
  // Lo que se guarda tiene su propio plazo, más corto: con 4 a la vez y el
  // presupuesto de 36 s, la acción termina antes de los 60 s del admin.
  const saveTimeoutMs = Math.min(timeoutMs, LIVE_SAVE_TIMEOUT_MS);
  let checked = 0;
  await eachLimited(toCheck, concurrency, async ({ item, row }) => {
    if (now().getTime() - startedAt > budgetMs) {
      results[item.productId] = { status: 'unknown', what: LIVE_TEXT.outOfTime };
      return;
    }
    // El plazo corre para la consulta a Mercado Libre. Lo que se guarda va
    // después y aparte: si se demora, el cambio igual se muestra y queda en
    // la bitácora (como no guardado), en vez de quedar escrito sin rastro.
    const priced = await within(
      Promise.resolve().then(() => deps.price(row, mlToken)),
      timeoutMs
    );
    if (priced.kind === 'timeout') {
      results[item.productId] = { status: 'unknown', what: LIVE_TEXT.mlSlow };
      return;
    }
    if (priced.kind === 'error') {
      results[item.productId] = { status: 'unknown', what: LIVE_TEXT.mlDown };
      return;
    }
    const outcome = priced.value;
    let check = liveCheckFrom(item.shown, row, outcome, now());
    results[item.productId] = check;
    if (check.status === 'unknown') return;
    checked++;

    // Sin nada que escribir, la base ya tiene lo de ahora (el refresco lo vio antes).
    let saved = !needsWrite(outcome);
    if (save && shouldSave(check, outcome)) {
      const wrote = await within(
        Promise.resolve().then(() => save(outcome)),
        saveTimeoutMs
      );
      saved = wrote.kind === 'ok' && wrote.value === true;
    }
    if (check.status === 'changed') {
      check = { ...check, saved };
      results[item.productId] = check;
      changes.push({
        productId: item.productId,
        status: 'changed',
        what: check.what,
        saved,
        shown: item.shown,
        live: { price: check.price, listPrice: check.listPrice, freeShipping: check.freeShipping, full: check.full },
      });
    } else if (check.status === 'unavailable') {
      changes.push({ productId: item.productId, status: 'unavailable', what: check.what, saved, shown: item.shown, live: null });
    }
  });
  return { results, changes, checked };
}
