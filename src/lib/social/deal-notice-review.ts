import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { categoryFromDomain } from '@/lib/categories';
import { captionDiscount } from '@/lib/content/captions';
import { searchCatalogProducts, type CatalogSearchHit } from '@/lib/ml-catalog';
import { inspectCatalogProduct, type ProductPreview, type ReviewContext } from '@/lib/manual-add';
import { readAffiliateSettings, type AffiliateSettings } from '@/lib/settings';
import { NAME_MATCH_MIN, nameMatch, noticeNote, type NoticeDeal } from '@/lib/social/deal-notice';
import { STORY_RULES, buildStoryItem, readStoryHistory, type StoryHistory, type StoryItem } from '@/lib/social/stories';
import { isOnSale, selectSocialProducts, type SocialProduct } from '@/lib/social/telegram';

/**
 * Qué hacer con cada producto de un aviso del canal (lib/social/deal-notice):
 * subir su historia, agregarlo al sitio o saltarlo. Solo lee: agregar lo hace
 * la acción de Agregar (/admin/candidatos/agregar), con sus mismos controles.
 *
 * El producto se busca por su nombre en el catálogo de Mercado Libre, en
 * todos los tipos: así se sabe también cuándo no es de tecnología (aceite,
 * sillas de auto). Los links del aviso no se abren.
 */

export type DealResult =
  /** Está en el sitio y a la venta: su historia, lista para subir. */
  | { kind: 'historia'; deal: NoticeDeal; item: StoryItem }
  /** Está en el sitio pero no a la venta (oculto, en pausa o borrado). */
  | { kind: 'no_a_la_venta'; deal: NoticeDeal; name: string }
  /** No está en el sitio: la revisión de Agregar (se puede agregar, ya espera en la cola, o por qué no). */
  | { kind: 'agregar'; deal: NoticeDeal; preview: ProductPreview }
  /** No es de un tipo que el sitio publique. */
  | { kind: 'fuera'; deal: NoticeDeal; domain: string | null }
  /** No se encontró, o Mercado Libre no respondió: el mensaje dice cuál. */
  | { kind: 'sin_ficha'; deal: NoticeDeal; message: string };

/** Fichas revisadas con Agregar por producto, como máximo: cada una son ~4 consultas. */
const MAX_INSPECT = 2;

const NOT_FOUND =
  'No encontré su ficha en Mercado Libre. Si es de tecnología, búscala allá y pega el link de la ficha (con /p/MLC…) en Agregar.';
const ML_DOWN = 'Mercado Libre no respondió. Toca Revisar de nuevo en un rato.';

interface Found {
  id: string;
  domainId: string | null;
  buyBox: boolean;
  score: number;
}

/** Las fichas que se parecen al nombre del aviso, de la más a la menos parecida (a igual parecido, el orden de ML). Puro. */
export function similarHits(name: string, hits: CatalogSearchHit[]): Found[] {
  return hits
    .map((h, i) => ({ id: h.id, domainId: h.domainId, buyBox: h.buyBox, score: h.name ? nameMatch(name, h.name) : 0, i }))
    .filter((h) => h.score >= NAME_MATCH_MIN)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ id, domainId, buyBox, score }) => ({ id, domainId, buyBox, score }));
}

/** Lo que hace falta para revisar los productos de un aviso. */
export interface DealContext extends ReviewContext {
  key: Buffer;
  now: Date;
  /** Las historias de los últimos 14 días y el link de afiliado: se leen una vez por aviso (dealContext). */
  storyHistory: () => Promise<Map<string, StoryHistory>>;
  affiliateSettings: () => Promise<AffiliateSettings>;
}

/** El contexto de un aviso: lo que es igual para todos sus productos se lee una sola vez, y solo si hace falta. */
export function dealContext(review: ReviewContext, key: Buffer, now: Date): DealContext {
  let history: Promise<Map<string, StoryHistory>> | null = null;
  let settings: Promise<AffiliateSettings> | null = null;
  const since = new Date(now.getTime() - STORY_RULES.repeatAfterDays * 86_400_000);
  return {
    ...review,
    key,
    now,
    storyHistory: () => (history ??= readStoryHistory(review.admin, since)),
    affiliateSettings: () => (settings ??= readAffiliateSettings(review.admin)),
  };
}

