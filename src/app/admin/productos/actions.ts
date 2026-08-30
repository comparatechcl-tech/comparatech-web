'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { RrssStatus } from '@/lib/types';
import { verifyAffiliateLink } from '@/lib/actions/verifyAffiliateLink';
import { resolveAffiliateItemId } from '@/lib/affiliate-link';

export { verifyAffiliateLink };

type ActionResult = { ok: true } | { ok: false; error: string };

export async function setRrssStatus(productId: string, status: RrssStatus): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { error } = await admin.from('products').update({ rrss_status: status }).eq('id', productId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/productos');
  return { ok: true };
}

/**
 * Baja (o repone) un producto del sitio público.
 *
 * Usa una columna propia y no is_active a propósito: is_active lo maneja el
 * cron según lo que diga Mercado Libre, así que un producto bajado a mano
 * volvería a publicarse solo al día siguiente. Además, el prospector trata
 * lo oculto como "ya conocido", para no volver a ofrecerlo como candidato.
 */
export async function setProductHidden(
  productId: string,
  hidden: boolean
): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { error } = await admin.from('products').update({ is_hidden: hidden }).eq('id', productId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/productos');
  revalidatePath('/');
  return { ok: true };
}

export async function updateAffiliateUrl(productId: string, url: string): Promise<ActionResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Falta el link de afiliado' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  // Se resuelve a qué oferta apunta el link y se guarda, para que el cron
  // refresque el precio de esa oferta y no el de un vendedor elegido aparte.
  // Si no se puede resolver ahora, el link se guarda igual: es mejor eso a
  // bloquear la edición, y el precio sigue con el comportamiento anterior.
  const resolved = await resolveAffiliateItemId(trimmed);
  const patch: Record<string, unknown> = { affiliate_url: trimmed };
  if (resolved.ok) patch.ml_item_id = resolved.itemId;

  const { error } = await admin.from('products').update(patch).eq('id', productId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/productos');
  revalidatePath('/');
  return { ok: true };
}
