import { unstable_cache } from 'next/cache';
import { getDeals } from '@/lib/queries/products';
import { getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { dropsById, rankDeals, type ConfirmedDrop } from '@/lib/deal-rank';
import type { PriceStats } from '@/lib/deals';
import type { Product } from '@/lib/types';

/**
 * El resumen del historial de precios de todas las ofertas.
 *
 * Leer el historial de todas las ofertas son decenas de consultas, y lo
 * necesitan la portada, la página de ofertas y cada tanda que pide
 * /ofertas/lote. Se guarda por 5 minutos (o hasta que se invalide 'catalog',
 * que es lo que hace la revisión de precios) en una sola entrada que
 * comparten todas: el historial se lee una vez, no una por página.
 *
 * La llave es la lista de ofertas con su precio: si un precio cambia, deja
 * de servir lo guardado y se lee de nuevo.
 *
 * Antes se guardaba solo el historial que confirmaba una baja. La portada
 * necesita saber de todas si el precio se ha movido hace poco (ver
 * lib/home-deals), así que ahora va el resumen de cada una: unos 270 bytes
 * por oferta, menos de 0,1 MB con las casi 400 de hoy. El caché de datos de
 * Vercel no acepta entradas de más de 2 MB, y a eso se llegaría recién con
 * unas 7.000 ofertas. Va solo el resumen, nunca el historial mismo.
 *
 * `unread` son las ofertas cuyo historial no se pudo leer esta vez. Se
 * guarda igual (por 5 minutos a lo más): la portada las trata como "no se
 * sabe", que no es lo mismo que "precio quieto".
 */
const readDealStats = unstable_cache(
  async (priced: [id: string, price: number][]): Promise<{ stats: [string, PriceStats][]; unread: string[] }> => {
    const read = await getPriceStatsManyChecked(priced.map(([id]) => id));
    return { stats: [...read.stats], unread: [...read.unread] };
  },
  // El número sube cada vez que cambia la forma de lo guardado: el caché de datos sobrevive a los despliegues.
  ['deal-stats-v3'],
  { revalidate: 300, tags: ['catalog'] }
);

export interface DealsWithStats {
  /** Las ofertas, de mayor a menor descuento sobre el precio de lista. */
  deals: Product[];
  /** El resumen del historial de precios, por id. Las ofertas sin historial no están. */
  stats: Map<string, PriceStats>;
  /** Las ofertas cuyo historial no se pudo leer: de esas no se sabe nada. */
  unread: Set<string>;
}

/** Las ofertas con lo que el historial propio dice de cada una. */
export async function getDealsWithStats(): Promise<DealsWithStats> {
  const deals = await getDeals();
  // Ordenado por id: la llave no depende del orden en que llegan las ofertas.
  const priced = deals.map((p): [string, number] => [p.id, p.price]).sort(([a], [b]) => (a < b ? -1 : 1));
  const read = await readDealStats(priced);
  return { deals, stats: new Map(read.stats), unread: new Set(read.unread) };
}

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
  const { deals, stats } = await getDealsWithStats();

  return {
    ranked: rankDeals(deals, stats),
    drops: dropsById(deals, stats),
    best: deals[0] ?? null,
  };
}
