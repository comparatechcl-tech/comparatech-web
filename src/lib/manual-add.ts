import type { SupabaseClient } from '@supabase/supabase-js';
import { categoryFromDomain, getCategoryInfo } from '@/lib/categories';
import { commissionRate, estimateCommission } from '@/lib/commission';
import { formatCLP } from '@/lib/format';
import { enrichFromMlProduct } from '@/lib/ml-enrichment';
import {
  discoverDomains,
  firstPictureUrl,
  getRootCategory,
  getSellers,
  getWinners,
  isGreenSeller,
  lookupProduct,
  searchCatalogProducts,
} from '@/lib/ml-catalog';
import { shareAffiliateUrl, type MlInput } from '@/lib/ml-links';
import { directAffiliateUrl } from '@/lib/outbound';
import { passesCommissionFloor } from '@/lib/prospect-filter';
import { pickSiteDomain } from '@/lib/prospect-finders';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * "Agregar desde Mercado Libre" (/admin/candidatos/agregar): el dueño ve un producto en
 * ML, pega el link y el sitio lo revisa como lo haría la prospección (ganador
 * de la caja de compra, vendedor verde, categoría del sitio, comisión), le
 * arma el link de afiliado y lo deja en la cola o lo publica.
 *
 * Revisar solo lee (ML y la base). Lo que escribe es saveManualCandidate, y
 * la acción del admin vuelve a revisar el producto antes de guardarlo: lo que
 * llega del navegador no se toma por bueno.
 */

/** listo: se puede agregar. en_cola: ya espera en Candidatos. en_sitio: ya está publicado. */
export type PreviewState = 'listo' | 'en_cola' | 'en_sitio' | 'no_se_puede';

export interface ProductPreview {
  kind: 'ficha';
  id: string;
  raw: string;
  name: string;
  imageUrl: string | null;
  price: number | null;
  originalPrice: number | null;
  discountPct: number;
  category: string | null;
  categoryName: string | null;
  sellerNickname: string | null;
  /** Comisión estimada por venta (lib/commission). */
  commission: number | null;
  /** Sin la categoría raíz se estima con la tasa más baja. */
  commissionAssumed: boolean;
  /** Link de afiliado directo, o null si los links directos no están confirmados. */
  affiliateUrl: string | null;
  state: PreviewState;
  /** Por qué no se puede agregar (state no_se_puede). */
  reason?: string;
  /** Lo que conviene saber antes de agregarlo, sin impedirlo. */
  warnings: string[];
  /** Si ya está publicado, su ficha en ComparaTech. */
  siteSlug?: string;
}

export interface CatalogSuggestion {
  id: string;
  name: string;
  imageUrl: string | null;
}

export type ReviewItem =
  | ProductPreview
  /**
   * Publicación de un vendedor: no se puede agregar al sitio, pero sí lleva su
   * link de afiliado para compartirla (shareUrl), y las fichas del catálogo
   * parecidas a su título.
   */
  | { kind: 'publicacion'; id: string; raw: string; message: string; suggestions: CatalogSuggestion[]; shareUrl: string | null }
  /** Algo que no se puede revisar, con la explicación. */
  | { kind: 'aviso'; raw: string; message: string };

export interface ReviewContext {
  admin: SupabaseClient;
  token: string;
  /** matt_word y matt_tool para el link directo; null si los links directos no están confirmados. */
  affiliate: { word: string | null; tool: string | null } | null;
  minCommission: number;
}

/** La fila de product_candidates, como la arma la prospección. */
export type ManualCandidate = Record<string, unknown> & { ml_product_id: string; name: string };

/** Columnas de las migraciones 0014 y 0018: sin ellas se guarda igual, sin estas. */
const OPTIONAL_COLUMNS = [
  'reject_reason',
  'reviewed_by',
  'highlight_position',
  'highlight_category_id',
  'ml_root_category',
  'is_full',
  'official_store',
  'checked_at',
];

