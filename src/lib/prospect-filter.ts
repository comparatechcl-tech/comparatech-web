/**
 * Decide qué candidatos prospectados vale la pena poner a revisión humana.
 *
 * El problema que resuelve: el prospector trae los destacados de ML cada día
 * y esos destacados se repiten. En una revisión real, 8 de 9 candidatos
 * pendientes eran variantes de color de productos que el sitio ya tenía
 * publicados (otro Blik Soul250, otro Redmi Buds, otra Silla GX2000). Cada
 * uno de esos obliga a una persona a mirarlo y descartarlo a mano, todos los
 * días, para no publicar lo mismo dos veces.
 *
 * Como los listados ya muestran una sola variante por familia (la más
 * barata), publicar otro color del mismo modelo no agrega nada al sitio...
 * salvo que sea bastante más barato. Ese caso sí importa: entre los colores
 * de unos mismos Redmi Buds había $7.300 de diferencia.
 */

/**
 * Cuánto más barato tiene que ser un color nuevo de un producto ya publicado
 * para que valga la pena revisarlo.
 *
 * Existe para amortiguar el ruido: los precios de ML se mueven todos los
 * días, y sin un margen cualquier variante que hoy esté $200 más barata
 * volvería a la cola de revisión, mañana la otra, y así indefinidamente.
 */
export const MIN_PRICE_IMPROVEMENT = 0.05;

export interface PublishedCatalog {
  /** ml_product_id de todo lo que ya está publicado y activo. */
  productIds: Set<string>;
  /** Precio más bajo publicado para cada familia. */
  cheapestByFamily: Map<string, number>;
}

export interface CandidateLike {
  ml_product_id: string;
  ml_family_id?: string | null;
  price: number;
}

export function buildPublishedCatalog(
  rows: { ml_product_id: string | null; ml_family_id: string | null; price: number }[]
): PublishedCatalog {
  const productIds = new Set<string>();
  const cheapestByFamily = new Map<string, number>();

  for (const row of rows) {
    if (row.ml_product_id) productIds.add(row.ml_product_id);
    if (!row.ml_family_id) continue;

    const current = cheapestByFamily.get(row.ml_family_id);
    if (current === undefined || row.price < current) {
      cheapestByFamily.set(row.ml_family_id, row.price);
    }
  }

  return { productIds, cheapestByFamily };
}

export type SkipReason =
  | 'ya_publicado'
  | 'familia_ya_publicada'
  | 'variante_del_mismo_lote';

/**
 * Colapsa las variantes que vienen dentro de un mismo lote, quedándose con la
 * más barata de cada familia.
 *
 * Hace falta además del filtro contra el catálogo publicado: los destacados
 * de ML traen los colores juntos. En un lote real llegaron cuatro Filamentos
 * 3D Tronxy PLA —violeta, negro, naranja y rosa— y ninguno estaba publicado
 * todavía, así que los cuatro habrían pasado a revisión para terminar siendo
 * el mismo producto.
 */
export function collapseCandidateFamilies<T extends CandidateLike>(
  candidates: T[]
): { kept: T[]; dropped: T[] } {
  const cheapestByFamily = new Map<string, T>();

  for (const candidate of candidates) {
    if (!candidate.ml_family_id) continue;
    const current = cheapestByFamily.get(candidate.ml_family_id);
    if (!current || candidate.price < current.price) {
      cheapestByFamily.set(candidate.ml_family_id, candidate);
    }
  }

  const winners = new Set(cheapestByFamily.values());
  const kept: T[] = [];
  const dropped: T[] = [];

  for (const candidate of candidates) {
    // Sin familia no hay con qué agrupar: pasa tal cual.
    if (!candidate.ml_family_id || winners.has(candidate)) kept.push(candidate);
    else dropped.push(candidate);
  }

  return { kept, dropped };
}

/**
 * Separa los candidatos que merecen revisión de los que solo repiten el
 * catálogo. Los descartados se devuelven con su motivo en vez de perderse:
 * el resumen diario tiene que poder decir qué se filtró y por qué.
 */
export function partitionCandidates<T extends CandidateLike>(
  candidates: T[],
  catalog: PublishedCatalog
): { fresh: T[]; skipped: { candidate: T; reason: SkipReason }[] } {
  const fresh: T[] = [];
  const skipped: { candidate: T; reason: SkipReason }[] = [];

  for (const candidate of candidates) {
    if (catalog.productIds.has(candidate.ml_product_id)) {
      skipped.push({ candidate, reason: 'ya_publicado' });
      continue;
    }

    const family = candidate.ml_family_id;
    const cheapestPublished = family ? catalog.cheapestByFamily.get(family) : undefined;

    if (cheapestPublished === undefined) {
      fresh.push(candidate);
      continue;
    }

    const worthReviewing =
      candidate.price < cheapestPublished * (1 - MIN_PRICE_IMPROVEMENT);

    if (worthReviewing) fresh.push(candidate);
    else skipped.push({ candidate, reason: 'familia_ya_publicada' });
  }

  return { fresh, skipped };
}
