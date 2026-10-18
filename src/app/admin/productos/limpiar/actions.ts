'use server';

/**
 * Sacar productos del sitio de a varios (/admin/productos/limpiar) y
 * reponerlos ("Deshacer"). Es el mismo borrado lógico de Productos: se
 * ocultan y quedan marcados como eliminados, dejan de revisarse cada 30
 * minutos y se pueden reponer desde Productos → Eliminados.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';

/** Tope por tanda: una página de la vista con margen, y una URL de .in() que cabe. */
const MAX_PER_BATCH = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CleanupResult = { ok: true; ids: string[] } | { ok: false; error: string };

function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))];
}

/** El sitio entero lee el catálogo: se renueva todo, como cuando cambia un precio. */
function refreshSite() {
  revalidateTag('catalog');
  revalidatePath('/', 'layout');
}

/** Saca del sitio los productos elegidos. Devuelve los que de verdad cambiaron (para "Deshacer"). */
export async function removeProducts(productIds: string[]): Promise<CleanupResult> {
  const actor = await requireAdmin();
  const ids = cleanIds(productIds);
  if (ids.length === 0) return { ok: true, ids: [] };
  if (ids.length > MAX_PER_BATCH) return { ok: false, error: `Máximo ${MAX_PER_BATCH} productos por tanda` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const remove = (patch: Record<string, unknown>) =>
    admin.from('products').update(patch).in('id', ids).eq('is_hidden', false).select('id, name');
  let { data, error } = await remove({ is_hidden: true, deleted_at: new Date().toISOString() });
  // Sin la migración 0017 queda solo oculto, que para el sitio es lo mismo.
  if (error && isMissingSchemaError(error)) ({ data, error } = await remove({ is_hidden: true }));
  if (error) return { ok: false, error: error.message };

  const changed = (data ?? []) as { id: string; name: string }[];
  if (changed.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'limpiar_catalogo',
      target: `${changed.length} productos`,
      after: { count: changed.length, ids: changed.map((p) => p.id), names: changed.slice(0, 20).map((p) => p.name) },
    });
    refreshSite();
  }
  return { ok: true, ids: changed.map((p) => p.id) };
}

/** Vuelve a publicar productos sacados ("Deshacer"). Solo toca los marcados como eliminados. */
export async function restoreProducts(productIds: string[]): Promise<CleanupResult> {
  const actor = await requireAdmin();
  const ids = cleanIds(productIds);
  if (ids.length === 0) return { ok: true, ids: [] };
  if (ids.length > MAX_PER_BATCH) return { ok: false, error: `Máximo ${MAX_PER_BATCH} productos por tanda` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  let { data, error } = await admin
    .from('products')
    .update({ is_hidden: false, deleted_at: null })
    .in('id', ids)
    .not('deleted_at', 'is', null)
    .select('id');
  if (error && isMissingSchemaError(error)) {
    ({ data, error } = await admin.from('products').update({ is_hidden: false }).in('id', ids).select('id'));
  }
  if (error) return { ok: false, error: error.message };

  const changed = ((data ?? []) as { id: string }[]).map((p) => p.id);
  if (changed.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'reponer_productos',
      target: `${changed.length} productos`,
      after: { count: changed.length, ids: changed },
    });
    refreshSite();
  }
  return { ok: true, ids: changed };
}