export const SHORT_LINK_MESSAGE =
  'Los links cortos (meli.la) no los abro: cada apertura cuenta como un clic tuyo de afiliado. ' +
  'Abre el producto en Mercado Libre y copia la dirección de la ficha, la que tiene /p/MLC….';

export const NOT_ML_MESSAGE = 'Eso no es un link de un producto de Mercado Libre Chile.';

const ITEM_MESSAGE =
  'Este link es de una publicación de un vendedor, no de la ficha del producto, y Mercado Libre no deja ' +
  'ver a qué ficha pertenece.';

const SHARE_HELP = 'No se puede agregar al sitio, pero abajo tienes su link de afiliado para compartirlo.';

const FIND_CATALOG_HELP =
  'Busca el producto en Mercado Libre hasta llegar a su ficha (la dirección tiene /p/MLC…) y pega esa dirección.';

const ML_DOWN = 'Mercado Libre no respondió. Intenta de nuevo en un rato.';

function discountOf(price: number, original: number | null): number {
  if (!original || original <= price || price <= 0) return 0;
  return Math.round(((original - price) / original) * 100);
}

type ProductRow = { slug: string; name: string; is_active: boolean; is_hidden: boolean; deleted_at: string | null };

/** Lo que el sitio ya sabe de esta ficha: si está publicada, en la cola, u otro color publicado. */
async function readSiteState(admin: SupabaseClient, id: string, familyId: string | null) {
  const [product, candidate, family] = await Promise.all([
    admin.from('products').select('slug, name, is_active, is_hidden, deleted_at').eq('ml_product_id', id).maybeSingle(),
    admin.from('product_candidates').select('id, status').eq('ml_product_id', id).maybeSingle(),
    familyId
      ? admin
          .from('products')
          .select('name')
          .eq('ml_family_id', familyId)
          .eq('is_hidden', false)
          .is('deleted_at', null)
          .neq('ml_product_id', id)
          .limit(1)
      : Promise.resolve({ data: [] as { name: string }[], error: null }),
  ]);
  const failed = product.error ?? candidate.error ?? family.error;
  if (failed) throw new Error(`No se pudo leer la base: ${failed.message}`);
  return {
    product: (product.data as ProductRow | null) ?? null,
    candidate: (candidate.data as { id: string; status: string } | null) ?? null,
    familyName: ((family.data ?? []) as { name: string }[])[0]?.name ?? null,
  };
}

/**
 * Revisa una ficha de catálogo. `notFound`: ML no tiene una ficha con ese
 * código (puede ser el de una publicación). Lanza solo si falla la base.
 */
