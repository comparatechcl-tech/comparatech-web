/**
 * URL pública del sitio — la usan sitemap.xml, robots.txt, Open Graph y el
 * JSON-LD de las fichas.
 *
 * El valor por defecto dejó de ser un dominio escrito a mano. `comparatech.cl`
 * todavía no está registrado, así que mientras nadie definiera
 * NEXT_PUBLIC_SITE_URL el sitio publicaba un sitemap con todas sus URLs en un
 * host que no resuelve, un robots.txt apuntando al sitemap de ese host, y un
 * og:image roto en cada link que se compartiera en redes. Ahora, si la
 * variable no está, caemos al dominio que Vercel ya conoce.
 *
 * Solo para uso server-side: VERCEL_PROJECT_PRODUCTION_URL no lleva el prefijo
 * NEXT_PUBLIC_, así que no existe en el bundle del cliente.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // Dominio de producción del proyecto, estable entre deploys.
  const productionDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionDomain) return `https://${productionDomain}`;

  // Último recurso en Vercel: la URL de este deploy puntual. Cambia en cada
  // deploy, así que sirve para no romper nada, no para indexar.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return 'http://localhost:3000';
}

export const SITE_URL = resolveSiteUrl();
