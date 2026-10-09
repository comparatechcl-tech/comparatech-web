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
export function toCardProduct(product: Product, drop?: ConfirmedDrop | null): CardProduct {
  const badges = specBadges(product.specs);
  const chip = offerChip(product.offer_info);

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    category: product.category,
    price: product.price,
    original_price: product.original_price,
    image_url: product.image_url,
    href: buyUrl(product),
    ...(badges.length > 0 && { badges }),
    ...(chip && { chip }),
    ...(product.is_featured && { is_featured: true as const }),
    ...(drop && { drop_amount: drop.amount }),
  };
}
