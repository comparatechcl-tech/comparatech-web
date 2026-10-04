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

/** Una sola lectura por producto y por render, aunque la pidan varios componentes. */
export const getPriceStatsCached = cache(getPriceStats);

/**
 * Estadísticas de varios productos (página de ofertas). De a pocos en
 * paralelo para no saturar Supabase durante una regeneración.
 */
export async function getPriceStatsMany(productIds: string[]): Promise<Map<string, PriceStats>> {
  const byId = new Map<string, PriceStats>();
  const unique = [...new Set(productIds)];
  await mapWithConcurrency(unique, 6, async (id) => {
    const stats = await getPriceStatsCached(id);
    if (stats) byId.set(id, stats);
  });
  return byId;
}
