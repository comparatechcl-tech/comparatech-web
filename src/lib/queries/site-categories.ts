import { getAllProducts } from '@/lib/queries/products';
import { getPopulatedCategories } from '@/lib/categories';
import { CategoryInfo } from '@/lib/types';

/**
 * Categorías que hoy tienen productos publicados.
 *
 * El menú, las tarjetas del home, el footer y el sitemap se arman con esto
 * en vez de con una lista fija. Antes "Electrónica" estaba destacada en el
 * home sin un solo producto adentro, y "Celulares" aparecía llena solo
 * porque los audífonos estaban mal categorizados.
 */
export async function getSiteCategories(): Promise<CategoryInfo[]> {
  return getPopulatedCategories(await getAllProducts());
}
