'use server';

/**
 * Acciones de la cola de candidatos (/admin/candidatos).
 *
 * Los links de afiliado son la única fuente de ingresos: cada acción
 * verifica quién la pide (requireAdmin), no publica un link de otra cuenta
 * ni un link directo cuya atribución nadie comprobó, y deja registro en
 * admin_audit_log.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import type { PostgrestError } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { getMlToken } from '@/lib/ml-enrichment';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { directLinksUsable } from '@/lib/admin-settings';
import { checkAffiliateOwnership, inspectAffiliateLink } from '@/lib/affiliate-link';
import { linkVerdict } from '@/lib/link-check';
import { PRICED_COLUMNS, applyPricing, priceProducts, type PricedProduct, type PricingResult } from '@/lib/pricing';
import { expectedAffiliateParams, readAffiliateSettings, rememberAffiliateParams } from '@/lib/settings';
import { directAffiliateUrl, isAllowedAffiliateUrl, isMeliLaUrl } from '@/lib/outbound';
import { stripDiacritics } from '@/lib/text';
import { MAX_BATCH, extractAffiliateLinks, matchLinksToTargets } from '@/lib/link-batch';
import { isRejectReason } from '@/lib/candidate-sort';
import type { ApproveResult, BatchItemResult, BatchResult } from '@/lib/batch-result';

const DIRECT_NOT_CONFIRMED =
  'Pega el link meli.la: la atribución de los links directos aún no está comprobada.';

const VARIANT_SKIPPED = 'Se omitió otro color del mismo modelo';

/** Tope para rechazar o recuperar de una vez: una página de la cola con margen. */
const MAX_REVIEW = 200;

