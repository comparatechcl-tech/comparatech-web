/**
 * A dónde lleva el botón "Ver en Mercado Libre".
 *
 * Hoy todos los links son meli.la generados a mano. Esos links aterrizan en
 * el perfil social de la cuenta afiliada, y el comprador tiene que tocar
 * "Ir a producto" para llegar a la ficha: un clic de más, y una página
 * intermedia que a veces muestra otro precio.
 *
 * El link directo va a la ficha de catálogo con los parámetros matt_word y
 * matt_tool, que son los que identifican a la cuenta afiliada en todos sus
 * links. Evita el clic intermedio y además permitiría publicar sin generar
 * cada link a mano — pero que ML atribuya la comisión así no está
 * documentado, por eso queda detrás de un interruptor en el admin.
 *
 * Sin imports a propósito: lo usan componentes de cliente.
 */

interface AffiliateParams {
  word: string | null;
  tool: string | null;
  directLinks: boolean;
}

export function directAffiliateUrl(
  mlProductId: string | null | undefined,
  params: Pick<AffiliateParams, 'word' | 'tool'>
): string | null {
  if (!mlProductId || !params.word || !params.tool) return null;
  const url = new URL(`https://www.mercadolibre.cl/p/${mlProductId}`);
  url.searchParams.set('matt_word', params.word);
  url.searchParams.set('matt_tool', params.tool);
  return url.toString();
}

/** El destino que corresponde según la configuración vigente. */
export function resolveOutboundUrl(
  product: { affiliate_url: string; ml_product_id: string | null },
  params: AffiliateParams
): string {
  if (params.directLinks) {
    const direct = directAffiliateUrl(product.ml_product_id, params);
    if (direct) return direct;
  }
  return product.affiliate_url;
}

/** Para los componentes: usa el destino precalculado si viene, si no el link guardado. */
export function buyUrl(product: { affiliate_url: string; outbound_url?: string }): string {
  return product.outbound_url ?? product.affiliate_url;
}
