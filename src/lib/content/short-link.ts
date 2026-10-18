/**
 * El link corto de un producto, para escribirlo a mano donde el link no se
 * puede tocar: TikTok, YouTube Shorts y los reels de Instagram y Facebook.
 * El dueño lo pidió el 18-10-2026 para dar un acceso directo al producto
 * donde no puede poner el sticker de link.
 *
 * Es comparatech.cl/p/ y los dígitos del código del producto en el catálogo
 * de Mercado Libre (MLC78729874 → comparatech.cl/p/78729874): son únicos,
 * no cambian y no necesitan una tabla nueva.
 *
 * Lleva a la ficha del sitio, con el precio al día y el botón de compra, y
 * no directo a Mercado Libre: las reglas de su programa de afiliados no
 * permiten acortar ni modificar sus links.
 *
 * Sin I/O: lo usan los textos de redes (admin, cron) y la ruta /p/[codigo].
 */

const ML_ID_RE = /^MLC(\d{6,12})$/;
const CODE_RE = /^\d{6,12}$/;

/** "78729874" de "MLC78729874", o null. */
export function shortLinkCode(mlProductId: string | null | undefined): string | null {
  return ML_ID_RE.exec(mlProductId?.trim() ?? '')?.[1] ?? null;
}

/** El código del catálogo de Mercado Libre de un link corto ("78729874" → "MLC78729874"), o null si no lo es. */
export function mlIdFromShortCode(code: string): string | null {
  return CODE_RE.test(code) ? `MLC${code}` : null;
}

/**
 * El link corto como texto para escribir, sin "https://" ni "www."
 * ("comparatech.cl/p/78729874"), o null si el producto no tiene código.
 */
export function shortLinkText(siteUrl: string, mlProductId: string | null | undefined): string | null {
  const code = shortLinkCode(mlProductId);
  if (!code) return null;
  let host: string;
  try {
    host = new URL(siteUrl).host.replace(/^www\./, '');
  } catch {
    return null;
  }
  return `${host}/p/${code}`;
}
