import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * Robots que solo bajan páginas para entrenar modelos de IA (aprobado por el
 * dueño el 03-11-2026, letra B del plan). No traen visitas y gastan el uso
 * de Vercel, así que no entran a ninguna parte.
 *
 * Los que buscan en vivo para responder (OAI-SearchBot y ChatGPT-User de
 * OpenAI, PerplexityBot, Claude-SearchBot y Claude-User) NO van aquí: desde
 * ChatGPT llega la mayoría de los clics. OpenAI dice que cerrar GPTBot no
 * cambia lo que muestra la búsqueda de ChatGPT, que usa OAI-SearchBot.
 */
const AI_TRAINING_BOTS =['GPTBot', 'ClaudeBot', 'CCBot', 'Bytespider', 'meta-externalagent'] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: [...AI_TRAINING_BOTS], disallow: '/' },
      {
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
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
