import { MetadataRoute } from 'next';
import { getAllProducts } from '@/lib/queries/products';
import { CATEGORIES } from '@/lib/types';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://comparatech.cl';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getAllProducts();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/comparador`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${siteUrl}/buscar`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${siteUrl}/nosotros`, changeFrequency: 'monthly', priority: 0.4 },
    ...CATEGORIES.map((c) => ({
      url: `${siteUrl}/categoria/${c.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
  ];

  const productRoutes: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${siteUrl}/producto/${p.slug}`,
    changeFrequency: 'daily',
    priority: 0.9,
  }));

  return [...staticRoutes, ...productRoutes];
}
