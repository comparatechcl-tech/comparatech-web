'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type ActionResult = { ok: true } | { ok: false; error: string };

export async function approveCandidate(
  candidateId: string,
  name: string,
  affiliateUrl: string
): Promise<ActionResult> {
  if (!affiliateUrl.trim()) return { ok: false, error: 'Falta el link de afiliado' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const baseSlug = slugify(name);

  // Dos candidatos distintos (vendedores distintos) pueden tener el mismo
  // nombre de producto - el slug tiene que ser unico igual, o la
  // aprobacion se cae por violar la restriccion unique de products.slug.
  const { data: existing } = await admin.from('products').select('id').eq('slug', baseSlug).maybeSingle();
  const slug = existing ? `${baseSlug}-${candidateId.slice(0, 5)}` : baseSlug;

  const { error } = await admin.rpc('promote_candidate_to_product', {
    candidate_id: candidateId,
    p_slug: slug,
    p_affiliate_url: affiliateUrl.trim(),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/candidatos');
  revalidatePath('/');
  return { ok: true };
}

export async function rejectCandidate(candidateId: string): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { error } = await admin
    .from('product_candidates')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', candidateId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/candidatos');
  return { ok: true };
}