function slugify(text: string): string {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/**
 * Páginas públicas donde aparece un producto recién publicado. Antes se
 * revalidaba el layout entero, lo que tiraba el caché de todas las fichas
 * del sitio por cada aprobación.
 */
function refreshPublic(categories: Iterable<string>) {
  // Sin esto el catálogo compartido (unstable_cache) tarda hasta 60 s en
  // incluir el producto recién publicado.
  revalidateTag('catalog');
  revalidatePath('/');
  revalidatePath('/ofertas');
  for (const category of new Set(categories)) {
    if (category) revalidatePath(`/categoria/${category}`);
  }
}

/**
 * ¿Se puede guardar este link? Va antes de abrirlo: un 'javascript:' o un
 * dominio ajeno terminaría como href del botón de compra.
 *
 * Mientras no se compruebe que ML paga comisión por un link directo, solo se
 * acepta un meli.la: pegar a mano una URL directa con matt_word sería la
 * misma apuesta que encender los links directos sin la prueba.
 */
function affiliateUrlError(url: string, directUsable: boolean): string | null {
  if (!isAllowedAffiliateUrl(url)) {
    if (/^http:\/\//i.test(url) && isAllowedAffiliateUrl(url.replace(/^http:/i, 'https:'))) {
      return 'El link tiene que empezar con https://. Cópialo de nuevo desde el Generador de links de Mercado Libre.';
    }
    return 'Ese link no es de Mercado Libre';
  }
  if (!directUsable && !isMeliLaUrl(url)) return DIRECT_NOT_CONFIRMED;
  return null;
}

/**
 * Escribe un cambio en product_candidates y, si la migración 0014 todavía no
 * se aplicó (faltan reject_reason o reviewed_by), lo repite sin esas
 * columnas: rechazar o recuperar no puede depender de que exista el motivo.
 */
async function withOptionalColumns<T>(
  patch: Record<string, unknown>,
  run: (patch: Record<string, unknown>) => PromiseLike<{ data: T | null; error: PostgrestError | null }>
): Promise<{ data: T | null; error: PostgrestError | null }> {
  const first = await run(patch);
  if (!first.error || !isMissingSchemaError(first.error)) return first;
  const { reject_reason: _reason, reviewed_by: _by, ...base } = patch;
  return run(base);
}

/** Quién aprobó. Sin la migración 0014 no hay dónde guardarlo y no pasa nada. */
async function markReviewedBy(admin: SupabaseAdmin, ids: string[], actor: string) {
  if (ids.length === 0) return;
  const { error } = await admin.from('product_candidates').update({ reviewed_by: actor }).in('id', ids);
  if (error && !isMissingSchemaError(error)) {
    console.error(`[candidatos] no se pudo guardar reviewed_by: ${error.message}`);
  }
}

/**
 * Los rechazos de la base (migración 0012) llegan en inglés técnico; acá se
 * traducen a algo que el dueño entienda y pueda resolver.
 */
function promoteErrorMessage(error: PostgrestError): string {
  // 23505 también puede venir del slug (products_slug_key); ese caso es raro
  // y su mensaje se deja tal cual.
  if (/ml_product_id/.test(error.message) || (error.code === '23505' && !/slug/i.test(error.message))) {
    return 'Este producto ya está publicado en el sitio (otro candidato con la misma ficha de Mercado Libre ya se aprobó).';
  }
  if (/affiliate_url no permitido/i.test(error.message)) {
    return 'La base rechazó el link: tiene que ser un meli.la o un link de mercadolibre.cl generado para la cuenta ComparaTech.';
  }
  return error.message;
}

/** Pasa el candidato a `products` con su link. Devuelve el id y el slug del producto nuevo. */
async function promote(
  admin: SupabaseAdmin,
  candidate: { id: string; name: string; ml_product_id: string },
  url: string,
  itemId: string | null,
  linkVerified: boolean
): Promise<{ ok: true; productId: string | null; slug: string } | { ok: false; error: string }> {
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
  if (error) return { ok: false, error: promoteErrorMessage(error) };

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
  return { ok: true, productId: (newProductId as string | null) ?? null, slug };
}

/**
 * Precio del ganador de la caja de compra desde el primer minuto, en vez del
 * que tenía el candidato cuando entró a la cola. Devuelve el resultado por
 * producto: es lo que le dice al admin si quedó publicado o en pausa.
 */
async function priceNewProducts(
  admin: SupabaseAdmin,
  productIds: string[],
  token: string
): Promise<Map<string, PricingResult>> {
  const { data: fresh } = await admin.from('products').select(PRICED_COLUMNS).in('id', productIds);
  if (!fresh?.length) return new Map();
  const outcomes = await priceProducts(fresh as unknown as PricedProduct[], token);
  await applyPricing(admin, outcomes);
  return new Map(outcomes.map((o) => [o.id, o.result]));
}

/**
 * Publica un candidato.
 *
 * El link se valida ANTES de publicar: si es de otra cuenta o lleva a otra
 * ficha, no se aprueba. Así se evitan casos como el de un Blik Gris cuyo
 * link abría el Negro, que antes solo se descubrían cuando alguien reclamaba.
 *
 * Sin link pegado, solo se arma el link directo si los links directos están
 * encendidos Y la prueba de atribución está confirmada (directLinksUsable).
 */
export async function approveCandidate(candidateId: string, affiliateUrl: string): Promise<ApproveResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data: candidate, error: readError } = await admin
    .from('product_candidates')
    .select('id, name, ml_product_id, category, status')
    .eq('id', candidateId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!candidate) return { ok: false, error: 'Ese candidato ya no existe' };
  if (candidate.status !== 'pending_review') return { ok: false, error: 'Este candidato ya fue revisado' };

  const usable = await directLinksUsable(admin);
  let url = affiliateUrl.trim();
  let itemId: string | null = null;
  let linkVerified = false;
  const token = await getMlToken();

  if (!url) {
    if (!usable) return { ok: false, error: DIRECT_NOT_CONFIRMED };
    const direct = directAffiliateUrl(candidate.ml_product_id, await readAffiliateSettings(admin));
    if (!direct) {
      return { ok: false, error: 'Falta el link de afiliado: no hay matt_word ni matt_tool configurados.' };
    }
    url = direct;
    linkVerified = true; // se arma desde la ficha misma: no puede apuntar a otra
  } else {
    const urlError = affiliateUrlError(url, usable);
    if (urlError) return { ok: false, error: urlError };

    // Queda memoizado: si recién se tocó "Verificar", no se vuelve a abrir
    // (cada apertura cuenta como un clic de afiliado).
    const inspected = await inspectAffiliateLink(url);
    if (inspected.ok) {
      const foreign = checkAffiliateOwnership(inspected.info, expectedAffiliateParams());
      if (foreign) return { ok: false, error: foreign };

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
  await markReviewedBy(admin, [candidate.id], actor);

  let result: PricingResult | undefined;
  if (promoted.productId && token) {
    result = (await priceNewProducts(admin, [promoted.productId], token)).get(promoted.productId);
  }
  refreshPublic([candidate.category as string]);

  // 'activo' o sin respuesta de ML: el producto entra visible con el precio
  // del candidato y el cron lo corrige en la próxima pasada.
  const paused = result === 'sin_ganador' || result === 'ganador_no_verde' || result === 'link_otro_producto';
  const outcome = paused ? ('en_pausa' as const) : ('publicado' as const);
  const reason = paused ? result : result === 'activo' ? undefined : 'pendiente';

  await logAdminEvent(admin, {
    actor,
    action: 'aprobar',
    target: candidate.id,
    after: {
      count: 1,
      ids: [candidate.id],
      name: candidate.name,
      slug: promoted.slug,
      affiliate_url: url,
      verified: linkVerified,
      outcome,
      reason: reason ?? null,
    },
  });

  return { ok: true, outcome, ...(reason ? { reason } : {}), slug: promoted.slug };
}

/**
 * Aprueba varios candidatos de una vez.
 *
 * Se pega lo que devolvió el generador de links de Mercado Libre para las
 * URLs que entregó el admin, y cada link se asigna a su candidato (ver
 * lib/link-batch). Sin pegar nada, solo se usan links directos si su
 * atribución está comprobada. `candidateIds` va en el mismo orden en que se
 * entregaron las URLs.
 */
export async function approveBatch(candidateIds: string[], pasted: string): Promise<BatchResult> {
  const actor = await requireAdmin();
  if (candidateIds.length === 0) return { ok: false, error: 'No hay candidatos seleccionados' };
  if (candidateIds.length > MAX_BATCH) return { ok: false, error: `Máximo ${MAX_BATCH} candidatos por tanda` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data, error } = await admin
    .from('product_candidates')
    .select('id, name, ml_product_id, ml_family_id, category, price, status')
    .in('id', candidateIds);
  if (error) return { ok: false, error: error.message };

  type Row = {
    id: string;
    name: string;
    ml_product_id: string;
    ml_family_id: string | null;
    category: string;
    price: number;
    status: string;
  };
  const rows = new Map(((data ?? []) as Row[]).map((c) => [c.id, c]));
  const candidates = candidateIds
    .map((id) => rows.get(id))
    .filter((c): c is Row => Boolean(c) && c!.status === 'pending_review');

  // Un modelo en varios colores se publica una sola vez, en el color más
  // barato: el sitio muestra una tarjeta por familia y dos productos de la
  // misma familia competirían entre sí.
  const cheapestByFamily = new Map<string, Row>();
  for (const c of candidates) {
    if (!c.ml_family_id) continue;
    const best = cheapestByFamily.get(c.ml_family_id);
    if (!best || c.price < best.price || (c.price === best.price && c.id < best.id)) {
      cheapestByFamily.set(c.ml_family_id, c);
    }
  }
  const skipped = new Set(
    candidates.filter((c) => c.ml_family_id && cheapestByFamily.get(c.ml_family_id)?.id !== c.id).map((c) => c.id)
  );

  const usable = await directLinksUsable(admin);
  const expected = expectedAffiliateParams();

  // Qué link le toca a cada candidato.
  const links = new Map<string, { url: string; itemId: string | null; verified: boolean }>();
  const failed = new Map<string, string>();
  const foreign = new Map<string, string>();
  let match: Awaited<ReturnType<typeof matchLinksToTargets>> | null = null;

  if (pasted.trim()) {
    // Se cotejan también los colores omitidos: así el orden de los links
    // sigue calzando con el de las URLs que se copiaron.
    match = await matchLinksToTargets(
      pasted,
      candidates.map((c) => ({ id: c.id, mlProductId: c.ml_product_id })),
      expected
    );
    if (match.linksFound === 0) {
      return { ok: false, error: 'No encontré links de Mercado Libre (meli.la) en lo que pegaste.' };
    }
    for (const a of match.assigned) {
      if (skipped.has(a.targetId)) continue;
      // Misma regla que al aprobar de a uno. matchLinksToTargets ya deja
      // fuera los links de otra cuenta; esto cubre lo que llegue igual.
      const ownership = a.info ? checkAffiliateOwnership(a.info, expected) : null;
      if (ownership) {
        foreign.set(a.targetId, ownership);
        continue;
      }
      const urlError = affiliateUrlError(a.url, usable);
      if (urlError) {
        failed.set(a.targetId, urlError);
        continue;
      }
      links.set(a.targetId, { url: a.url, itemId: a.info?.itemId ?? null, verified: a.verified });
    }

    // Un link de otra cuenta no se asigna, pero conviene decir de qué
    // producto era: la inspección quedó memoizada y no se vuelve a abrir.
    if (match.rejected.length > 0) {
      const ordered = extractAffiliateLinks(pasted);
      const byPosition = ordered.length === candidates.length;
      const byProduct = new Map(candidates.map((c) => [c.ml_product_id, c.id]));
      for (const r of match.rejected) {
        const inspected = await inspectAffiliateLink(r.url);
        const featured = inspected.ok ? inspected.info.featuredProductId : null;
        const index = ordered.indexOf(r.url);
        const targetId =
          (featured ? byProduct.get(featured) : undefined) ??
          (byPosition && index >= 0 ? candidates[index]?.id : undefined);
        if (targetId && !links.has(targetId) && !skipped.has(targetId)) {
          const ownership = inspected.ok ? checkAffiliateOwnership(inspected.info, expected) : null;
          foreign.set(targetId, ownership ?? r.reason);
        }
      }
    }

    const withParams = match.assigned.find(
      (a) => a.info?.mattWord && a.info?.mattTool && links.has(a.targetId)
    );
    if (withParams) await rememberAffiliateParams(admin, withParams.info!.mattWord, withParams.info!.mattTool);
  } else {
    if (!usable) return { ok: false, error: DIRECT_NOT_CONFIRMED };
    const settings = await readAffiliateSettings(admin);
    for (const c of candidates) {
      if (skipped.has(c.id)) continue;
      const direct = directAffiliateUrl(c.ml_product_id, settings);
      // Se arma desde la ficha misma: no puede apuntar a otra.
      if (direct) links.set(c.id, { url: direct, itemId: null, verified: true });
    }
  }

  // Uno por uno a propósito: en paralelo, dos candidatos con el mismo nombre
  // podrían tomar el mismo slug antes de que cualquiera de los dos se guarde.
  const productByCandidate = new Map<string, string>();
  for (const c of candidates) {
    const link = links.get(c.id);
    if (!link) continue;
    const promoted = await promote(admin, c, link.url, link.itemId, link.verified);
    if (!promoted.ok) failed.set(c.id, promoted.error);
    else if (promoted.productId) productByCandidate.set(c.id, promoted.productId);
  }

  const approvedIds = [...productByCandidate.keys()];
  await markReviewedBy(admin, approvedIds, actor);

  const token = approvedIds.length > 0 ? await getMlToken() : null;
  const outcomes = token
    ? await priceNewProducts(admin, [...productByCandidate.values()], token)
    : new Map<string, PricingResult>();
  if (approvedIds.length > 0) {
    refreshPublic(approvedIds.map((id) => rows.get(id)?.category ?? ''));
  }

  const items: BatchItemResult[] = candidates.map((c) => {
    const base = { id: c.id, name: c.name, verified: links.get(c.id)?.verified ?? false };
    if (skipped.has(c.id)) return { ...base, outcome: 'omitido_variante', detail: VARIANT_SKIPPED };
    if (foreign.has(c.id)) return { ...base, outcome: 'otra_cuenta', detail: foreign.get(c.id) };
    if (failed.has(c.id)) return { ...base, outcome: 'error', detail: failed.get(c.id) };
    const productId = productByCandidate.get(c.id);
    if (!productId) return { ...base, outcome: 'sin_link' };
    return { ...base, outcome: outcomes.get(productId) ?? 'pendiente' };
  });

  if (approvedIds.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'aprobar',
      target: `${approvedIds.length} candidatos`,
      after: {
        count: approvedIds.length,
        ids: approvedIds,
        outcomes: Object.fromEntries(items.filter((i) => productByCandidate.has(i.id)).map((i) => [i.id, i.outcome])),
        direct: !pasted.trim(),
      },
    });
  }

  return {
    ok: true,
    items,
    wrongLinks: match?.wrong ?? [],
    // El motivo va pegado al link: el panel muestra esta lista tal cual.
    unmatchedLinks: (match?.unmatched ?? []).map((url) => {
      const reason = match?.rejected.find((r) => r.url === url)?.reason;
      return reason ? `${url} (${reason})` : url;
    }),
    linksFound: match?.linksFound ?? 0,
  };
}

