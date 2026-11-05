import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chileDateKey, chileDayStart } from '@/lib/clicks';
import { buildVideoTexts } from '@/lib/content/captions';
import { addDays, chileDay } from '@/lib/social/carousel-url';
import { META_DAILY_KEY, type DailyState } from '@/lib/social/meta-daily';
import { NETWORK_RULES, VIDEO_MARK, singleParagraph } from '@/lib/social/networks';
import { isOnSale, selectSocialProducts, type SocialProduct } from '@/lib/social/telegram';

/**
 * El video del día para TikTok y YouTube Shorts (letra D del plan, aprobada
 * por el dueño el 03-11-2026).
 *
 * Es el mismo reel que ese día salió solo en Instagram y Facebook
 * (lib/social/meta-daily). Lo programa en Metricool la tarea de Claude
 * "comparatech-feed-automatico", que corre en el PC del dueño: Metricool no
 * tiene API en el plan gratis, y su conector solo existe en Claude.
 *
 * Reglas:
 * - solo el reel de hoy, y solo si ya salió en Instagram o Facebook;
 * - el producto sigue a la venta, con el mismo precio que muestra el video y
 *   el precio revisado hace poco;
 * - cada red, a lo más 1 video al día (YouTube castiga los Shorts casi
 *   iguales hechos en serie) y el mismo producto no se repite en 14 días;
 * - sin pasar las publicaciones gratis del mes en Metricool.
 *
 * Solo lee: anotar lo programado lo hace /api/social/registrar, con el texto
 * 'video' (la marca de video, igual que "Ya lo subí" en /admin/videos).
 */

export const SHORTS_NETWORKS = ['tiktok', 'youtube'] as const;
export type ShortsNetwork = (typeof SHORTS_NETWORKS)[number];

/** Las publicaciones gratis al mes de Metricool. Hoy solo TikTok y YouTube pasan por ahí. */
export const METRICOOL_MONTHLY_FREE = 20;
/** Días sin repetir el mismo producto en una red (igual que /admin/videos). */
export const SHORTS_REPEAT_DAYS = 14;

export interface ShortsPost {
  red: ShortsNetwork;
  /** El objeto `info` de createScheduledPost, completo (sin publicationDate). */
  metricool: Record<string, unknown>;
  texto: string;
}

export interface ShortsPlan {
  listo: boolean;
  /** Por qué no hay nada que programar (si listo es false). */
  motivo?: string;
  producto?: { id: string; nombre: string; precio: number };
  video?: string;
  publicaciones: ShortsPost[];
  /** Lo que se dejó fuera, red por red. */
  omitidas: { red: ShortsNetwork; motivo: string }[];
  programadas_este_mes: number | null;
  cupo_mes: number;
}

/** Los campos comunes de `info` para un video. Sin acortador: reescribiría los links. */
function videoBase(network: ShortsNetwork, text: string, videoUrl: string): Record<string, unknown> {
  return {
    autoPublish: true,
    draft: false,
    shortener: false,
    smartLinkData: { ids: [] },
    descendants: [],
    firstCommentText: '',
    hasNotReadNotes: false,
    providers: [{ network }],
    text,
    media: [videoUrl],
    mediaAltText: [],
  };
}

/**
 * Lo que se manda a Metricool para cada red.
 *
 * TikTok: un video con link de compra es contenido de marca, así que lleva
 * el interruptor de contenido comercial (CLAUDE.md: en TikTok sigue el de la
 * plataforma) y es público. La música ya viene en el video: sin la música al
 * azar de TikTok, que no está despejada para publicidad. El video lleva la
 * foto real del producto: no es contenido hecho con IA.
 *
 * YouTube: un Short público, no hecho para niños. Sin portada propia: Metricool
 * rechaza el pedido entero si el canal no está verificado.
 */
export function shortsMetricoolInfo(
  network: ShortsNetwork,
  videoUrl: string,
  texts: { tiktok: string; youtubeTitle: string; youtubeDescription: string }
): Record<string, unknown> {
  if (network === 'tiktok') {
    return {
      ...videoBase('tiktok', texts.tiktok, videoUrl),
      tiktokData: {
        privacyOption: 'PUBLIC_TO_EVERYONE',
        commercialContentThirdParty: true,
        commercialContentOwnBrand: true,
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
        autoAddMusic: false,
        isAigc: false,
      },
    };
  }
  return {
    ...videoBase('youtube', texts.youtubeDescription, videoUrl),
    youtubeData: {
      title: texts.youtubeTitle,
      type: 'short',
      privacy: 'public',
      tags: [],
      category: 'SCIENCE_TECHNOLOGY',
      madeForKids: false,
      isAiGeneratedContent: false,
    },
  };
}

/** Una marca de video ya anotada en TikTok o YouTube. */
export interface ShortsMark {
  channel: string;
  productId: string | null;
  postedAt: string;
}

export interface ShortsInput {
  now: Date;
  siteUrl: string;
  state: DailyState | null;
  /** El producto del reel de hoy, como está ahora (null si no se encontró). */
  product: SocialProduct | null;
  /** Las marcas de video en TikTok y YouTube de los últimos 14 días. */
  marks: ShortsMark[];
  /** Lo programado este mes en TikTok y YouTube, o null si no se pudo contar. */
  monthCount: number | null;
}

const empty = (motivo: string, monthCount: number | null): ShortsPlan => ({
  listo: false,
  motivo,
  publicaciones: [],
  omitidas: [],
  programadas_este_mes: monthCount,
  cupo_mes: METRICOOL_MONTHLY_FREE,
});

