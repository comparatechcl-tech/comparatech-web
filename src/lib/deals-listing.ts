/**
 * La lista de /ofertas, de a tandas.
 *
 * Antes la página llevaba todas las ofertas escritas en el HTML (325, cerca
 * de 700 KB) para poder filtrarlas en el navegador, y crecía con el
 * catálogo. Ahora lleva solo la primera tanda; las siguientes, y las de
 * cada filtro, se piden a /ofertas/lote, que filtra en el servidor.
 *
 * Sin I/O y sin imports del servidor: lo usan la página, la ruta de tandas
 * y el componente de cliente, y se prueba con datos fijos.
 */
import { HOT_DEAL_DISCOUNT, discountOf, type ConfirmedDrop } from '@/lib/deal-rank';
import { toCardProduct, type CardProduct } from '@/lib/card-product';
import type { Product } from '@/lib/types';

/** Cuántas ofertas trae la página y cada "ver más". */
export const DEALS_PAGE = 48;

export interface DealsFilter {
  /** Slug de la categoría, o null para todas. */
  category: string | null;
  /** Solo las de HOT_DEAL_DISCOUNT % o más. */
  hot: boolean;
}

export const ALL_DEALS: DealsFilter = { category: null, hot: false };

export interface DealsBatch {
  items: CardProduct[];
  /** Cuántas ofertas cumplen el filtro en total, no solo en esta tanda. */
  total: number;
}

/** Identifica un filtro: sirve de llave para lo que ya se cargó. */
export function dealsFilterKey(filter: DealsFilter): string {
  return `${filter.category ?? ''}|${filter.hot ? 1 : 0}`;
}

function matchesFilter(product: Product, filter: DealsFilter): boolean {
  if (filter.category && product.category !== filter.category) return false;
  return !filter.hot || discountOf(product) >= HOT_DEAL_DISCOUNT;
}

/** Cuántas ofertas llevan el distintivo fuerte (el chip "40% o más"). */
export function countHotDeals(deals: Product[]): number {
  return deals.filter((p) => discountOf(p) >= HOT_DEAL_DISCOUNT).length;
}

/**
 * Una tanda de la lista ya ordenada (ver rankDeals), lista para las
 * tarjetas. El filtro no cambia el orden: las bajas comprobadas siguen
 * primero dentro de cada categoría.
 */
export function dealsBatch(
  ranked: Product[],
  drops: Record<string, ConfirmedDrop>,
  filter: DealsFilter,
  offset: number
): DealsBatch {
  const matching = ranked.filter((p) => matchesFilter(p, filter));
  return {
    items: matching.slice(offset, offset + DEALS_PAGE).map((p) => toCardProduct(p, drops[p.id])),
    total: matching.length,
  };
}

/** Lo que el navegador lleva cargado de un filtro. */
export interface LoadedDeals {
  items: CardProduct[];
  total: number;
  /** Desde dónde se pide la tanda siguiente. */
  next: number;
  /** ¿Quedan tandas por pedir? */
  more: boolean;
}

/**
 * Suma una tanda a lo ya cargado. La página y cada tanda salen del caché en
 * momentos distintos: si entre medio una oferta subió de puesto, vuelve a
 * venir en la tanda siguiente, y se descarta para no repetir la tarjeta.
 * Por eso `next` avanza de a tandas enteras y no según cuántas se sumaron.
 */
export function appendDealsBatch(
  current: LoadedDeals | undefined,
  batch: DealsBatch,
  offset: number
): LoadedDeals {
  const seen = new Set(current?.items.map((p) => p.id));
  const next = offset + DEALS_PAGE;
  return {
    items: [...(current?.items ?? []), ...batch.items.filter((p) => !seen.has(p.id))],
    total: batch.total,
    next,
    // Una tanda incompleta es la última, aunque el total diga otra cosa.
    more: batch.items.length === DEALS_PAGE && next < batch.total,
  };
}

/** Dónde se pide una tanda. Los valores por defecto se omiten. */
export function dealsBatchUrl(filter: DealsFilter, offset: number): string {
  const qs = new URLSearchParams();
  if (filter.category) qs.set('cat', filter.category);
  if (filter.hot) qs.set('hot', '1');
  if (offset > 0) qs.set('desde', String(offset));
  const query = qs.toString();
  return `/ofertas/lote${query ? `?${query}` : ''}`;
}

const BATCH_PARAMS = new Set(['cat', 'hot', 'desde']);
const CATEGORY_SLUG_RE = /^[a-z0-9-]{1,40}$/;
const OFFSET_RE = /^\d{1,6}$/;

/**
 * Lee lo que pide /ofertas/lote. Es estricto a propósito: cada dirección
 * distinta es una respuesta distinta en el caché, así que solo se aceptan
 * las que arma dealsBatchUrl. Un parámetro de más, repetido o con otro
 * formato es null (la ruta responde 400).
 */
export function parseDealsBatchQuery(
  params: URLSearchParams
): { filter: DealsFilter; offset: number } | null {
  for (const key of params.keys()) {
    if (!BATCH_PARAMS.has(key) || params.getAll(key).length !== 1) return null;
  }

  const cat = params.get('cat');
  if (cat !== null && !CATEGORY_SLUG_RE.test(cat)) return null;

  const hot = params.get('hot');
  if (hot !== null && hot !== '1') return null;

  const desde = params.get('desde');
  if (desde !== null && !OFFSET_RE.test(desde)) return null;
  const offset = desde === null ? 0 : Number(desde);
  // Las tandas parten siempre en un múltiplo de DEALS_PAGE.
  if (offset % DEALS_PAGE !== 0) return null;

  return { filter: { category: cat, hot: hot === '1' }, offset };
}
