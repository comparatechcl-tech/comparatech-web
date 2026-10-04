import { MetadataRoute } from 'next';
import { getAllProducts, getDeals } from '@/lib/queries/products';
import { getPopulatedCategories } from '@/lib/categories';
import { SITE_URL } from '@/lib/site';
import type { Product } from '@/lib/types';

/**
 * Última vez que cambió algo de un producto que se ve en su ficha. La
 * revisión de precio corre cada media hora; si nunca corrió, la fecha de
 * alta. Un lastModified fijo o ausente le dice a Google que no hay nada
 * nuevo que rastrear.
 */
function productModified(product: Product): Date | undefined {
  const iso = product.price_checked_at ?? product.created_at;
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** La fecha más reciente de un grupo de productos (para listados). */
function latestModified(products: Product[]): Date | undefined {
  let latest: Date | undefined;
  for (const product of products) {
    const date = productModified(product);
    if (date && (!latest || date > latest)) latest = date;
  }
  return latest;
}

/**
 * Solo lo que se puede indexar y tiene contenido: productos a la venta y
 * categorías con productos. /buscar no va: es noindex, y cada búsqueda es
 * una variación de las páginas que ya están acá.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, deals] = await Promise.all([getAllProducts(), getDeals()]);

  const withDate = (date: Date | undefined) => (date ? { lastModified: date } : {});

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1, ...withDate(latestModified(products)) },
    {
      url: `${SITE_URL}/ofertas`,
      changeFrequency: 'daily',
      priority: 0.9,
      ...withDate(latestModified(deals.length > 0 ? deals : products)),
    },
    { url: `${SITE_URL}/comparador`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/nosotros`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/privacidad`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terminos`, changeFrequency: 'yearly', priority: 0.2 },
    ...getPopulatedCategories(products).map((c) => ({
      url: `${SITE_URL}/categoria/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
      ...withDate(latestModified(products.filter((p) => p.category === c.slug))),
    })),
  ];

  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/producto/${p.slug}`,
    changeFrequency: 'daily',
    priority: 0.9,
    ...withDate(productModified(p)),
  }));

  return [...staticRoutes, ...productRoutes];
}
