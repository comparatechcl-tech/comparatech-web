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

/**
 * Hosts a los que puede llevar un botón de compra. El link de afiliado se
 * pega a mano en el admin y termina como href en todas las páginas: sin
 * esta lista, un 'javascript:' o un dominio parecido (mercadolibre.cl.evil.com)
 * quedaría publicado con el aspecto de un botón legítimo.
 */
const ALLOWED_HOSTS = new Set([
  'meli.la',
  'mercadolibre.cl',
  'www.mercadolibre.cl',
  'articulo.mercadolibre.cl',
  'mercadolibre.com',
  'www.mercadolibre.com',
]);

const SITE_ROOT = 'https://www.mercadolibre.cl';
const ML_ID_RE = /^[A-Z]{3}\d+$/;

function parseAllowed(url: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  // Solo https y sin puerto ni usuario: un 'https://meli.la@otro.com' o un
  // puerto raro no son links que genere Mercado Libre.
  if (parsed.protocol !== 'https:') return null;
  if (parsed.port || parsed.username || parsed.password) return null;
  return ALLOWED_HOSTS.has(parsed.hostname) ? parsed : null;
}

/** ¿Se puede publicar este link como botón de compra? */
export function isAllowedAffiliateUrl(url: string): boolean {
  return parseAllowed(url) !== null;
}

/**
 * ¿Es un link generado por el Generador de links de afiliado? Además de
 * meli.la cuenta el acortador antiguo de ML (mercadolibre.com/sec/...), que
 * cumple el mismo papel: es el respaldo que sigue pagando comisión si los
 * links directos se apagan.
 */
export function isMeliLaUrl(url: string): boolean {
  const parsed = parseAllowed(url);
  if (!parsed) return false;
  if (parsed.hostname === 'meli.la') return parsed.pathname.length > 1;
  return parsed.hostname.endsWith('mercadolibre.com') && parsed.pathname.startsWith('/sec/');
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

/**
 * Red de seguridad para un link guardado que no pasa la lista: mejor un
 * link directo (o la ficha sin parámetros) que publicar algo desconocido.
 * Sin ficha asociada, la portada de ML; nunca '#' ni 'javascript:'.
 */
function safeFallback(
  mlProductId: string | null | undefined,
  params?: Pick<AffiliateParams, 'word' | 'tool'>
): string {
  if (mlProductId && ML_ID_RE.test(mlProductId)) {
    const direct = params ? directAffiliateUrl(mlProductId, params) : null;
    return direct ?? `${SITE_ROOT}/p/${mlProductId}`;
  }
  return SITE_ROOT;
}

/** El destino que corresponde según la configuración vigente. */
export function resolveOutboundUrl(
  product: { affiliate_url: string; ml_product_id: string | null },
  params: AffiliateParams
): string {
  if (params.directLinks) {
    const direct = directAffiliateUrl(product.ml_product_id, params);
    if (direct && isAllowedAffiliateUrl(direct)) return direct;
  }
  if (isAllowedAffiliateUrl(product.affiliate_url ?? '')) return product.affiliate_url.trim();
  return safeFallback(product.ml_product_id, params);
}

/**
 * Para los componentes: usa el destino precalculado si viene, si no el link
 * guardado. Si ninguno pasa la lista, cae a la ficha (con los parámetros de
 * afiliado si se entregan).
 */
export function buyUrl(
  product: { affiliate_url: string; outbound_url?: string; ml_product_id?: string | null },
  params?: Pick<AffiliateParams, 'word' | 'tool'>
): string {
  if (product.outbound_url && isAllowedAffiliateUrl(product.outbound_url)) return product.outbound_url.trim();
  if (isAllowedAffiliateUrl(product.affiliate_url ?? '')) return product.affiliate_url.trim();
  return safeFallback(product.ml_product_id, params);
}
