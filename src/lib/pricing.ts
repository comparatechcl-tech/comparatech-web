/**
 * Precio y disponibilidad de los productos publicados.
 *
 * El precio que se publica es el del GANADOR de la caja de compra de Mercado
 * Libre: la primera oferta de /products/{id}/items, que es la que el
 * comprador ve al llegar a la ficha.
 *
 * Antes se seguía a la oferta desde la que se había generado el link de
 * afiliado. Pero el link aterriza en el perfil de la cuenta afiliada, y su
 * botón "Ir a producto" lleva a la ficha de catálogo, donde ML muestra su
 * propio ganador. En una auditoría, 26 de 80 productos activos publicaban un
 * precio distinto al de la ficha —siempre más caro: un Galaxy S26 Ultra
 * figuraba a $1.849.989 cuando la ficha lo mostraba a $1.114.917— y 30 de
 * los 48 productos dados de baja tenían un vendedor ganador vigente, o sea
 * que se podían comprar sin problemas.
 *
 * La regla de reputación verde del Programa de Afiliados se aplica sobre el
 * ganador, que es quien efectivamente le vende al comprador. En la misma
 * auditoría el ganador fue verde en 78 de 78 casos.
 *
 * Lo usan el cron de precios y las acciones del admin, para que "revisar
 * ahora" haga exactamente lo mismo que la corrida automática.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSellers,
  getWinners,
  isGreenSeller,
  mapWithConcurrency,
  type MlSeller,
  type WinnersResult,
} from '@/lib/ml-catalog';

import type { InactiveReason } from '@/lib/inactive-reasons';

export type { InactiveReason };

export type PricingResult = 'activo' | InactiveReason | 'error_transitorio';

export const PRICED_COLUMNS =
  'id, ml_product_id, affiliate_url, price, original_price, seller_id, seller_sales_count, is_active, inactive_reason, inactive_since, winner_item_id, link_target_product_id, link_checked_at';

export interface PricedProduct {
  id: string;
  ml_product_id: string;
  affiliate_url: string;
  price: number;
  original_price: number | null;
  seller_id: number | null;
  seller_sales_count: number;
  is_active: boolean;
  inactive_reason: InactiveReason | null;
  inactive_since: string | null;
  winner_item_id: string | null;
  link_target_product_id: string | null;
  link_checked_at: string | null;
}

export interface PricingOutcome {
  id: string;
  result: PricingResult;
  patch: Record<string, unknown>;
  priceChanged: boolean;
  reactivated: boolean;
  deactivated: boolean;
}

function listPriceOf(offer: { price: number; original_price: number | null }): number | null {
  return typeof offer.original_price === 'number' && offer.original_price > offer.price
    ? offer.original_price
    : null;
}

function decide(
  product: PricedProduct,
  winners: WinnersResult,
  sellers: Map<number, MlSeller>,
  now: string
): PricingOutcome {
  const base = { id: product.id, priceChanged: false, reactivated: false, deactivated: false };

  // Un tropiezo de la API no dice nada del producto: no se toca.
  if (winners.status === 'error') {
    return { ...base, result: 'error_transitorio', patch: {} };
  }

  const patch: Record<string, unknown> = { price_checked_at: now };
  let reason: InactiveReason | null = null;

  if (winners.status === 'no_winner') {
    reason = 'sin_ganador';
  } else {
    const winner = winners.offers[0];
    const seller = sellers.get(winner.seller_id);

    // Sin la reputación del ganador no se puede decidir: mejor no tocar.
    if (!seller) return { ...base, result: 'error_transitorio', patch: {} };

    const listPrice = listPriceOf(winner);
    if (winner.price !== product.price) patch.price = winner.price;
    if (listPrice !== product.original_price) patch.original_price = listPrice;
    if (winner.seller_id !== product.seller_id) patch.seller_id = winner.seller_id;
    if (winner.item_id !== product.winner_item_id) patch.winner_item_id = winner.item_id;
    if (seller.salesCount !== product.seller_sales_count) patch.seller_sales_count = seller.salesCount;

    if (!isGreenSeller(seller)) {
      reason = 'ganador_no_verde';
    } else if (
      product.link_target_product_id &&
      product.link_target_product_id !== product.ml_product_id
    ) {
      reason = 'link_otro_producto';
    }
  }

  const priceChanged = 'price' in patch || 'original_price' in patch;

  if (reason) {
    if (product.is_active) patch.is_active = false;
    if (product.inactive_reason !== reason) patch.inactive_reason = reason;
    if (product.is_active || !product.inactive_since) patch.inactive_since = now;
    return {
      ...base,
      result: reason,
      patch,
      priceChanged,
      deactivated: product.is_active,
    };
  }

  if (!product.is_active) patch.is_active = true;
  if (product.inactive_reason) patch.inactive_reason = null;
  if (product.inactive_since) patch.inactive_since = null;

  return {
    ...base,
    result: 'activo',
    patch,
    priceChanged,
    reactivated: !product.is_active,
  };
}

/** Consulta a ML el ganador de cada producto y decide qué hay que actualizar. */
export async function priceProducts(
  products: PricedProduct[],
  token: string,
  options: {
    concurrency?: number;
    outOfTime?: () => boolean;
    /**
     * Devuelve la ficha a la que lleva el link (null si no se pudo saber).
     * Si se pasa, se usa con los productos que están por volver al sitio
     * con un link que nunca se verificó (ver más abajo).
     */
    verifyLink?: (product: PricedProduct) => Promise<string | null>;
  } = {}
): Promise<PricingOutcome[]> {
  const concurrency = options.concurrency ?? 6;

  const fetched = await mapWithConcurrency(products, concurrency, async (product) => {
    const winners: WinnersResult = options.outOfTime?.()
      ? { status: 'error', detail: 'sin tiempo en esta corrida' }
      : await getWinners(product.ml_product_id, token);
    return { product, winners };
  });

  const sellers = await getSellers(
    fetched.flatMap(({ winners }) => (winners.status === 'ok' ? [winners.offers[0].seller_id] : [])),
    token
  );

  // Un producto que vuelve al sitio con un link nunca verificado se
  // verifica justo antes de republicarlo. Es el único momento en que se
  // puede: mientras la ficha no tiene vendedor, el perfil de afiliado no
  // muestra el producto y el link no dice a dónde lleva. Así un link que
  // abre otro color u otro modelo no vuelve a publicarse.
  const targets = new Map<string, string>();
  const verifyLink = options.verifyLink;
  if (verifyLink) {
    const returning = fetched.filter(
      ({ product, winners }) =>
        !product.is_active &&
        !product.link_checked_at &&
        product.affiliate_url &&
        winners.status === 'ok' &&
        isGreenSeller(sellers.get(winners.offers[0].seller_id))
    );
    await mapWithConcurrency(returning, 3, async ({ product }) => {
      if (options.outOfTime?.()) return;
      const target = await verifyLink(product);
      if (target) targets.set(product.id, target);
    });
  }

  const now = new Date().toISOString();
  return fetched.map(({ product, winners }) => {
    const target = targets.get(product.id);
    if (!target) return decide(product, winners, sellers, now);

    const outcome = decide({ ...product, link_target_product_id: target }, winners, sellers, now);
    outcome.patch.link_target_product_id = target;
    outcome.patch.link_checked_at = now;
    return outcome;
  });
}

