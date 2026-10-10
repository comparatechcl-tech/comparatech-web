import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { buildCaption, formatPrice, mlPhotoJpg } from '@/lib/content/captions';
import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';
import { resolveOutboundUrl } from '@/lib/outbound';
import type { AffiliateSettings } from '@/lib/settings';
import { shortProductName } from '@/lib/text';
import { piecePath, snapshotOf } from '@/lib/social/piece-url';
import {
  TELEGRAM_RULES,
  isOnSale,
  selectSocialProducts,
  type PickRules,
  type SocialProduct,
  type TelegramPick,
} from '@/lib/social/telegram';

/**
 * Instagram, Facebook y TikTok, que se programan desde Metricool.
 *
 * El sitio no habla con Metricool: prepara el plan (qué productos, con qué
 * texto y qué imagen) y anota lo que se programó. Quien programa es el
 * asistente conectado a Metricool, que llama a /api/social/plan, crea las
 * publicaciones y avisa a /api/social/registrar. Así el sitio no guarda
 * ninguna clave de las redes.
 *
 * A diferencia de Telegram, en estas redes un post publicado no se puede
 * corregir desde acá. Por eso nada se programa con más de dos días de
 * anticipación, y el plan avisa de lo que está programado y ya no calza con
 * el precio de hoy, para retirarlo antes de que salga.
 */

export const NETWORKS = ['instagram', 'facebook', 'tiktok'] as const;
export type Network = (typeof NETWORKS)[number];

/**
 * Canales que se pueden anotar: los de arriba y YouTube, que solo lleva
 * video. Telegram no: sus filas las maneja el bot, que edita los mensajes
 * según lo que diga social_posts.
 */
export const RECORD_CHANNELS = [...NETWORKS, 'youtube'] as const;
export type RecordChannel = (typeof RECORD_CHANNELS)[number];

export const NETWORK_RULES: PickRules & { repeatAfterDays: number } = {
  /** Metricool gratis da 20 publicaciones al mes, y cada red cuenta como una. */
  maxPosts: 2,
  perCategory: 2,
  /** Lo mismo que el sitio muestra como oferta. */
  minDiscount: MIN_DEAL_DISCOUNT,
  minDrop: TELEGRAM_RULES.minDrop,
  maxPriceAgeMs: TELEGRAM_RULES.maxPriceAgeMs,
  repeatAfterDays: 14,
};

/** Tope de productos por plan: más que esto no se alcanza a programar con cuidado. */
export const PLAN_MAX = 12;

/**
 * Con cuánta anticipación se puede programar. El precio de la imagen y del
 * texto es el de hoy: más allá de esto, lo más probable es que ya no rija.
 */
export const SCHEDULE_AHEAD_MS = 48 * 3600_000;

/** Cambio de precio desde el que un post programado ya no se debe publicar tal cual. */
const PRICE_CHANGE_THRESHOLD = 0.03;

/** TikTok corta el título de una publicación de fotos en 90 caracteres. */
const TIKTOK_TITLE_MAX = 90;
/** Metricool publica en TikTok textos de hasta 2.000 caracteres. */
const TIKTOK_TEXT_MAX = 2000;

/**
 * Productos que ya salieron (o están programados) en estas redes desde
 * `since`. null si la tabla social_posts todavía no existe.
 */
export async function postedOnNetworks(admin: SupabaseClient, since: Date): Promise<Set<string> | null> {
  const ids = new Set<string>();
  const { data, error } = await admin
    .from('social_posts')
    .select('product_id')
    .in('channel', [...RECORD_CHANNELS])
    .neq('status', 'error')
    .gte('posted_at', since.toISOString())
    .order('posted_at', { ascending: false })
    .limit(1000);
  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw new Error(`No se pudo leer social_posts: ${error.message}`);
  }
  for (const row of (data ?? []) as { product_id: string | null }[]) {
    if (row.product_id) ids.add(row.product_id);
  }
  return ids;
}

/**
 * Cuántas publicaciones de Metricool caen entre `from` y `to` (para la cuota
 * mensual). Solo las que tienen id de Metricool: lo marcado a mano desde el
 * admin no pasó por ahí.
 */
