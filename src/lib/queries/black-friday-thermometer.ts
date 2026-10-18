import { unstable_cache } from 'next/cache';
import { getSupabase } from '@/lib/supabase/client';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { BLACK_FRIDAY } from '@/lib/black-friday';
import {
  buildThermometer,
  buildWatchList,
  showWatchList,
  thermometerSlot,
  watchCandidates,
  type ThermometerProduct,
  type ThermometerRow,
  type ThermometerSummary,
  type WatchItem,
} from '@/lib/black-friday-thermometer';
import { FROZEN_BALANCE } from '@/lib/black-friday-2026-balance';
import { getAllProducts } from '@/lib/queries/products';
import { getPriceHistoryCached, getPriceStatsCached } from '@/lib/queries/price-history';
import type { PricePoint, PriceStats } from '@/lib/deals';

/**
 * Lo que lee el termómetro del Black Friday (lib/black-friday-thermometer):
 * todo el catálogo visible y TODO su historial de precios hasta ahora, y lo
 * que se guarda es solo el resumen (unos KB).
 *
 * Por qué todo el historial y no el de los últimos días: el precio que regía
 * al empezar la referencia es el último registro anterior a ella, y un
 * producto sin registros también cuenta (su precio no cambió). Son unas
 * 6.000 filas el 18-10-2026 y unas 50.000 calculadas para el 1 de diciembre:
 * de a 1.000 por consulta (Supabase corta ahí sin avisar), de a seis
 * consultas a la vez.
 *
 * Con la clave pública, como el resto del sitio: cuenta lo que se ve (ni lo
 * oculto ni lo borrado). Por eso el balance se congela después del evento
 * (lib/black-friday-2026-balance): si después se borran productos del
 * catálogo, el balance publicado no cambia.
 *
 * El caché no lleva la etiqueta 'catalog' a propósito: la revisión de
 * precios la purga cada 30 minutos, y releer todo el historial cada media
 * hora gasta Supabase y tiempo de Vercel sin cambiar el dato. La llave
 * (thermometerSlot) cambia una vez al día antes del 21 de noviembre, cada
 * hora desde ahí y nunca en el balance, que se rehace una vez al día.
 */

const PAGE = 1000;
/** Tope de páginas: 200.000 filas. Más que eso es que algo responde raro. */
const MAX_PAGES = 200;
const CONCURRENCY = 6;
/** Ids por consulta: viajan en la URL (37 caracteres cada uno). */
const ID_CHUNK = 40;

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  ml_family_id: string | null;
  created_at: string;
  price: number;
  original_price: number | null;
  is_active: boolean;
  inactive_since: string | null;
};

type HistoryRow = { p: string; v: number; l: number | null; t: string };

function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

/** Lee páginas de a CONCURRENCY hasta la primera que viene incompleta. Lanza si alguna falla. */
async function readAllPages<T>(readPage: (from: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let first = 0; first < MAX_PAGES; first += CONCURRENCY) {
    const pages = Array.from({ length: Math.min(CONCURRENCY, MAX_PAGES - first) }, (_, i) => first + i);
    const results = await mapWithConcurrency(pages, CONCURRENCY, async (page) => {
      const { data, error } = await readPage(page * PAGE);
      if (error) throw new Error(error.message);
      return (data ?? []) as T[];
    });
    for (const rows of results) {
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
  throw new Error(`más de ${MAX_PAGES * PAGE} filas`);
}

async function readProducts(): Promise<ThermometerProduct[]> {
  const supabase = requireSupabase();
  const rows = await readAllPages<ProductRow>((from) =>
    supabase
      .from('products')
      .select('id, slug, name, category, ml_family_id, created_at, price, original_price, is_active, inactive_since')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
  );
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    familyId: r.ml_family_id,
    createdAt: Date.parse(r.created_at),
    price: r.price,
    listPrice: r.original_price,
    active: r.is_active,
    inactiveSince: r.inactive_since ? Date.parse(r.inactive_since) : null,
  }));
}

