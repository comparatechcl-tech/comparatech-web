import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/safe-equal';
import { MIN_SIGNING_SECRET_LENGTH, PIECE_TTL_SECONDS } from '@/lib/social/piece-url';

/**
 * Direcciones públicas de las láminas de un carrusel para Instagram y
 * Facebook (portada, una lámina por producto y cierre), firmadas igual que
 * las piezas de un producto (lib/social/piece-url) y por lo mismo: lo que la
 * lámina dice viaja en la dirección, así la imagen dice siempre lo que decía
 * la tarjeta del admin, y sin la firma cualquiera podría armar una "baja"
 * inventada con la marca del sitio.
 *
 * Todas las láminas de un carrusel cuelgan de la misma carpeta, que es la
 * lista de sus productos en orden: /social/carrusel/{id1}.{id2}…/{archivo}.
 * La portada la necesita entera (muestra la foto de cada uno) y cada lámina
 * de producto dice cuál es el suyo con su puesto ("1" es el primero).
 *
 * La firma cubre todo: el tipo de carrusel, el día, la lista, el puesto, el
 * precio, la baja y desde cuándo, la hora de revisión, el envío y el
 * vencimiento. La clave se deriva de CRON_SECRET, aparte de la de las piezas:
 * una firma de un lado no sirve en el otro.
 *
 * Hoy hay un solo tipo, 'bajas' (Top 5 bajas de la semana). Para sumar otro
 * ("Lo que vamos a vigilar en Black Friday", el balance, regalos por
 * presupuesto) se agrega a CAROUSEL_KINDS y la plantilla
 * (lib/content/carousel-template) le pone sus textos; la dirección no cambia.
 */

export const CAROUSEL_KINDS = ['bajas'] as const;
export type CarouselKind = (typeof CAROUSEL_KINDS)[number];

/** Productos que caben en la dirección. Instagram deja hasta 20 láminas; 8 más portada y cierre son 10. */
export const CAROUSEL_MAX_ITEMS = 8;

/** Lo que comparten todas las láminas de un carrusel. */
export interface CarouselSet {
  kind: CarouselKind;
  /** El día del carrusel en Chile, como AAAAMMDD (20261018). */
  day: number;
  /** Los productos, en el orden del carrusel: el primero es el puesto 1. */
  ids: string[];
  /** Hasta cuándo sirve la dirección, en segundos Unix. */
  expiresAt: number;
}

/** Lo que dice la lámina de un producto, además de lo que sale de la base (nombre, marca y foto). */
export interface CarouselItem {
  /** Puesto en el carrusel, desde 1. */
  rank: number;
  price: number;
  /** Cuánto bajó, en pesos, según el historial propio. */
  dropAmount: number;
  /** Desde cuándo rige el precio de hoy, en segundos Unix. */
  dropSince: number;
  /** Cuándo se revisó el precio, en segundos Unix. 0 si no se sabe. */
  checkedAt: number;
  freeShipping: boolean;
  full: boolean;
}

export type CarouselSlide =
  | { type: 'portada'; set: CarouselSet }
  | { type: 'producto'; set: CarouselSet; item: CarouselItem }
  | { type: 'cierre'; set: CarouselSet };

/** Clave de la firma, o null si CRON_SECRET falta o es demasiado corto (el mismo largo que piden las piezas). */
export function carouselKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < MIN_SIGNING_SECRET_LENGTH) return null;
  return createHmac('sha256', secret).update('comparatech/social-carrusel/v1').digest();
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IDS_RE = new RegExp(`^${UUID}(\\.${UUID}){0,${CAROUSEL_MAX_ITEMS - 1}}$`);
/** Entero sin ceros a la izquierda: cada valor tiene una sola forma de escribirse. */
const INT = '(0|[1-9]\\d{0,9})';
const KIND = `(${CAROUSEL_KINDS.join('|')})`;
const DAY = '(20\\d{6})';
const SIG = '([0-9a-f]{32})';
const COVER_RE = new RegExp(`^(portada|cierre)-${KIND}-${DAY}-${INT}-${SIG}\\.jpg$`);
const ITEM_RE = new RegExp(`^([1-${CAROUSEL_MAX_ITEMS}])-${KIND}-${DAY}-${INT}-${INT}-${INT}-${INT}-([0-3])-${INT}-${SIG}\\.jpg$`);

