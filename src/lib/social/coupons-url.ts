import { createHmac } from 'node:crypto';
import { safeEqual } from '@/lib/safe-equal';
import { MIN_SIGNING_SECRET_LENGTH } from '@/lib/social/piece-url';
import { isCarouselDay } from '@/lib/social/carousel-url';
import { COUPON_MAX, couponsProblem, type Coupon } from '@/lib/social/coupons';

/**
 * Direcciones públicas de la imagen de cupones (feed e historia), firmadas
 * como las láminas del carrusel (lib/social/carousel-url) y por lo mismo: los
 * cupones viajan en la dirección, así Instagram baja exactamente lo que el
 * dueño vio, y sin la firma nadie puede armar cupones inventados con la marca
 * del sitio.
 *
 *   /social/cupones/{datos}/{feed|historia}-{vence}-{firma}.jpg
 *
 * {datos} es el día y la lista de cupones en JSON y base64url, escrito
 * siempre igual: cada imagen tiene una sola dirección válida. La clave se
 * deriva de CRON_SECRET, aparte de las otras: una firma de un lado no sirve
 * en el otro.
 */

export const COUPON_FORMATS = ['feed', 'historia'] as const;
export type CouponFormat = (typeof COUPON_FORMATS)[number];

export interface CouponSet {
  /** El día de los cupones en Chile, AAAAMMDD. */
  day: number;
  coupons: Coupon[];
  /** Hasta cuándo sirve la dirección, en segundos Unix. */
  expiresAt: number;
}

export function couponKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const secret = env.CRON_SECRET;
  if (!secret || secret.length < MIN_SIGNING_SECRET_LENGTH) return null;
  return createHmac('sha256', secret).update('comparatech/social-cupones/v1').digest();
}

const DATA_RE = /^[A-Za-z0-9_-]{8,1400}$/;
const FILE_RE = /^(feed|historia)-(0|[1-9]\d{0,9})-([0-9a-f]{32})\.jpg$/;

function encodeData(day: number, coupons: Coupon[]): string {
  const rows = coupons.map((c) => [c.code, c.kind === 'porcentaje' ? 1 : 0, c.value, c.cap, c.min, c.minWord === 'sobre' ? 1 : 0, c.note]);
  return Buffer.from(JSON.stringify([day, rows]), 'utf8').toString('base64url');
}

function decodeData(data: string): { day: number; coupons: Coupon[] } | null {
  if (!DATA_RE.test(data)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'number' || !Array.isArray(parsed[1])) return null;
  const [day, rows] = parsed as [number, unknown[]];
  if (rows.length < 1 || rows.length > COUPON_MAX) return null;
  const coupons: Coupon[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 7) return null;
    const [code, pct, value, cap, min, over, note] = row as unknown[];
    if (typeof code !== 'string' || typeof note !== 'string') return null;
    if ((pct !== 0 && pct !== 1) || (over !== 0 && over !== 1)) return null;
    if (typeof value !== 'number' || typeof cap !== 'number' || typeof min !== 'number') return null;
    coupons.push({ code, kind: pct ? 'porcentaje' : 'monto', value, cap, min, minWord: over ? 'sobre' : 'desde', note });
  }
  if (!isCarouselDay(day) || couponsProblem(coupons) !== null) return null;
  // Escrito de otra forma (espacios, orden de las claves) no vale: una sola dirección por imagen.
  if (encodeData(day, coupons) !== data) return null;
  return { day, coupons };
}

function sign(data: string, format: CouponFormat, expiresAt: number, key: Buffer): string {
  return createHmac('sha256', key).update(['cupones-v1', data, format, expiresAt].join('|')).digest('hex').slice(0, 32);
}

/** Ruta de la imagen (sin dominio), o null si los cupones no son válidos. */
export function couponPath(set: CouponSet, format: CouponFormat, key: Buffer): string | null {
  if (!isCarouselDay(set.day) || couponsProblem(set.coupons) !== null) return null;
  if (!Number.isSafeInteger(set.expiresAt) || set.expiresAt < 0 || set.expiresAt > 9_999_999_999) return null;
  if (!(COUPON_FORMATS as readonly string[]).includes(format)) return null;
  const data = encodeData(set.day, set.coupons);
  if (!DATA_RE.test(data)) return null;
  return `/social/cupones/${data}/${format}-${set.expiresAt}-${sign(data, format, set.expiresAt, key)}.jpg`;
}

export type CouponCheck =
  | { ok: true; set: CouponSet; format: CouponFormat }
  | { ok: false; reason: 'formato' | 'firma' | 'vencida' };

/** Lee y comprueba una dirección. Solo con ok:true se puede dibujar la imagen. */
export function checkCouponPath(data: string, file: string, key: Buffer, nowSeconds: number): CouponCheck {
  const m = FILE_RE.exec(file);
  if (!m) return { ok: false, reason: 'formato' };
  const decoded = decodeData(data);
  if (!decoded) return { ok: false, reason: 'formato' };
  const format = m[1] as CouponFormat;
  const expiresAt = Number(m[2]);
  if (!safeEqual(sign(data, format, expiresAt, key), m[3])) return { ok: false, reason: 'firma' };
  if (expiresAt < nowSeconds) return { ok: false, reason: 'vencida' };
  return { ok: true, set: { ...decoded, expiresAt }, format };
}

/** Hasta el fin del día (UTC) más dos: los mismos cupones el mismo día dan la misma dirección. */
export function couponExpiry(now: Date): number {
  return (Math.floor(now.getTime() / 86_400_000) + 3) * 86_400;
}
