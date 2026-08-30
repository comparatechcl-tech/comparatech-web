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

/**
 * Borra un producto para siempre. Para sacarlo del sitio alcanza con
 * ocultarlo; esto es para lo que se cargó por error y no debería quedar ni
 * en el historial.
 *
 * Se pierde el affiliate_url, que es lo caro de este flujo: hay que generarlo
 * a mano en la Central de Afiliados. Si el producto se vuelve a aprobar más
 * adelante, hay que generarlo de nuevo.
 *
 * Antes de borrar se marca su candidato como rechazado. Sin eso, el producto
 * desaparece de `products` y la prospección del día siguiente lo vuelve a
 * ofrecer como candidato nuevo: se estaría borrando algo que reaparece solo.
 */
export async function deleteProduct(productId: string): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data: product, error: readError } = await admin
    .from('products')
    .select('id, ml_product_id')
    .eq('id', productId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!product) return { ok: false, error: 'Ese producto ya no existe' };

  if (product.ml_product_id) {
    await admin
      .from('product_candidates')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
      .eq('ml_product_id', product.ml_product_id);
  }

  const { error } = await admin.from('products').delete().eq('id', productId);
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
