import { getCatalogProducts } from '@/lib/queries/products';
import { getPopulatedCategories } from '@/lib/categories';
import { CategoryInfo } from '@/lib/types';

/**
 * Mínimo de productos para que una categoría aparezca en el menú, el home y
 * el footer. Una categoría con uno o dos productos se ve abandonada y manda
 * a quien entra a una página casi vacía.
 */
export const MIN_PRODUCTS_PER_CATEGORY = 3;

export interface SiteCategoryWithCount extends CategoryInfo {
  /** Productos visibles, contando una vez cada producto real (sin variantes). */
  count: number;
}

/**
 * Categorías con su conteo, en el orden del registro. Puro: recibe el
 * catálogo ya colapsado para poder probarlo sin Supabase.
 */
export function categoriesWithCounts(
  products: { category: string }[],
  minProducts = MIN_PRODUCTS_PER_CATEGORY
): SiteCategoryWithCount[] {
  const counts = new Map<string, number>();
  for (const p of products) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);

  return getPopulatedCategories(products)
    .map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 }))
    .filter((c) => c.count >= minProducts);
}

/**
 * Categorías con productos visibles y cuántos tiene cada una.
 *
 * Cuenta el catálogo colapsado (una tarjeta por producto real): cinco
 * colores del mismo audífono son un producto para quien navega. Con
 * `minProducts = 1` devuelve todas las que tienen algo, que es lo que
 * necesita la página de categoría para decidir entre mostrarse o dar 404.
 */
export async function getSiteCategoriesWithCounts(
  minProducts = MIN_PRODUCTS_PER_CATEGORY
): Promise<SiteCategoryWithCount[]> {
  return categoriesWithCounts(await getCatalogProducts(), minProducts);
}

/**
 * Categorías que hoy tienen al menos MIN_PRODUCTS_PER_CATEGORY productos
 * publicados.
 *
 * El menú, las tarjetas del home, el footer y el sitemap se arman con esto
 * en vez de con una lista fija. Antes "Electrónica" estaba destacada en el
 * home sin un solo producto adentro, y "Celulares" aparecía llena solo
 * porque los audífonos estaban mal categorizados.
 */
export async function getSiteCategories(): Promise<CategoryInfo[]> {
  return (await getSiteCategoriesWithCounts()).map(({ slug, name }) => ({ slug, name }));
}
