import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { captionDiscount } from '@/lib/content/captions';
import { resolveOutboundUrl } from '@/lib/outbound';
import { readAffiliateSettings, type AffiliateSettings } from '@/lib/settings';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { shortProductName } from '@/lib/text';
import { readSocialEvidence } from '@/lib/social/drops';
import type { InterestScore } from '@/lib/social/interest';
import { NETWORK_RULES, STORY_MARK } from '@/lib/social/networks';
import { piecePath, snapshotOf } from '@/lib/social/piece-url';
import {
  isOnSale,
  pickByRules,
  readFreshSocialProducts,
  selectSocialProducts,
  type PickRules,
  type SocialProduct,
  type TelegramPick,
} from '@/lib/social/telegram';

/**
 * Historias de Instagram que se suben a mano desde el teléfono.
 *
 * El único link que se puede tocar en una historia es el sticker "Enlace",
 * y ningún programador de publicaciones lo puede poner: hay que subir la
 * historia desde la app. Lo que sí se puede dejar listo es todo lo demás:
 * qué ofertas mostrar, la imagen con el precio del momento y el link de
 * afiliado para pegar en el sticker (ver /admin/historias).
 *
 * Las historias llevan su propia cuenta de "ya publicado", aparte de la del
 * plan de publicaciones: una historia dura un día y lleva su link, así que
 * no le quita productos al feed ni el feed a las historias. Se anotan en
 * social_posts con STORY_MARK en `caption`.
 */

export const STORY_RULES: PickRules & { repeatAfterDays: number } = {
  ...NETWORK_RULES,
  /** Se suben a mano y no gastan la cuota de Metricool: caben más que en el plan de publicaciones. */
  maxPosts: 8,
  /** El dueño ve el aviso en la tarjeta antes de subirla: decide él. */
  cleanOnly: false,
};

/**
 * Cuánto tiene que bajar una oferta ya subida para volver a mostrarse antes
 * de los 14 días. Lo mismo que hace rehacer un post programado
 * (lib/social/networks): menos que esto no es noticia.
 */
export const STORY_REPOST_DROP = 0.03;

/** Lo que se sabe de las historias recientes de un producto. */
export interface StoryHistory {
  /** El precio más bajo con que se subió. null si ninguna historia lo anotó. */
  lowest: number | null;
  /** Cuándo se subió la última. */
  lastAt: string;
}

interface StoryRow {
  product_id: string | null;
  posted_price: number | null;
  posted_at: string;
}

/** Las historias marcadas como publicadas desde `since`, por producto. Sin la tabla, ninguna. */
export async function readStoryHistory(admin: SupabaseClient, since: Date): Promise<Map<string, StoryHistory>> {
  const { data, error } = await admin
    .from('social_posts')
    .select('product_id, posted_price, posted_at')
    .eq('channel', 'instagram')
    .eq('caption', STORY_MARK)
    .neq('status', 'error')
    .gte('posted_at', since.toISOString())
    .order('posted_at', { ascending: false })
    .limit(2000);
  if (error) {
    if (isMissingSchemaError(error)) return new Map();
    throw new Error(`No se pudo leer las historias publicadas: ${error.message}`);
  }

  const history = new Map<string, StoryHistory>();
  // Vienen de la más nueva a la más antigua: la primera de cada producto es la última subida.
  for (const row of (data ?? []) as StoryRow[]) {
    if (!row.product_id) continue;
    const price = row.posted_price && row.posted_price > 0 ? row.posted_price : null;
    const known = history.get(row.product_id);
    if (!known) history.set(row.product_id, { lowest: price, lastAt: row.posted_at });
    else if (price !== null && (known.lowest === null || price < known.lowest)) known.lowest = price;
  }
  return history;
}

/**
 * ¿Bajó lo suficiente desde sus historias como para subirla de nuevo? Puro.
 *
 * Se compara con el precio MÁS BAJO con que ya se subió, no con el último:
 * muchos precios van y vienen entre los mismos dos valores (dos vendedores
 * que se turnan), y comparando con el último esa oferta volvería a aparecer
 * cada vez que el precio regresa al valor de siempre.
 */
export function droppedSinceStory(history: StoryHistory | undefined, price: number): boolean {
  if (!history || history.lowest === null) return false;
  return price <= history.lowest * (1 - STORY_REPOST_DROP);
}

export interface StoryItem {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  price: number;
  /** Precio de lista, solo si es mayor que el precio. */
  listPrice: number | null;
  discount: number;
  /** Baja confirmada por el historial (en %), para lo que no llega al descuento. */
  drop: number | null;
  checkedAt: string | null;
  /** Si ya se subió en estos días y vuelve porque bajó: a cuánto se subió y cuándo. */
  again: { price: number; at: string } | null;
  /** Por qué se propone, en una frase (lib/social/interest). Vacío en las ya publicadas. */
  reason: string;
  /** Lo que conviene mirar antes de subirla, o null. */
  warning: string | null;
  /** Puntaje de interés: las ofertas vienen ordenadas por él. 0 en las ya publicadas. */
  points: number;
  /** Ruta firmada de la pieza 9:16, sin dominio: sirve en producción y en local. */
  image: string;
  /** El mismo destino que el botón de compra del sitio. */
  link: string;
  fileName: string;
}

/** Lo que buildStoryItem necesita de la selección. Una historia ya publicada no lleva puntaje. */
export type StoryPick = Pick<TelegramPick<SocialProduct>, 'product' | 'discount' | 'drop'> & {
  score: InterestScore | null;
};