export async function countPostsBetween(admin: SupabaseClient, from: Date, to: Date): Promise<number | null> {
  const { count, error } = await admin
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .in('channel', [...RECORD_CHANNELS])
    .neq('status', 'error')
    .not('external_id', 'is', null)
    .gte('posted_at', from.toISOString())
    .lt('posted_at', to.toISOString());
  if (error) return null;
  return count ?? 0;
}

export interface PlanItem {
  id: string;
  slug: string;
  nombre: string;
  nombre_corto: string;
  marca: string | null;
  categoria: string;
  precio: number;
  precio_lista: number | null;
  descuento: number;
  baja_historial: number | null;
  comision_estimada: number;
  motivo: string;
  precio_revisado: string | null;
  /** Después de esta hora el precio ya no se puede dar por vigente: no programar más allá. */
  programar_antes_de: string;
  ficha: string;
  link_compra: string;
  /** La pieza en JPG (1080x1350), en una dirección pública y firmada. */
  pieza: string;
  /** La foto del producto tal como está en Mercado Libre, para armar un video. */
  foto: string;
  textos: Record<Network, string>;
  /**
   * Lo que va en `info` al crear cada publicación en Metricool (falta solo
   * publicationDate). Está acá y no en la cabeza de quien programa porque de
   * estos ajustes depende cumplir las reglas de cada red.
   */
  metricool: Record<Network, Record<string, unknown>>;
}

const TIKTOK_TITLE_PREFIX = 'Publicidad: ';

function tiktokTitle(p: SocialProduct): string {
  const price = formatPrice(p.price);
  const room = TIKTOK_TITLE_MAX - TIKTOK_TITLE_PREFIX.length - price.length - 3;
  return `${TIKTOK_TITLE_PREFIX}${shortProductName(p.name, room)} a ${price}`.slice(0, TIKTOK_TITLE_MAX);
}

/**
 * TikTok no respeta los saltos de línea al publicar desde Metricool: el
 * texto llegaría todo pegado y el aviso de la comisión quedaría mezclado
 * con los hashtags. Se arma en un solo párrafo, con el aviso primero.
 */
export function singleParagraph(text: string, max = TIKTOK_TEXT_MAX): string {
  const parts = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // Tras una frase que ya termina en punto basta un espacio: ". ·" parece un error.
  return parts
    .map((part, i) => (i === 0 ? part : `${/[.!?]$/.test(parts[i - 1]) ? ' ' : ' · '}${part}`))
    .join('')
    .slice(0, max);
}

/** Campos comunes de `info` en Metricool para una pieza de producto. */
function metricoolBase(network: Network, text: string, image: string, alt: string): Record<string, unknown> {
  return {
    autoPublish: true,
    draft: false,
    // Sin acortador: reescribiría el link de afiliado.
    shortener: false,
    smartLinkData: { ids: [] },
    descendants: [],
    firstCommentText: '',
    hasNotReadNotes: false,
    providers: [{ network }],
    text,
    media: [image],
    mediaAltText: [alt],
  };
}

/**
 * Los ajustes de cada red. La pieza lleva la foto real del producto: no es
 * contenido generado con IA. En TikTok un post con link de afiliado es
 * "contenido de marca" y tiene que llevar la etiqueta de contenido comercial
 * (y no puede ser privado).
 */
function metricoolSettings(
  p: SocialProduct,
  textos: Record<Network, string>,
  image: string
): Record<Network, Record<string, unknown>> {
  const alt = `${shortProductName(p.name)} a ${formatPrice(p.price)}`;
  return {
    instagram: {
      ...metricoolBase('instagram', textos.instagram, image, alt),
      instagramData: { type: 'POST', showReelOnFeed: true, collaborators: [], isAiGenerated: false },
    },
    facebook: {
      ...metricoolBase('facebook', textos.facebook, image, alt),
      facebookData: { type: 'POST' },
    },
    tiktok: {
      ...metricoolBase('tiktok', textos.tiktok, image, alt),
      tiktokData: {
        title: tiktokTitle(p),
        privacyOption: 'PUBLIC_TO_EVERYONE',
        commercialContentThirdParty: true,
        commercialContentOwnBrand: true,
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
        // La música al azar de TikTok no está despejada para publicidad.
        autoAddMusic: false,
        photoCoverIndex: 0,
        isAigc: false,
      },
    },
  };
}

