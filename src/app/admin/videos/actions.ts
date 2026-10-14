'use server';

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { isOnSale, selectSocialProducts } from '@/lib/social/telegram';
import { VIDEO_MARK, VIDEO_NETWORKS, VIDEO_RULES, type VideoNetwork } from '@/lib/social/videos';

/**
 * Lo que se anota cuando un video se sube a mano desde /admin/videos: una
 * marca por red, porque el mismo archivo se sube a cada una por separado.
 *
 * Ninguna de las dos acciones regenera páginas, a propósito: regenerar haría
 * que la lista se arme de nuevo después de cada toque (las tarjetas se corren
 * bajo el dedo y el video ya bajado para compartir se pierde). La única página
 * pública que mira estas marcas es /hoy, adonde lleva el link del perfil, y
 * se regenera sola cada minuto: el producto aparece ahí sin pedirlo desde acá.
 *
 * Tampoco tocan el producto (rrss_status y compañía): eso es del plan de
 * publicaciones del feed, que lleva su propia cuenta.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** posted_price es un entero de 32 bits en la base. */
const MAX_PRICE = 2_147_483_647;

type MarkResult = { ok: true; postId: number } | { ok: false; error: string };
/** `gone`: no había una marca vigente con ese id (ya estaba deshecha), que no es lo mismo que una falla. */
type UndoResult = { ok: true } | { ok: false; error: string; gone?: true };

/**
 * Anota que el video de un producto ya se subió a una red: así no vuelve a
 * sugerirse para esa red en 14 días.
 *
 * `shownPrice` es el precio que lleva el video (va escrito en la imagen). Es
 * el que se anota, y no el de la base en este instante: la lista de la página
 * no se actualiza sola y el precio pudo cambiar entre que se cargó y este
 * toque. Sin un precio válido no se anota nada: una marca con otro precio
 * diría que se subió un video que no existe.
 */
export async function markVideoPosted(productId: string, network: VideoNetwork, shownPrice: number): Promise<MarkResult> {
  const actor = await requireAdmin();
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return { ok: false, error: 'Producto no válido' };
  // Llega desde el navegador: el tipo no garantiza que sea una de las cuatro.
  if (typeof network !== 'string' || !(VIDEO_NETWORKS as readonly string[]).includes(network)) {
    return { ok: false, error: 'Red no válida' };
  }
  const price = typeof shownPrice === 'number' && Number.isFinite(shownPrice) ? Math.round(shownPrice) : 0;
  if (price <= 0 || price > MAX_PRICE) return { ok: false, error: 'Precio no válido' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).eq('id', productId));
  if (read.error) return { ok: false, error: read.error };
  const product = read.rows[0];
  if (!isOnSale(product)) return { ok: false, error: 'Ese producto ya no está a la venta en el sitio.' };

  // Un segundo toque sobre la misma red (la respuesta del primero se perdió,
  // o hay otra pestaña abierta) no la anota dos veces: con dos filas, al
  // desmarcar se anularía una sola y el video seguiría figurando como subido.
  const since = new Date(Date.now() - VIDEO_RULES.repeatAfterDays * 86_400_000).toISOString();
  const previous = await admin
    .from('social_posts')
    .select('id')
    .eq('product_id', product.id)
    .eq('channel', network)
    .eq('caption', VIDEO_MARK)
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
      channel: network,
      posted_price: price,
      caption: VIDEO_MARK,
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
    after: { video: 'subido', red: network, precio: price },
  });
  return { ok: true, postId: (data as { id: number }).id };
}

/**
 * Deshace una marca hecha por error: el video vuelve a figurar como pendiente
 * en esa red. Las filas no se borran: quedan anuladas, igual que las historias.
 *
 * Anula todas las marcas vigentes de ese producto en esa red, no solo la del
 * id. Puede haber más de una (dos pestañas o dos teléfonos que marcaron en el
 * mismo instante, o una pestaña vieja que marcó con otro precio), y la página
 * muestra una sola: si quedara otra en pie, al recargar la red volvería a
 * figurar como subida y el producto seguiría sin sugerirse. Vigente es lo que
 * todavía cuenta (los últimos 14 días): una marca más antigua ya no cambia
 * nada y queda como registro de lo que se subió entonces.
 */
export async function undoVideoPosted(postId: number): Promise<UndoResult> {
  const actor = await requireAdmin();
  if (typeof postId !== 'number' || !Number.isSafeInteger(postId) || postId <= 0) {
    return { ok: false, error: 'Marca no válida' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  // Solo marcas de video todavía vigentes: nunca una publicación del feed, una historia ni un mensaje de Telegram.
  const found = await admin
    .from('social_posts')
    .select('product_id, channel, posted_at')
    .eq('id', postId)
    .in('channel', [...VIDEO_NETWORKS])
    .eq('caption', VIDEO_MARK)
    .eq('status', 'publicado')
    .limit(1);
  if (found.error) return { ok: false, error: found.error.message };
  const target = ((found.data ?? []) as { product_id: string | null; channel: string; posted_at: string | null }[])[0];
  // Pasa cuando la respuesta de un primer intento se perdió en el camino o se
  // desmarcó desde otra pestaña: la página lo distingue para no dejar el botón
  // marcado para siempre.
  const gone: UndoResult = { ok: false, error: 'Esa marca ya no existe.', gone: true };
  if (!target) return gone;

  // Una sola escritura para todas: o se anulan juntas o no se anula ninguna.
  let undo = admin
    .from('social_posts')
    .update({ status: 'error', error: 'Marcada por error', updated_at: new Date().toISOString() })
    .in('channel', [...VIDEO_NETWORKS])
    .eq('caption', VIDEO_MARK)
    .eq('status', 'publicado');
  const own = target.posted_at ? new Date(target.posted_at).getTime() : NaN;
  if (target.product_id && Number.isFinite(own)) {
    // Desde el inicio del plazo, o desde la fecha de esta marca si es anterior: la del id se anula siempre.
    const windowStart = Date.now() - VIDEO_RULES.repeatAfterDays * 86_400_000;
    const since = new Date(Math.min(own, windowStart)).toISOString();
    undo = undo.eq('product_id', target.product_id).eq('channel', target.channel).gte('posted_at', since);
  } else {
    // Sin producto o sin fecha no hay cómo encontrar a las demás: se anula esa sola.
    undo = undo.eq('id', postId);
  }
  const { data, error } = await undo.select('id');
  if (error) return { ok: false, error: error.message };
  const undone = ((data ?? []) as { id: number }[]).length;
  // Alguien la deshizo entre la lectura y la escritura.
  if (undone === 0) return gone;

  await logAdminEvent(admin, {
    actor,
    action: 'marcar_rrss',
    target: target.product_id ?? undefined,
    // Si eran varias queda dicho: explica por qué cambió más de una fila con un solo toque.
    after: undone > 1 ? { video: 'deshecho', red: target.channel, marcas: undone } : { video: 'deshecho', red: target.channel },
  });
  return { ok: true };
}
