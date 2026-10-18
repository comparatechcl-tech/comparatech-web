import { cache } from 'react';
import { getAllProducts, getPausedProducts } from '@/lib/queries/products';
import { getPriceHistoryCached, getPriceStatsCached } from '@/lib/queries/price-history';
import { getModel, versionsOf, type ModelDef } from '@/lib/models';
import type { PricePoint, PriceStats } from '@/lib/deals';
import type { Product } from '@/lib/types';

/**
 * Lo que leen las páginas de modelo (ver lib/models). Las versiones salen
 * del catálogo que ya está en el caché (el mismo de todo el sitio) y de los
 * productos fuera de venta cuya ficha sigue publicada; el historial, de la
 * misma lectura que usa cada ficha.
 */

export interface ModelVersions {
  model: ModelDef;
  /** A la venta hoy, de menor a mayor precio. */
  onSale: Product[];
  /** Sin vendedor con reputación verde hoy, con su ficha todavía publicada. */
  paused: Product[];
}

/** Las versiones de un modelo, o null si el modelo no existe. Una lectura por render. */
export const getModelVersions = cache(async (slug: string): Promise<ModelVersions | null> => {
  const model = getModel(slug);
  if (!model) return null;
  const [all, paused] = await Promise.all([getAllProducts(), getPausedProducts()]);
  return { model, onSale: versionsOf(model, all), paused: versionsOf(model, paused) };
});

export interface ModelHistories {
  /** El historial de cada versión, por id; null si no se pudo leer. */
  histories: Map<string, PricePoint[] | null>;
  /** El resumen de cada versión con historial (para "Bajó $X", lib/deal-rank). */
  stats: Map<string, PriceStats>;
}

/**
 * El historial de cada versión. Son pocas (2 a 10), así que se leen una por
 * una con la lectura de la ficha, que trae además el precio que regía al
 * empezar la ventana. Nunca lanza: lo que no se pudo leer queda en null.
 */
export async function getModelHistories(products: Product[]): Promise<ModelHistories> {
  const read = await Promise.all(
    products.map(async (p) => [p.id, await getPriceHistoryCached(p.id), await getPriceStatsCached(p.id)] as const)
  );
  const histories = new Map<string, PricePoint[] | null>();
  const stats = new Map<string, PriceStats>();
  for (const [id, history, stat] of read) {
    histories.set(id, history);
    if (stat) stats.set(id, stat);
  }
  return { histories, stats };
}
