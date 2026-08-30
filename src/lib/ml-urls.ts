/**
 * URLs públicas de Mercado Libre, armadas a partir de los IDs que ya
 * guardamos.
 *
 * Reemplazan al enlace de búsqueda por texto que tenía el panel de
 * candidatos: buscar "Galaxy A37 128 GB Awesome Charcoal" devuelve una
 * parrilla con variantes de memoria, de color y de otros vendedores, y hay
 * que adivinar cuál es la oferta que el sitio va a publicar. Con el
 * item_id se llega directo a la que corresponde, que es desde donde hay que
 * generar el link de afiliado.
 *
 * Sin imports a propósito: lo usan componentes de cliente.
 */

const SITE = 'https://www.mercadolibre.cl';

/** Ficha de catálogo con todas las ofertas del producto. */
export function mlProductUrl(mlProductId: string): string {
  return `${SITE}/p/${mlProductId}`;
}

/**
 * Ficha de catálogo con una oferta puntual ya seleccionada. `pdp_filters`
 * es el parámetro con el que ML preselecciona un vendedor dentro de la
 * ficha, así que la página abre mostrando el precio que publicamos.
 */
export function mlOfferUrl(mlProductId: string, itemId: string): string {
  return `${SITE}/p/${mlProductId}?pdp_filters=item_id%3A${itemId}`;
}

/** Búsqueda por texto. Último recurso cuando no hay ml_product_id. */
export function mlSearchUrl(query: string): string {
  return `https://listado.mercadolibre.cl/${encodeURIComponent(query.trim())}`;
}

/** El mejor enlace disponible según los datos que tengamos del producto. */
export function bestMlUrl(product: {
  name: string;
  ml_product_id?: string | null;
  ml_item_id?: string | null;
}): string {
  if (product.ml_product_id && product.ml_item_id) {
    return mlOfferUrl(product.ml_product_id, product.ml_item_id);
  }
  if (product.ml_product_id) return mlProductUrl(product.ml_product_id);
  return mlSearchUrl(product.name);
}
