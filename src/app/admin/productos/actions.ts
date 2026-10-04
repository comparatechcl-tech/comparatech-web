'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { CATEGORIES } from '@/lib/categories';
import { RrssStatus } from '@/lib/types';

type ActionResult = { ok: true } | { ok: false; error: string };

const RRSS_STATUSES: RrssStatus[] = ['sin_usar', 'seleccionado', 'publicado'];

/** Canales que se pueden marcar a mano (los mismos que acepta social_posts). */
export type SocialChannel = 'instagram' | 'tiktok' | 'whatsapp' | 'telegram' | 'facebook';
const SOCIAL_CHANNELS: SocialChannel[] = ['instagram', 'tiktok', 'whatsapp', 'telegram', 'facebook'];

/** Largo máximo de la nota interna: es un recordatorio, no un documento. */
const MAX_NOTE_LENGTH = 500;

/**
 * Lo que hay que regenerar cuando cambia un producto: la portada, ofertas,
 * su categoría (la vieja y la nueva si se movió) y su ficha. La etiqueta
 * 'catalog' invalida la lectura compartida del catálogo (lib/queries).
 */
function refreshProductPages(slug: string | null, categories: (string | null | undefined)[]) {
  revalidateTag('catalog');
  revalidatePath('/admin/productos');
  revalidatePath('/');
  revalidatePath('/ofertas');
  revalidatePath('/hoy');
  for (const cat of new Set(categories.filter(Boolean))) revalidatePath(`/categoria/${cat}`);
  if (slug) revalidatePath(`/producto/${slug}`);
}

async function readSlugAndCategory(
  admin: SupabaseClient,
  productId: string
): Promise<{ slug: string; category: string; name: string } | null> {
  const { data } = await admin.from('products').select('slug, category, name').eq('id', productId).maybeSingle();
  return (data as { slug: string; category: string; name: string } | null) ?? null;
}

/**
 * Estado de uso en redes. Al pasar a 'publicado' se guarda cuándo y en qué
 * canal: con eso /hoy muestra lo que se está promocionando y el bot de
 * Telegram no repite lo que ya salió.
 */
export async function setRrssStatus(
  productId: string,
  status: RrssStatus,
  channel?: SocialChannel
): Promise<ActionResult> {
  const actor = await requireAdmin();
  if (!RRSS_STATUSES.includes(status)) return { ok: false, error: 'Estado no válido' };
  if (channel && !SOCIAL_CHANNELS.includes(channel)) return { ok: false, error: 'Canal no válido' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { rrss_status: status };
  if (status === 'publicado') {
    patch.rrss_published_at = now;
    patch.rrss_channel = channel ?? null;
  }

  let { error } = await admin.from('products').update(patch).eq('id', productId);
  // Sin la migración 0017 se guarda solo el estado, como antes.
  if (error && isMissingSchemaError(error)) {
    ({ error } = await admin.from('products').update({ rrss_status: status }).eq('id', productId));
  }
  if (error) return { ok: false, error: error.message };

  if (status === 'publicado' && channel) {
    const { data: product } = await admin.from('products').select('price').eq('id', productId).maybeSingle();
    const { error: postError } = await admin.from('social_posts').insert({
      product_id: productId,
      channel,
      posted_price: (product as { price: number } | null)?.price ?? null,
      status: 'publicado',
    });
    if (postError && !isMissingSchemaError(postError)) {
      console.error('[admin/productos] no se pudo registrar la publicación:', postError.message);
    }
  }

  await logAdminEvent(admin, {
    actor,
    action: 'marcar_rrss',
    target: productId,
    after: { status, channel: channel ?? null },
  });

  revalidatePath('/admin/productos');
  revalidatePath('/hoy');
  return { ok: true };
}

/**
 * Baja (o repone) un producto del sitio público.
 *
 * Usa una columna propia y no is_active a propósito: is_active lo maneja el
 * cron según lo que diga Mercado Libre, así que un producto bajado a mano
 * volvería a publicarse solo al día siguiente. Además, el prospector trata
 * lo oculto como "ya conocido", para no volver a ofrecerlo como candidato.
 *
 * Reponer un producto eliminado también le quita la marca de eliminado.
 */
export async function setProductHidden(productId: string, hidden: boolean): Promise<ActionResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const info = await readSlugAndCategory(admin, productId);
  if (!info) return { ok: false, error: 'Ese producto ya no existe' };

  let { error } = await admin
    .from('products')
    .update(hidden ? { is_hidden: true } : { is_hidden: false, deleted_at: null })
    .eq('id', productId);
  if (error && !hidden && isMissingSchemaError(error)) {
    ({ error } = await admin.from('products').update({ is_hidden: false }).eq('id', productId));
  }
  if (error) return { ok: false, error: error.message };

  await logAdminEvent(admin, {
    actor,
    action: hidden ? 'ocultar_producto' : 'mostrar_producto',
    target: productId,
    after: { name: info.name, is_hidden: hidden },
  });

  refreshProductPages(info.slug, [info.category]);
  return { ok: true };
}