/** Escribe los cambios. Devuelve cuántas escrituras fallaron. */
export async function applyPricing(
  admin: SupabaseClient,
  outcomes: PricingOutcome[],
  concurrency = 8
): Promise<number> {
  const writes = outcomes.filter((o) => Object.keys(o.patch).length > 0);
  const results = await mapWithConcurrency(writes, concurrency, async (o) => {
    const { error } = await admin.from('products').update(o.patch).eq('id', o.id);
    return error ? 1 : 0;
  });
  return results.reduce<number>((sum, failed) => sum + failed, 0);
}

export function summarizePricing(outcomes: PricingOutcome[]) {
  const count = (result: PricingResult) => outcomes.filter((o) => o.result === result).length;
  return {
    revisados: outcomes.length,
    activos: count('activo'),
    precios_actualizados: outcomes.filter((o) => o.priceChanged).length,
    reactivados: outcomes.filter((o) => o.reactivated).length,
    desactivados: outcomes.filter((o) => o.deactivated).length,
    en_pausa: {
      sin_ganador: count('sin_ganador'),
      ganador_no_verde: count('ganador_no_verde'),
      link_otro_producto: count('link_otro_producto'),
    },
    errores_transitorios: count('error_transitorio'),
  };
}

/** ¿Cambió algo que el visitante del sitio vería? */
export function hasVisibleChanges(outcomes: PricingOutcome[]): boolean {
  return outcomes.some((o) => o.priceChanged || o.reactivated || o.deactivated);
}