/** Qué programar hoy, con lo ya leído. Puro. */
export function planShorts(input: ShortsInput): ShortsPlan {
  const { now, state, product, marks, monthCount } = input;
  const today = chileDay(now);
  if (!state || state.day !== today) return empty('Hoy todavía no sale el reel diario en Instagram ni Facebook.', monthCount);
  if (state.instagram?.status !== 'publicado' && state.facebook?.status !== 'publicado') {
    return empty('El reel de hoy todavía no está publicado en Instagram ni en Facebook.', monthCount);
  }
  if (!state.videoUrl?.startsWith('https://')) return empty('El reel de hoy no tiene la dirección del video.', monthCount);
  if (!product || !isOnSale(product)) return empty('El producto del reel ya no está a la venta en el sitio.', monthCount);
  if (product.price !== state.price) {
    return empty('El precio cambió desde que se armó el video: el video ya no dice la verdad.', monthCount);
  }
  const checked = product.price_checked_at ? new Date(product.price_checked_at).getTime() : NaN;
  if (!Number.isFinite(checked) || now.getTime() - checked > NETWORK_RULES.maxPriceAgeMs) {
    return empty('El precio del producto no se revisó hace poco.', monthCount);
  }
  if (monthCount === null) return empty('No se pudo contar lo programado este mes en Metricool.', monthCount);

  const built = buildVideoTexts(product, now, input.siteUrl);
  // TikTok no respeta los saltos de línea cuando publica Metricool: un solo párrafo.
  const texts = { ...built, tiktok: singleParagraph(built.tiktok) };
  const since = addDays(today, -SHORTS_REPEAT_DAYS);
  const plan: ShortsPlan = {
    listo: false,
    producto: { id: product.id, nombre: state.name, precio: product.price },
    video: state.videoUrl,
    publicaciones: [],
    omitidas: [],
    programadas_este_mes: monthCount,
    cupo_mes: METRICOOL_MONTHLY_FREE,
  };
  let used = monthCount;
  for (const red of SHORTS_NETWORKS) {
    const mine = marks.filter((m) => m.channel === red);
    if (mine.some((m) => chileDay(new Date(m.postedAt)) === today)) {
      plan.omitidas.push({ red, motivo: 'hoy ya salió un video en esta red' });
      continue;
    }
    if (mine.some((m) => m.productId === product.id && chileDay(new Date(m.postedAt)) >= since)) {
      plan.omitidas.push({ red, motivo: `este producto ya salió en esta red en los últimos ${SHORTS_REPEAT_DAYS} días` });
      continue;
    }
    if (used + 1 > METRICOOL_MONTHLY_FREE) {
      plan.omitidas.push({ red, motivo: `se acabaría el cupo gratis del mes (${METRICOOL_MONTHLY_FREE})` });
      continue;
    }
    used += 1;
    plan.publicaciones.push({
      red,
      metricool: shortsMetricoolInfo(red, state.videoUrl, texts),
      texto: red === 'tiktok' ? texts.tiktok : texts.youtubeDescription,
    });
  }
  plan.listo = plan.publicaciones.length > 0;
  if (!plan.listo) plan.motivo = 'Hoy no queda ninguna red en la que se pueda programar.';
  return plan;
}

/** La medianoche del día 1 del mes de `now`, en Chile. */
export function chileMonthStart(now: Date): Date {
  return chileDayStart(`${chileDateKey(now).slice(0, 7)}-01`);
}

/** Lee lo necesario y arma el plan de hoy. */
export async function readShortsPlan(admin: SupabaseClient, now: Date, siteUrl: string): Promise<ShortsPlan> {
  const { data: setting, error: settingError } = await admin
    .from('admin_private_settings')
    .select('value')
    .eq('key', META_DAILY_KEY)
    .maybeSingle();
  if (settingError) throw new Error(`No se pudo leer el reel de hoy: ${settingError.message}`);
  const state = ((setting as { value?: unknown } | null)?.value ?? null) as DailyState | null;

  let product: SocialProduct | null = null;
  if (state?.productId) {
    const read = await selectSocialProducts((columns) => admin.from('products').select(columns).eq('id', state.productId));
    if (read.error) throw new Error(`No se pudo leer el producto: ${read.error}`);
    product = read.rows[0] ?? null;
  }

  const since = new Date(now.getTime() - (SHORTS_REPEAT_DAYS + 1) * 86_400_000).toISOString();
  const { data: rows, error: marksError } = await admin
    .from('social_posts')
    .select('channel, product_id, posted_at')
    .in('channel', [...SHORTS_NETWORKS])
    .eq('caption', VIDEO_MARK)
    .neq('status', 'error')
    .gte('posted_at', since);
  if (marksError) throw new Error(`No se pudo leer lo ya subido: ${marksError.message}`);
  const marks = ((rows ?? []) as { channel: string; product_id: string | null; posted_at: string }[]).map((r) => ({
    channel: r.channel,
    productId: r.product_id,
    postedAt: r.posted_at,
  }));

  const { count, error: countError } = await admin
    .from('social_posts')
    .select('id', { count: 'exact', head: true })
    .in('channel', [...SHORTS_NETWORKS])
    .neq('status', 'error')
    .not('external_id', 'is', null)
    .gte('posted_at', chileMonthStart(now).toISOString());

  return planShorts({ now, siteUrl, state, product, marks, monthCount: countError ? null : (count ?? 0) });
}
