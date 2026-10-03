'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getMlToken } from '@/lib/ml-enrichment';
import { inspectAffiliateLink } from '@/lib/affiliate-link';
import { linkVerdict } from '@/lib/link-check';
import { PRICED_COLUMNS, applyPricing, priceProducts, type PricedProduct } from '@/lib/pricing';
import { readAffiliateSettings, rememberAffiliateParams } from '@/lib/settings';
import { directAffiliateUrl } from '@/lib/outbound';
import { stripDiacritics } from '@/lib/text';


function slugify(text: string): string {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Publica un candidato.
 *
 * El link se valida ANTES de publicar: si lleva a otra ficha, no se aprueba.
 * Así se evitan casos como el de un Blik Gris cuyo link abría el Negro, que
 * antes solo se descubrían cuando alguien reclamaba.
 *
 * Si los links directos están activados en /admin/configuracion, el link
 * puede quedar vacío: se arma solo a partir de la ficha.
 */
export async function approveCandidate(
  candidateId: string,
  affiliateUrl: string
): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data: candidate, error: readError } = await admin
    .from('product_candidates')
    .select('id, name, ml_product_id, status')
    .eq('id', candidateId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!candidate) return { ok: false, error: 'Ese candidato ya no existe' };
  if (candidate.status !== 'pending_review') return { ok: false, error: 'Este candidato ya fue revisado' };

  let url = affiliateUrl.trim();
  let itemId: string | null = null;
  let linkVerified = false;
  const token = await getMlToken();

  if (!url) {
    const settings = await readAffiliateSettings(admin);
    const direct = settings.directLinks ? directAffiliateUrl(candidate.ml_product_id, settings) : null;
    if (!direct) return { ok: false, error: 'Falta el link de afiliado' };
    url = direct;
    linkVerified = true; // se arma desde la ficha misma: no puede apuntar a otra
  } else {
    const inspected = await inspectAffiliateLink(url);
    if (inspected.ok) {
      const verdict = await linkVerdict(inspected.info, candidate.ml_product_id, token);
      if (verdict === 'otra_ficha') {
        return {
          ok: false,
          error: `Este link lleva a otra ficha (${inspected.info.featuredProductId}). Genéralo desde la ficha de este producto.`,
        };
      }
      itemId = inspected.info.itemId;
      linkVerified = verdict === 'coincide';
      await rememberAffiliateParams(admin, inspected.info.mattWord, inspected.info.mattTool);
    }
    // Si el link no se pudo abrir (ML lento o caído) o no se pudo saber a
    // qué ficha lleva, se aprueba igual: es mejor que bloquear la revisión
    // por un tropiezo de red. El cron lo verifica si el producto sale del
    // sitio y vuelve.
  }

  const baseSlug = slugify(candidate.name);

  // Dos candidatos distintos pueden tener el mismo nombre de producto: el
  // slug tiene que ser único igual, o la aprobación se cae por la
  // restricción unique de products.slug.
  const { data: existing } = await admin.from('products').select('id').eq('slug', baseSlug).maybeSingle();
  const slug = existing ? `${baseSlug}-${candidateId.slice(0, 5)}` : baseSlug;

  const { data: newProductId, error } = await admin.rpc('promote_candidate_to_product', {
    candidate_id: candidateId,
    p_slug: slug,
    p_affiliate_url: url,
  });
  if (error) return { ok: false, error: error.message };

  if (newProductId) {
    await admin
      .from('products')
      .update({
        ml_item_id: itemId,
        link_target_product_id: linkVerified ? candidate.ml_product_id : null,
        link_checked_at: linkVerified ? new Date().toISOString() : null,
      })
      .eq('id', newProductId);

    // Precio del ganador de la caja de compra desde el primer minuto, en vez
    // del que tenía el candidato cuando entró a la cola.
    if (token) {
      const { data: fresh } = await admin.from('products').select(PRICED_COLUMNS).eq('id', newProductId);
      if (fresh?.length) {
        const outcomes = await priceProducts(fresh as unknown as PricedProduct[], token);
        await applyPricing(admin, outcomes);
      }
    }
  }

  revalidatePath('/', 'layout');
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
