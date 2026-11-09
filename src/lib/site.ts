/**
 * URL pública del sitio — la usan sitemap.xml, robots.txt, Open Graph y el
 * JSON-LD de las fichas.
 *
 * El valor por defecto dejó de ser un dominio escrito a mano: un dominio
 * propio que no resuelva hace que el sitio publique un sitemap con todas sus
 * URLs en un host inaccesible, un robots.txt apuntando al sitemap de ese
 * host, y un og:image roto en cada link que se comparta en redes. Ahora, si
 * NEXT_PUBLIC_SITE_URL no está, caemos al dominio que Vercel ya conoce.
 *
 * En Railway no hay dominio que caiga solo: sin NEXT_PUBLIC_SITE_URL todo el
 * sitio apuntaría a http://localhost:3000 (canonical, sitemap, robots, Open
 * Graph). Por eso en el sitio publicado de Railway (APP_ENV=production) su
 * falta corta el build, en vez de publicar algo que Google tomaría tal cual.
 *
 * Solo para uso server-side: VERCEL_PROJECT_PRODUCTION_URL no lleva el prefijo
 * NEXT_PUBLIC_, así que no existe en el bundle del cliente.
 */
export interface SiteUrlEnv {
  NEXT_PUBLIC_SITE_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
  APP_ENV?: string;
}

export function resolveSiteUrl(
  // NEXT_PUBLIC_SITE_URL se lee escrita así, entera: Next la reemplaza por su valor al armar el sitio.
  env: SiteUrlEnv = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    APP_ENV: process.env.APP_ENV,
  },
): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // Dominio de producción del proyecto, estable entre deploys.
  const productionDomain = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionDomain) return `https://${productionDomain}`;

  // Último recurso en Vercel: la URL de este deploy puntual. Cambia en cada
  // deploy, así que sirve para no romper nada, no para indexar.
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;

  if (env.APP_ENV === 'production') {
    throw new Error(
      'Falta NEXT_PUBLIC_SITE_URL: sin ella el sitio publicado apuntaría a http://localhost:3000. ' +
        'Agrégala en Railway → Variables (https://www.comparatech.cl) y vuelve a desplegar.',
    );
  }

  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl();
