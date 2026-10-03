import { getWinners } from '@/lib/ml-catalog';
import { inspectAffiliateLink, type AffiliateLinkInfo } from '@/lib/affiliate-link';

/**
 * ¿El link de afiliado lleva a esta ficha?
 *
 * - `coincide`: el perfil destaca esta ficha, o la oferta que destaca está
 *   entre las de esta ficha. Lo segundo cubre el caso en que el HTML del
 *   perfil cambie y la detección de la ficha falle.
 * - `otra_ficha`: el perfil destaca otro producto. Es lo único que justifica
 *   rechazar un link o sacar un producto del sitio.
 * - `indeterminado`: el perfil no muestra el producto (la ficha está sin
 *   vendedores) o Mercado Libre respondió otra página. No dice nada malo
 *   del link, así que no bloquea nada.
 */
export type LinkVerdict = 'coincide' | 'otra_ficha' | 'indeterminado';

export async function linkVerdict(
  info: Pick<AffiliateLinkInfo, 'featuredProductId' | 'itemId'>,
  mlProductId: string,
  token: string | null
): Promise<LinkVerdict> {
  if (info.featuredProductId === mlProductId) return 'coincide';

  if (info.itemId && token) {
    const winners = await getWinners(mlProductId, token);
    if (winners.status === 'ok' && winners.offers.some((o) => o.item_id === info.itemId)) {
      return 'coincide';
    }
  }

  return info.featuredProductId ? 'otra_ficha' : 'indeterminado';
}

/** Un link directo a la ficha (/p/MLC...) dice a qué producto lleva sin abrirlo. */
const DIRECT_PRODUCT_RE = /mercadolibre\.cl\/(?:[^/?#]+\/)?p\/(MLC\d+)/;

/**
 * Ficha a la que lleva el link, para guardar en `link_target_product_id`.
 * Null si no se pudo determinar.
 *
 * Abre el link, así que cuenta como un clic en las métricas del afiliado:
 * se usa solo cuando un producto con un link nunca verificado está por
 * volver al sitio, no en cada corrida.
 */
export async function resolveLinkTarget(
  affiliateUrl: string,
  mlProductId: string,
  token: string
): Promise<string | null> {
  const direct = affiliateUrl.match(DIRECT_PRODUCT_RE)?.[1];
  if (direct) return direct;

  const inspected = await inspectAffiliateLink(affiliateUrl);
  if (!inspected.ok) return null;

  const verdict = await linkVerdict(inspected.info, mlProductId, token);
  if (verdict === 'coincide') return mlProductId;
  if (verdict === 'otra_ficha') return inspected.info.featuredProductId;
  return null;
}
