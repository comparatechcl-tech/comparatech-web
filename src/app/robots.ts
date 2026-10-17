import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // '/admin' sin barra también: la regla '/admin/' no cubre la portada
      // del admin. Igual responden 401 y llevan X-Robots-Tag: noindex.
      //
      // Lo demás son espacios infinitos de direcciones que Google pide no
      // dejar rastrear (guía de navegación facetada): el mismo listado en
      // otro orden, cada par posible del comparador (cientos de miles) y los
      // datos en JSON que piden las páginas. Las páginas en sí (la categoría,
      // /comparador, /ofertas) siguen abiertas.
      disallow: [
        '/admin',
        '/admin/',
        '/api/',
        '/*?orden=',
        '/*&orden=',
        '/comparador?',
        '/comparador/datos',
        '/ofertas/lote',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
