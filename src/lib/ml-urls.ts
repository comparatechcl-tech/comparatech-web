/**
 * URLs públicas de Mercado Libre, armadas a partir de los IDs que ya
 * guardamos.
 *
 * Reemplazan al enlace de búsqueda por texto que tenía el panel de
 * candidatos: buscar "Galaxy A37 128 GB Awesome Charcoal" devuelve una
 * parrilla con variantes de memoria, de color y de otros vendedores, y hay
 * que adivinar cuál es la ficha correcta. Con el ml_product_id se llega
 * directo a la ficha de catálogo, que es la que ve el comprador y desde
 * donde hay que generar el link de afiliado.
 *
 * Sin imports a propósito: lo usan componentes de cliente.
 */

const SITE = 'https://www.mercadolibre.cl';

/** Ficha de catálogo con todas las ofertas del producto. */
export function mlProductUrl(mlProductId: string): string {
  return `${SITE}/p/${mlProductId}`;
}
