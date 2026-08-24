import { MetadataRoute } from 'next';
import { getAllProducts } from '@/lib/queries/products';
import { getPopulatedCategories } from '@/lib/categories';
import { SITE_URL } from '@/lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getAllProducts();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/comparador`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/buscar`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${SITE_URL}/nosotros`, changeFrequency: 'monthly', priority: 0.4 },
    ...getPopulatedCategories(products).map((c) => ({
      url: `${SITE_URL}/categoria/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ];

  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/producto/${p.slug}`,
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  return [...staticRoutes, ...productRoutes];
}
