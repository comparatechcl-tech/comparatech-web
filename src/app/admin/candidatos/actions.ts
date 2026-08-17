'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';

const DIACRITICS_RE = new RegExp('[\u0300-\u036f]', 'g');

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function approveCandidate(candidateId: string, name: string, affiliateUrl: string) {
  if (!affiliateUrl.trim()) throw new Error('Falta el link de afiliado');

  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin no configurado');

  const { error } = await admin.rpc('promote_candidate_to_product', {
    candidate_id: candidateId,
    p_slug: slugify(name),
    p_affiliate_url: affiliateUrl.trim(),
  });
  if (error) throw new Error(error.message);

  revalidatePath('/admin/candidatos');
  revalidatePath('/');
}

export async function rejectCandidate(candidateId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase admin no configurado');

  const { error } = await admin
    .from('product_candidates')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', candidateId);
  if (error) throw new Error(error.message);

  revalidatePath('/admin/candidatos');
}