/**
 * "Eliminar" es un borrado lógico: el producto se oculta y queda marcado
 * como eliminado, pero la fila sigue ahí.
 *
 * Antes era un borrado real y se perdía el affiliate_url, que es lo caro de
 * este flujo: hay que generarlo a mano en la Central de Afiliados. Además,
 * como la fila sigue existiendo (oculta), el prospector la reconoce y no
 * vuelve a ofrecer el producto como candidato nuevo.
 */
export async function deleteProduct(productId: string): Promise<ActionResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const info = await readSlugAndCategory(admin, productId);
  if (!info) return { ok: false, error: 'Ese producto ya no existe' };

  let { error } = await admin
    .from('products')
    .update({ is_hidden: true, deleted_at: new Date().toISOString() })
    .eq('id', productId);
  // Sin la migración 0017 queda solo oculto, que para el sitio es lo mismo.
  if (error && isMissingSchemaError(error)) {
    ({ error } = await admin.from('products').update({ is_hidden: true }).eq('id', productId));
  }
  if (error) return { ok: false, error: error.message };

  await logAdminEvent(admin, {
    actor,
    action: 'eliminar_producto',
    target: productId,
    after: { name: info.name, slug: info.slug },
  });

  refreshProductPages(info.slug, [info.category]);
  return { ok: true };
}

export interface ProductEdit {
  category?: string;
  is_featured?: boolean;
  admin_note?: string | null;
}

/** Edición desde el panel "Editar": categoría, fijar en portada y nota interna. */
export async function updateProduct(productId: string, edit: ProductEdit): Promise<ActionResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const patch: Record<string, unknown> = {};
  if (edit.category !== undefined) {
    // Solo categorías del registro: una escrita a mano crearía una página de
    // categoría que nadie enlaza.
    if (!CATEGORIES.some((c) => c.slug === edit.category)) return { ok: false, error: 'Categoría no válida' };
    patch.category = edit.category;
  }
  if (edit.is_featured !== undefined) patch.is_featured = edit.is_featured === true;
  if (edit.admin_note !== undefined) {
    const note = (edit.admin_note ?? '').trim();
    if (note.length > MAX_NOTE_LENGTH) {
      return { ok: false, error: `La nota puede tener hasta ${MAX_NOTE_LENGTH} caracteres` };
    }
    patch.admin_note = note || null;
  }
  if (Object.keys(patch).length === 0) return { ok: true };

  const { data: before, error: readError } = await admin
    .from('products')
    .select('slug, category, is_featured')
    .eq('id', productId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!before) return { ok: false, error: 'Ese producto ya no existe' };

  const { error } = await admin.from('products').update(patch).eq('id', productId);
  if (error) {
    if (isMissingSchemaError(error) && 'admin_note' in patch) {
      return { ok: false, error: 'Para guardar notas falta aplicar la migración 0017 en Supabase.' };
    }
    return { ok: false, error: error.message };
  }

  const prev = before as { slug: string; category: string; is_featured: boolean };
  await logAdminEvent(admin, {
    actor,
    action: 'editar_producto',
    target: productId,
    before: { category: prev.category, is_featured: prev.is_featured },
    after: patch,
  });

  refreshProductPages(prev.slug, [prev.category, edit.category]);
  return { ok: true };
}
