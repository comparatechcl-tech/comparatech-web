import { unstable_cache } from 'next/cache';
import { getDeals } from '@/lib/queries/products';
import { getPriceStatsMany } from '@/lib/queries/price-history';
import { confirmedDrop, dropsById, rankDeals, type ConfirmedDrop } from '@/lib/deal-rank';
import type { PriceStats } from '@/lib/deals';
import type { Product } from '@/lib/types';

/**
 * El historial de las ofertas que hoy tienen una baja comprobada.
 *
 * Leer el historial de todas las ofertas son decenas de consultas, y ahora
 * lo necesitan la página de ofertas y cada tanda que pide /ofertas/lote. Se
 * guarda por 5 minutos (o hasta que se invalide 'catalog', que es lo que
 * hace la revisión de precios).
 *
 * La llave es la lista de ofertas con su precio: si un precio cambia, deja
 * de servir lo guardado y se lee de nuevo. Y se guarda solo el historial que
 * confirma una baja, que son pocos: el caché de datos de Vercel no acepta
 * entradas de más de 2 MB.
 */
const readDropStats = unstable_cache(
  async (priced: [id: string, price: number][]): Promise<[string, PriceStats][]> => {
    const stats = await getPriceStatsMany(priced.map(([id]) => id));
    const withDrop: [string, PriceStats][] = [];
    for (const [id, price] of priced) {
      const s = stats.get(id);
      if (s && confirmedDrop({ price, original_price: null }, s)) withDrop.push([id, s]);
    }
    return withDrop;
  },
  ['deal-drop-stats-v1'],
  { revalidate: 300, tags: ['catalog'] }
);

export interface RankedDeals {
  /** Todas las ofertas: primero las bajas comprobadas, después por descuento. */
  ranked: Product[];
  /** Bajas comprobadas, por id de producto. */
  drops: Record<string, ConfirmedDrop>;
  /** La de mayor descuento sobre el precio de lista, si hay alguna. */
  best: Product | null;
}

/**
 * Las ofertas en el orden en que se muestran en /ofertas. Lo comparten la
 * página y la ruta de tandas para que una sea la continuación de la otra.
 */
export async function getRankedDeals(): Promise<RankedDeals> {
  const deals = await getDeals();
  // Ordenado por id: la llave no depende del orden en que llegan las ofertas.
  const priced = deals.map((p): [string, number] => [p.id, p.price]).sort(([a], [b]) => (a < b ? -1 : 1));
  const stats = new Map(await readDropStats(priced));

  return {
    ranked: rankDeals(deals, stats),
    drops: dropsById(deals, stats),
    best: deals[0] ?? null,
  };
}
