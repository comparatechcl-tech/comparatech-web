import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { buildCaption, captionDiscount, mlPhotoJpg, type CaptionProduct } from '@/lib/content/captions';
import { estimateCommission } from '@/lib/commission';
import { resolveOutboundUrl } from '@/lib/outbound';
import { readAffiliateSettings, type AffiliateSettings } from '@/lib/settings';
import { shortProductName } from '@/lib/text';
import { SITE_URL } from '@/lib/site';

/**
 * Canal de Telegram que se publica solo.
 *
 * Es el único canal de redes que se puede automatizar sin pedir permisos a
 * una plataforma: un bot publica las mejores ofertas del día (ver
 * /api/cron/social-telegram) y después mantiene los posts al día. Un post
 * con un precio que ya no existe es peor que no publicar: quien llega a ML
 * y ve otro precio no vuelve a confiar en el canal. Por eso, durante 7
 * días, si el precio se mueve 3% o más se corrige el texto, y si la oferta
 * termina el post lo dice y pierde el botón.
 *
 * Sin TELEGRAM_BOT_TOKEN o TELEGRAM_CHANNEL_ID no hace nada: el resto del
 * sitio funciona igual. El token vive solo en las variables de entorno,
 * nunca en site_settings (que es de lectura pública).
 */

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_CHANNEL_ID?.trim();
  return token && chatId ? { token, chatId } : null;
}

/** Telegram corta los pies de foto en 1024 caracteres. */
export const TELEGRAM_CAPTION_MAX = 1024;
export const TELEGRAM_BUTTON_TEXT = 'Ver oferta en Mercado Libre';
// No dice "oferta terminada": el post también se cierra cuando el producto
// se ocultó o se sacó del sitio con el precio intacto.
export const TELEGRAM_ENDED_TEXT = '⚠️ Publicación retirada';

const API_TIMEOUT_MS = 10_000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Pie de foto en HTML, dentro del máximo de Telegram. Si no cabe, se saca
 * primero el link a la ficha (el botón ya lleva a la compra); el aviso de
 * publicidad no se corta nunca.
 */
export function telegramCaption(product: CaptionProduct, link: string, now: Date): string {
  const text = buildCaption(product, 'telegram', { now, siteUrl: SITE_URL, link });
  const html = escapeHtml(text);
  if (html.length <= TELEGRAM_CAPTION_MAX) return html;
  const withoutSite = text
    .split('\n')
    .filter((line) => !line.startsWith('🔎'))
    .join('\n');
  return escapeHtml(withoutSite).slice(0, TELEGRAM_CAPTION_MAX);
}

/** Texto del post cuando el producto ya no está a la venta (o se sacó del sitio). */
export function endedCaption(product: Pick<CaptionProduct, 'name'> | null): string {
  const lines = [TELEGRAM_ENDED_TEXT];
  if (product) lines.push(escapeHtml(shortProductName(product.name)));
  lines.push('Ya no mostramos este producto. Revisa las publicaciones más recientes del canal.');
  return lines.join('\n');
}

type ApiResult<T> = { ok: true; result: T } | { ok: false; error: string };

async function callApi<T>(cfg: TelegramConfig, method: string, body: Record<string, unknown>): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: boolean; result?: T; description?: string }
      | null;
    if (json?.ok && json.result !== undefined) return { ok: true, result: json.result };
    // La descripción de Telegram nunca incluye el token: se puede guardar.
    return { ok: false, error: json?.description ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Telegram no respondió' };
  }
}

function buyButton(url: string) {
  return { inline_keyboard: [[{ text: TELEGRAM_BUTTON_TEXT, url }]] };
}

/**
 * Publica la foto con su texto y el botón de compra. Si Telegram no logra
 * bajar la foto de ML, publica el texto solo: el post vale por el precio y
 * el link, no por la imagen.
 */