export async function inspectCatalogProduct(
  id: string,
  raw: string,
  ctx: ReviewContext
): Promise<{ notFound: true } | { preview: ProductPreview; candidate: ManualCandidate | null }> {
  const base: ProductPreview = {
    kind: 'ficha',
    id,
    raw,
    name: id,
    imageUrl: null,
    price: null,
    originalPrice: null,
    discountPct: 0,
    category: null,
    categoryName: null,
    sellerNickname: null,
    commission: null,
    commissionAssumed: false,
    affiliateUrl: null,
    state: 'no_se_puede',
    warnings: [],
  };
  const blocked = (preview: ProductPreview, reason: string) => ({
    preview: { ...preview, state: 'no_se_puede' as const, reason },
    candidate: null,
  });

  const lookup = await lookupProduct(id, ctx.token);
  if (lookup.status === 'not_found') return { notFound: true };
  if (lookup.status === 'error') return blocked(base, ML_DOWN);

  const product = lookup.product;
  const name = (product as { name?: string })?.name?.trim();
  const imageUrl = firstPictureUrl(product);
  if (!name || !imageUrl) return blocked(base, 'La ficha no tiene nombre o foto en Mercado Libre.');

  const enrichment = enrichFromMlProduct(product, name);
  const category = categoryFromDomain(enrichment.domainId);
  const preview: ProductPreview = {
    ...base,
    name,
    imageUrl,
    category,
    categoryName: category ? (getCategoryInfo(category)?.name ?? category) : null,
    affiliateUrl: ctx.affiliate ? directAffiliateUrl(id, ctx.affiliate) : null,
  };

  const site = await readSiteState(ctx.admin, id, enrichment.familyId);
  if (site.product) {
    const hidden = site.product.deleted_at ? 'borrado' : site.product.is_hidden ? 'oculto' : null;
    return {
      preview: {
        ...preview,
        state: 'en_sitio',
        siteSlug: site.product.slug,
        warnings: hidden ? [`Está ${hidden}: revísalo en Productos.`] : [],
      },
      candidate: null,
    };
  }

  if (!category) {
    return blocked(
      preview,
      `El sitio no tiene una categoría para este tipo de producto (${enrichment.domainId ?? 'sin tipo'}).`
    );
  }

  const winners = await getWinners(id, ctx.token);
  if (winners.status === 'no_winner') {
    return blocked(
      preview,
      'Ahora nadie vende este producto en la ficha de Mercado Libre (sin ganador). Puede volver más adelante.'
    );
  }
  if (winners.status === 'error') return blocked(preview, ML_DOWN);

  const winner = winners.offers[0];
  const originalPrice =
    typeof winner.original_price === 'number' && winner.original_price > winner.price ? winner.original_price : null;
  const [root, sellers] = await Promise.all([
    winner.category_id ? getRootCategory(winner.category_id, ctx.token) : Promise.resolve(null),
    getSellers([winner.seller_id], ctx.token),
  ]);
  const seller = sellers.get(winner.seller_id);
  const commission = estimateCommission(winner.price, root);
  const priced: ProductPreview = {
    ...preview,
    price: winner.price,
    originalPrice,
    discountPct: discountOf(winner.price, originalPrice),
    sellerNickname: seller?.nickname ?? null,
    commission,
    commissionAssumed: commissionRate(root).source === 'asumido',
  };

  if (!isGreenSeller(seller)) {
    return blocked(
      priced,
      'Quien lo vende hoy en la ficha no tiene reputación verde, y Mercado Libre no paga comisión por esas ventas. ' +
        'El vendedor que gana la ficha cambia: prueba más tarde.'
    );
  }

  const warnings: string[] = [];
  if (!passesCommissionFloor(winner.price, root, ctx.minCommission)) {
    warnings.push(`Deja poca comisión: ~${formatCLP(commission)} por venta.`);
  }
  if (site.familyName) warnings.push(`Ya publicas otro color de este modelo (${site.familyName}).`);
  if (site.candidate && site.candidate.status !== 'pending_review' && site.candidate.status !== 'approved') {
    warnings.push('Lo habías descartado antes: agregarlo lo vuelve a la cola.');
  }
  if (!ctx.affiliate) {
    warnings.push(
      'Los links directos no están confirmados: para publicarlo hay que pegar su link meli.la en Candidatos.'
    );
  }

  const now = new Date().toISOString();
  const candidate: ManualCandidate = {
    ml_product_id: id,
    ml_family_id: enrichment.familyId,
    ml_domain_id: enrichment.domainId,
    ml_item_id: winner.item_id,
    name,
    brand: enrichment.brand,
    category,
    price: winner.price,
    original_price: originalPrice,
    image_url: imageUrl,
    description: enrichment.description,
    specs: enrichment.specs,
    seller_id: winner.seller_id,
    seller_nickname: seller?.nickname ?? null,
    seller_reputation: 'verde',
    seller_sales_count: seller?.salesCount ?? 0,
    source: 'manual',
    // Explícitos: un candidato descartado antes vuelve a la cola como nuevo.
    status: 'pending_review',
    prospected_at: now,
    reviewed_at: null,
    reject_reason: null,
    reviewed_by: null,
    highlight_position: null,
    highlight_category_id: null,
    ml_root_category: root,
    is_full: winner.shipping?.logistic_type === 'fulfillment',
    official_store: winner.official_store_id != null,
    checked_at: now,
  };

  return {
    preview: { ...priced, state: site.candidate?.status === 'pending_review' ? 'en_cola' : 'listo', warnings },
    candidate,
  };
}

