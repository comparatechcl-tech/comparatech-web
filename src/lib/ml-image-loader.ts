/**
 * Loader de next/image para las fotos de Mercado Libre.
 *
 * Vercel Hobby incluye 5.000 optimizaciones de imagen al mes, y cada foto
 * de producto en cada ancho distinto gasta una. El CDN de ML ya publica
 * cada foto en varios tamaños y en WebP, con solo cambiar la letra del
 * final del archivo:
 *
 *   D_NQ_NP_898382-MLA99937961431_112025-F.jpg
 *                                         ^ I, E, V, O, W o F
 *
 * Con este loader el navegador pide la foto directo a ML en el tamaño que
 * necesita y Vercel no procesa nada. Medido con GET sobre 20 fotos reales:
 * -V.webp pesa ~6 KB (alcanza para tarjetas), -O.webp ~12 KB y -F.webp
 * ~40 KB (la ficha). Todas existían en .webp.
 *
 * NO se configura global en next.config.js a propósito: las imágenes
 * locales (el hero pesa 1,8 MB) sí tienen que pasar por el optimizador.
 * Cada <Image> de ML lleva `loader={mlImageLoader}`.
 *
 * Sin imports: lo usan componentes de cliente.
 */

const ML_SIZE_SUFFIX = /-[IEVOWF]\.(?:jpe?g|webp|png)$/i;

function isMlStaticHost(hostname: string): boolean {
  return hostname === 'mlstatic.com' || hostname.endsWith('.mlstatic.com');
}

/** Letra de tamaño de ML para el ancho que pide next/image. */
function sizeFor(width: number): 'V' | 'O' | 'F' {
  if (width <= 320) return 'V';
  if (width <= 500) return 'O';
  return 'F';
}

export default function mlImageLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    // Rutas locales ("/hero.jpg") y cualquier cosa que no sea una URL
    // absoluta quedan tal cual.
    return src;
  }
  if (!isMlStaticHost(url.hostname) || !ML_SIZE_SUFFIX.test(url.pathname)) return src;

  // Solo cambia el final del nombre: el prefijo (D_NQ_NP_ o D_Q_NP_) y el
  // id de la foto se conservan.
  url.pathname = url.pathname.replace(ML_SIZE_SUFFIX, `-${sizeFor(width)}.webp`);
  return url.toString();
}