/**
 * Todo lo que hace falta para programar un producto. null si no se pudo
 * firmar la imagen (datos imposibles): sin imagen no hay publicación.
 */
export function buildPlanItem(
  pick: TelegramPick<SocialProduct>,
  opts: { now: Date; siteUrl: string; settings: AffiliateSettings; key: Buffer }
): PlanItem | null {
  const p = pick.product;
  const site = opts.siteUrl.replace(/\/+$/, '');
  const feed = piecePath(snapshotOf(p, 'feed', opts.now), opts.key);
  if (!feed) return null;

  // El mismo destino que el botón del sitio.
  const link = resolveOutboundUrl(p, opts.settings);
  const caption = (channel: Network) => buildCaption(p, channel, { now: opts.now, siteUrl: site, link });
  const textos: Record<Network, string> = {
    instagram: caption('instagram'),
    facebook: caption('facebook'),
    tiktok: singleParagraph(caption('tiktok')),
  };
  const pieza = `${site}${feed}`;

  return {
    id: p.id,
    slug: p.slug,
    nombre: p.name,
    nombre_corto: shortProductName(p.name),
    marca: p.brand,
    categoria: p.category,
    precio: p.price,
    precio_lista: pick.discount > 0 ? p.original_price : null,
    descuento: pick.discount,
    baja_historial: pick.drop === null ? null : Math.round(pick.drop),
    comision_estimada: pick.commission,
    motivo: pick.reason,
    precio_revisado: p.price_checked_at,
    programar_antes_de: new Date(opts.now.getTime() + SCHEDULE_AHEAD_MS).toISOString(),
    ficha: `${site}/producto/${p.slug}`,
    link_compra: link,
    pieza,
    foto: mlPhotoJpg(p.image_url),
    textos,
    metricool: metricoolSettings(p, textos, pieza),
  };
}

// ---------------------------------------------------------------------------
// Registro de lo programado.