export async function sendPhoto(
  cfg: TelegramConfig,
  post: { photoUrl: string; caption: string; buttonUrl: string }
): Promise<{ ok: true; messageId: number } | { ok: false; error: string }> {
  const photo = await callApi<{ message_id: number }>(cfg, 'sendPhoto', {
    chat_id: cfg.chatId,
    photo: mlPhotoJpg(post.photoUrl),
    caption: post.caption,
    parse_mode: 'HTML',
    reply_markup: buyButton(post.buttonUrl),
  });
  if (photo.ok) return { ok: true, messageId: photo.result.message_id };

  const text = await callApi<{ message_id: number }>(cfg, 'sendMessage', {
    chat_id: cfg.chatId,
    text: post.caption,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: buyButton(post.buttonUrl),
  });
  if (text.ok) return { ok: true, messageId: text.result.message_id };
  return { ok: false, error: `${photo.error} / ${text.error}` };
}

/**
 * Cambia el texto de un post. Sin buttonUrl el botón se quita (un array
 * vacío es la forma de sacarlo). Si el post se publicó como texto porque la
 * foto falló, se edita el texto en vez del pie de foto.
 */
export async function editMessageCaption(
  cfg: TelegramConfig,
  messageId: number,
  caption: string,
  buttonUrl: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const markup = buttonUrl ? buyButton(buttonUrl) : { inline_keyboard: [] };
  const result = await callApi<unknown>(cfg, 'editMessageCaption', {
    chat_id: cfg.chatId,
    message_id: messageId,
    caption,
    parse_mode: 'HTML',
    reply_markup: markup,
  });
  if (result.ok || /not modified/i.test(result.error)) return { ok: true };
  if (/no caption|there is no caption/i.test(result.error)) {
    const text = await callApi<unknown>(cfg, 'editMessageText', {
      chat_id: cfg.chatId,
      message_id: messageId,
      text: caption,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: markup,
    });
    if (text.ok || /not modified/i.test(text.error)) return { ok: true };
    return { ok: false, error: text.error };
  }
  return { ok: false, error: result.error };
}

// ---------------------------------------------------------------------------
// Lectura de productos con migraciones que pueden faltar.

/** Columnas que necesitan el texto, el botón y la selección. */
export const SOCIAL_BASE_COLUMNS = [
  'id',
  'slug',
  'name',
  'brand',
  'category',
  'price',
  'original_price',
  'image_url',
  'affiliate_url',
  'ml_product_id',
  'ml_family_id',
  'price_checked_at',
  'seller_reputation',
  'seller_sales_count',
  'is_active',
  'is_hidden',
].join(',');

const COLUMNS_0016 = 'offer_info,ml_root_category';
const COLUMNS_0017 = 'deleted_at,rrss_published_at,rrss_channel';

export interface SocialProduct extends CaptionProduct {
  brand: string | null;
  category: string;
  image_url: string;
  affiliate_url: string;
  ml_product_id: string | null;
  ml_family_id?: string | null;
  is_active: boolean;
  is_hidden: boolean;
  ml_root_category?: string | null;
  deleted_at?: string | null;
  rrss_published_at?: string | null;
  rrss_channel?: string | null;
}

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

/**
 * Prueba de la lectura más completa a la mínima. `has0017` dice si la
 * consulta puede filtrar por deleted_at y las columnas de redes.
 */
export async function selectSocialProducts(
  run: (columns: string, has0017: boolean) => PromiseLike<QueryResult>
): Promise<{ rows: SocialProduct[]; has0017: boolean; error: string | null }> {
  const tiers = [
    { columns: `${SOCIAL_BASE_COLUMNS},${COLUMNS_0016},${COLUMNS_0017}`, has0017: true },
    { columns: `${SOCIAL_BASE_COLUMNS},${COLUMNS_0016}`, has0017: false },
    { columns: `${SOCIAL_BASE_COLUMNS},${COLUMNS_0017}`, has0017: true },
    { columns: SOCIAL_BASE_COLUMNS, has0017: false },
  ];
  let last: QueryResult = { data: null, error: null };
  for (const tier of tiers) {
    last = await run(tier.columns, tier.has0017);
    if (last.error && isMissingSchemaError(last.error)) continue;
    if (last.error) return { rows: [], has0017: tier.has0017, error: last.error.message };
    return { rows: (last.data ?? []) as SocialProduct[], has0017: tier.has0017, error: null };
  }
  return { rows: [], has0017: false, error: last.error?.message ?? null };
}

