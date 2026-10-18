/**
 * El visor de fotos de la ficha y de la página de cada modelo: la foto en
 * grande y, con las flechas o deslizando el dedo, las fotos de las otras
 * versiones del mismo producto (colores y capacidades), cada una con su
 * precio y el link a su ficha. Pedido del dueño el 18-10-2026.
 *
 * Mercado Libre trae una foto por ficha (la que guardamos): el visor pasa
 * de una versión a otra, no por varias fotos de la misma.
 *
 * Sin imports: lo usa el componente de cliente (PhotoViewer) y lo arman las
 * páginas en el servidor. Todo lo que va acá queda escrito en el HTML, así
 * que lleva solo lo que el visor muestra.
 */

export interface ViewerItem {
  id: string;
  slug: string;
  /** Lo que distingue a la versión: "256 GB · Lavanda", "Negro". */
  label: string;
  /** El nombre completo, para el texto alternativo de la foto. */
  name: string;
  price: number;
  imageUrl: string;
  /** false: hoy sin vendedor con reputación verde (el precio es el último que vimos). */
  onSale: boolean;
}

type Version = { id: string; slug: string; name: string; price: number; image_url: string; is_active: boolean };

/**
 * Las fotos del visor y en cuál parte: primero las versiones a la venta, de
 * menor a mayor precio, y después las que hoy no tienen vendedor. Sin
 * repetir, y con la versión de la página siempre incluida.
 */
export function viewerItems<T extends Version>(
  current: T,
  versions: T[],
  labelOf: (product: T) => string,
): { items: ViewerItem[]; start: number } {
  const seen = new Set<string>();
  const all = [current, ...versions].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const ordered = all.sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.price - b.price);
  const items = ordered.map((p) => ({
    id: p.id,
    slug: p.slug,
    label: labelOf(p),
    name: p.name,
    price: p.price,
    imageUrl: p.image_url,
    onSale: p.is_active,
  }));
  return { items, start: Math.max(0, items.findIndex((i) => i.id === current.id)) };
}

/** La foto siguiente (1) o la anterior (-1); después de la última vuelve a la primera. */
export function stepIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (index + direction + count) % count;
}

/** Cuánto hay que deslizar el dedo para cambiar de foto, en píxeles. */
export const SWIPE_MIN_PX = 50;

/**
 * Hacia dónde pasa un deslizamiento: hacia la izquierda, la siguiente (1);
 * hacia la derecha, la anterior (-1). Un deslizamiento corto, o más vertical
 * que horizontal, no cambia nada (0).
 */
export function swipeStep(dx: number, dy = 0): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx)) return 0;
  return dx < 0 ? 1 : -1;
}
