/**
 * Lo que una tarjeta de producto necesita para dibujarse, y nada más.
 *
 * Las tarjetas son componentes de cliente (ver ProductCard), así que todo lo
 * que reciben queda escrito en el HTML de la página y otra vez en los datos
 * con que React la arma en el navegador. Con el producto entero viajaban las
 * specs completas (la tarjeta muestra a lo más tres), el link guardado, la
 * reputación del vendedor y varias fechas: cerca de 1,4 KB por tarjeta, y
 * una categoría tiene cientos. Acá se resuelve en el servidor lo que se va a
 * mostrar, y solo eso cruza.
 *
 * Sin imports del servidor: los tipos los usan componentes de cliente.
 */
import type { Product } from '@/lib/types';
import type { ConfirmedDrop } from '@/lib/deal-rank';
import { buyUrl } from '@/lib/outbound';
import { specBadges } from '@/lib/spec-badges';
import { priceDateLabel, priceState } from '@/lib/price-freshness';

export interface CardProduct {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  original_price: number | null;
  image_url: string;
  /** Destino del botón de compra, ya resuelto con lib/outbound. */
  href: string;
  /** Hasta tres specs que sirven para comparar (lib/spec-badges). */
  badges?: string[];
  /** "Envío gratis" o "Full", según la oferta ganadora. */
  chip?: string;
  is_featured?: true;
  /** Baja comprobada con el historial propio (lib/deal-rank), en pesos. */
  drop_amount?: number;
  /**
   * "23/11": el precio no se revisó hoy y va con el día de su última
   * revisión (lib/price-freshness). Sin este dato ni `no_price`, es el de hoy.
   */
  price_date?: string;
  /** No hay un precio que mostrar: nunca se revisó, o hace más de un mes. */
  no_price?: true;
}

/**
 * Lo mínimo que se lee de la oferta ganadora. Se declara acá y no se usa el
 * tipo completo para que funcione aunque el producto todavía no traiga ese
 * dato (columna de una migración, se llena con el cron).
 */
type CardOfferInfo = { free_shipping?: boolean | null; is_full?: boolean | null };

/** Un solo chip, el que más pesa al decidir: envío gratis gana a Full. */
function offerChip(offer: CardOfferInfo | null | undefined): string | null {
  if (!offer) return null;
  if (offer.free_shipping === true) return 'Envío gratis';
  if (offer.is_full === true) return 'Full';
  return null;
}

/**
 * Los datos opcionales que no aplican se omiten en vez de ir vacíos: la
 * mayoría de las tarjetas no es destacada ni tiene una baja comprobada.
 */
/**
 * Cómo carga la foto de una tarjeta. Por defecto ("lazy"), cuando se acerca
 * a la pantalla. Las primeras de un listado se ven sin bajar, y una foto que
 * espera es justo lo que Google mide como carga lenta (LCP): "priority" la
 * pide antes que todo y "eager" la pide sin esperar.
 */
export type CardImageLoading = 'priority' | 'eager' | 'lazy';

/** Las que se piden antes que todo, como mucho: la primera fila en el teléfono (dos por fila). */
const PRIORITY_IMAGES = 2;

/** La carga de la foto de la tarjeta `index` cuando las primeras `eager` se ven al abrir la página. */
export function cardImageLoading(index: number, eager: number): CardImageLoading {
  if (index >= eager) return 'lazy';
  return index < PRIORITY_IMAGES ? 'priority' : 'eager';
}

export function toCardProduct(product: Product, drop?: ConfirmedDrop | null, now: number = Date.now()): CardProduct {
  const badges = specBadges(product.specs);
  // Con el precio sin revisar hoy no se afirma nada de la oferta: ni
  // descuento, ni envío, ni una baja (lib/price-freshness).
  const state = priceState(product.price_checked_at, now);
  const today = state === 'hoy';
  const chip = today ? offerChip(product.offer_info) : null;

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    original_price: today ? product.original_price : null,
    image_url: product.image_url,
    href: buyUrl(product),
    ...(badges.length > 0 && { badges }),
    ...(chip && { chip }),
    ...(product.is_featured && { is_featured: true as const }),
    ...(today && drop && { drop_amount: drop.amount }),
    ...(state === 'referencia' && product.price_checked_at && { price_date: priceDateLabel(product.price_checked_at) }),
    ...(state === 'sin_precio' && { no_price: true as const }),
  };
}
