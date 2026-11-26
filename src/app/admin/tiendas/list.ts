/**
 * El orden de las tarjetas de "Otras tiendas".
 *
 * Van todas en una sola lista, por clics, tengan o no una tienda enlazada.
 * Así una tarjeta no cambia de lugar cuando se le guarda una tienda: se usa
 * desde el teléfono, y una tarjeta que salta a otra sección parece que
 * desapareció (y la de abajo sube justo bajo el dedo).
 */

export interface OrderableCard {
  id: string;
  name: string;
  clicks: number;
  /** Si ya tiene alguna tienda enlazada. */
  linked: boolean;
}

/**
 * De más a menos clics. Las enlazadas van todas; de las que no tienen tienda,
 * solo las `maxUnlinked` más abiertas. Sin repetidos. Puro.
 */
export function orderStoreCards<T extends OrderableCard>(cards: T[], maxUnlinked: number): T[] {
  const seen = new Set<string>();
  const sorted = [...cards].sort((a, b) => b.clicks - a.clicks || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const out: T[] = [];
  let unlinked = 0;
  for (const card of sorted) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    if (!card.linked) {
      if (unlinked >= maxUnlinked) continue;
      unlinked += 1;
    }
    out.push(card);
  }
  return out;
}
