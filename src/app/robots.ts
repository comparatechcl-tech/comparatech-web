import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // '/admin' sin barra también: la regla '/admin/' no cubre la portada
      // del admin. Igual responden 401 y llevan X-Robots-Tag: noindex.
      disallow: ['/admin', '/admin/', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