export interface PostRecord {
  productId: string;
  channel: RecordChannel;
  /** Cuándo sale la publicación. */
  at: Date;
  price: number | null;
  caption: string | null;
  /** uuid de la publicación en Metricool (su id cambia al editarla; el uuid no). */
  externalId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fecha con zona horaria explícita: sin ella, el servidor la leería como UTC. */
const WITH_OFFSET_RE = /(Z|[+-]\d{2}:\d{2})$/;
export const RECORDS_MAX = 60;
const CAPTION_MAX = 3000;
/** Se puede anotar algo publicado hace poco. */
const PAST_WINDOW_MS = 2 * 86_400_000;

type ParseResult = { ok: true; records: PostRecord[] } | { ok: false; error: string };

/** Valida el cuerpo de /api/social/registrar. Puro. */
export function parsePostRecords(body: unknown, now: Date): ParseResult {
  const list = (body as { publicaciones?: unknown } | null)?.publicaciones;
  if (!Array.isArray(list) || list.length === 0) return { ok: false, error: 'Falta la lista "publicaciones"' };
  if (list.length > RECORDS_MAX) return { ok: false, error: `Máximo ${RECORDS_MAX} publicaciones por llamada` };

  const records: PostRecord[] = [];
  for (const [i, raw] of list.entries()) {
    const where = `publicaciones[${i}]`;
    if (!raw || typeof raw !== 'object') return { ok: false, error: `${where}: no es un objeto` };
    const r = raw as Record<string, unknown>;

    const productId = typeof r.product_id === 'string' ? r.product_id.trim().toLowerCase() : '';
    if (!UUID_RE.test(productId)) return { ok: false, error: `${where}: product_id no válido` };

    const channel = r.canal as RecordChannel;
    if (!RECORD_CHANNELS.includes(channel)) return { ok: false, error: `${where}: canal no válido` };

    const when = typeof r.programado_para === 'string' ? r.programado_para.trim() : '';
    if (!WITH_OFFSET_RE.test(when)) {
      return { ok: false, error: `${where}: programado_para debe llevar zona horaria (por ejemplo 2026-10-11T10:00:00-03:00)` };
    }
    const at = new Date(when);
    const t = at.getTime();
    if (!Number.isFinite(t)) return { ok: false, error: `${where}: programado_para no es una fecha` };
    if (t < now.getTime() - PAST_WINDOW_MS) return { ok: false, error: `${where}: programado_para es de hace más de dos días` };
    if (t > now.getTime() + SCHEDULE_AHEAD_MS) {
      return { ok: false, error: `${where}: no se programa con más de 48 horas de anticipación (el precio cambia)` };
    }

    let price: number | null = null;
    if (r.precio !== undefined && r.precio !== null) {
      // posted_price es un entero de 32 bits en la base.
      if (typeof r.precio !== 'number' || !Number.isSafeInteger(r.precio) || r.precio <= 0 || r.precio > 2_147_483_647) {
        return { ok: false, error: `${where}: precio no válido` };
      }
      price = r.precio;
    }

    let caption: string | null = null;
    if (r.texto !== undefined && r.texto !== null) {
      if (typeof r.texto !== 'string' || r.texto.length > CAPTION_MAX) return { ok: false, error: `${where}: texto no válido` };
      caption = r.texto;
    }

    // Obligatorio: sin él no hay cómo saber si la publicación ya se anotó,
    // ni cómo retirarla de Metricool si el precio cambia.
    const externalId =
      typeof r.metricool_id === 'string' || typeof r.metricool_id === 'number' ? String(r.metricool_id).trim() : '';
    if (!/^[\w-]{1,80}$/.test(externalId)) return { ok: false, error: `${where}: falta metricool_id (el uuid de la publicación)` };

    records.push({ productId, channel, at, price, caption, externalId });
  }
  return { ok: true, records };
}

export interface RegisterResult {
  registradas: number;
  /** Ya anotadas que cambiaron (otra fecha, otro precio) o que se habían retirado. */
  actualizadas: number;
  repetidas: number;
  productos: number;
  /** Productos que no existen o no están a la venta: no se anotan. */
  rechazados: string[];
}

interface ExistingPost {
  id: number;
  channel: string;
  external_id: string | null;
  product_id: string | null;
  posted_price: number | null;
  caption: string | null;
  status: string;
  posted_at: string;
}

/**
 * Anota las publicaciones y marca los productos, para que /hoy (el link de
 * la bio) los muestre y la selección no los repita.
 *
 * Una publicación ya anotada (mismo canal e id de Metricool) no se duplica:
 * si viene igual se salta, y si cambió algo (se editó en Metricool, que
 * conserva el uuid, o se había retirado) se actualiza su fila.
 */
export async function registerPosts(admin: SupabaseClient, records: PostRecord[], now: Date): Promise<RegisterResult> {
  const ids = [...new Set(records.map((r) => r.productId))];
  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', ids));
  if (read.error) throw new Error(`No se pudo leer los productos: ${read.error}`);
  // Solo lo que está a la venta y visible: lo demás no se promociona.
  const onSale = new Map(read.rows.filter((p) => isOnSale(p)).map((p) => [p.id, p]));
  const rechazados = ids.filter((id) => !onSale.has(id));
  // Sin precio no se podría avisar si cambia antes de que salga: se toma el de ahora.
  const valid = records
    .filter((r) => onSale.has(r.productId))
    .map((r) => ({ ...r, price: r.price ?? onSale.get(r.productId)?.price ?? null }));

  const existing = new Map<string, ExistingPost>();
  const externalIds = [...new Set(valid.map((r) => r.externalId))];
  if (externalIds.length > 0) {
    const { data, error } = await admin
      .from('social_posts')
      .select('id, channel, external_id, product_id, posted_price, caption, status, posted_at')
      .in('external_id', externalIds);
    if (error) throw new Error(`No se pudo leer social_posts: ${error.message}`);
    for (const row of (data ?? []) as ExistingPost[]) existing.set(`${row.channel}|${row.external_id}`, row);
  }

  const fresh: PostRecord[] = [];
  const changed: { id: number; record: PostRecord; caption: string | null }[] = [];
  const seen = new Set<string>();
  let repetidas = 0;
  for (const r of valid) {
    const key = `${r.channel}|${r.externalId}`;
    if (seen.has(key)) {
      repetidas++;
      continue;
    }
    seen.add(key);

    const row = existing.get(key);
    if (!row) {
      fresh.push(r);
      continue;
    }
    // Lo que no viene (el texto) se conserva de la fila.
    const caption = r.caption ?? row.caption;
    const same =
      row.status === 'publicado' &&
      row.product_id === r.productId &&
      new Date(row.posted_at).getTime() === r.at.getTime() &&
      row.posted_price === r.price &&
      row.caption === caption;
    if (same) repetidas++;
    else changed.push({ id: row.id, record: r, caption });
  }

  // Los productos primero: si después falla la escritura de las
  // publicaciones, repetir la llamada completa lo deja todo bien. Al revés,
  // el reintento las vería ya anotadas y los productos quedarían sin marcar.
  const first = new Map<string, PostRecord>();
  for (const r of [...fresh, ...changed.map((c) => c.record)]) {
    const current = first.get(r.productId);
    if (!current || r.at < current.at) first.set(r.productId, r);
  }
  for (const [productId, r] of first) {
    const { error } = await admin
      .from('products')
      .update({ rrss_status: 'publicado', rrss_published_at: r.at.toISOString(), rrss_channel: r.channel })
      .eq('id', productId);
    if (error) throw new Error(`No se pudo marcar el producto ${productId}: ${error.message}`);
  }

  if (fresh.length > 0) {
    const { error } = await admin.from('social_posts').insert(
      fresh.map((r) => ({
        product_id: r.productId,
        channel: r.channel,
        external_id: r.externalId,
        posted_price: r.price,
        caption: r.caption,
        status: 'publicado',
        posted_at: r.at.toISOString(),
      }))
    );
    if (error) throw new Error(`No se pudo anotar en social_posts: ${error.message}`);
  }

  for (const { id, record: r, caption } of changed) {
    const { error } = await admin
      .from('social_posts')
      .update({
        product_id: r.productId,
        posted_price: r.price,
        caption,
        status: 'publicado',
        error: null,
        posted_at: r.at.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(`No se pudo actualizar la publicación ${r.externalId}: ${error.message}`);
  }

  return {
    registradas: fresh.length,
    actualizadas: changed.length,
    repetidas,
    productos: first.size,
    rechazados,
  };
}

export interface Retirement {
  channel: RecordChannel;
  externalId: string;
}

type RetireParse = { ok: true; items: Retirement[] } | { ok: false; error: string };

/** Valida la lista "retiradas" de /api/social/registrar. Puro. */
export function parseRetirements(body: unknown): RetireParse {
  const list = (body as { retiradas?: unknown } | null)?.retiradas;
  if (list === undefined || list === null) return { ok: true, items: [] };
  if (!Array.isArray(list) || list.length > RECORDS_MAX) return { ok: false, error: 'La lista "retiradas" no es válida' };

  const items: Retirement[] = [];
  for (const [i, raw] of list.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const channel = r.canal as RecordChannel;
    if (!RECORD_CHANNELS.includes(channel)) return { ok: false, error: `retiradas[${i}]: canal no válido` };
    const externalId =
      typeof r.metricool_id === 'string' || typeof r.metricool_id === 'number' ? String(r.metricool_id).trim() : '';
    if (!/^[\w-]{1,80}$/.test(externalId)) return { ok: false, error: `retiradas[${i}]: falta metricool_id` };
    items.push({ channel, externalId });
  }
  return { ok: true, items };
}

/**
 * Marca como no publicadas las que se sacaron de Metricool (o que Metricool
 * no publicó): dejan de contar para "ya publicado", así el producto puede
 * volver a salir. Solo toca filas de estas redes, nunca las de Telegram.
 *
 * El producto deja de figurar como publicado si no le queda ninguna otra
 * publicación vigente; si le queda, toma la fecha y el canal de la última.
 */
export async function retirePosts(admin: SupabaseClient, items: Retirement[], now: Date): Promise<number> {
  let retired = 0;
  const products = new Set<string>();
  for (const item of items) {
    const { data, error } = await admin
      .from('social_posts')
      .update({ status: 'error', error: 'Retirada de Metricool', updated_at: now.toISOString() })
      .eq('channel', item.channel)
      .eq('external_id', item.externalId)
      .neq('status', 'error')
      .select('id, product_id');
    if (error) throw new Error(`No se pudo retirar ${item.externalId}: ${error.message}`);
    for (const row of (data ?? []) as { id: number; product_id: string | null }[]) {
      retired++;
      if (row.product_id) products.add(row.product_id);
    }
  }

  for (const productId of products) {
    const { data, error } = await admin
      .from('social_posts')
      .select('channel, posted_at')
      .eq('product_id', productId)
      .neq('status', 'error')
      .order('posted_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`No se pudo leer social_posts: ${error.message}`);
    const last = ((data ?? []) as { channel: string; posted_at: string }[])[0];
    const patch = last
      ? { rrss_status: 'publicado', rrss_published_at: last.posted_at, rrss_channel: last.channel }
      : { rrss_status: 'sin_usar', rrss_published_at: null, rrss_channel: null };
    const { error: stampError } = await admin.from('products').update(patch).eq('id', productId);
    if (stampError) throw new Error(`No se pudo marcar el producto ${productId}: ${stampError.message}`);
  }
  return retired;
}

// ---------------------------------------------------------------------------
// Lo programado que ya no calza con el sitio.

export interface PendingIssue {
  metricool_id: string | null;
  canal: string;
  product_id: string | null;
  nombre: string | null;
  programado_para: string;
  precio_anotado: number | null;
  precio_actual: number | null;
  motivo: string;
}

interface PendingRow {
  product_id: string | null;
  channel: string;
  external_id: string | null;
  posted_price: number | null;
  posted_at: string;
}

/** Qué anda mal con una publicación programada, o null si sigue vigente. Puro. */
export function pendingIssue(
  post: Pick<PendingRow, 'posted_price'>,
  product: Pick<SocialProduct, 'price' | 'is_active' | 'is_hidden' | 'deleted_at'> | null | undefined
): string | null {
  if (!isOnSale(product)) return 'El producto ya no está a la venta en el sitio';
  const posted = post.posted_price ?? 0;
  if (posted > 0 && Math.abs(product.price - posted) / posted >= PRICE_CHANGE_THRESHOLD) {
    return product.price > posted ? 'El precio subió desde que se programó' : 'El precio bajó desde que se programó';
  }
  return null;
}

/**
 * Publicaciones programadas (todavía no salen) cuyo producto dejó de venderse
 * o cambió de precio 3% o más: hay que retirarlas o rehacerlas en Metricool
 * antes de su hora. En Telegram esto lo corrige el bot; acá no hay cómo
 * editar un post ya publicado.
 */
export async function readPendingIssues(admin: SupabaseClient, now: Date): Promise<PendingIssue[]> {
  const { data, error } = await admin
    .from('social_posts')
    .select('product_id, channel, external_id, posted_price, posted_at')
    .in('channel', [...RECORD_CHANNELS])
    .eq('status', 'publicado')
    .gt('posted_at', now.toISOString())
    .order('posted_at', { ascending: true })
    .limit(200);
  if (error) {
    if (isMissingSchemaError(error)) return [];
    throw new Error(`No se pudo leer social_posts: ${error.message}`);
  }
  const posts = (data ?? []) as PendingRow[];
  if (posts.length === 0) return [];

  const ids = [...new Set(posts.map((p) => p.product_id).filter((id): id is string => Boolean(id)))];
  const read = ids.length
    ? await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', ids))
    : { rows: [] as SocialProduct[], has0017: false, error: null };
  if (read.error) throw new Error(`No se pudo leer los productos: ${read.error}`);
  const byId = new Map(read.rows.map((p) => [p.id, p]));

  const issues: PendingIssue[] = [];
  for (const post of posts) {
    const product = post.product_id ? byId.get(post.product_id) ?? null : null;
    const motivo = pendingIssue(post, product);
    if (!motivo) continue;
    issues.push({
      metricool_id: post.external_id,
      canal: post.channel,
      product_id: post.product_id,
      nombre: product?.name ?? null,
      programado_para: post.posted_at,
      precio_anotado: post.posted_price,
      precio_actual: product?.price ?? null,
      motivo,
    });
  }
  return issues;
}