type ReviewResult = { ok: true; ids: string[] } | { ok: false; error: string };

function cleanIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
}

/**
 * Rechaza candidatos pendientes. Devuelve los que de verdad cambiaron, para
 * que "Deshacer" recupere exactamente esos.
 *
 * No revalida la página: la tarjeta la quita el cliente al instante, y
 * releer 200 candidatos por cada rechazo haría lenta la revisión.
 */
export async function rejectCandidates(candidateIds: string[], reason?: string | null): Promise<ReviewResult> {
  const actor = await requireAdmin();
  const ids = cleanIds(candidateIds);
  if (ids.length === 0) return { ok: true, ids: [] };
  if (ids.length > MAX_REVIEW) return { ok: false, error: `Máximo ${MAX_REVIEW} candidatos de una vez` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const rejectReason = isRejectReason(reason) ? reason : null;
  const { data, error } = await withOptionalColumns<{ id: string }[]>(
    {
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: actor,
      reject_reason: rejectReason,
    },
    (patch) =>
      admin.from('product_candidates').update(patch).in('id', ids).eq('status', 'pending_review').select('id')
  );
  if (error) return { ok: false, error: error.message };

  const changed = (data ?? []).map((r) => r.id);
  if (changed.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'rechazar',
      target: changed.length === 1 ? changed[0] : `${changed.length} candidatos`,
      after: { count: changed.length, ids: changed, reason: rejectReason },
    });
  }
  return { ok: true, ids: changed };
}

