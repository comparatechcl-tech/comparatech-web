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
 *
 * Cada cambio de precio queda además en price_history. Es lo único que
 * permite decir con honestidad "bajó" o "el más bajo del mes": el precio de
 * lista que informa el vendedor puede estar inflado, el historial no. Un día
 * sin registrar es un dato que no se recupera.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getRootCategory,
  getSellers,
  getWinners,
  isGreenSeller,
  mapWithConcurrency,
  type MlOffer,
  type MlSeller,
  type WinnersResult,
} from '@/lib/ml-catalog';
import { readAffiliateSettings } from '@/lib/settings';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import type { OfferInfo } from '@/lib/types';

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
  // No están en PRICED_COLUMNS (la usan otros módulos y no puede cambiar).
  // Si quien llama no las lee, quedan undefined y se escriben igual: así
  // solo cuesta una escritura de más, nunca un dato desactualizado.
  ml_category_id?: string | null;
  ml_root_category?: string | null;
  offer_info?: OfferInfo | null;
}

/** Fila para price_history: el precio que vio el comprador en ese momento. */
export interface PriceObservation {
  product_id: string;
  ml_product_id: string;
  price: number;
  original_price: number | null;
  seller_id: number;
  winner_item_id: string;
  observed_at: string;
}

export interface PricingOutcome {
  id: string;
  result: PricingResult;
  patch: Record<string, unknown>;
  priceChanged: boolean;
  reactivated: boolean;
  deactivated: boolean;
  /** Solo cuando cambió el precio: lo que se agrega al historial. */
  observation?: PriceObservation;
}

function listPriceOf(offer: { price: number; original_price: number | null }): number | null {
  return typeof offer.original_price === 'number' && offer.original_price > offer.price
    ? offer.original_price
    : null;
}

const NO_WARRANTY_RE = /^sin garant[ií]a/i;

function warrantyText(text: string | null | undefined): string | null {
  const t = text?.trim();
  return t && !NO_WARRANTY_RE.test(t) ? t : null;
}

/**
 * "Garantía de fábrica: 2 años". El campo `warranty` de la oferta ya viene
 * armado; si falta, se arma desde sale_terms (tipo + plazo), que es de donde
 * ML lo saca para mostrarlo en su ficha.
 */
function warrantyOf(offer: MlOffer): string | null {
  const direct = warrantyText(offer.warranty);
  if (direct) return direct;

  const term = (id: string) => offer.sale_terms?.find((t) => t?.id === id)?.value_name?.trim() || null;
  const type = term('WARRANTY_TYPE');
  const time = term('WARRANTY_TIME');
  if (type && NO_WARRANTY_RE.test(type)) return null;
  if (type && time) return warrantyText(`${type}: ${time}`);
  return warrantyText(type ?? time);
}

/**
 * Señales del ganador para la ficha. Cada una sale de un campo explícito de
 * ML: si el campo no viene, la señal queda en false o null, nunca supuesta.
 */
export function offerInfoFrom(offers: MlOffer[], total: number): OfferInfo {
  const winner = offers[0];
  const lowest = Math.min(...offers.map((o) => o.price));
  return {
    free_shipping: winner.shipping?.free_shipping === true,
    is_full: winner.shipping?.logistic_type === 'fulfillment',
    sold_by_ml: (winner.tags ?? []).includes('first_party'),
    official_store: winner.official_store_id != null,
    warranty: warrantyOf(winner),
    offers_count: total,
    // Si ML no mandó todas las ofertas no se puede afirmar que es el más
    // barato: queda sin saber en vez de anunciar algo que no se comprobó.
    is_lowest: offers.length >= total ? winner.price === lowest : null,
  };
}

const OFFER_INFO_KEYS: (keyof OfferInfo)[] = [
  'free_shipping',
  'is_full',
  'sold_by_ml',
  'official_store',
  'warranty',
  'offers_count',
  'is_lowest',
];

function sameOfferInfo(a: OfferInfo, b: OfferInfo | null | undefined): boolean {
  return !!b && OFFER_INFO_KEYS.every((key) => a[key] === b[key]);
}

/**
 * Decide qué cambia en un producto a partir de lo que respondió ML. Es pura
 * (no consulta nada) para poder probar cada caso sin red.
 *
 * `roots` trae la categoría raíz de cada category_id ya consultada.
 */
