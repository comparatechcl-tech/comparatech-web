/**
 * El link corto de un producto: comparatech.cl/p/ y los dígitos del código
 * del producto en el catálogo de Mercado Libre (MLC78729874 →
 * comparatech.cl/p/78729874). Son únicos, no cambian y no necesitan una tabla
 * nueva.
 *
 * Lleva a la ficha del sitio (ruta /p/[codigo]), con el precio al día y el
 * botón de compra, y no directo a Mercado Libre: las reglas de su programa de
 * afiliados no permiten acortar ni modificar sus links.
 *
 * Los textos de redes lo llevaron el 18-10-2026, para escribirlo donde el
 * link no se puede tocar, y el mismo día el dueño lo cambió por el nombre del
 * sitio: un link largo que no se puede tocar nadie lo escribe a mano. La ruta
 * sigue para los textos que ya se publicaron con él.
 *
 * Sin I/O.
 */

const CODE_RE = /^\d{6,12}$/;

/** El código del catálogo de Mercado Libre de un link corto ("78729874" → "MLC78729874"), o null si no lo es. */
export function mlIdFromShortCode(code: string): string | null {
  return CODE_RE.test(code) ? `MLC${code}` : null;
}
