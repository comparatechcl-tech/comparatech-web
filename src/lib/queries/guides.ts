import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { getCatalogProducts } from '@/lib/queries/products';
import { getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { buildGuide, guideCandidates, type GuideDef, type GuideView } from '@/lib/guides';
import type { PriceStats } from '@/lib/deals';

/**
 * Lo que leen las guías (lib/guides): el catálogo que ya está en el caché
 * (el mismo de todo el sitio) y el resumen del historial de sus candidatos.
 *
 * El historial se lee solo de los candidatos de la guía (tipo y precio, sin
 * los avisos que se ven sin historial): hoy son ~100 de ~900. Se guarda por
 * 5 minutos, o hasta que la revisión de precios invalide 'catalog', en una
 * entrada por guía. Va el resumen de cada producto (~270 bytes), nunca el
 * historial mismo: con 1.000 candidatos serían 0,3 MB, lejos de los 2 MB que
 * acepta el caché de datos de Vercel.
 *
 * La llave es la lista de candidatos con su precio: si un precio cambia,
 * deja de servir lo guardado y se lee de nuevo.
 */
const readGuideStats = unstable_cache(
  async (priced: [id: string, price: number][]): Promise<{ stats: [string, PriceStats][]; unread: string[] }> => {
    const read = await getPriceStatsManyChecked(priced.map(([id]) => id));
    return { stats: [...read.stats], unread: [...read.unread] };
  },
  // El número sube cada vez que cambia la forma de lo guardado: el caché de datos sobrevive a los despliegues.
  ['guide-stats-v1'],
  { revalidate: 300, tags: ['catalog'] },
);

/**
 * La guía armada con el catálogo y el historial de hoy. Una vez por render:
 * la usan la página y su metadata.
 */
export const getGuideView = cache(async (guide: GuideDef): Promise<GuideView> => {
  const catalog = await getCatalogProducts();
  const candidates = guideCandidates(guide, catalog);
  // Ordenado por id: la llave no depende del orden en que llega el catálogo.
  const priced = candidates.map((p): [string, number] => [p.id, p.price]).sort(([a], [b]) => (a < b ? -1 : 1));
  const read = priced.length > 0 ? await readGuideStats(priced) : { stats: [], unread: [] };
  return buildGuide(guide, candidates, new Map(read.stats), new Set(read.unread), Date.now());
});