/** Lo que hace falta para subir la historia de un producto. null si no se pudo firmar la imagen. Puro. */
export function buildStoryItem(
  pick: StoryPick,
  opts: { now: Date; settings: AffiliateSettings; key: Buffer; history?: StoryHistory }
): StoryItem | null {
  const p = pick.product;
  const image = piecePath(snapshotOf(p, 'story', opts.now), opts.key);
  if (!image) return null;

  const safeSlug = p.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 80) || 'producto';
  const h = opts.history;
  return {
    id: p.id,
    slug: p.slug,
    name: shortProductName(p.name),
    brand: p.brand,
    price: p.price,
    listPrice: pick.discount > 0 ? p.original_price : null,
    discount: pick.discount,
    drop: pick.drop === null ? null : Math.round(pick.drop),
    checkedAt: p.price_checked_at,
    again: h && h.lowest !== null ? { price: h.lowest, at: h.lastAt } : null,
    reason: pick.score?.reason ?? '',
    warning: pick.score?.warning ?? null,
    points: pick.score?.points ?? 0,
    image,
    link: resolveOutboundUrl(p, opts.settings),
    fileName: `comparatech-${safeSlug}-historia.jpg`,
  };
}

/**
 * Las ofertas de este momento para subir como historia: la puerta de entrada
 * del plan de publicaciones (descuento sobre el precio de lista o baja
 * confirmada, precio recién revisado), con más productos y en orden de
 * interés (lib/social/interest). Lo que ya se subió como historia en los
 * últimos 14 días no vuelve, salvo que haya bajado de precio: esas van
 * primero. Solo lee.
 */
export async function readStoryPicks(admin: SupabaseClient, now: Date, key: Buffer): Promise<StoryItem[]> {
  const freshSince = new Date(now.getTime() - STORY_RULES.maxPriceAgeMs).toISOString();
  const read = await readFreshSocialProducts(admin, freshSince);
  if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);

  const since = new Date(now.getTime() - STORY_RULES.repeatAfterDays * 86_400_000);
  const [history, settings] = await Promise.all([readStoryHistory(admin, since), readAffiliateSettings(admin)]);

  const alreadyPosted = new Set<string>();
  for (const p of read.rows) {
    if (history.has(p.id) && !droppedSinceStory(history.get(p.id), p.price)) alreadyPosted.add(p.id);
  }
  // Después de saber qué se subió: el historial de precios de eso no hace falta leerlo.
  const evidence = await readSocialEvidence(admin, read.rows, now, alreadyPosted);

  const items = pickByRules(read.rows, { now, recentlyPosted: alreadyPosted, evidence }, STORY_RULES)
    .map((pick) => buildStoryItem(pick, { now, settings, key, history: history.get(pick.product.id) }))
    .filter((item): item is StoryItem => item !== null);
  // sort es estable: dentro de cada grupo se conserva el orden de la selección, que es el de interés.
  return items.sort((a, b) => Number(b.again !== null) - Number(a.again !== null));
}

/** Lo que dura una historia en Instagram. Lo marcado en ese rato sigue a mano para subirlo a otras redes. */
export const STORY_LIFETIME_MS = 24 * 3600_000;

/** Una historia ya marcada como publicada, con lo necesario para compartirla de nuevo o deshacer la marca. */
export interface PostedStory extends StoryItem {
  postId: number;
  postedAt: string;
  /** El precio con que se subió. La imagen que se entrega ahora lleva el precio de ahora. */
  postedPrice: number | null;
}

interface PostedRow {
  id: number;
  product_id: string | null;
  posted_price: number | null;
  posted_at: string;
}

/**
 * Las historias marcadas en las últimas 24 horas, de la más nueva a la más
 * antigua: la misma historia se sube a mano en cada red, así que después de
 * Instagram hay que tenerla a mano para las demás. Una por producto (la
 * última marca), y solo de lo que sigue a la venta. Solo lee.
 */
export async function readPostedStories(admin: SupabaseClient, now: Date, key: Buffer): Promise<PostedStory[]> {
  const since = new Date(now.getTime() - STORY_LIFETIME_MS);
  const { data, error } = await admin
    .from('social_posts')
    .select('id, product_id, posted_price, posted_at')
    .eq('channel', 'instagram')
    .eq('caption', STORY_MARK)
    .eq('status', 'publicado')
    .gte('posted_at', since.toISOString())
    .order('posted_at', { ascending: false })
    .limit(60);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error(`No se pudo leer las historias publicadas: ${error.message}`);
  }

  const latest = new Map<string, PostedRow>();
  for (const row of (data ?? []) as PostedRow[]) {
    if (row.product_id && !latest.has(row.product_id)) latest.set(row.product_id, row);
  }
  if (latest.size === 0) return [];

  const ids = [...latest.keys()];
  const [read, settings] = await Promise.all([
    selectSocialProducts((columns) => admin.from('products').select(columns).in('id', ids)),
    readAffiliateSettings(admin),
  ]);
  if (read.error) throw new Error(`No se pudo leer los productos: ${read.error}`);
  const onSale = new Map(read.rows.filter((p) => isOnSale(p)).map((p) => [p.id, p]));

  const stories: PostedStory[] = [];
  for (const [productId, row] of latest) {
    const product = onSale.get(productId);
    if (!product) continue;
    const item = buildStoryItem({ product, discount: captionDiscount(product), drop: null, score: null }, { now, settings, key });
    if (!item) continue;
    stories.push({ ...item, postId: row.id, postedAt: row.posted_at, postedPrice: row.posted_price });
  }
  return stories;
}
