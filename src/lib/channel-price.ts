/**
 * Precios que informa el canal oficial de afiliados de Mercado Libre.
 *
 * Desde el 23-11-2026 Mercado Libre no entrega precios a esta aplicación,
 * pero en su canal para afiliados publica todos los días productos con su
 * precio y un link que identifica la ficha exacta (lib/short-links). Cuando
 * uno de esos productos ya está en el sitio, ese es su precio a la hora del
 * aviso: se guarda con esa hora, igual que un precio revisado a mano
 * (lib/manual-price), y el sitio lo muestra como el de hoy por 12 horas y
 * después con su fecha.
 *
 * Solo se toma un precio sin condiciones. Si el aviso lo ata a un cupón, a
 * una tarjeta o a cuotas, o trae montos que no se entienden, no se toma: un
 * precio que no paga cualquiera no es el precio del producto. Tampoco se
 * toma un cambio de más del doble o de menos de la mitad (casi siempre es un
 * error del aviso), ni se vuelve a publicar un producto que estaba en pausa:
 * eso lo decide una persona en la pestaña Precios.
 *
 * De la oferta (quién vende, envío, garantía) el aviso no dice nada:
 * `offer_info` queda con la marca `source: 'canal'` y el sitio no muestra
 * nada de eso (priceOnlyKnown en lib/price-freshness).
 *
 * Puro: decide qué cambia. Quien lee el canal y escribe es lib/channel-sync.
 */

import { MANUAL_OFFER_INFO, canValidateByHand, manualPriceOutcome, type ManualPriceProduct } from '@/lib/manual-price';
import { CHANNEL_PRICE_SOURCE } from '@/lib/price-freshness';
import type { PricingOutcome } from '@/lib/pricing';
import type { NoticeDeal } from '@/lib/social/deal-notice';
import type { OfferInfo } from '@/lib/types';

/** Lo que queda en offer_info: nada afirmado de la oferta, y la marca de que el precio lo informó el canal. */
export const CHANNEL_OFFER_INFO: OfferInfo = { ...MANUAL_OFFER_INFO, source: CHANNEL_PRICE_SOURCE };

/** Por qué el precio de un aviso no se llevó al sitio. */
export type ChannelSkip =
  /** El aviso ata el precio a un cupón, una tarjeta, cuotas o una suscripción. */
  | 'con_condiciones'
  /** El aviso no trae un monto para este producto. */
  | 'sin_precio'
  /** Trae varios montos y no es un "de $A a $B". */
  | 'precio_ambiguo'
  /** Menos de la mitad o más del doble del precio guardado. */
  | 'cambio_grande'
  /** El sitio ya tiene una revisión igual o más nueva que el aviso. */
  | 'ya_revisado'
  /** El producto está en pausa: no se vuelve a publicar solo. */
  | 'en_pausa'
  /** Oculto, eliminado o fuera del sitio por su link. */
  | 'fuera_del_sitio'
  /** El aviso no tiene una fecha que se entienda, o es del futuro. */
  | 'sin_fecha';

export interface ChannelPrice {
  price: number;
  /** El precio sin descuento que da el aviso ("de $A a $B"), si es creíble; si no, null. */
  listPrice: number | null;
}

/** Los mismos umbrales con que la pestaña Precios pide confirmar (lib/manual-price). */
const BIG_DROP = 0.5;
const BIG_RISE = 2;
const BIG_LIST = 3;
/** Cuánto puede diferir el descuento que dice el aviso del que sale de sus dos montos. */
const PCT_TOLERANCE = 1;
/** Desfase de relojes tolerado para un aviso "del futuro". */
const CLOCK_SKEW_MS = 5 * 60_000;

type DealPrice = Pick<NoticeDeal, 'price' | 'coupon' | 'amounts' | 'discountPct' | 'conditional'>;

/**
 * El precio que el aviso da para el producto, sin condiciones, o por qué no
 * se puede tomar. Un solo monto es el precio. Dos montos de mayor a menor son
 * "de $A a $B": el segundo es el precio y el primero el precio sin descuento,
 * que se guarda solo si es creíble (no más del triple) y calza con el
 * descuento que dice el aviso.
 */
export function noticePrice(deal: DealPrice): { ok: true; value: ChannelPrice } | { ok: false; reason: ChannelSkip } {
  if (deal.coupon || deal.conditional) return { ok: false, reason: 'con_condiciones' };
  const amounts = deal.amounts ?? (deal.price ? [deal.price] : []);
  if (amounts.length === 0) return { ok: false, reason: 'sin_precio' };
  if (amounts.length === 1) return { ok: true, value: { price: amounts[0], listPrice: null } };
  if (amounts.length === 2 && amounts[0] > amounts[1]) {
    const [list, price] = amounts;
    const pct = Math.round((1 - price / list) * 100);
    const matches = deal.discountPct === null || deal.discountPct === undefined || Math.abs(pct - deal.discountPct) <= PCT_TOLERANCE;
    return { ok: true, value: { price, listPrice: matches && list <= price * BIG_LIST ? list : null } };
  }
  return { ok: false, reason: 'precio_ambiguo' };
}

/** Lo que tiene que venir del producto para decidir. */
export type ChannelProduct = ManualPriceProduct & {
  price_checked_at: string | null;
  is_hidden?: boolean;
  deleted_at?: string | null;
};

export type ChannelDecision =
  | { ok: true; outcome: PricingOutcome; value: ChannelPrice; postedAt: string }
  | { ok: false; reason: ChannelSkip };

/**
 * Qué hacer con el precio que un aviso da para un producto del sitio.
 * `postedAt` es la hora del aviso: queda como la hora de revisión del precio.
 */
export function channelPriceDecision(
  product: ChannelProduct,
  deal: DealPrice,
  postedAt: string,
  now: number = Date.now()
): ChannelDecision {
  if (product.is_hidden || product.deleted_at || !canValidateByHand(product)) return { ok: false, reason: 'fuera_del_sitio' };
  if (!product.is_active) return { ok: false, reason: 'en_pausa' };

  const posted = Date.parse(postedAt);
  if (!Number.isFinite(posted) || posted > now + CLOCK_SKEW_MS) return { ok: false, reason: 'sin_fecha' };
  const checked = product.price_checked_at ? Date.parse(product.price_checked_at) : NaN;
  if (Number.isFinite(checked) && checked >= posted) return { ok: false, reason: 'ya_revisado' };

  const read = noticePrice(deal);
  if (!read.ok) return read;
  const { price } = read.value;
  if (product.price > 0 && (price < product.price * BIG_DROP || price > product.price * BIG_RISE)) {
    return { ok: false, reason: 'cambio_grande' };
  }

  const at = new Date(posted).toISOString();
  const outcome = manualPriceOutcome(product, read.value, at);
  return { ok: true, outcome: { ...outcome, patch: { ...outcome.patch, offer_info: CHANNEL_OFFER_INFO } }, value: read.value, postedAt: at };
}