const FLAG_FREE_SHIPPING = 1;
const FLAG_FULL = 2;
const MAX_INT = 9_999_999_999;

function flagsOf(item: Pick<CarouselItem, 'freeShipping' | 'full'>): number {
  return (item.freeShipping ? FLAG_FREE_SHIPPING : 0) | (item.full ? FLAG_FULL : 0);
}

const isInt = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_INT;

/** ¿Es un día de verdad (AAAAMMDD)? */
export function isCarouselDay(day: number): boolean {
  if (!Number.isInteger(day) || day < 20_000_101 || day > 20_991_231) return false;
  const y = Math.floor(day / 10_000);
  const m = Math.floor(day / 100) % 100;
  const d = day % 100;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isValidSet(set: CarouselSet): boolean {
  return (
    (CAROUSEL_KINDS as readonly string[]).includes(set.kind) &&
    isCarouselDay(set.day) &&
    set.ids.length >= 1 &&
    set.ids.length <= CAROUSEL_MAX_ITEMS &&
    new Set(set.ids).size === set.ids.length &&
    IDS_RE.test(set.ids.join('.')) &&
    isInt(set.expiresAt)
  );
}

function isValidItem(set: CarouselSet, item: CarouselItem): boolean {
  return (
    Number.isInteger(item.rank) &&
    item.rank >= 1 &&
    item.rank <= set.ids.length &&
    [item.price, item.dropAmount, item.dropSince, item.checkedAt].every(isInt) &&
    item.price > 0 &&
    // Un carrusel de bajas sin baja (o sin fecha de la baja) no existe.
    (set.kind !== 'bajas' || (item.dropAmount > 0 && item.dropSince > 0))
  );
}

function sign(slide: CarouselSlide, key: Buffer): string {
  const { set } = slide;
  const fields: (string | number)[] = ['carrusel-v1', set.kind, set.day, set.ids.join('.'), slide.type];
  if (slide.type === 'producto') {
    const i = slide.item;
    fields.push(i.rank, i.price, i.dropAmount, i.dropSince, i.checkedAt, flagsOf(i));
  }
  fields.push(set.expiresAt);
  // 128 bits: de sobra para que nadie acierte una firma probando.
  return createHmac('sha256', key).update(fields.join('|')).digest('hex').slice(0, 32);
}

/** Ruta de la lámina (sin dominio), o null si los datos no son válidos. */
export function carouselPath(slide: CarouselSlide, key: Buffer): string | null {
  const set = { ...slide.set, ids: slide.set.ids.map((id) => id.toLowerCase()) };
  const s = { ...slide, set } as CarouselSlide;
  if (!isValidSet(set)) return null;
  if (s.type === 'producto' && !isValidItem(set, s.item)) return null;
  const head =
    s.type === 'producto'
      ? [s.item.rank, set.kind, set.day, s.item.price, s.item.dropAmount, s.item.dropSince, s.item.checkedAt, flagsOf(s.item)]
      : [s.type, set.kind, set.day];
  return `/social/carrusel/${set.ids.join('.')}/${[...head, set.expiresAt, sign(s, key)].join('-')}.jpg`;
}

export type CarouselCheck =
  | { ok: true; slide: CarouselSlide }
  | { ok: false; reason: 'formato' | 'firma' | 'vencida' };

/**
 * Lee y comprueba una dirección. `nowSeconds` es la hora actual en segundos
 * Unix. Solo con ok:true se puede dibujar la lámina. Como en las piezas, cada
 * lámina tiene una sola dirección válida (ids en minúsculas, números sin
 * ceros a la izquierda).
 */
export function checkCarouselPath(idsSegment: string, file: string, key: Buffer, nowSeconds: number): CarouselCheck {
  if (!IDS_RE.test(idsSegment)) return { ok: false, reason: 'formato' };
  const ids = idsSegment.split('.');

  let slide: CarouselSlide;
  let given: string;
  const cover = COVER_RE.exec(file);
  const item = cover ? null : ITEM_RE.exec(file);
  if (cover) {
    const set: CarouselSet = { kind: cover[2] as CarouselKind, day: Number(cover[3]), ids, expiresAt: Number(cover[4]) };
    slide = { type: cover[1] as 'portada' | 'cierre', set };
    given = cover[5];
  } else if (item) {
    const flags = Number(item[8]);
    const set: CarouselSet = { kind: item[2] as CarouselKind, day: Number(item[3]), ids, expiresAt: Number(item[9]) };
    slide = {
      type: 'producto',
      set,
      item: {
        rank: Number(item[1]),
        price: Number(item[4]),
        dropAmount: Number(item[5]),
        dropSince: Number(item[6]),
        checkedAt: Number(item[7]),
        freeShipping: (flags & FLAG_FREE_SHIPPING) !== 0,
        full: (flags & FLAG_FULL) !== 0,
      },
    };
    given = item[10];
  } else {
    return { ok: false, reason: 'formato' };
  }

  if (!isValidSet(slide.set) || (slide.type === 'producto' && !isValidItem(slide.set, slide.item))) {
    return { ok: false, reason: 'formato' };
  }
  // La firma antes que el vencimiento: a quien no la tiene no se le dice nada más.
  if (!safeEqual(sign(slide, key), given)) return { ok: false, reason: 'firma' };
  if (slide.set.expiresAt < nowSeconds) return { ok: false, reason: 'vencida' };
  return { ok: true, slide };
}

/**
 * Hasta cuándo sirve una dirección armada ahora: al fin del día (UTC) más
 * las dos semanas de las piezas. El mismo carrusel pedido dos veces en el día
 * da las mismas direcciones, y la segunda vez las imágenes ya están guardadas.
 */
export function carouselExpiry(now: Date): number {
  return (Math.floor(now.getTime() / 86_400_000) + 1) * 86_400 + PIECE_TTL_SECONDS;
}

const CHILE_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Santiago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** El día en Chile de un instante, como AAAAMMDD. */
export function chileDay(at: Date | number): number {
  return Number(CHILE_DAY.format(typeof at === 'number' ? new Date(at) : at).replace(/-/g, ''));
}

/** Un día AAAAMMDD movido `days` días (negativo, hacia atrás). */
export function addDays(day: number, days: number): number {
  const date = new Date(Date.UTC(Math.floor(day / 10_000), (Math.floor(day / 100) % 100) - 1, day % 100) + days * 86_400_000);
  return date.getUTCFullYear() * 10_000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Cuántos días mira cada tipo de carrusel, contando el del carrusel: lo que dicen la portada y el cierre. */
export const CAROUSEL_WINDOW_DAYS: Record<CarouselKind, number> = { bajas: 7 };

/** Los días que cubre un carrusel, para la portada, el cierre y el texto: "del 12 al 18 de octubre". */
export function carouselRangeLabel(kind: CarouselKind, day: number): string {
  return dayRangeLabel(addDays(day, -(CAROUSEL_WINDOW_DAYS[kind] - 1)), day);
}

/** "del 12 al 18 de octubre", o "del 28 de octubre al 3 de noviembre" si cambia el mes. */
export function dayRangeLabel(from: number, to: number): string {
  const part = (day: number) => ({ d: day % 100, m: MONTHS[(Math.floor(day / 100) % 100) - 1], y: Math.floor(day / 10_000) });
  const a = part(from);
  const b = part(to);
  if (a.m === b.m && a.y === b.y) return `del ${a.d} al ${b.d} de ${b.m}`;
  return `del ${a.d} de ${a.m} al ${b.d} de ${b.m}`;
}
