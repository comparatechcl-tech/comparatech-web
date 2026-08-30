'use server';

import { resolveAffiliateItemId } from '@/lib/affiliate-link';
import { getMlToken } from '@/lib/ml-enrichment';

export type LinkCheckResult =
  | { ok: true; direct: true; itemId: string }
  | { ok: true; direct: false; reason: 'wrong_offer' | 'no_reference_found'; itemId: string | null }
  | { ok: false; error: string };

/**
 * Comprueba si un link de afiliado lleva a la oferta del vendedor aprobado.
 *
 * Compara el item_id que el link destaca (ver lib/affiliate-link) contra el
 * item real de ese vendedor, consultando /products/{id}/items igual que el
 * cron de refresco de precios.
 *
 * Devuelve el itemId aunque no coincida: quien llama lo guarda igual, porque
 * el precio publicado tiene que seguir a la oferta que el usuario va a ver,
 * coincida o no con la que se aprobó.
 */
export async function verifyAffiliateLink(
  url: string,
  mlProductId: string | null,
  sellerId: number | null
): Promise<LinkCheckResult> {
  if (!mlProductId || !sellerId) {
    return { ok: false, error: 'Este producto no tiene ml_product_id/seller_id para comparar' };
  }

  const resolved = await resolveAffiliateItemId(url);
  if (!resolved.ok) {
    if (resolved.reason === 'sin_wid') {
      return { ok: true, direct: false, reason: 'no_reference_found', itemId: null };
    }
    return { ok: false, error: resolved.message };
  }

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

    return resolved.itemId === approvedOffer.item_id
      ? { ok: true, direct: true, itemId: resolved.itemId }
      : { ok: true, direct: false, reason: 'wrong_offer', itemId: resolved.itemId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo consultar Mercado Libre' };
  }
}
