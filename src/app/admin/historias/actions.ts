'use server';

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { STORY_MARK } from '@/lib/social/networks';
import { STORY_RULES } from '@/lib/social/stories';
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
 * Anota que la historia de un producto ya se subió: así no vuelve a
 * ofrecerse en 14 días, salvo que baje de precio.
 *
 * `shownPrice` es el precio que llevaba la imagen compartida. Es el que se
 * anota, y no el de la base en este instante: la lista de la página no se
 * actualiza sola y el precio pudo cambiar entre que se cargó y este toque.
 * Opcional, para que una pestaña abierta con la versión anterior siga
 * funcionando.
 */
export async function markStoryPublished(productId: string, shownPrice?: number): Promise<MarkResult> {
  const actor = await requireAdmin();
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return { ok: false, error: 'Producto no válido' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).eq('id', productId));
  if (read.error) return { ok: false, error: read.error };
  const product = read.rows[0];
  if (!isOnSale(product)) return { ok: false, error: 'Ese producto ya no está a la venta en el sitio.' };

  const price = Math.round(
    typeof shownPrice === 'number' && Number.isFinite(shownPrice) && shownPrice > 0 && shownPrice <= 2_147_483_647
      ? shownPrice
      : product.price
  );

  // Un segundo toque sobre la misma historia (la respuesta del primero se
  // perdió, o hay otra pestaña abierta) no la anota dos veces: con dos filas,
  // "Deshacer" anularía una sola y la oferta seguiría escondida.
  const since = new Date(Date.now() - STORY_RULES.repeatAfterDays * 86_400_000).toISOString();
  const previous = await admin
    .from('social_posts')
    .select('id')
    .eq('product_id', product.id)
    .eq('channel', 'instagram')
    .eq('caption', STORY_MARK)
    .eq('status', 'publicado')
    .eq('posted_price', price)
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(1);
  const already = ((previous.data ?? []) as { id: number }[])[0];
  // Si esta lectura falla se anota igual: es peor perder la marca que repetirla.
  if (!previous.error && already) return { ok: true, postId: already.id };

  const { data, error } = await admin
    .from('social_posts')
    .insert({
      product_id: product.id,
      channel: 'instagram',
      posted_price: price,
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
    after: { historia: 'publicada', precio: price },
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
