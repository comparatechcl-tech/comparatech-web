/**
 * Resolución de links de afiliado de Mercado Libre.
 *
 * Todo link generado desde la app de ML redirige primero a
 * mercadolibre.cl/social/<usuario> —ese salto es el tracking de afiliados,
 * no un error—. Lo que importa es qué oferta queda incrustada ahí como
 * destacada: el HTML de esa página trae un parámetro `wid=MLC...` con el
 * item_id exacto.
 *
 * Ese item_id es la única fuente de verdad sobre lo que ve el usuario al
 * hacer clic. Guardarlo permite que el precio publicado siga al link, en vez
 * de seguir a un `seller_id` elegido por separado durante la prospección:
 * las dos cosas se separaban con el tiempo y el sitio terminaba anunciando
 * un precio distinto al que el comprador encontraba en Mercado Libre.
 */

/**
 * ML solo entrega la redirección real del acortador meli.la si el request
 * trae un User-Agent de navegador — con el de fetch() por defecto el link no
 * redirige.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const WID_RE = /[?&]wid=(MLC[A-Za-z0-9]+)/;

export type AffiliateItemResult =
  | { ok: true; itemId: string }
  | { ok: false; reason: 'sin_wid' }
  | { ok: false; reason: 'error'; message: string };

export function extractItemId(html: string): string | null {
  return html.match(WID_RE)?.[1] ?? null;
}

/** Sigue el link de afiliado y devuelve el item_id de la oferta que destaca. */
export async function resolveAffiliateItemId(
  url: string,
  timeoutMs = 8000
): Promise<AffiliateItemResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, reason: 'error', message: 'Falta el link' };

  try {
    const res = await fetch(trimmed, {
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const itemId = extractItemId(await res.text());
    return itemId ? { ok: true, itemId } : { ok: false, reason: 'sin_wid' };
  } catch (e) {
    return {
      ok: false,
      reason: 'error',
      message: e instanceof Error ? e.message : 'No se pudo abrir el link',
    };
  }
}
