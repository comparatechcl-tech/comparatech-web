import { cache } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { priceStats, type PricePoint, type PriceStats } from '@/lib/deals';

/**
 * Historial de precios para las páginas públicas.
 *
 * Se lee con el cliente anon: la tabla tiene una policy de lectura pública
 * para los productos visibles (migración 0016), así que no hace falta la
 * clave de servicio en una página que se sirve desde caché.
 *
 * Nunca lanza. El historial es un extra de la ficha: si la tabla no existe
 * todavía o Supabase falla, la página se muestra igual, sin la nota.
 */

const HISTORY_DAYS = 90;

/**
 * Tope de filas por producto. Un ganador que se alterna entre dos vendedores
 * puede sumar decenas de cambios al día; con este tope se pierden los más
 * antiguos, y daysTracked queda corto (nunca largo), así que lo que se
 * afirma sigue siendo cierto.
 */
const MAX_ROWS = 1000;

/**
 * Si la migración 0016 no se aplicó, la página de ofertas haría dos
 * consultas fallidas por producto en cada regeneración. Tras el primer
 * "no existe" se deja de preguntar por un rato.
 */
const MISSING_TABLE_RETRY_MS = 10 * 60 * 1000;
let missingTableUntil = 0;

async function readHistory(productId: string): Promise<PricePoint[] | null> {
  const supabase = getSupabase();
  if (!supabase || Date.now() < missingTableUntil) return null;

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();

  // Como solo se registran los cambios, el precio vigente al inicio de la
  // ventana es el último registro anterior a ella: se pide aparte.
  const [recent, before] = await Promise.all([
    supabase
      .from('price_history')
      .select('price, observed_at')
      .eq('product_id', productId)
      .gte('observed_at', since)
      .order('observed_at', { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from('price_history')
      .select('price, observed_at')
      .eq('product_id', productId)
      .lt('observed_at', since)
      .order('observed_at', { ascending: false })
      .limit(1),
  ]);

  if (recent.error) {
    if (isMissingSchemaError(recent.error)) {
      missingTableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
    } else {
      console.warn('[price-history] no se pudo leer el historial:', recent.error.message);
    }
    return null;
  }

  const recentRows = (recent.data ?? []) as PricePoint[];
  // Si el tope cortó la ventana, el registro anterior a ella dejaría un
  // hueco en el medio (precios que no se ven): se descarta.
  const truncated = recentRows.length >= MAX_ROWS;
  const carriedIn = truncated || before.error ? [] : ((before.data ?? []) as PricePoint[]);
  return [...carriedIn, ...recentRows];
}

export async function getPriceStats(productId: string): Promise<PriceStats | null> {
  try {
    const history = await readHistory(productId);
    return history && history.length > 0 ? priceStats(history) : null;
  } catch {
    return null;
  }
}

/**
 * Los registros de los últimos 90 días, más el anterior a ellos (el precio
 * que regía al empezar), para el gráfico de la ficha. Nunca lanza.
 */
export async function getPriceHistory(productId: string): Promise<PricePoint[] | null> {
  try {
    return await readHistory(productId);
  } catch {
    return null;
  }
}

/** Una sola lectura por producto y por render: la usan la nota de la ficha y el gráfico. */
export const getPriceHistoryCached = cache(getPriceHistory);

/** Las estadísticas de la ficha, sobre la misma lectura que el gráfico. */
export const getPriceStatsCached = cache(async (productId: string): Promise<PriceStats | null> => {
  const history = await getPriceHistoryCached(productId);
  try {
    return history && history.length > 0 ? priceStats(history) : null;
  } catch {
    return null;
  }
});

/** Productos por consulta: los ids viajan en la URL (37 caracteres cada uno). */
const BULK_CHUNK = 40;
/** Filas por página: el tope por respuesta de Supabase. */
const BULK_PAGE = 1000;
/**
 * Páginas por tanda de productos. Si una tanda tiene más historial que esto
 * no se afirma nada de ella: con el historial cortado, la "última baja"
 * podría no ser la última.
 */
const BULK_MAX_PAGES = 6;

type HistoryRow = PricePoint & { product_id: string };

/** El historial de una tanda de productos, o null si no se pudo leer entero. */
async function readHistoryChunk(ids: string[], since: string): Promise<Map<string, PricePoint[]> | null> {
  const supabase = getSupabase();
  if (!supabase || Date.now() < missingTableUntil) return null;

  const byId = new Map<string, PricePoint[]>();
  for (let page = 0; page < BULK_MAX_PAGES; page++) {
    const from = page * BULK_PAGE;
    const { data, error } = await supabase
      .from('price_history')
      .select('product_id, price, observed_at')
      .in('product_id', ids)
      .gte('observed_at', since)
      // Con el id al final el orden es estable y las páginas no se pisan.
      .order('observed_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + BULK_PAGE - 1);

    if (error) {
      if (isMissingSchemaError(error)) {
        missingTableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      } else {
        console.warn('[price-history] no se pudo leer el historial:', error.message);
      }
      return null;
    }

    const rows = (data ?? []) as HistoryRow[];
    for (const row of rows) {
      const list = byId.get(row.product_id);
      const point = { price: row.price, observed_at: row.observed_at };
      if (list) list.push(point);
      else byId.set(row.product_id, [point]);
    }
    if (rows.length < BULK_PAGE) return byId;
  }
  console.warn(`[price-history] una tanda de ${ids.length} productos pasó de ${BULK_MAX_PAGES * BULK_PAGE} registros: no se afirma nada de ella`);
  return null;
}

/** Días hacia atrás que mira getLastPriceChanges. */
const LAST_CHANGE_DAYS = 90;
/** Tope de páginas de getLastPriceChanges: con ~500 cambios al día, alcanza para meses. */
const LAST_CHANGE_MAX_PAGES = 60;

/**
 * La última vez que cambió el precio de cada producto, para el lastmod del
 * sitemap. El historial guarda solo los cambios, así que la fila más nueva
 * de un producto es su último cambio. Mira los últimos 90 días: un producto
 * sin cambios en ese plazo no aparece. Si hay más historial que el tope, lo
 * leído es lo más nuevo, así que las fechas que trae siguen siendo ciertas.
 *
 * Nunca lanza: si no se pudo leer, null.
 */
export async function getLastPriceChanges(): Promise<Map<string, string> | null> {
  const supabase = getSupabase();
  if (!supabase || Date.now() < missingTableUntil) return null;

  const since = new Date(Date.now() - LAST_CHANGE_DAYS * 86_400_000).toISOString();
  const latest = new Map<string, string>();
  try {
    for (let page = 0; page < LAST_CHANGE_MAX_PAGES; page++) {
      const from = page * BULK_PAGE;
      const { data, error } = await supabase
        .from('price_history')
        .select('product_id, observed_at')
        .gte('observed_at', since)
        .order('observed_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + BULK_PAGE - 1);

      if (error) {
        if (isMissingSchemaError(error)) missingTableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
        else console.warn('[price-history] no se pudo leer los últimos cambios:', error.message);
        return null;
      }

      const rows = (data ?? []) as { product_id: string; observed_at: string }[];
      for (const row of rows) if (!latest.has(row.product_id)) latest.set(row.product_id, row.observed_at);
      if (rows.length < BULK_PAGE) break;
    }
    return latest;
  } catch (err) {
    console.warn('[price-history] no se pudo leer los últimos cambios:', err);
    return null;
  }
}

/**
 * Estadísticas de varios productos (portada y página de ofertas).
 *
 * Lee el historial de a tandas de productos y no producto por producto: con
 * 325 ofertas eran 650 consultas en cada regeneración de la página, y ahora
 * son unas veinte. A diferencia de la lectura de la ficha, no trae el precio
 * anterior a la ventana de 90 días: una baja cuyo precio anterior es más
 * viejo que eso no se reconoce acá. Nunca al revés: lo que se afirma es
 * cierto.
 *
 * Nunca lanza: sin historial, las páginas se muestran sin la marca "Bajó".
 */
export async function getPriceStatsMany(productIds: string[]): Promise<Map<string, PriceStats>> {
  return (await getPriceStatsManyChecked(productIds)).stats;
}

export interface CheckedPriceStats {
  stats: Map<string, PriceStats>;
  /**
   * Los productos cuyo historial NO se pudo leer (la consulta falló o la
   * tanda era demasiado larga). No es lo mismo que no tener historial: de
   * estos no se sabe si estuvieron más baratos, así que quien decide qué
   * destacar o publicar solo no puede tratarlos como "precio quieto".
   */
  unread: Set<string>;
}

/** Lo mismo que getPriceStatsMany, diciendo además de cuáles no se pudo leer el historial. */
export async function getPriceStatsManyChecked(productIds: string[]): Promise<CheckedPriceStats> {
  const byId = new Map<string, PriceStats>();
  const unread = new Set<string>();
  const unique = [...new Set(productIds)];
  if (unique.length === 0) return { stats: byId, unread };

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += BULK_CHUNK) chunks.push(unique.slice(i, i + BULK_CHUNK));

  try {
    await mapWithConcurrency(chunks, 4, async (chunk) => {
      const histories = await readHistoryChunk(chunk, since);
      if (!histories) {
        for (const id of chunk) unread.add(id);
        return;
      }
      for (const [id, history] of histories) {
        const stats = priceStats(history);
        if (stats) byId.set(id, stats);
      }
    });
  } catch (err) {
    console.warn('[price-history] no se pudo leer el historial:', err);
    // Sin saber qué tandas alcanzaron a leerse, lo prudente es no dar ninguna por leída.
    for (const id of unique) if (!byId.has(id)) unread.add(id);
  }
  return { stats: byId, unread };
}
