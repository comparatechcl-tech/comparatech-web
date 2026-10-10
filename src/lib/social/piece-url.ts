import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/safe-equal';

/**
 * Dirección pública de la pieza de un producto, para programar publicaciones
 * en redes desde fuera del sitio (Metricool solo acepta la imagen por link).
 *
 * La pieza del kit vive en /admin, detrás de la clave: nadie de fuera puede
 * bajarla. Esta dirección es pública pero va firmada, por dos razones:
 *
 *  - El precio, el precio de lista, la hora de revisión y los avisos de
 *    envío viajan en la propia dirección. Así la imagen muestra siempre lo
 *    mismo que dice el texto del post, aunque la plataforma la baje horas
 *    después y el precio ya haya cambiado en el sitio.
 *  - Sin firma, cualquiera podría armar una dirección con otro precio y
 *    obtener una "oferta" falsa con la marca de ComparaTech, servida desde
 *    el dominio del sitio.
 *
 * La clave de la firma se deriva de CRON_SECRET: no hay que cargar otra
 * variable en Vercel, y lo que se firma con ella no sirve para llamar a los
 * crons (ni al revés).
 */

export type PieceFormat = 'feed' | 'story';

export const PIECE_FORMATS: PieceFormat[] = ['feed', 'story'];

/** Lo que la pieza muestra y no sale de la base. */
export interface PieceSnapshot {
  productId: string;
  format: PieceFormat;
  price: number;
  /** Precio de lista. 0 si no hay o no es mayor que el precio. */
  listPrice: number;
  /** Cuándo se revisó el precio, en segundos Unix. 0 si no se sabe. */
  checkedAt: number;
  freeShipping: boolean;
  full: boolean;
  /** Hasta cuándo sirve la dirección, en segundos Unix. */
  expiresAt: number;
}

/**
 * Cuánto dura una dirección. Las plataformas piden links "que no venzan" y
 * no dicen si bajan la imagen al programar o al publicar. Como nada se
 * programa con más de dos días de anticipación (lib/social/networks), dos
 * semanas sobran y no dejan direcciones válidas para siempre.
 */
export const PIECE_TTL_SECONDS = 14 * 86_400;

/**
 * Largo mínimo de CRON_SECRET para firmar. Más exigente que el de los crons:
 * cada dirección firmada es pública y permite probar claves sin pasar por el
 * sitio, así que la clave tiene que ser larga de verdad.
 */
export const MIN_SIGNING_SECRET_LENGTH = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Entero sin ceros a la izquierda: cada valor tiene una sola forma de escribirse. */
const INT = '(0|[1-9]\\d{0,9})';
const FILE_RE = new RegExp(`^(feed|story)-${INT}-${INT}-${INT}-([0-3])-${INT}-([0-9a-f]{32})\\.jpg$`);

const FLAG_FREE_SHIPPING = 1;
const FLAG_FULL = 2;

/** Clave de la firma, o null si CRON_SECRET falta o es demasiado corto. */
export function pieceKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < MIN_SIGNING_SECRET_LENGTH) return null;
  return createHmac('sha256', secret).update('comparatech/social-pieza/v1').digest();
}

function flagsOf(s: Pick<PieceSnapshot, 'freeShipping' | 'full'>): number {
  return (s.freeShipping ? FLAG_FREE_SHIPPING : 0) | (s.full ? FLAG_FULL : 0);
}

function isValidSnapshot(s: PieceSnapshot): boolean {
  const ints = [s.price, s.listPrice, s.checkedAt, s.expiresAt];
  return (
    UUID_RE.test(s.productId) &&
    PIECE_FORMATS.includes(s.format) &&
    ints.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 9_999_999_999) &&
    s.price > 0
  );
}

function sign(s: PieceSnapshot, key: Buffer): string {
  const message = ['v1', s.productId, s.format, s.price, s.listPrice, s.checkedAt, flagsOf(s), s.expiresAt].join('|');
  // 128 bits: de sobra para que nadie acierte una firma probando.
  return createHmac('sha256', key).update(message).digest('hex').slice(0, 32);
}

/** Ruta de la pieza (sin dominio), o null si los datos no son válidos. */
export function piecePath(snapshot: PieceSnapshot, key: Buffer): string | null {
  const s = { ...snapshot, productId: snapshot.productId.toLowerCase() };
  if (!isValidSnapshot(s)) return null;
  const file = [s.format, s.price, s.listPrice, s.checkedAt, flagsOf(s), s.expiresAt, sign(s, key)].join('-');
  return `/social/pieza/${s.productId}/${file}.jpg`;
}

export type PieceCheck =
  | { ok: true; snapshot: PieceSnapshot }
  | { ok: false; reason: 'formato' | 'firma' | 'vencida' };

/**
 * Lee y comprueba una dirección. `nowSeconds` es la hora actual en segundos
 * Unix. Solo con ok:true se puede dibujar la pieza.
 *
 * Cada pieza tiene una sola dirección válida (id en minúsculas, números sin
 * ceros a la izquierda): si se aceptaran variantes, una dirección filtrada
 * serviría para pedir la misma imagen miles de veces saltándose el caché.
 */
export function checkPiecePath(productId: string, file: string, key: Buffer, nowSeconds: number): PieceCheck {
  const match = FILE_RE.exec(file);
  if (!UUID_RE.test(productId) || !match) return { ok: false, reason: 'formato' };

  const flags = Number(match[5]);
  const snapshot: PieceSnapshot = {
    productId,
    format: match[1] as PieceFormat,
    price: Number(match[2]),
    listPrice: Number(match[3]),
    checkedAt: Number(match[4]),
    freeShipping: (flags & FLAG_FREE_SHIPPING) !== 0,
    full: (flags & FLAG_FULL) !== 0,
    expiresAt: Number(match[6]),
  };
  if (!isValidSnapshot(snapshot)) return { ok: false, reason: 'formato' };
  // La firma antes que el vencimiento: a quien no la tiene no se le dice nada más.
  if (!safeEqual(sign(snapshot, key), match[7])) return { ok: false, reason: 'firma' };
  if (snapshot.expiresAt < nowSeconds) return { ok: false, reason: 'vencida' };
  return { ok: true, snapshot };
}

/** Lo que la pieza necesita del producto para congelar su precio. */
export interface PieceProduct {
  id: string;
  price: number;
  original_price: number | null;
  price_checked_at: string | null;
  offer_info?: { free_shipping?: boolean | null; is_full?: boolean | null } | null;
}

/** La foto fija de un producto tal como está ahora. */
export function snapshotOf(product: PieceProduct, format: PieceFormat, now: Date): PieceSnapshot {
  const checked = product.price_checked_at ? new Date(product.price_checked_at).getTime() : NaN;
  const list = product.original_price ?? 0;
  return {
    productId: product.id,
    format,
    price: Math.round(product.price),
    // Un precio de lista igual o menor no es una rebaja: no se muestra.
    listPrice: list > product.price ? Math.round(list) : 0,
    checkedAt: Number.isFinite(checked) && checked > 0 ? Math.floor(checked / 1000) : 0,
    freeShipping: product.offer_info?.free_shipping === true,
    full: product.offer_info?.is_full === true,
    // Al fin del día (UTC): el mismo precio pedido dos veces en el día da la
    // misma dirección, y la segunda vez la imagen ya está guardada.
    expiresAt: (Math.floor(now.getTime() / 86_400_000) + 1) * 86_400 + PIECE_TTL_SECONDS,
  };
}
