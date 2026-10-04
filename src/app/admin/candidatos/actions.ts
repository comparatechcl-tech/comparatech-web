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
import { MAX_BATCH, matchLinksToTargets } from '@/lib/link-batch';
import type { BatchItemResult, BatchResult } from '@/lib/batch-result';


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

  const promoted = await promote(admin, candidate, url, itemId, linkVerified);
  if (!promoted.ok) return promoted;

  if (promoted.productId && token) await priceNewProducts(admin, [promoted.productId], token);

  revalidatePath('/', 'layout');
  return { ok: true };
}

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/** Pasa el candidato a `products` con su link. Devuelve el id del producto nuevo. */
async function promote(
  admin: SupabaseAdmin,
  candidate: { id: string; name: string; ml_product_id: string },
  url: string,
  itemId: string | null,
  linkVerified: boolean
): Promise<{ ok: true; productId: string | null } | { ok: false; error: string }> {
  const baseSlug = slugify(candidate.name);

  // Dos candidatos distintos pueden tener el mismo nombre de producto: el
  // slug tiene que ser único igual, o la aprobación se cae por la
  // restricción unique de products.slug.
  const { data: existing } = await admin.from('products').select('id').eq('slug', baseSlug).maybeSingle();
  const slug = existing ? `${baseSlug}-${candidate.id.slice(0, 5)}` : baseSlug;

  const { data: newProductId, error } = await admin.rpc('promote_candidate_to_product', {
    candidate_id: candidate.id,
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
  }
  return { ok: true, productId: (newProductId as string | null) ?? null };
}

/**
 * Precio del ganador de la caja de compra desde el primer minuto, en vez del
 * que tenía el candidato cuando entró a la cola.
 */
async function priceNewProducts(admin: SupabaseAdmin, productIds: string[], token: string) {
  const { data: fresh } = await admin.from('products').select(PRICED_COLUMNS).in('id', productIds);
  if (!fresh?.length) return new Map<string, string>();
  const outcomes = await priceProducts(fresh as unknown as PricedProduct[], token);
  await applyPricing(admin, outcomes);
  return new Map(outcomes.map((o) => [o.id, o.result as string]));
}

/**
 * Aprueba varios candidatos de una vez.
 *
 * Con los links directos encendidos no hace falta pegar nada. Si no, se pega
 * lo que devolvió el generador de links de Mercado Libre para las URLs que
 * entregó el admin, y cada link se asigna a su candidato (ver lib/link-batch).
 * `candidateIds` va en el mismo orden en que se entregaron las URLs.
 */
export async function approveBatch(candidateIds: string[], pasted: string): Promise<BatchResult> {
  if (candidateIds.length === 0) return { ok: false, error: 'No hay candidatos seleccionados' };
  if (candidateIds.length > MAX_BATCH) return { ok: false, error: `Máximo ${MAX_BATCH} candidatos por tanda` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data, error } = await admin
    .from('product_candidates')
    .select('id, name, ml_product_id, status')
    .in('id', candidateIds);
  if (error) return { ok: false, error: error.message };

  type Row = { id: string; name: string; ml_product_id: string; status: string };
  const rows = new Map(((data ?? []) as Row[]).map((c) => [c.id, c]));
  const candidates = candidateIds
    .map((id) => rows.get(id))
    .filter((c): c is Row => Boolean(c) && c!.status === 'pending_review');

  // Qué link le toca a cada candidato.
  const links = new Map<string, { url: string; itemId: string | null; verified: boolean }>();
  let match: Awaited<ReturnType<typeof matchLinksToTargets>> | null = null;

  if (pasted.trim()) {
    match = await matchLinksToTargets(
      pasted,
      candidates.map((c) => ({ id: c.id, mlProductId: c.ml_product_id }))
    );
    if (match.linksFound === 0) {
      return { ok: false, error: 'No encontré links de Mercado Libre (meli.la) en lo que pegaste.' };
    }
    for (const a of match.assigned) {
      links.set(a.targetId, { url: a.url, itemId: a.info?.itemId ?? null, verified: a.verified });
    }
    const withParams = match.assigned.find((a) => a.info?.mattWord && a.info?.mattTool);
    if (withParams) await rememberAffiliateParams(admin, withParams.info!.mattWord, withParams.info!.mattTool);
  } else {
    const settings = await readAffiliateSettings(admin);
    if (!settings.directLinks) return { ok: false, error: 'Pega los links que generó Mercado Libre' };
    for (const c of candidates) {
      const direct = directAffiliateUrl(c.ml_product_id, settings);
      // Se arma desde la ficha misma: no puede apuntar a otra.
      if (direct) links.set(c.id, { url: direct, itemId: null, verified: true });
    }
  }

  // Uno por uno a propósito: en paralelo, dos candidatos con el mismo nombre
  // podrían tomar el mismo slug antes de que cualquiera de los dos se guarde.
  const productByCandidate = new Map<string, string>();
  const failed = new Map<string, string>();
  for (const c of candidates) {
    const link = links.get(c.id);
    if (!link) continue;
    const promoted = await promote(admin, c, link.url, link.itemId, link.verified);
    if (!promoted.ok) failed.set(c.id, promoted.error);
    else if (promoted.productId) productByCandidate.set(c.id, promoted.productId);
  }

  const token = productByCandidate.size > 0 ? await getMlToken() : null;
  const outcomes = token ? await priceNewProducts(admin, [...productByCandidate.values()], token) : new Map();
  if (productByCandidate.size > 0) revalidatePath('/', 'layout');

  const items: BatchItemResult[] = candidates.map((c) => {
    const productId = productByCandidate.get(c.id);
    const outcome: BatchItemResult['outcome'] = failed.has(c.id)
      ? 'error'
      : productId
        ? ((outcomes.get(productId) as BatchItemResult['outcome'] | undefined) ?? 'pendiente')
        : 'sin_link';
    return { id: c.id, name: c.name, outcome, verified: links.get(c.id)?.verified ?? false, detail: failed.get(c.id) };
  });

  return {
    ok: true,
    items,
    wrongLinks: match?.wrong ?? [],
    unmatchedLinks: match?.unmatched ?? [],
    linksFound: match?.linksFound ?? 0,
  };
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
