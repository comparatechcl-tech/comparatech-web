import { dropSince, type PriceStats } from '@/lib/deals';

/**
 * Qué cuenta como buena oferta y en qué orden se muestran.
 *
 * Hay dos señales y no valen lo mismo:
 *
 *  - El descuento sobre el precio de lista. Lo informa el vendedor en
 *    Mercado Libre y puede estar inflado (hay quien tiene "55% off" todo el
 *    año). Sirve para destacar, pero se presenta como lo que es.
 *  - La baja comprobada: el precio de hoy es menor que el que nosotros
 *    mismos registramos antes (tabla price_history). Esa sí la vimos, así
 *    que va primero y con su propio distintivo.
 *
 * Sin imports del servidor: lo usan también componentes de cliente.
 */

/** Desde este descuento un producto cuenta como oferta. */
export const MIN_DEAL_DISCOUNT = 20;

/** Desde este descuento la oferta lleva el distintivo fuerte. */
export const HOT_DEAL_DISCOUNT = 40;

/**
 * Una baja menor que esto no es noticia: un precio que pasó de $19.990 a
 * $19.890 "bajó", pero ponerlo primero en la portada sería ruido.
 */
export const MIN_DROP_PCT = 3;

export type DealTier = 'hot' | 'deal' | null;

type Priced = { price: number; original_price: number | null };

/** Descuento sobre el precio de lista, en % entero. 0 si no hay rebaja. */
export function discountOf(product: Priced): number {
  const { price, original_price: original } = product;
  if (!original || original <= price || price <= 0) return 0;
  return Math.round((1 - price / original) * 100);
}

export function dealTier(discount: number): DealTier {
  if (discount >= HOT_DEAL_DISCOUNT) return 'hot';
  if (discount >= MIN_DEAL_DISCOUNT) return 'deal';
  return null;
}

/** Baja de precio comprobada con el historial propio. */
export interface ConfirmedDrop {
  /** Cuánto bajó, en pesos. */
  amount: number;
  /** Cuánto bajó respecto del precio anterior, en %. */
  pct: number;
  /** Desde cuándo rige el precio de hoy. */
  since: string;
}

/**
 * La baja que el historial confirma para el precio de hoy, o null si no hay
 * una reciente o es demasiado chica para destacarla.
 */
export function confirmedDrop(
  product: Priced,
  stats: PriceStats | null | undefined,
  now: number = Date.now()
): ConfirmedDrop | null {
  const drop = dropSince(stats ?? null, product.price, now);
  if (!drop) return null;
  const pct = (drop.amount / (product.price + drop.amount)) * 100;
  if (pct < MIN_DROP_PCT) return null;
  return { amount: drop.amount, pct, since: drop.since };
}

/**
 * Ordena ofertas: primero las que bajaron de verdad (de mayor a menor baja)
 * y después el resto en el orden en que venían, que es por descuento. No
 * muta la lista.
 */
export function rankDeals<T extends Priced & { id: string }>(
  products: T[],
  stats: Map<string, PriceStats>,
  now: number = Date.now()
): T[] {
  const drops = new Map(products.map((p) => [p.id, confirmedDrop(p, stats.get(p.id), now)]));
  const confirmed = products
    .filter((p) => drops.get(p.id))
    .sort((a, b) => (drops.get(b.id)?.pct ?? 0) - (drops.get(a.id)?.pct ?? 0));
  return [...confirmed, ...products.filter((p) => !drops.get(p.id))];
}

/**
 * Las bajas comprobadas de una lista, por id de producto. Es un objeto plano
 * para poder pasarlo como prop a las tarjetas, que son componentes de cliente.
 */
export function dropsById<T extends Priced & { id: string }>(
  products: T[],
  stats: Map<string, PriceStats>,
  now: number = Date.now()
): Record<string, ConfirmedDrop> {
  const out: Record<string, ConfirmedDrop> = {};
  for (const p of products) {
    const drop = confirmedDrop(p, stats.get(p.id), now);
    if (drop) out[p.id] = drop;
  }
  return out;
}
