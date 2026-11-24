/**
 * "Los más populares" de la portada: los productos que más personas abrieron
 * en Mercado Libre desde el sitio.
 *
 * Desde el 23-11-2026 Mercado Libre no entrega precios y la portada se quedó
 * sin su sección de ofertas (ver lib/price-freshness). Esto es lo que el
 * sitio sí sabe por su cuenta, sin depender de nadie: qué fichas terminan en
 * un clic hacia Mercado Libre (tabla outbound_clicks). No dice que sean
 * mejores ni más baratos: solo que son los que más se abren.
 *
 * Sin I/O: se prueba con datos fijos. La lectura está en lib/queries/popular.
 */
import { normalizeName } from '@/lib/text';

/** Lo que hace falta de cada producto para saber a qué tarjeta del catálogo corresponde. */
export interface PopularProduct {
  id: string;
  name: string;
  ml_family_id: string | null;
}

/** Con menos productos que esto la sección no se muestra: dos tarjetas sueltas parecen un error. */
export const POPULAR_MIN = 4;

/** Un producto con un solo clic en el período no es "popular". */
export const POPULAR_MIN_CLICKS = 2;

/**
 * Los productos del catálogo ordenados por clics, del más abierto al menos.
 *
 * `clicks` son los ids de producto de cada clic del período. `all` son todos
 * los productos a la venta y `catalog` las tarjetas que se muestran (una por
 * producto real, ver collapseVariants): el clic en un color que no es la
 * tarjeta de su modelo cuenta para esa tarjeta, por familia o por nombre.
 * Los clics de productos que ya no están a la venta no cuentan. A igual
 * número de clics se mantiene el orden del catálogo.
 */
export function rankPopular<T extends PopularProduct>(
  clicks: (string | null | undefined)[],
  all: PopularProduct[],
  catalog: T[],
  limit: number
): T[] {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const byFamily = new Map<string, T>();
  const byName = new Map<string, T>();
  for (const p of catalog) {
    if (p.ml_family_id && !byFamily.has(p.ml_family_id)) byFamily.set(p.ml_family_id, p);
    const name = normalizeName(p.name);
    if (!byName.has(name)) byName.set(name, p);
  }
  const allById = new Map(all.map((p) => [p.id, p]));

  /** La tarjeta del catálogo que representa a un producto, si tiene. */
  const cardOf = (id: string): T | null => {
    const direct = byId.get(id);
    if (direct) return direct;
    const product = allById.get(id);
    if (!product) return null;
    return (product.ml_family_id && byFamily.get(product.ml_family_id)) || byName.get(normalizeName(product.name)) || null;
  };

  const counts = new Map<string, number>();
  for (const id of clicks) {
    if (!id) continue;
    const card = cardOf(id);
    if (card) counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
  }

  const order = new Map(catalog.map((p, i) => [p.id, i]));
  return [...counts]
    .filter(([, n]) => n >= POPULAR_MIN_CLICKS)
    .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .slice(0, Math.max(0, limit))
    .map(([id]) => byId.get(id))
    .filter((p): p is T => Boolean(p));
}