/**
 * Fichas del catálogo parecidas al título de una publicación, dentro de un
 * tipo que el sitio publica. null si ML no respondió (no es lo mismo que "no
 * hay parecidas").
 */
export async function suggestCatalogProducts(
  words: string,
  token: string,
  max = 4
): Promise<CatalogSuggestion[] | null> {
  if (!words.trim()) return [];
  const domains = await discoverDomains(words, token);
  if (domains.status !== 'ok') return null;
  const domain = pickSiteDomain(domains.items);
  if (!domain) return [];
  const results = await searchCatalogProducts(words, domain, token, 10);
  if (results.status !== 'ok') return null;
  return results.items
    .filter((r) => r.buyBox && r.name)
    .slice(0, max)
    .map((r) => ({ id: r.id, name: r.name as string, imageUrl: r.picture }));
}

/** Lo que se muestra por cada cosa pegada. Lanza solo si falla la base. */
export async function reviewInput(input: MlInput, ctx: ReviewContext): Promise<ReviewItem> {
  switch (input.kind) {
    case 'corto':
      return { kind: 'aviso', raw: input.raw, message: SHORT_LINK_MESSAGE };
    case 'otro':
      return { kind: 'aviso', raw: input.raw, message: NOT_ML_MESSAGE };
    case 'publicacion': {
      // Un link de la app de Mercado Libre ("Compartir" da …/up/MLCU…) no trae el título: no hay con qué buscar.
      const suggestions = input.words ? await suggestCatalogProducts(input.words, ctx.token) : [];
      // Como el generador de links de Mercado Libre: el link de afiliado de la publicación, aunque no entre al sitio.
      const shareUrl = ctx.affiliate ? shareAffiliateUrl(input.raw, ctx.affiliate) : null;
      const share = shareUrl ? ` ${SHARE_HELP}` : '';
      const message =
        suggestions === null
          ? `${ITEM_MESSAGE}${share} No pude buscar fichas parecidas (Mercado Libre no respondió). ${FIND_CATALOG_HELP}`
          : suggestions.length > 0
            ? `${ITEM_MESSAGE}${share} Si es alguna de estas fichas, esa sí se puede agregar:`
            : `${ITEM_MESSAGE}${share} Para agregarlo al sitio: ${FIND_CATALOG_HELP.charAt(0).toLowerCase()}${FIND_CATALOG_HELP.slice(1)}`;
      return { kind: 'publicacion', id: input.id, raw: input.raw, message, suggestions: suggestions ?? [], shareUrl };
    }
    case 'ficha':
    case 'codigo': {
      const result = await inspectCatalogProduct(input.id, input.raw, ctx);
      if (!('notFound' in result)) return result.preview;
      return input.kind === 'ficha'
        ? { kind: 'aviso', raw: input.raw, message: `Mercado Libre no tiene una ficha con el código ${input.id}.` }
        : {
            kind: 'publicacion',
            id: input.id,
            raw: input.raw,
            message: `${input.id} no es el código de una ficha de catálogo (parece el de una publicación). ${FIND_CATALOG_HELP}`,
            suggestions: [],
            shareUrl: null,
          };
    }
  }
}

/**
 * Guarda el candidato (o lo pone al día si ya estaba) y devuelve su id. Sin
 * las migraciones 0014 o 0018 se guarda sin esas columnas.
 */
export async function saveManualCandidate(
  admin: SupabaseClient,
  candidate: ManualCandidate
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const save = (row: Record<string, unknown>) =>
    admin.from('product_candidates').upsert(row, { onConflict: 'ml_product_id' }).select('id').single();
  let { data, error } = await save(candidate);
  if (error && isMissingSchemaError(error)) {
    const rest: Record<string, unknown> = { ...candidate };
    for (const column of OPTIONAL_COLUMNS) delete rest[column];
    ({ data, error } = await save(rest));
  }
  if (error) return { ok: false, error: `No se pudo guardar en la cola: ${error.message}` };
  const id = (data as { id?: string } | null)?.id;
  return id ? { ok: true, id } : { ok: false, error: 'La base no devolvió el candidato guardado.' };
}
