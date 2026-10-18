'use server';

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { formatPrice } from '@/lib/content/captions';
import { socialProductName } from '@/lib/content/social-name';
import { CAROUSEL_CHANNEL, CAROUSEL_MARK } from '@/lib/social/carousel-marks';
import { CAROUSEL_MAX_ITEMS } from '@/lib/social/carousel-url';
import { isOnSale, selectSocialProducts } from '@/lib/social/telegram';

/**
 * Lo que se anota cuando el carrusel de la semana se sube a mano desde
 * /admin/historias/carrusel: una fila por producto en social_posts, todas con
 * la misma hora (lib/social/carousel-marks). Con eso la página sabe que el de
 * esta semana ya salió, y /hoy (el link del perfil que nombra el texto)
 * muestra sus productos.
 *
 * Como las historias, ninguna de las dos acciones regenera páginas: /hoy se
 * regenera sola cada minuto.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** posted_price es un entero de 32 bits en la base. */
const MAX_PRICE = 2_147_483_647;
/** Un segundo toque sobre el mismo carrusel en estos días devuelve la marca que ya existe. */
const REPEAT_WINDOW_MS = 7 * 86_400_000;

export type CarouselMarkResult =
  | { ok: true; postIds: number[]; postedAt: string; warning?: string }
  | { ok: false; error: string };
export type CarouselUndoResult = { ok: true } | { ok: false; error: string };

interface PostRow {
  id: number;
  product_id: string | null;
  posted_price: number | null;
  posted_at: string;
}

/** Lo que llega del teléfono, revisado: productos distintos con su precio, en orden. null si algo no sirve. */
function parseItems(raw: unknown): { productId: string; price: number }[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > CAROUSEL_MAX_ITEMS) return null;
  const seen = new Set<string>();
  const items: { productId: string; price: number }[] = [];
  for (const entry of raw) {
    const productId = entry && typeof entry === 'object' ? (entry as { productId?: unknown }).productId : undefined;
    const price = entry && typeof entry === 'object' ? (entry as { price?: unknown }).price : undefined;
    if (typeof productId !== 'string' || !UUID_RE.test(productId)) return null;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return null;
    const id = productId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    items.push({ productId: id, price: Math.round(price) });
  }
  return items;
}

/**
 * Anota que el carrusel se publicó, con el precio que llevaba cada lámina
 * (no el de la base en este instante: la página no se actualiza sola). Se
 * anota aunque algo haya cambiado desde que se cargó (puede que ya esté
 * arriba), y la respuesta lo avisa.
 */
