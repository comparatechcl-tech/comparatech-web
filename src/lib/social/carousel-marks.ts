import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Las marcas de "ya lo publiqué" del carrusel semanal (/admin/historias/carrusel).
 *
 * Un carrusel publicado deja una fila en social_posts por producto, todas con
 * la misma hora (posted_at): esa hora identifica el carrusel. Van en el canal
 * 'instagram' con CAROUSEL_MARK en `caption`, como las historias, porque la
 * tabla no admite otro canal sin una migración; llevan su propia cuenta y no
 * le quitan productos al plan de publicaciones (ver isHandMark en
 * lib/social/networks).
 *
 * Archivo aparte y liviano a propósito: lo lee también /hoy, que es adonde
 * lleva el link del perfil que nombra el texto del carrusel.
 */

export const CAROUSEL_MARK = 'carrusel';
export const CAROUSEL_CHANNEL = 'instagram';

/** Un carrusel marcado como publicado: sus filas, en el orden en que se anotaron. */
export interface CarouselBatch {
  postedAt: string;
  posts: { postId: number; productId: string; postedPrice: number | null }[];
}

interface MarkRow {
  id: number;
  product_id: string | null;
  posted_price: number | null;
  posted_at: string;
}

/**
 * Los carruseles marcados desde `since`, del más nuevo al más antiguo. Una
 * marca deshecha (status 'error') no cuenta. Sin la tabla, ninguno.
 */
export async function readCarouselMarks(admin: SupabaseClient, since: Date): Promise<CarouselBatch[]> {
  const { data, error } = await admin
    .from('social_posts')
    .select('id, product_id, posted_price, posted_at')
    .eq('channel', CAROUSEL_CHANNEL)
    .eq('caption', CAROUSEL_MARK)
    .eq('status', 'publicado')
    .gte('posted_at', since.toISOString())
    .order('posted_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(400);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error(`No se pudo leer los carruseles publicados: ${error.message}`);
  }

  const batches: CarouselBatch[] = [];
  const byTime = new Map<string, CarouselBatch>();
  for (const row of (data ?? []) as MarkRow[]) {
    if (!row.product_id) continue;
    // La misma hora es el mismo carrusel: se anotan todas sus filas de una vez.
    const at = new Date(row.posted_at).getTime();
    const key = Number.isFinite(at) ? String(at) : row.posted_at;
    let batch = byTime.get(key);
    if (!batch) {
      batch = { postedAt: row.posted_at, posts: [] };
      byTime.set(key, batch);
      batches.push(batch);
    }
    batch.posts.push({ postId: row.id, productId: row.product_id, postedPrice: row.posted_price });
  }
  return batches;
}

/** Por producto, cuándo salió en un carrusel por última vez (milisegundos). Puro. */
export function lastShownAt(batches: CarouselBatch[]): Map<string, number> {
  const shown = new Map<string, number>();
  for (const batch of batches) {
    const at = new Date(batch.postedAt).getTime();
    if (!Number.isFinite(at)) continue;
    for (const post of batch.posts) {
      const known = shown.get(post.productId);
      if (known === undefined || at > known) shown.set(post.productId, at);
    }
  }
  return shown;
}