export async function rejectCandidate(candidateId: string, reason?: string | null): Promise<ReviewResult> {
  return rejectCandidates([candidateId], reason);
}

/**
 * Devuelve a la cola candidatos rechazados o vencidos ("Deshacer" y la
 * vista de rechazados). Solo toca esos estados: un aprobado ya es producto
 * y no puede volver a la cola.
 */
export async function restoreCandidates(candidateIds: string[]): Promise<ReviewResult> {
  const actor = await requireAdmin();
  const ids = cleanIds(candidateIds);
  if (ids.length === 0) return { ok: true, ids: [] };
  if (ids.length > MAX_REVIEW) return { ok: false, error: `Máximo ${MAX_REVIEW} candidatos de una vez` };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { data, error } = await withOptionalColumns<{ id: string }[]>(
    { status: 'pending_review', reviewed_at: null, reject_reason: null, reviewed_by: null },
    (patch) =>
      admin
        .from('product_candidates')
        .update(patch)
        .in('id', ids)
        .in('status', ['rejected', 'expired'])
        .select('id')
  );
  if (error) return { ok: false, error: error.message };

  const changed = (data ?? []).map((r) => r.id);
  if (changed.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'recuperar',
      target: changed.length === 1 ? changed[0] : `${changed.length} candidatos`,
      after: { count: changed.length, ids: changed },
    });
  }
  return { ok: true, ids: changed };
}

/**
 * Motivo elegido después de rechazar (los chips del aviso "Rechazaste N").
 * Va aparte para que rechazar siga siendo un solo toque: el motivo es
 * opcional y no puede frenar la revisión.
 */
export async function setRejectReason(
  candidateIds: string[],
  reason: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  const ids = cleanIds(candidateIds);
  if (ids.length === 0) return { ok: true };
  if (ids.length > MAX_REVIEW) return { ok: false, error: `Máximo ${MAX_REVIEW} candidatos de una vez` };
  if (!isRejectReason(reason)) return { ok: false, error: 'Motivo desconocido' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const { error } = await admin
    .from('product_candidates')
    .update({ reject_reason: reason, reviewed_by: actor })
    .in('id', ids)
    .eq('status', 'rejected');
  if (error) {
    return {
      ok: false,
      error: isMissingSchemaError(error)
        ? 'El motivo se podrá guardar cuando se aplique la migración 0014.'
        : error.message,
    };
  }
  return { ok: true };
}