/** ¿El producto sigue a la venta y visible en el sitio? */
export function isOnSale<T extends Pick<SocialProduct, 'is_active' | 'is_hidden' | 'deleted_at'>>(
  p: T | null | undefined
): p is T {
  return Boolean(p && p.is_active && !p.is_hidden && !p.deleted_at);
}

// ---------------------------------------------------------------------------
// Selección de lo que se publica.

export const TELEGRAM_RULES = {
  maxPosts: 5,
  minPosts: 3,
  perCategory: 2,
  /** Descuento mínimo sobre el precio de lista. */
  minDiscount: 15,
  /** Baja mínima según el historial propio, para los que no llegan al descuento. */
  minDrop: 5,
  /** Un precio revisado hace más que esto puede no ser el de hoy. */
  maxPriceAgeMs: 6 * 3600_000,
  /** No se repite un producto en el canal antes de esto. */
  repeatAfterDays: 14,
};

export interface TelegramPick<T> {
  product: T;
  discount: number;
  drop: number | null;
  commission: number;
  reason: string;
}

/**
 * Elige qué publicar: precio fresco, una rebaja que valga la pena (o una
 * baja confirmada por el historial), nada repetido en 14 días y como mucho
 * dos por categoría, para que el canal no sean cinco audífonos seguidos.
 * Entre los que califican van primero los que más comisión dejan.
 *
 * Puro: recibe las bajas ya calculadas (drops, en %).
 */
