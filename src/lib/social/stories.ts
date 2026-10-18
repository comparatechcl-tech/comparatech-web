import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { captionDiscount } from '@/lib/content/captions';
import { resolveOutboundUrl } from '@/lib/outbound';
import { readAffiliateSettings, type AffiliateSettings } from '@/lib/settings';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { socialProductName } from '@/lib/content/social-name';
import { readSocialEvidence } from '@/lib/social/drops';
import type { InterestScore } from '@/lib/social/interest';
import { mlCheckUrl } from '@/lib/social/live-price';
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
  /**
   * Cuándo se subió la historia de ese precio más bajo (la más nueva, si hubo
   * varias a ese precio). null si ninguna anotó precio. Va junto a `lowest`
   * en "Ya la subiste el {fecha} a {$}": la fecha y el precio de la misma
   * historia, no la fecha de la última con el precio de otra.
   */
  lowestAt: string | null;
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
  // Vienen de la más nueva a la más antigua: la primera de cada producto es la
  // última subida. Con dos al mismo precio más bajo, queda la fecha de la más
  // nueva (la primera que se ve), por eso el "<" estricto.
  for (const row of (data ?? []) as StoryRow[]) {
    if (!row.product_id) continue;
    const price = row.posted_price && row.posted_price > 0 ? row.posted_price : null;
    const known = history.get(row.product_id);
    if (!known) {
      history.set(row.product_id, { lowest: price, lowestAt: price !== null ? row.posted_at : null, lastAt: row.posted_at });
    } else if (price !== null && (known.lowest === null || price < known.lowest)) {
      known.lowest = price;
      known.lowestAt = row.posted_at;
    }
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
  /**
   * La ficha de Mercado Libre para mirar el precio, sin parámetros de afiliado
   * (lib/social/live-price: mlCheckUrl). Nunca `link`: abrirlo para mirar
   * contaría como un clic de afiliado. null si el producto no tiene ficha.
   */
  mlUrl: string | null;
  /** Lo que la pieza dice del envío (mismo dato que la imagen, de offer_info). */
  freeShipping: boolean;
  full: boolean;
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
    name: socialProductName(p),
    brand: p.brand,
    price: p.price,
    listPrice: pick.discount > 0 ? p.original_price : null,
    discount: pick.discount,
    drop: pick.drop === null ? null : Math.round(pick.drop),
    checkedAt: p.price_checked_at,
    // El precio y la fecha de la misma historia: la del precio más bajo, que es contra el que se compara.
    again: h && h.lowest !== null ? { price: h.lowest, at: h.lowestAt ?? h.lastAt } : null,
    reason: pick.score?.reason ?? '',
    warning: pick.score?.warning ?? null,
    points: pick.score?.points ?? 0,
    image,
    link: resolveOutboundUrl(p, opts.settings),
    fileName: `comparatech-${safeSlug}-historia.jpg`,
    mlUrl: mlCheckUrl(p.ml_product_id),
    // Igual que la imagen (snapshotOf): solo con un sí explícito.
    freeShipping: p.offer_info?.free_shipping === true,
    full: p.offer_info?.is_full === true,
  };
}

/**
 * Las ofertas de la lista, más cuántas otras califican y quedaron fuera.
 * Es un arreglo como siempre (quien solo quiere la lista no nota nada) con
 * `waiting` pegado.
 */
export type StoryPicks = StoryItem[] & {
  /**
   * Cuántas ofertas más pasan todas las reglas y no entraron por el cupo de
   * ocho o por los límites de variedad (dos por categoría, una por tipo, dos
   * por marca). Una por modelo: dos colores del mismo cuentan una. Son las
   * que aparecen al marcar las ya subidas y tocar Actualizar.
   */
  waiting: number;
};

/** Sin tope de cantidad ni de variedad: para contar todo lo que califica. */
const ALL_THAT_QUALIFY = {
  maxPosts: Number.MAX_SAFE_INTEGER,
  perCategory: Number.MAX_SAFE_INTEGER,
  perType: Number.MAX_SAFE_INTEGER,
  perBrand: Number.MAX_SAFE_INTEGER,
};

/**
 * Las ofertas de este momento para subir como historia: la puerta de entrada
 * del plan de publicaciones (descuento sobre el precio de lista o baja
 * confirmada, precio recién revisado), con más productos y en orden de
 * interés (lib/social/interest). Lo que ya se subió como historia en los
 * últimos 14 días no vuelve, salvo que haya bajado de precio: esas van
 * primero. Trae también cuántas más esperan su turno (`waiting`). Solo lee.
 */
export async function readStoryPicks(admin: SupabaseClient, now: Date, key: Buffer): Promise<StoryPicks> {
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

  const options = { now, recentlyPosted: alreadyPosted, evidence };
  const picks = pickByRules(read.rows, options, STORY_RULES);
  const items = picks
    .map((pick) => buildStoryItem(pick, { now, settings, key, history: history.get(pick.product.id) }))
    .filter((item): item is StoryItem => item !== null);
  // La misma selección sin cupos: lo que queda fuera de la lista espera su turno.
  const qualifying = pickByRules(read.rows, options, { ...STORY_RULES, ...ALL_THAT_QUALIFY }).length;
  // sort es estable: dentro de cada grupo se conserva el orden de la selección, que es el de interés.
  const sorted = items.sort((a, b) => Number(b.again !== null) - Number(a.again !== null));
  return Object.assign(sorted, { waiting: Math.max(0, qualifying - picks.length) });
}

/** Lo que dura una historia en Instagram. Lo marcado en ese rato sigue a mano para subirlo a otras redes. */
export const STORY_LIFETIME_MS = 24 * 3600_000;

/** Una historia ya marcada como publicada, con lo necesario para compartirla de nuevo o deshacer la marca. */
export interface PostedStory extends StoryItem {
  postId: number;
  postedAt: string;
  /** El precio con que se subió. La imagen que se entrega ahora lleva el precio de ahora. */
  postedPrice: number | null;
  /**
   * false si el producto ya no está a la venta en el sitio: la historia sigue
   * en Instagram con un producto que no se puede comprar, y la tarjeta pide
   * borrarla. Sin imagen ni Compartir (la pieza solo se dibuja para lo que se
   * vende).
   */
  onSale: boolean;
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
 * última marca). Lo que ya no está a la venta viene con `onSale: false`: su
 * historia sigue arriba y hay que borrarla. Solo lee.
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
  // Un producto borrado de la base no vuelve: no hay nada que mostrar. Ocultado, en pausa o
  // marcado como borrado sí: su historia sigue en Instagram y la tarjeta pide borrarla.
  const known = new Map(read.rows.map((p) => [p.id, p]));

  const stories: PostedStory[] = [];
  for (const [productId, row] of latest) {
    const product = known.get(productId);
    if (!product) continue;
    const item = buildStoryItem({ product, discount: captionDiscount(product), drop: null, score: null }, { now, settings, key });
    if (!item) continue;
    stories.push({ ...item, postId: row.id, postedAt: row.posted_at, postedPrice: row.posted_price, onSale: isOnSale(product) });
  }
  return stories;
}
