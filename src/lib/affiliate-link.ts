/**
 * Inspección de links de afiliado de Mercado Libre.
 *
 * Todo link meli.la aterriza en el perfil social de la cuenta afiliada
 * (mercadolibre.cl/social/<usuario>), que muestra un producto destacado con
 * un botón "Ir a producto". Ese botón lleva a la ficha de catálogo /p/{id},
 * donde Mercado Libre elige qué vendedor mostrar — su ganador de la caja de
 * compra, no necesariamente la oferta desde la que se generó el link.
 *
 * Por eso lo que hay que verificar de un link es a qué PRODUCTO lleva, no a
 * qué oferta: si el perfil destaca otra ficha (pasó con un Blik Gris que
 * llevaba al Negro, y con un Redmi Watch cuyo link abría una Huawei Band), el
 * comprador termina mirando algo distinto a lo que vio en el sitio.
 *
 * De paso se leen `matt_word` y `matt_tool`, los parámetros que identifican a
 * la cuenta afiliada. Son iguales en todos sus links y permiten armar links
 * directos a la ficha (ver lib/outbound).
 */

import { isAllowedAffiliateUrl } from '@/lib/outbound';

/**
 * ML solo entrega la redirección real del acortador meli.la si el request
 * trae un User-Agent de navegador — con el de fetch() por defecto el link no
 * redirige.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * El producto destacado es la tarjeta que va justo antes de la acción "Ir a
 * producto" (id `show_product`), y la ficha es la del enlace de esa acción.
 *
 * Si la acción no está, el perfil NO muestra el producto del link —pasa
 * cuando la ficha se quedó sin vendedores— y lo que hay en la página es el
 * feed general de la cuenta. Antes se tomaba "la primera ficha" y "el
 * primer wid" del HTML, y en ese caso devolvían cualquier cosa: 13 links
 * distintos parecían llevar todos a un mantel de fiestas patrias.
 */
const SHOW_PRODUCT = '"id":"show_product"';
const ACTION_URL_RE = /"url":"((?:[^"\\]|\\.)*)"/;
const CARD_ITEM_RE = /"metadata":\{"id":"(MLC\d+)"/g;
const PRODUCT_PATH_RE = /\/p\/(MLC\d+)/;

const MAX_REDIRECTS = 6;

export interface AffiliateLinkInfo {
  /**
   * Oferta destacada en el perfil. Null —igual que featuredProductId— si el
   * perfil no está mostrando el producto: en ese caso el link no se puede
   * verificar, lo que no significa que esté mal.
   */
  itemId: string | null;
  /** Ficha de catálogo a la que lleva "Ir a producto". */
  featuredProductId: string | null;
  mattWord: string | null;
  mattTool: string | null;
}

export type InspectResult =
  | { ok: true; info: AffiliateLinkInfo }
  | { ok: false; error: string };

export function extractFeatured(html: string): { productId: string | null; itemId: string | null } {
  const at = html.indexOf(SHOW_PRODUCT);
  if (at < 0) return { productId: null, itemId: null };

  let productId: string | null = null;
  const rawUrl = html.slice(at).match(ACTION_URL_RE)?.[1];
  if (rawUrl) {
    try {
      // El HTML trae la URL escapada como JSON ("https://...").
      productId = (JSON.parse(`"${rawUrl}"`) as string).match(PRODUCT_PATH_RE)?.[1] ?? null;
    } catch {
      // Escape inesperado: queda sin ficha y se verifica por la oferta.
    }
  }

  const cards = Array.from(html.slice(0, at).matchAll(CARD_ITEM_RE));
  const itemId = cards.length > 0 ? cards[cards.length - 1][1] : null;

  return { productId, itemId };
}

/**
 * Hosts por los que puede pasar la cadena de redirecciones. El link pegado
 * tiene que estar en la lista estricta de lib/outbound, pero los saltos
 * intermedios de ML pasan por subdominios propios (perfil social, login,
 * seguimiento) que no conviene enumerar uno por uno: lo que importa es no
 * seguir nunca a un dominio que no sea de Mercado Libre. Un link que redirige
 * afuera no es de la cuenta y además haría que el servidor abriera cualquier
 * URL que alguien pegue.
 */
function isMercadoLibreHop(url: string): boolean {
  if (isAllowedAffiliateUrl(url)) return true;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    return u.hostname.endsWith('.mercadolibre.cl') || u.hostname.endsWith('.mercadolibre.com');
  } catch {
    return false;
  }
}

