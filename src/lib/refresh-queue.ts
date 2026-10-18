import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';

/**
 * En qué orden revisa precios el cron (ver api/cron/refresh-prices).
 *
 * Una corrida alcanza a consultar en Mercado Libre unos 1.300 productos en
 * su presupuesto de 40 s (medido el 18-10-2026: 1.214 en 31 s de promedio).
 * Mientras el catálogo quepa, el orden da lo mismo: se revisa todo cada
 * media hora. Cuando no cabe, lo que no se alcanzó conserva su hora de
 * revisión vieja y pasa al frente de la corrida siguiente, así que nada se
 * queda atrás para siempre. Este orden decide qué va primero:
 *
 *  1. Lo que más se ve: las ofertas del sitio y lo que tuvo clics o salió en
 *     redes hace poco. Un descuento publicado con un precio viejo es lo que
 *     más daño hace, y esos se revisan en cada corrida.
 *  2. El resto, desde el precio revisado hace más tiempo.
 *
 * La base ya entrega las filas del precio más viejo al más nuevo: aquí solo
 * se pasan adelante las prioritarias, sin cambiar el orden dentro de cada
 * grupo.
 */

/**
 * Tope de prioritarios por corrida. El 18-10 eran 473 (456 ofertas, 18 con
 * clics y 17 en redes, con repetidos). Con el tope, al resto le quedan al
 * menos unos 700 lugares por corrida aunque las ofertas se multipliquen en
 * Black Friday; las prioritarias que no entran se ordenan con el resto, por
 * antigüedad.
 */
export const MAX_PRIORITY = 600;

export interface QueueRow {
  id: string;
  price: number;
  original_price: number | null;
  is_active: boolean;
  price_checked_at?: string | null;
}

/** Una oferta como las del sitio: a la venta y con 20% o más de descuento. */
export function isVisibleDeal(row: Pick<QueueRow, 'price' | 'original_price' | 'is_active'>): boolean {
  if (!row.is_active || !row.original_price || row.original_price <= row.price) return false;
  return Math.round((1 - row.price / row.original_price) * 100) >= MIN_DEAL_DISCOUNT;
}

/**
 * La fila de la corrida: primero las prioritarias (hasta `maxPriority`),
 * después el resto. `hotIds` son los productos con clics o publicaciones
 * recientes.
 */
export function refreshQueue<T extends QueueRow>(
  rows: T[],
  hotIds: ReadonlySet<string>,
  maxPriority = MAX_PRIORITY
): { queue: T[]; priority: number } {
  const first: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (first.length < maxPriority && (hotIds.has(row.id) || isVisibleDeal(row))) first.push(row);
    else rest.push(row);
  }
  return { queue: [...first, ...rest], priority: first.length };
}

/**
 * Minutos del precio visible más viejo que queda después de la corrida: el
 * de los productos a la venta que esta corrida no alcanzó a revisar (o que
 * dieron error). 0 si todos quedaron al día. Si este número sube corrida
 * tras corrida, el catálogo ya no cabe en el ritmo de revisión.
 */
export function oldestVisibleMinutes(
  rows: Pick<QueueRow, 'id' | 'is_active' | 'price_checked_at'>[],
  freshIds: ReadonlySet<string>,
  now: number
): number {
  let oldest = 0;
  for (const row of rows) {
    if (!row.is_active || freshIds.has(row.id) || !row.price_checked_at) continue;
    const checked = new Date(row.price_checked_at).getTime();
    if (Number.isNaN(checked)) continue;
    oldest = Math.max(oldest, Math.floor((now - checked) / 60_000));
  }
  return oldest;
}
