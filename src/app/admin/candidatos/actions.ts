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

type LinkCheckResult =
  | { ok: true; direct: boolean; finalUrl: string }
  | { ok: false; error: string };

// Mercado Libre solo entrega la redirección real del acortador meli.la si el
// request trae un User-Agent de navegador — con el UA por defecto de fetch()
// el link no redirige y parece roto. Los links de "compartir mi perfil" de
// afiliados terminan en mercadolibre.cl/social/<usuario> (una vitrina cuya
// oferta destacada cambia sola con el tiempo), en vez de en la ficha fija
// del producto/vendedor que se aprobó — eso es lo que se detecta acá.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export async function verifyAffiliateLink(url: string): Promise<LinkCheckResult> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: 'Falta el link' };

  try {
    const res = await fetch(trimmed, {
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    const finalUrl = res.url || trimmed;
    const direct = !finalUrl.includes('/social/');
    return { ok: true, direct, finalUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo verificar el link' };
  }
}

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

export async function rejectCandidates(candidateIds: string[]): Promise<ActionResult> {
  if (candidateIds.length === 0) return { ok: true };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { error } = await admin
    .from('product_candidates')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .in('id', candidateIds);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/candidatos');
  return { ok: true };
}