/**
 * Resultados recientes por URL. Abrir un meli.la cuenta como un clic de
 * afiliado: el admin lo abre al tocar "Verificar" y otra vez al "Aprobar" o
 * "Guardar", y ML podría tomar los clics repetidos desde la IP del servidor
 * como fraude. Diez minutos cubren ese ir y venir.
 *
 * Solo se guardan los resultados buenos: si ML estaba lento, el siguiente
 * intento tiene que volver a probar.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const inspectCache = new Map<string, { at: number; result: InspectResult }>();

/** Para los tests. */
export function clearInspectCache(): void {
  inspectCache.clear();
}

function readCache(url: string, now: number): InspectResult | null {
  const hit = inspectCache.get(url);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    inspectCache.delete(url);
    return null;
  }
  return hit.result;
}

function writeCache(url: string, result: InspectResult, now: number): void {
  // El Map vive mientras viva la instancia: se limpian los vencidos para que
  // no crezca sin tope en una instancia que dure mucho.
  for (const [key, value] of inspectCache) {
    if (now - value.at > CACHE_TTL_MS) inspectCache.delete(key);
  }
  inspectCache.set(url, { at: now, result });
}

/**
 * Sigue el link salto por salto —para poder leer los parámetros de cada
 * URL intermedia— y analiza la página donde aterriza.
 *
 * Ojo: abrir un meli.la cuenta como un clic en las métricas del afiliado.
 * Se usa al guardar o verificar un link, no en barridos periódicos, y el
 * resultado queda memoizado diez minutos (ver inspectCache).
 */
export async function inspectAffiliateLink(
  url: string,
  timeoutMs = 10_000
): Promise<InspectResult> {
  const start = url.trim();
  if (!start) return { ok: false, error: 'Falta el link' };
  if (!isAllowedAffiliateUrl(start)) return { ok: false, error: 'Ese link no es de Mercado Libre' };

  const cached = readCache(start, Date.now());
  if (cached) return cached;

  const result = await fetchAndInspect(start, timeoutMs);
  if (result.ok) writeCache(start, result, Date.now());
  return result;
}

async function fetchAndInspect(start: string, timeoutMs: number): Promise<InspectResult> {
  let current = start;
  let mattWord: string | null = null;
  let mattTool: string | null = null;

  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const parsed = new URL(current);
      mattWord ??= parsed.searchParams.get('matt_word');
      mattTool ??= parsed.searchParams.get('matt_tool');

      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        if (!isMercadoLibreHop(current)) {
          return { ok: false, error: 'El link redirige fuera de Mercado Libre' };
        }
        continue;
      }

      const featured = extractFeatured(await res.text());
      return {
        ok: true,
        info: {
          itemId: featured.itemId,
          featuredProductId: featured.productId,
          mattWord,
          mattTool,
        },
      };
    }
    return { ok: false, error: 'El link redirige demasiadas veces' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo abrir el link' };
  }
}

/**
 * ¿El link es de la cuenta de ComparaTech? Compara los parámetros que se
 * leyeron del link con los esperados (lib/settings: expectedAffiliateParams).
 *
 * Solo rechaza con evidencia: si el link no trae matt_word, o no hay un
 * valor esperado con qué comparar, no se puede decir que sea ajeno.
 */
export function checkAffiliateOwnership(
  info: { mattWord: string | null; mattTool: string | null },
  expected: { word: string | null; tool: string | null }
): string | null {
  const word = info.mattWord?.trim();
  if (word && expected.word && word !== expected.word) {
    return `Este link es de otra cuenta de afiliado (matt_word=${word}). Genéralo con la cuenta ComparaTech.`;
  }
  const tool = info.mattTool?.trim();
  if (tool && expected.tool && tool !== expected.tool) {
    return `Este link es de otra cuenta de afiliado (matt_tool=${tool}). Genéralo con la cuenta ComparaTech.`;
  }
  return null;
}
