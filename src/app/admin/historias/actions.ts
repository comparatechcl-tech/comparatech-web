'use server';

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { STORY_MARK } from '@/lib/social/networks';
import { isOnSale, selectSocialProducts } from '@/lib/social/telegram';

/**
 * Lo que se anota cuando una historia se sube a mano desde /admin/historias.
 *
 * Ninguna de las dos acciones regenera páginas, a propósito: una historia no
 * cambia nada del sitio público, y regenerar haría que la lista se arme de
 * nuevo después de cada toque (las tarjetas se corren bajo el dedo y todas
 * las imágenes se bajan otra vez).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MarkResult = { ok: true; postId: number } | { ok: false; error: string };
type UndoResult = { ok: true } | { ok: false; error: string };

/**
 * Anota que la historia de un producto ya se subió, con el precio de ahora:
 * así no vuelve a ofrecerse en 14 días, salvo que baje de precio.
 */
export async function markStoryPublished(productId: string): Promise<MarkResult> {
  const actor = await requireAdmin();
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return { ok: false, error: 'Producto no válido' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).eq('id', productId));
  if (read.error) return { ok: false, error: read.error };
  const product = read.rows[0];
  if (!isOnSale(product)) return { ok: false, error: 'Ese producto ya no está a la venta en el sitio.' };

  const { data, error } = await admin
    .from('social_posts')
    .insert({
      product_id: product.id,
      channel: 'instagram',
      posted_price: Math.round(product.price),
      caption: STORY_MARK,
      status: 'publicado',
    })
    .select('id')
    .single();
  if (error) {
    return {
      ok: false,
      error: isMissingSchemaError(error) ? 'Falta la tabla de publicaciones (migración 0017).' : error.message,
    };
  }

  await logAdminEvent(admin, {
    actor,
    action: 'marcar_rrss',
    target: product.id,
    after: { historia: 'publicada', precio: Math.round(product.price) },
  });
  return { ok: true, postId: (data as { id: number }).id };
}

/** Deshace una marca hecha por error: la oferta vuelve a estar disponible. */
export async function undoStoryPublished(postId: number): Promise<UndoResult> {
  const actor = await requireAdmin();
  if (typeof postId !== 'number' || !Number.isSafeInteger(postId) || postId <= 0) {
    return { ok: false, error: 'Marca no válida' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  // Solo marcas de historia todavía vigentes: nunca una publicación del feed ni de Telegram.
  const { data, error } = await admin
    .from('social_posts')
    .update({ status: 'error', error: 'Marcada por error', updated_at: new Date().toISOString() })
    .eq('id', postId)
    .eq('channel', 'instagram')
    .eq('caption', STORY_MARK)
    .eq('status', 'publicado')
    .select('product_id');
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as { product_id: string | null }[];
  if (rows.length === 0) return { ok: false, error: 'Esa marca ya no existe.' };

  await logAdminEvent(admin, {
    actor,
    action: 'marcar_rrss',
    target: rows[0].product_id ?? undefined,
    after: { historia: 'deshecha' },
  });
  return { ok: true };
}
