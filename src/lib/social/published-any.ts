import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CAROUSEL_MARK } from '@/lib/social/carousel-marks';
import { STORY_MARK, VIDEO_MARK } from '@/lib/social/networks';

/**
 * Lo ya publicado en cualquier formato (historia, reel o carrusel), para no
 * sugerirlo de nuevo en otro. El dueño lo pidió el 07-11-2026: Historias le
 * proponía casi siempre productos que ya habían salido como reel o en el
 * carrusel, porque cada página solo miraba sus propias marcas.
 */

/** Días en que algo publicado en cualquier formato no vuelve a sugerirse. */
export const ANY_FORMAT_REPEAT_DAYS = 14;

/** Cuánto tiene que haber bajado desde que se publicó para volver antes: menos que esto no es noticia. */
export const ANY_FORMAT_REPOST_DROP = 0.03;

const MARKS = [STORY_MARK, VIDEO_MARK, CAROUSEL_MARK];

interface Row {
  product_id: string | null;
  posted_price: number | null;
}

/** De cada producto publicado desde `since`, el precio más bajo con que salió (null si ninguna marca lo anotó). Puro. */
export function lowestPublishedPrice(rows: Row[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const row of rows) {
    if (!row.product_id) continue;
    const price = typeof row.posted_price === 'number' && row.posted_price > 0 ? row.posted_price : null;
    const known = out.get(row.product_id);
    if (known === undefined) out.set(row.product_id, price);
    else if (price !== null && (known === null || price < known)) out.set(row.product_id, price);
  }
  return out;
}

/** ¿Bajó lo suficiente desde que se publicó como para volver a sugerirlo? Puro. */
export function droppedSincePublished(lowest: number | null, price: number): boolean {
  return lowest !== null && price > 0 && price <= lowest * (1 - ANY_FORMAT_REPOST_DROP);
}

/** Los productos publicados en cualquier formato desde `since` que hoy no han bajado: no se sugieren. */
export function stillPublished(published: Map<string, number | null>, rows: { id: string; price: number }[]): Set<string> {
  const out = new Set<string>();
  for (const p of rows) {
    if (published.has(p.id) && !droppedSincePublished(published.get(p.id) ?? null, p.price)) out.add(p.id);
  }
  return out;
}

/** Lee las marcas de historia, video y carrusel desde `since`. Si la lectura falla, no saca nada (mejor repetir que no sugerir). */
export async function readPublishedAnyFormat(admin: SupabaseClient, since: Date): Promise<Map<string, number | null>> {
  const { data, error } = await admin
    .from('social_posts')
    .select('product_id, posted_price')
    .in('caption', MARKS)
    .neq('status', 'error')
    .gte('posted_at', since.toISOString())
    .limit(5000);
  if (error) {
    console.error(`[published-any] no se pudo leer lo publicado: ${error.message}`);
    return new Map();
  }
  return lowestPublishedPrice((data ?? []) as Row[]);
}
