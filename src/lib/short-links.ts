/**
 * Adónde apunta el link corto de un producto en un aviso del canal de
 * afiliados de Mercado Libre.
 *
 * Los avisos traen cada producto con un link de tinyurl.com. Ese link no se
 * abre nunca: lleva a Mercado Libre, y sus páginas no se leen con programas
 * (ver CLAUDE.md). Lo que sí se puede es preguntarle al acortador adónde
 * apunta: responde con una redirección, y la dirección de destino trae la
 * ficha exacta (…/p/MLC123…). El pedido va a tinyurl.com y termina ahí: no se
 * sigue, no llega a Mercado Libre y no cuenta como clic en ningún panel.
 *
 * Solo acortadores de terceros de la lista. meli.la es de Mercado Libre:
 * resolverlo ya es pedirle a Mercado Libre, y ese sí cuenta como clic.
 */

/** Acortadores a los que se les puede preguntar el destino sin tocar Mercado Libre. */
const RESOLVABLE_HOSTS = new Set(['tinyurl.com', 'www.tinyurl.com']);

const CODE_RE = /^\/[A-Za-z0-9_-]{3,40}\/?$/;

/** La ficha de catálogo de una dirección de mercadolibre.cl, con o sin el nombre antes de /p/. */
const CATALOG_URL_RE = /^https?:\/\/(?:www\.)?mercadolibre\.cl\/(?:[^\s?#]*\/)?p\/(MLC\d{5,15})(?:[/?#]|$)/i;

const TIMEOUT_MS = 8000;

/** "MLC61403702" si la dirección es la ficha de un producto de Mercado Libre Chile; si no, null. Puro. */
export function catalogIdFromUrl(url: string): string | null {
  return CATALOG_URL_RE.exec(String(url ?? '').trim())?.[1]?.toUpperCase() ?? null;
}

/**
 * La dirección a pedirle al acortador, o null si el link no es uno de los que
 * se pueden resolver (otro sitio, meli.la, una dirección con parámetros). Puro.
 */
export function resolvableShortLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(String(link ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!RESOLVABLE_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (!CODE_RE.test(url.pathname) || url.search || url.username || url.password || url.port) return null;
  return `https://tinyurl.com${url.pathname.replace(/\/$/, '')}`;
}

export type ShortLinkResult =
  /** Apunta a la ficha de un producto de Mercado Libre Chile. */
  | { status: 'ficha'; mlId: string }
  /** Apunta a otra cosa (una búsqueda, una campaña, otro sitio): no identifica un producto. */
  | { status: 'otro' }
  /** No es un link que se pueda resolver, o el acortador no respondió con una redirección. */
  | { status: 'sin_resolver'; reason: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Lo ya preguntado en este proceso: un mismo aviso se mira en varias pasadas. */
const cache = new Map<string, ShortLinkResult>();
const CACHE_MAX = 500;

/** Solo para las pruebas. */
export function clearShortLinkCache(): void {
  cache.clear();
}

/**
 * Pregunta al acortador adónde apunta el link, sin seguir la redirección.
 * Nunca lanza. Una respuesta que no se pudo obtener (red, tiempo) no se
 * guarda: se vuelve a preguntar en la pasada siguiente.
 */
export async function resolveShortLink(link: string, fetchImpl: Fetch = fetch): Promise<ShortLinkResult> {
  const target = resolvableShortLink(link);
  if (!target) return { status: 'sin_resolver', reason: 'no es un link corto conocido' };
  const known = cache.get(target);
  if (known) return known;

  let result: ShortLinkResult;
  try {
    const res = await fetchImpl(target, {
      method: 'HEAD',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      return { status: 'sin_resolver', reason: `el acortador respondió ${res.status}` };
    }
    const mlId = catalogIdFromUrl(location);
    result = mlId ? { status: 'ficha', mlId } : { status: 'otro' };
  } catch (err) {
    return { status: 'sin_resolver', reason: err instanceof Error ? err.message : 'no respondió' };
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(target, result);
  return result;
}