async function readCatalog(admin: SupabaseClient, ids: string[]): Promise<SocialProduct[]> {
  if (ids.length === 0) return [];
  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).in('ml_product_id', ids));
  if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);
  return read.rows;
}

async function storyOf(product: SocialProduct, deal: NoticeDeal, ctx: DealContext): Promise<DealResult> {
  const [history, settings] = await Promise.all([ctx.storyHistory(), ctx.affiliateSettings()]);
  const h = history.get(product.id);
  // Sin `history`: la tarjeta lo leería como "bajó desde que la subiste", y puede que no haya bajado.
  const item = buildStoryItem(
    { product, discount: captionDiscount(product), drop: null, score: null },
    { now: ctx.now, settings, key: ctx.key }
  );
  if (!item) return { kind: 'sin_ficha', deal, message: 'No se pudo armar la imagen de este producto.' };
  const last = h ? { price: h.lowest, at: h.lowestAt ?? h.lastAt } : null;
  return { kind: 'historia', deal, item: { ...item, reason: noticeNote(deal, product.price, last) } };
}

/** Qué hacer con un producto del aviso. Lanza solo si falla la base. */
export async function reviewDeal(deal: NoticeDeal, ctx: DealContext): Promise<DealResult> {
  let found: Found[];
  if (deal.mlId) {
    found = [{ id: deal.mlId, domainId: null, buyBox: true, score: 1 }];
  } else {
    const search = await searchCatalogProducts(deal.name, null, ctx.token, 10);
    if (search.status !== 'ok') return { kind: 'sin_ficha', deal, message: ML_DOWN };
    found = similarHits(deal.name, search.items);
    if (found.length === 0) return { kind: 'sin_ficha', deal, message: NOT_FOUND };
  }

  // Lo que ya está en el sitio va primero: a la venta, su historia; si no, se avisa.
  const catalog = await readCatalog(
    ctx.admin,
    found.map((f) => f.id)
  );
  const byId = new Map(catalog.map((p) => [p.ml_product_id, p]));
  for (const f of found) {
    const product = byId.get(f.id);
    if (product && isOnSale(product)) return storyOf(product, deal, ctx);
  }
  const paused = found.map((f) => byId.get(f.id)).find(Boolean);

  // Con un link limpio el tipo se sabe al revisarlo; con la búsqueda, por lo que trae ML.
  const candidates = deal.mlId ? found : found.filter((f) => f.domainId && categoryFromDomain(f.domainId));
  if (candidates.length === 0) {
    if (paused) return { kind: 'no_a_la_venta', deal, name: paused.name };
    return { kind: 'fuera', deal, domain: found[0]?.domainId ?? null };
  }

  // Primero las que tienen caja de compra: las otras nunca tienen quién las venda.
  const ordered = [...candidates.filter((f) => f.buyBox), ...candidates.filter((f) => !f.buyBox)];
  let first: ProductPreview | null = null;
  for (const f of ordered.slice(0, MAX_INSPECT)) {
    const inspected = await inspectCatalogProduct(f.id, f.id, ctx);
    if ('notFound' in inspected) continue;
    const preview = inspected.preview;
    if (preview.state === 'en_sitio') {
      // Otro color o variante ya publicado que la búsqueda no trajo como del sitio: se vuelve a leer.
      const [product] = await readCatalog(ctx.admin, [f.id]);
      if (product && isOnSale(product)) return storyOf(product, deal, ctx);
      return { kind: 'no_a_la_venta', deal, name: preview.name };
    }
    if (preview.state === 'listo' || preview.state === 'en_cola') return { kind: 'agregar', deal, preview };
    first ??= preview;
  }
  if (paused) return { kind: 'no_a_la_venta', deal, name: paused.name };
  if (first) return { kind: 'agregar', deal, preview: first };
  return { kind: 'sin_ficha', deal, message: NOT_FOUND };
}