export function decide(
  product: PricedProduct,
  winners: WinnersResult,
  sellers: Map<number, MlSeller>,
  now: string,
  checkLink: boolean,
  roots: Map<string, string | null> = new Map()
): PricingOutcome {
  const base = { id: product.id, priceChanged: false, reactivated: false, deactivated: false };

  // Un tropiezo de la API no dice nada del producto: no se toca.
  if (winners.status === 'error') {
    return { ...base, result: 'error_transitorio', patch: {} };
  }

  const patch: Record<string, unknown> = { price_checked_at: now };
  let reason: InactiveReason | null = null;
  let observation: PriceObservation | undefined;

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

    const offerInfo = offerInfoFrom(winners.offers, winners.total);
    if (!sameOfferInfo(offerInfo, product.offer_info)) patch.offer_info = offerInfo;

    // La raíz define la comisión (lib/commission). Solo se escribe cuando
    // cambia la categoría o si antes no se pudo averiguar.
    const categoryId = winner.category_id || null;
    if (categoryId) {
      if (categoryId !== product.ml_category_id) patch.ml_category_id = categoryId;
      const root = roots.get(categoryId);
      if (root && root !== product.ml_root_category) patch.ml_root_category = root;
    }

    if ('price' in patch || 'original_price' in patch) {
      observation = {
        product_id: product.id,
        ml_product_id: product.ml_product_id,
        price: winner.price,
        original_price: listPrice,
        seller_id: winner.seller_id,
        winner_item_id: winner.item_id,
        observed_at: now,
      };
    }

    if (!isGreenSeller(seller)) {
      reason = 'ganador_no_verde';
    } else if (
      checkLink &&
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
      ...(observation ? { observation } : {}),
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
    ...(observation ? { observation } : {}),
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
    /**
     * Con los links directos encendidos (ver lib/outbound) el botón de
     * compra se arma desde la ficha y el link guardado no se usa: que lleve
     * a otro producto deja de importar y no se verifica.
     *
     * Si no se pasa, se lee de la configuración. Antes valía false por
     * omisión, y las acciones del admin que no lo pasaban sacaban del sitio
     * por "link a otro producto" a productos que con links directos no
     * tenían ningún problema.
     */
    directLinks?: boolean;
    /**
     * Si se buscan las categorías raíz en ML (por omisión, sí). El cron lo
     * apaga cuando falta la migración 0016: sin las columnas no hay dónde
     * guardar la raíz y cada corrida repetía las mismas consultas a ML.
     */
    resolveRoots?: boolean;
    /**
     * Corte propio de las consultas de enriquecimiento (raíces), más
     * temprano que outOfTime: una consulta que empieza tarde puede tardar
     * hasta ~17 s y empujar las escrituras más allá del plazo del cron. Las
     * consultas de ganadores mantienen todo su presupuesto.
     */
    stopEnrichment?: () => boolean;
  } = {}
): Promise<PricingOutcome[]> {
  const concurrency = options.concurrency ?? 6;
  const directLinks =
    options.directLinks ?? (await readAffiliateSettings(getSupabaseAdmin())).directLinks;
  const checkLink = !directLinks;

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
  if (verifyLink && checkLink) {
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

  // Raíz de cada categoría nueva o que todavía no se conoce. getRootCategory
  // guarda las respuestas en memoria, así que en la práctica son pocas
  // llamadas por corrida aunque el catálogo tenga cientos de productos.
  const pendingCategories = new Set<string>();
  if (options.resolveRoots !== false) {
    for (const { product, winners } of fetched) {
      const categoryId = winners.status === 'ok' ? winners.offers[0].category_id : null;
      if (categoryId && (categoryId !== product.ml_category_id || !product.ml_root_category)) {
        pendingCategories.add(categoryId);
      }
    }
  }
  const roots = new Map<string, string | null>();
  await mapWithConcurrency([...pendingCategories], 4, async (categoryId) => {
    if (options.outOfTime?.() || options.stopEnrichment?.()) return;
    roots.set(categoryId, await getRootCategory(categoryId, token));
  });

  const now = new Date().toISOString();
  return fetched.map(({ product, winners }) => {
    const target = targets.get(product.id);
    if (!target) return decide(product, winners, sellers, now, checkLink, roots);

    const outcome = decide(
      { ...product, link_target_product_id: target },
      winners,
      sellers,
      now,
      checkLink,
      roots
    );
    outcome.patch.link_target_product_id = target;
    outcome.patch.link_checked_at = now;
    return outcome;
  });
}

/**
 * Columnas de la migración 0016. Si todavía no se aplicó, el update que las
 * incluye falla entero; se reintenta sin ellas para que el precio y la
 * disponibilidad se sigan actualizando igual.
 */
const OPTIONAL_COLUMNS = ['offer_info', 'ml_category_id', 'ml_root_category'];

function withoutOptionalColumns(patch: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...patch };
  for (const column of OPTIONAL_COLUMNS) delete rest[column];
  return rest;
}

/**
 * Escribe los cambios y agrega al historial los precios que cambiaron.
 * Devuelve cuántas escrituras de productos fallaron.
 */
export async function applyPricing(
  admin: SupabaseClient,
  outcomes: PricingOutcome[],
  concurrency = 8
): Promise<number> {
  const writes = outcomes.filter((o) => Object.keys(o.patch).length > 0);
  const observations: PriceObservation[] = [];

  // Apenas un update confirma que faltan las columnas nuevas, el resto de la
  // corrida las omite de entrada en vez de fallar y reintentar cada uno.
  let skipOptional = false;

  const results = await mapWithConcurrency(writes, concurrency, async (o) => {
    let patch = skipOptional ? withoutOptionalColumns(o.patch) : o.patch;
    let { error } = await admin.from('products').update(patch).eq('id', o.id);

    const hadOptional = OPTIONAL_COLUMNS.some((column) => column in patch);
    if (error && hadOptional && isMissingSchemaError(error)) {
      skipOptional = true;
      patch = withoutOptionalColumns(o.patch);
      ({ error } = await admin.from('products').update(patch).eq('id', o.id));
    }

    // Al historial solo va lo que quedó escrito en products: si el update
    // falló, el sitio sigue mostrando el precio anterior.
    if (!error && o.observation) observations.push(o.observation);
    return error ? 1 : 0;
  });

  if (observations.length > 0) {
    const { error } = await admin.from('price_history').insert(observations);
    // Sin la migración 0016 la tabla no existe y no hay nada que hacer. Un
    // historial incompleto no justifica marcar la corrida como fallida.
    if (error && !isMissingSchemaError(error)) {
      console.warn('[pricing] no se pudo guardar el historial de precios:', error.message);
    }
  }

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

/**
 * Lo que no puede esperar a la próxima corrida cuando queda poco tiempo
 * para escribir: productos que salen del sitio (sin ganador o sin vendedor
 * verde), que vuelven, o cuyo precio cambió. Suelen ser pocas filas.
 */
export function priorityOutcomes(outcomes: PricingOutcome[]): PricingOutcome[] {
  return outcomes.filter((o) => o.priceChanged || o.reactivated || o.deactivated);
}
