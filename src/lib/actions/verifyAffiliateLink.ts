'use server';

export type LinkCheckResult =
  | { ok: true; direct: true }
  | { ok: true; direct: false; reason: 'wrong_offer' | 'no_reference_found' }
  | { ok: false; error: string };

// Mercado Libre solo entrega la redirección real del acortador meli.la si el
// request trae un User-Agent de navegador — con el UA por defecto de fetch()
// el link no redirige.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function getMlToken(): Promise<string | null> {
  try {
    const res = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.ML_CLIENT_ID ?? '',
        client_secret: process.env.ML_CLIENT_SECRET ?? '',
      }),
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.json());
    return res.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Todos los links de afiliado generados desde la app de ML (compartir mi
 * perfil O compartir desde la ficha del producto) redirigen primero a
 * mercadolibre.cl/social/<usuario> — eso NO indica que el link esté mal,
 * es el paso intermedio normal de tracking de afiliados. Lo que sí varía es
 * qué oferta específica queda incrustada ahí como "destacada": el HTML que
 * devuelve esa página (sin ejecutar JS) trae un parámetro `wid=MLC...` con
 * el item_id exacto de esa oferta — lo comparamos contra el item_id real
 * del vendedor (`sellerId`) que se aprobó para este producto, consultando
 * /products/{mlProductId}/items igual que el cron de refresco de precios.
 */
export async function verifyAffiliateLink(
  url: string,
  mlProductId: string | null,
  sellerId: number | null
): Promise<LinkCheckResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Falta el link' };
  if (!mlProductId || !sellerId) {
    return { ok: false, error: 'Este producto no tiene ml_product_id/seller_id para comparar' };
  }

  let html: string;
  try {
    const res = await fetch(trimmed, {
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    html = await res.text();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo abrir el link' };
  }

  const featuredMatch = html.match(/[?&]wid=(MLC[A-Za-z0-9]+)/);
  if (!featuredMatch) {
    return { ok: true, direct: false, reason: 'no_reference_found' };
  }
  const featuredItemId = featuredMatch[1];

  const token = await getMlToken();
  if (!token) return { ok: false, error: 'No se pudo obtener token de Mercado Libre' };

  try {
    const itemsRes = await fetch(`https://api.mercadolibre.com/products/${mlProductId}/items`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const itemsData = await itemsRes.json();
    const results: { item_id: string; seller_id: number }[] = itemsData?.results ?? [];
    const approvedOffer = results.find((r) => r.seller_id === sellerId);

    if (!approvedOffer) {
      return { ok: false, error: 'El vendedor aprobado ya no aparece entre las ofertas de este producto' };
    }

    return featuredItemId === approvedOffer.item_id
      ? { ok: true, direct: true }
      : { ok: true, direct: false, reason: 'wrong_offer' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo consultar Mercado Libre' };
  }
}