async function readHistory(asOf: number): Promise<ThermometerRow[]> {
  const supabase = requireSupabase();
  // Por id y no por fecha: lo que se anota mientras se lee queda al final, y
  // las páginas que se leen a la vez no se corren. Nombres cortos: es lo que
  // más pesa de la respuesta.
  const rows = await readAllPages<HistoryRow>((from) =>
    supabase
      .from('price_history')
      .select('p:product_id, v:price, l:original_price, t:observed_at')
      .lte('observed_at', new Date(asOf).toISOString())
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
  );
  return rows.map((r) => ({ productId: r.p, price: r.v, listPrice: r.l, t: Date.parse(r.t) }));
}

/**
 * De los productos sin registros hasta `asOf`, los que sí tienen registros
 * después: de esos no se sabe qué precio regía (lib/black-friday-thermometer,
 * timelineOf). Solo pasa cuando se mide algo ya terminado (el balance).
 */
async function productsWithLaterRows(ids: string[], asOf: number): Promise<Set<string>> {
  const supabase = requireSupabase();
  const found = new Set<string>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  await mapWithConcurrency(chunks, 4, async (chunk) => {
    const { data, error } = await supabase
      .from('price_history')
      .select('product_id')
      .in('product_id', chunk)
      .gt('observed_at', new Date(asOf).toISOString())
      .limit(PAGE);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { product_id: string }[]) found.add(row.product_id);
  });
  return found;
}

/**
 * Todo lo que necesita buildThermometer, con el historial hasta `asOf`.
 * Lanza si algo no se pudo leer entero: un balance con huecos sería falso.
 */
export async function readThermometerInputs(asOf: number): Promise<{ products: ThermometerProduct[]; rows: ThermometerRow[] }> {
  const [products, rows] = await Promise.all([readProducts(), readHistory(asOf)]);

  // Medir hasta ahora no puede dejar registros "después".
  if (asOf >= Date.now() - 60_000) return { products, rows };
  const withRows = new Set(rows.map((r) => r.productId));
  const without = products.filter((p) => !withRows.has(p.id)).map((p) => p.id);
  if (without.length === 0) return { products, rows };
  const later = await productsWithLaterRows(without, asOf);
  return { products: products.filter((p) => !later.has(p.id)), rows };
}

async function computeSummary(): Promise<ThermometerSummary> {
  const now = Date.now();
  const { products, rows } = await readThermometerInputs(Math.min(now, BLACK_FRIDAY.end));
  return buildThermometer(products, rows, now);
}

// La llave lleva el número de versión: el caché de datos de Vercel sobrevive
// a los despliegues. Un día de vigencia basta: lo que hace cambiar el dato es
// el slot (cada día, cada hora o nunca), que es parte de la llave.
const readSummary = unstable_cache(async (_slot: string) => computeSummary(), ['bf-termometro-v1'], { revalidate: 86_400 });

/**
 * "Lo que vamos a vigilar" en /black-friday (lib/black-friday-thermometer,
 * buildWatchList), del lunes 23 hasta que termina el evento. Fuera de esas
 * fechas no lee nada. Son unos 14 modelos: el historial de cada uno sale de
 * la misma lectura que usa su ficha. Nunca lanza: sin datos, no hay lista.
 */
export async function getWatchList(now: number = Date.now()): Promise<WatchItem[]> {
  if (!showWatchList(now)) return [];
  try {
    const candidates = watchCandidates(await getAllProducts());
    const histories = new Map<string, PricePoint[] | null>();
    const stats = new Map<string, PriceStats>();
    await Promise.all(
      candidates.map(async ({ cheapest }) => {
        const [history, stat] = await Promise.all([getPriceHistoryCached(cheapest.id), getPriceStatsCached(cheapest.id)]);
        histories.set(cheapest.id, history);
        if (stat) stats.set(cheapest.id, stat);
      })
    );
    return buildWatchList(candidates, histories, stats, now);
  } catch (err) {
    console.warn('[termometro] no se pudo armar la lista a vigilar:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * El resumen del termómetro a esta hora, o null si no se pudo calcular (la
 * página lo dice en vez de mostrar números a medias). Después del evento,
 * si el balance ya está congelado, ese.
 */
export async function getThermometer(now: number = Date.now()): Promise<ThermometerSummary | null> {
  const slot = thermometerSlot(now);
  if (slot === 'balance' && FROZEN_BALANCE) return FROZEN_BALANCE;
  try {
    return await readSummary(slot);
  } catch (err) {
    console.warn('[termometro] no se pudo calcular:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
