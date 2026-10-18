import { MetadataRoute } from 'next';
import { collapseVariants, getAllProducts, getDeals } from '@/lib/queries/products';
import { getLastPriceChanges } from '@/lib/queries/price-history';
import { getPopulatedCategories } from '@/lib/categories';
import { indexableTypes, productsOfType, typePath } from '@/lib/category-listing';
import { latestDate, productLastModified } from '@/lib/sitemap-dates';
import { SITE_URL } from '@/lib/site';
import type { Product } from '@/lib/types';

/**
 * Solo lo que se puede indexar y tiene contenido: productos a la venta y
 * categorías con productos. /buscar no va: es noindex, y cada búsqueda es
 * una variación de las páginas que ya están acá.
 *
 * Las fechas son las del último cambio de precio (lib/sitemap-dates), no
 * las de la revisión de cada media hora: una fecha que se mueve sin que
 * cambie nada le enseña a Google a no creerle al sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, deals, lastChanges] = await Promise.all([getAllProducts(), getDeals(), getLastPriceChanges()]);

  const modified = (p: Product) => productLastModified(p, lastChanges);
  const latestOf = (list: Product[]) => latestDate(list.map(modified));
  const withDate = (date: Date | undefined) => (date ? { lastModified: date } : {});

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1, ...withDate(latestOf(products)) },
    {
      url: `${SITE_URL}/ofertas`,
      changeFrequency: 'daily',
      priority: 0.9,
      ...withDate(latestOf(deals.length > 0 ? deals : products)),
    },
    // Dirección fija para todos los años (lib/black-friday); cambia con las ofertas del día.
    {
      url: `${SITE_URL}/black-friday`,
      changeFrequency: 'daily',
      priority: 0.8,
      ...withDate(latestOf(deals.length > 0 ? deals : products)),
    },
    { url: `${SITE_URL}/comparador`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/nosotros`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${SITE_URL}/privacidad`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/terminos`, changeFrequency: 'yearly', priority: 0.2 },
    ...getPopulatedCategories(products).map((c) => ({
      url: `${SITE_URL}/categoria/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
      ...withDate(latestOf(products.filter((p) => p.category === c.slug))),
    })),
    // Las páginas por tipo que se indexan (lib/category-listing). Se cuentan
    // sin variantes repetidas, igual que en la página.
    ...getPopulatedCategories(products).flatMap((c) => {
      const inCategory = products.filter((p) => p.category === c.slug);
      return indexableTypes(collapseVariants(inCategory), c).map((t) => ({
        url: `${SITE_URL}${typePath(c.slug, t.slug)}`,
        changeFrequency: 'daily' as const,
        priority: 0.7,
        ...withDate(latestOf(productsOfType(inCategory, t.slug))),
      }));
    }),
  ];

  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/producto/${p.slug}`,
    changeFrequency: 'daily',
    priority: 0.9,
    ...withDate(modified(p)),
  }));

  return [...staticRoutes, ...productRoutes];
}