export function pickForTelegram<T extends SocialProduct>(
  rows: T[],
  opts: { now: Date; recentlyPosted: Set<string>; drops?: Map<string, number> }
): TelegramPick<T>[] {
  const now = opts.now.getTime();
  const eligible: TelegramPick<T>[] = [];

  for (const p of rows) {
    if (!isOnSale(p) || opts.recentlyPosted.has(p.id)) continue;
    const checked = p.price_checked_at ? new Date(p.price_checked_at).getTime() : NaN;
    if (!Number.isFinite(checked) || now - checked > TELEGRAM_RULES.maxPriceAgeMs || checked > now + 60_000) continue;

    const discount = captionDiscount(p);
    const drop = opts.drops?.get(p.id) ?? null;
    const byDiscount = discount >= TELEGRAM_RULES.minDiscount;
    const byDrop = drop !== null && drop >= TELEGRAM_RULES.minDrop;
    if (!byDiscount && !byDrop) continue;

    eligible.push({
      product: p,
      discount,
      drop,
      commission: estimateCommission(p.price, p.ml_root_category ?? null),
      reason: byDiscount ? `-${discount}% sobre precio de lista` : `bajó ${Math.round(drop ?? 0)}% según historial`,
    });
  }

  eligible.sort((a, b) => b.commission - a.commission || b.discount - a.discount);

  const perCategory = new Map<string, number>();
  // Dos colores del mismo modelo serían el mismo post repetido.
  const families = new Set<string>();
  const picked: TelegramPick<T>[] = [];
  for (const item of eligible) {
    if (picked.length >= TELEGRAM_RULES.maxPosts) break;
    const family = item.product.ml_family_id;
    if (family && families.has(family)) continue;
    const used = perCategory.get(item.product.category) ?? 0;
    if (used >= TELEGRAM_RULES.perCategory) continue;
    perCategory.set(item.product.category, used + 1);
    if (family) families.add(family);
    picked.push(item);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Mantenimiento de los posts publicados.

/** Ventana en que se corrigen los posts. Después ya nadie los mira. */
const SYNC_WINDOW_DAYS = 7;
/** Cambio de precio desde el que se corrige el texto. */
const PRICE_CHANGE_THRESHOLD = 0.03;
/**
 * Ediciones por corrida. Corre con el refresco de precios (cada 30 min):
 * pocas por vez mantienen el cron dentro de su tiempo y lejos del límite
 * de Telegram de 20 mensajes por minuto por canal.
 */
const MAX_EDITS_PER_RUN = 8;
const EDIT_SPACING_MS = 400;

interface PostRow {
  id: number;
  product_id: string | null;
  external_id: string | null;
  posted_price: number | null;
}

/**
 * Un post borrado a mano en el canal no se puede editar nunca más: se marca
 * como error para no reintentarlo en cada corrida. Lo demás (Telegram caído,
 * límite de mensajes) se reintenta la próxima vez.
 */
function failedEdit(error: string, now: Date): Record<string, unknown> {
  const permanent = /not found|can't be edited|message_id_invalid|chat not found/i.test(error);
  return permanent
    ? { status: 'error', error, updated_at: now.toISOString() }
    : { error, updated_at: now.toISOString() };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function syncTelegramPosts(
  admin: SupabaseClient,
  opts: { now?: Date; maxEdits?: number; spacingMs?: number } = {}
): Promise<{ edited: number; skipped?: string }> {
  const cfg = telegramConfig();
  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) return { edited: 0, skipped: 'Falta TELEGRAM_BOT_TOKEN' };
  if (!cfg) return { edited: 0, skipped: 'Falta TELEGRAM_CHANNEL_ID' };

  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - SYNC_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('social_posts')
    .select('id, product_id, external_id, posted_price')
    .eq('channel', 'telegram')
    .in('status', ['publicado', 'editado'])
    .not('external_id', 'is', null)
    .gte('posted_at', since)
    .order('posted_at', { ascending: false });
  if (error) {
    if (isMissingSchemaError(error)) return { edited: 0, skipped: 'Falta la tabla social_posts (migración 0017)' };
    return { edited: 0, skipped: `No se pudo leer social_posts: ${error.message}` };
  }

  const posts = ((data ?? []) as PostRow[]).filter((p) => Number.isFinite(Number(p.external_id)));
  if (posts.length === 0) return { edited: 0 };

  const ids = [...new Set(posts.map((p) => p.product_id).filter((id): id is string => Boolean(id)))];
  const read = ids.length
    ? await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', ids))
    : { rows: [] as SocialProduct[], has0017: false, error: null };
  if (read.error) return { edited: 0, skipped: `No se pudo leer los productos: ${read.error}` };
  const byId = new Map(read.rows.map((p) => [p.id, p]));

  let settings: AffiliateSettings | null = null;
  const maxEdits = opts.maxEdits ?? MAX_EDITS_PER_RUN;
  const spacing = opts.spacingMs ?? EDIT_SPACING_MS;
  let edited = 0;
  let attempts = 0;

  for (const post of posts) {
    if (attempts >= maxEdits) break;
    const product = post.product_id ? byId.get(post.product_id) ?? null : null;
    const messageId = Number(post.external_id);

    if (!isOnSale(product)) {
      const caption = endedCaption(product);
      attempts++;
      const result = await editMessageCaption(cfg, messageId, caption, null);
      await admin
        .from('social_posts')
        .update(
          result.ok
            ? { status: 'terminado', caption, updated_at: now.toISOString(), error: null }
            : failedEdit(result.error, now)
        )
        .eq('id', post.id);
      if (result.ok) edited++;
      await sleep(spacing);
      continue;
    }

    const posted = post.posted_price ?? 0;
    const changed = posted <= 0 || Math.abs(product.price - posted) / posted >= PRICE_CHANGE_THRESHOLD;
    if (!changed) continue;

    settings ??= await readAffiliateSettings(admin);
    const link = resolveOutboundUrl(product, settings);
    const caption = telegramCaption(product, link, now);
    attempts++;
    const result = await editMessageCaption(cfg, messageId, caption, link);
    await admin
      .from('social_posts')
      .update(
        result.ok
          ? { status: 'editado', caption, posted_price: product.price, updated_at: now.toISOString(), error: null }
          : failedEdit(result.error, now)
      )
      .eq('id', post.id);
    if (result.ok) edited++;
    await sleep(spacing);
  }

  return { edited };
}