export async function markCarouselPublished(items: { productId: string; price: number }[]): Promise<CarouselMarkResult> {
  const actor = await requireAdmin();
  const parsed = parseItems(items);
  if (!parsed) return { ok: false, error: 'El carrusel no es válido. Toca Actualizar.' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const ids = parsed.map((item) => item.productId);
  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', ids));
  if (read.error) return { ok: false, error: read.error };
  const byId = new Map(read.rows.map((p) => [p.id, p]));
  if (ids.some((id) => !byId.has(id))) return { ok: false, error: 'Un producto del carrusel ya no está en el sitio. Toca Actualizar.' };

  // Un segundo toque (la respuesta del primero se perdió, u otra pestaña) no lo anota dos veces:
  // con dos marcas, "Deshacer" anularía una sola y el carrusel seguiría como publicado.
  const since = new Date(Date.now() - REPEAT_WINDOW_MS).toISOString();
  const previous = await admin
    .from('social_posts')
    .select('id, product_id, posted_price, posted_at')
    .eq('channel', CAROUSEL_CHANNEL)
    .eq('caption', CAROUSEL_MARK)
    .eq('status', 'publicado')
    .in('product_id', ids)
    .gte('posted_at', since)
    .order('posted_at', { ascending: false });
  if (!previous.error) {
    const batches = new Map<string, PostRow[]>();
    for (const row of (previous.data ?? []) as PostRow[]) {
      const key = String(new Date(row.posted_at).getTime());
      batches.set(key, [...(batches.get(key) ?? []), row]);
    }
    for (const rows of batches.values()) {
      const same =
        rows.length === parsed.length &&
        parsed.every((item) => rows.some((row) => row.product_id === item.productId && row.posted_price === item.price));
      if (same) {
        const ordered = parsed.map((item) => rows.find((row) => row.product_id === item.productId) as PostRow);
        return { ok: true, postIds: ordered.map((row) => row.id), postedAt: ordered[0].posted_at };
      }
    }
  }

  // Todas con la misma hora: esa hora es el carrusel (lib/social/carousel-marks).
  const postedAt = new Date().toISOString();
  const { data, error } = await admin
    .from('social_posts')
    .insert(
      parsed.map((item) => ({
        product_id: item.productId,
        channel: CAROUSEL_CHANNEL,
        posted_price: item.price,
        caption: CAROUSEL_MARK,
        status: 'publicado',
        posted_at: postedAt,
      }))
    )
    .select('id, product_id');
  if (error) {
    return { ok: false, error: isMissingSchemaError(error) ? 'Falta la tabla de publicaciones (migración 0017).' : error.message };
  }
  const inserted = (data ?? []) as { id: number; product_id: string | null }[];
  const postIds = parsed
    .map((item) => inserted.find((row) => row.product_id === item.productId)?.id)
    .filter((id): id is number => typeof id === 'number');

  await logAdminEvent(admin, {
    actor,
    action: 'marcar_rrss',
    target: ids.join(','),
    after: { carrusel: 'publicado', precios: parsed.map((item) => item.price) },
  });

  // Lo que cambió desde que se cargó la página: la marca queda igual, pero conviene mirar la publicación.
  const notes: string[] = [];
  parsed.forEach((item, i) => {
    const product = byId.get(item.productId);
    const name = product ? socialProductName(product, { max: 40 }) : 'un producto';
    if (!isOnSale(product)) notes.push(`el #${i + 1} (${name}) ya no está a la venta`);
    else if (Math.round(product.price) !== item.price) notes.push(`el #${i + 1} (${name}) cambió a ${formatPrice(product.price)}`);
  });
  const warning = notes.length > 0 ? `Quedó marcado, pero desde que cargaste la página ${notes.join(' y ')}. Si ya lo subiste, revisa la publicación.` : undefined;
  return warning ? { ok: true, postIds, postedAt, warning } : { ok: true, postIds, postedAt };
}

/** Deshace la marca de un carrusel hecha por error: la página vuelve a ofrecerlo. */
export async function undoCarouselPublished(postIds: number[]): Promise<CarouselUndoResult> {
  const actor = await requireAdmin();
  if (
    !Array.isArray(postIds) ||
    postIds.length < 1 ||
    postIds.length > CAROUSEL_MAX_ITEMS ||
    !postIds.every((id) => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
  ) {
    return { ok: false, error: 'Marca no válida' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  // Solo marcas de carrusel todavía vigentes: nunca una historia, un video ni una publicación del feed.
  const { data, error } = await admin
    .from('social_posts')
    .update({ status: 'error', error: 'Marcada por error', updated_at: new Date().toISOString() })
    .in('id', postIds)
    .eq('channel', CAROUSEL_CHANNEL)
    .eq('caption', CAROUSEL_MARK)
    .eq('status', 'publicado')
    .select('product_id');
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as { product_id: string | null }[];
  if (rows.length === 0) return { ok: false, error: 'Esa marca ya no existe.' };

  await logAdminEvent(admin, {
    actor,
    action: 'marcar_rrss',
    target: rows.map((row) => row.product_id ?? '').filter(Boolean).join(',') || undefined,
    after: { carrusel: 'deshecho' },
  });
  return { ok: true };
}
