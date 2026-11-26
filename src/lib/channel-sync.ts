import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminEvent } from '@/lib/admin-audit';
import { channelPriceDecision, type ChannelSkip } from '@/lib/channel-price';
import { formatCLP } from '@/lib/format';
import { PRICED_COLUMNS, applyPricing, type PricedProduct, type PricingOutcome } from '@/lib/pricing';
import { resolveShortLink, type ShortLinkResult } from '@/lib/short-links';
import { parseDealNotice, type NoticeDeal } from '@/lib/social/deal-notice';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { isChannelName, readChannel, type ChannelPost, type ChannelRead } from '@/lib/telegram-channel';

/**
 * Lleva al sitio los precios que Mercado Libre publica en su canal oficial
 * de afiliados.
 *
 * Los avisos llegan por dos lados y se tratan igual (processNotices):
 *  - pegados a mano en /admin/historias/aviso (el canal de Telegram es
 *    privado: sin una sesión no se puede leer solo);
 *  - leídos de la vista pública de un canal (lib/telegram-channel: un pedido
 *    a t.me), si algún día el canal tiene una. Eso es syncChannel.
 *
 * De cada aviso se sacan sus productos con precio (lib/social/deal-notice),
 * se le pregunta al acortador a qué ficha apunta cada link (lib/short-links:
 * nunca a Mercado Libre) y, para los productos que ya están en el sitio, se
 * guarda ese precio con la hora del aviso (lib/channel-price).
 *
 * No se le pide nada a Mercado Libre en ningún paso.
 *
 * Los productos del aviso que no están en el sitio quedan anotados
 * (`no_estan`): agregarlos lo decide una persona.
 */

/** Quién firma en Actividad los cambios de la pasada automática. */
export const CHANNEL_ACTOR = 'canal de afiliados';
/** El nombre de la pasada en la bitácora de los crons. */
export const CHANNEL_JOB = 'canal';

/**
 * El nombre público del canal (lo que va después de t.me/). Mientras no esté,
 * la pasada automática no hace nada. Es un dato público, no un secreto; la
 * variable CANAL_AFILIADOS_TELEGRAM permite ponerlo sin tocar el código.
 */
export const DEFAULT_CHANNEL: string | null = null;

export function channelName(env: Record<string, string | undefined> = process.env): string | null {
  const name = env.CANAL_AFILIADOS_TELEGRAM?.trim() || DEFAULT_CHANNEL;
  return isChannelName(name) ? name : null;
}

/** Avisos nuevos que se miran por pasada, como máximo: los más recientes. */
const MAX_POSTS = 12;
/** Links que se le preguntan al acortador por pasada, como máximo. */
const MAX_LINKS = 40;
/** La primera vez no hay "último aviso visto": se toman solo los de este rato. */
const FIRST_RUN_WINDOW_MS = 24 * 3_600_000;
/** Un aviso más viejo que esto ya no se mira aunque quede pendiente. */
const MAX_POST_AGE_MS = 3 * 24 * 3_600_000;
/** Productos fuera del sitio que se anotan en el resumen, como máximo. */
const MAX_MISSING = 20;

export type SkipReason = ChannelSkip | 'sin_ficha' | 'link_sin_resolver' | 'no_esta_en_el_sitio' | 'no_se_guardo';

export interface ChannelWrite {
  id: string;
  slug: string;
  name: string;
  price: number;
  changed: boolean;
}

/** Qué pasó con cada producto de un aviso. */
export interface DealOutcome {
  /** El nombre como viene en el aviso. */
  name: string;
  /** El precio guardado, o el que trae el aviso si no se guardó. */
  price: number | null;
  mlId: string | null;
  /** 'guardado', o por qué no. */
  status: 'guardado' | SkipReason;
  /** Guardado, y el precio o el precio sin descuento eran otros. */
  changed?: boolean;
}

type Row = PricedProduct & {
  slug: string;
  name: string;
  is_hidden: boolean;
  price_checked_at: string | null;
  deleted_at?: string | null;
};

const BASE_COLUMNS = `${PRICED_COLUMNS}, slug, name, is_hidden, price_checked_at`;

async function readProducts(admin: SupabaseClient, mlIds: string[]): Promise<Row[]> {
  if (mlIds.length === 0) return [];
  // deleted_at llega con la migración 0017: sin ella, se lee sin él.
  for (const columns of [`${BASE_COLUMNS}, deleted_at`, BASE_COLUMNS]) {
    const { data, error } = await admin.from('products').select(columns).in('ml_product_id', mlIds);
    if (error && columns !== BASE_COLUMNS && isMissingSchemaError(error)) continue;
    if (error) throw new Error(`no se pudo leer el catálogo: ${error.message}`);
    return (data ?? []) as unknown as Row[];
  }
  return [];
}

export interface ChannelSyncDeps {
  read: (channel: string) => Promise<ChannelRead>;
  resolve: (link: string) => Promise<ShortLinkResult>;
  apply: (admin: SupabaseClient, outcomes: PricingOutcome[], concurrency: number) => Promise<number>;
}

const REAL_DEPS: ChannelSyncDeps = { read: readChannel, resolve: resolveShortLink, apply: applyPricing };

/** Un aviso con su hora: el del canal, o el que se pegó a mano (con la hora en que se pegó). */
export interface Notice {
  /** El número del aviso en el canal; 0 si se pegó a mano. */
  id: number;
  postedAt: string;
  text: string;
}

export interface ProcessOptions {
  now: number;
  /** false: modo prueba, no escribe nada. */
  write: boolean;
  /** Quién queda anotado en Actividad. */
  actor: string;
}

export interface ProcessResult {
  /** Productos con link en los avisos. */
  products: number;
  /** Qué pasó con cada uno, en el orden de los avisos. */
  deals: DealOutcome[];
  /** Lo que quedó escrito (vacío en modo prueba). */
  written: ChannelWrite[];
  /** Precios guardados, o que se guardarían en modo prueba. */
  saved: number;
  /** De esos, cuántos cambiaron el precio o el precio sin descuento. */
  changed: number;
  skipped: Partial<Record<SkipReason, number>>;
  missing: { ml_id: string; nombre: string; precio: number | null }[];
  /** Avisos con algo que quedó a medias por una falla pasajera (el acortador, la base). */
  pending: Set<number>;
}

interface Item {
  noticeId: number;
  postedAt: string;
  deal: NoticeDeal;
  mlId: string;
  detail: DealOutcome;
}

/**
 * Lleva al sitio los precios de unos avisos. Nunca lanza por el acortador
 * (queda en el resultado); sí por la base, al leer el catálogo.
 */
export async function processNotices(
  admin: SupabaseClient,
  notices: Notice[],
  opts: ProcessOptions,
  deps: Pick<ChannelSyncDeps, 'resolve' | 'apply'> = REAL_DEPS
): Promise<ProcessResult> {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const deals: DealOutcome[] = [];
  const pending = new Set<number>();
  const skip = (detail: DealOutcome, reason: SkipReason) => {
    detail.status = reason;
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  // Lo que trae cada aviso, con la ficha de cada producto.
  const items: Item[] = [];
  let products = 0;
  let asked = 0;
  for (const notice of notices) {
    const parsed = parseDealNotice(notice.text);
    if (parsed.deals.length === 0) continue;
    products += parsed.deals.length;
    // Un cupón suelto en el aviso, o un producto con condiciones, pone en duda todos sus precios.
    const conditional = parsed.coupons.length > 0 || parsed.deals.some((d) => d.conditional || d.coupon);
    for (const deal of parsed.deals) {
      const detail: DealOutcome = { name: deal.name, price: deal.price, mlId: deal.mlId, status: 'guardado' };
      deals.push(detail);
      if (conditional) {
        skip(detail, 'con_condiciones');
        continue;
      }
      let mlId = deal.mlId;
      if (!mlId) {
        if (!deal.link) {
          skip(detail, 'sin_ficha');
          continue;
        }
        if (asked >= MAX_LINKS) {
          pending.add(notice.id);
          skip(detail, 'link_sin_resolver');
          continue;
        }
        asked += 1;
        const resolved = await deps.resolve(deal.link);
        if (resolved.status !== 'ficha') {
          // 'otro' es definitivo (no es una ficha); 'sin_resolver' puede ser pasajero.
          if (resolved.status === 'sin_resolver') pending.add(notice.id);
          skip(detail, resolved.status === 'otro' ? 'sin_ficha' : 'link_sin_resolver');
          continue;
        }
        mlId = resolved.mlId;
        detail.mlId = mlId;
      }
      items.push({ noticeId: notice.id, postedAt: notice.postedAt, deal, mlId, detail });
    }
  }

  // Si un producto sale en dos avisos, vale el más nuevo; el anterior queda como ya revisado.
  const latest = new Map<string, Item>();
  for (const item of items) {
    const earlier = latest.get(item.mlId);
    if (earlier) skip(earlier.detail, 'ya_revisado');
    latest.set(item.mlId, item);
  }

  const rows = await readProducts(admin, [...latest.keys()]);
  const byMlId = new Map<string, Row[]>();
  for (const row of rows) byMlId.set(row.ml_product_id, [...(byMlId.get(row.ml_product_id) ?? []), row]);

  const missing: ProcessResult['missing'] = [];
  const written: ChannelWrite[] = [];
  let saved = 0;
  let changed = 0;
  for (const item of latest.values()) {
    // Una ficha es un producto del sitio; si hubiera más de una fila, vale la que está a la venta.
    const matches = byMlId.get(item.mlId) ?? [];
    const row = matches.find((r) => r.is_active && !r.is_hidden && !r.deleted_at) ?? matches[0];
    if (!row) {
      skip(item.detail, 'no_esta_en_el_sitio');
      if (missing.length < MAX_MISSING) missing.push({ ml_id: item.mlId, nombre: item.deal.name, precio: item.deal.price });
      continue;
    }
    const decision = channelPriceDecision(row, item.deal, item.postedAt, opts.now);
    if (!decision.ok) {
      skip(item.detail, decision.reason);
      continue;
    }
    const { price, listPrice } = decision.value;
    item.detail.price = price;

    if (opts.write) {
      // De a uno: así se sabe cuál quedó escrito y cuál no.
      const failed = await deps.apply(admin, [decision.outcome], 1);
      if (failed > 0) {
        skip(item.detail, 'no_se_guardo');
        pending.add(item.noticeId);
        continue;
      }
      written.push({ id: row.id, slug: row.slug, name: row.name, price, changed: decision.outcome.priceChanged });
      await logAdminEvent(admin, {
        actor: opts.actor,
        action: 'precio_canal',
        target: row.id,
        before: { precio: row.price, tachado: row.original_price ?? null, revisado: row.price_checked_at },
        after: {
          nombre: row.name,
          precio: price,
          tachado: listPrice,
          aviso: item.noticeId || 'pegado a mano',
          publicado: decision.postedAt,
        },
      });
    }
    item.detail.changed = decision.outcome.priceChanged;
    saved += 1;
    if (decision.outcome.priceChanged) changed += 1;
  }

  return { products, deals, written, saved, changed, skipped, missing, pending };
}

/** Por qué no se guardó el precio de un producto del aviso, en una frase para el admin. Puro. */
export function dealOutcomeText(deal: Pick<DealOutcome, 'status' | 'price' | 'changed'>, test = false): string {
  switch (deal.status) {
    case 'guardado': {
      const price = deal.price ? formatCLP(deal.price) : 'el precio del aviso';
      if (test) return `Modo prueba: se guardaría ${price}.`;
      return deal.changed ? `Guardado: ${price}. Cambió respecto de lo que tenía el sitio.` : `Guardado: ${price}, el mismo que tenía el sitio.`;
    }
    case 'con_condiciones':
      return 'No se guardó: el aviso ata el precio a un cupón, una tarjeta o cuotas.';
    case 'sin_precio':
      return 'No se guardó: el aviso no trae su precio.';
    case 'precio_ambiguo':
      return 'No se guardó: el aviso trae varios montos y no queda claro cuál es el precio.';
    case 'cambio_grande':
      return 'No se guardó: el precio del aviso es menos de la mitad o más del doble del que tiene el sitio. Míralo en la pestaña Precios.';
    case 'ya_revisado':
      return 'Sin cambios: el sitio ya tiene una revisión más nueva de este producto.';
    case 'en_pausa':
      return 'No se guardó: el producto está en pausa. Si se vende, vuelve a publicarlo desde la pestaña Precios.';
    case 'fuera_del_sitio':
      return 'No se guardó: el producto está oculto, eliminado o fuera del sitio por su link.';
    case 'sin_fecha':
      return 'No se guardó: no se pudo saber de cuándo es el aviso.';
    case 'sin_ficha':
      return 'No se guardó: su link no lleva a la ficha de un producto.';
    case 'link_sin_resolver':
      return 'No se guardó: no pude saber a qué producto apunta el link. Intenta de nuevo en un rato.';
    case 'no_esta_en_el_sitio':
      return 'No está en el sitio. Si es de tecnología, agrégalo más abajo.';
    case 'no_se_guardo':
      return 'No se pudo guardar en la base. Intenta de nuevo.';
  }
}

export interface ChannelSyncSummary {
  ok: boolean;
  /** Por qué no se hizo nada (sin canal configurado, sin vista pública, Telegram caído). */
  omitida?: string;
  canal?: string;
  /** Avisos con texto que traía la página. */
  avisos?: number;
  /** De esos, los que no se habían visto. */
  avisos_nuevos?: number;
  /** Productos con link en los avisos nuevos. */
  productos?: number;
  /** Precios guardados en el sitio (o que se guardarían, en modo prueba). */
  precios?: number;
  /** De esos, cuántos cambiaron el precio o el precio sin descuento. */
  cambios?: number;
  /** Lo que no se llevó al sitio, por motivo. */
  saltados?: Partial<Record<SkipReason, number>>;
  /** Productos del canal que no están en el sitio. */
  no_estan?: { ml_id: string; nombre: string; precio: number | null }[];
  /** El último aviso que quedó visto: la pasada siguiente parte del que sigue. */
  ultimo_aviso?: number | null;
  /** Modo prueba: nada se escribió. */
  prueba?: true;
}

/** El último aviso visto por la pasada anterior que terminó bien; null si nunca hubo. Nunca lanza. */
export async function readLastChannelPost(admin: SupabaseClient): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from('cron_runs')
      .select('summary')
      .eq('job', CHANNEL_JOB)
      .eq('ok', true)
      .not('summary->>ultimo_aviso', 'is', null)
      .order('id', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const last = Number((data[0] as { summary?: { ultimo_aviso?: unknown } }).summary?.ultimo_aviso);
    return Number.isSafeInteger(last) && last > 0 ? last : null;
  } catch {
    return null;
  }
}

export interface ChannelSyncOptions {
  /** El nombre público del canal; null si todavía no se sabe. */
  channel: string | null;
  now: Date;
  /** El último aviso ya visto; null la primera vez. */
  since: number | null;
  /** false: modo prueba, no escribe nada. */
  write: boolean;
}

/** Los avisos que toca mirar: los no vistos, recientes, y solo los últimos MAX_POSTS. Puro. */
export function postsToProcess(posts: ChannelPost[], since: number | null, now: number): ChannelPost[] {
  const maxAge = since === null ? FIRST_RUN_WINDOW_MS : MAX_POST_AGE_MS;
  return posts
    .filter((p) => (since === null || p.id > since) && now - Date.parse(p.postedAt) <= maxAge)
    .sort((a, b) => a.id - b.id)
    .slice(-MAX_POSTS);
}

/**
 * Una pasada automática sobre la vista pública del canal. Nunca lanza por
 * Telegram ni por el acortador (quedan en el resumen); sí por la base, que la
 * ruta anota como falla.
 */
export async function syncChannel(
  admin: SupabaseClient,
  opts: ChannelSyncOptions,
  deps: ChannelSyncDeps = REAL_DEPS
): Promise<{ summary: ChannelSyncSummary; written: ChannelWrite[] }> {
  const nothing = (omitida: string, ok = true) => ({ summary: { ok, omitida }, written: [] as ChannelWrite[] });
  if (!opts.channel) return nothing('Falta la dirección pública del canal de afiliados.');

  const read = await deps.read(opts.channel);
  if (read.status === 'sin_vista_publica') {
    return nothing('El canal no tiene vista pública en Telegram: no se puede leer sin una sesión.', false);
  }
  if (read.status === 'error') return nothing(`Telegram no respondió bien: ${read.reason}`, false);

  const now = opts.now.getTime();
  const fresh = postsToProcess(read.posts, opts.since, now);
  const result = await processNotices(admin, fresh, { now, write: opts.write, actor: CHANNEL_ACTOR }, deps);

  // Hasta dónde queda visto: el aviso anterior al primero que quedó pendiente
  // (si todavía es reciente); si no hay pendientes, el último de la página.
  const seenAll = read.posts.reduce((max, p) => Math.max(max, p.id), opts.since ?? 0) || null;
  const firstPending = fresh.find((p) => result.pending.has(p.id));
  const last = firstPending ? Math.max(firstPending.id - 1, opts.since ?? 0) || null : seenAll;

  return {
    summary: {
      ok: true,
      canal: opts.channel,
      avisos: read.posts.length,
      avisos_nuevos: fresh.length,
      productos: result.products,
      precios: result.saved,
      cambios: result.changed,
      saltados: result.skipped,
      no_estan: result.missing,
      ultimo_aviso: last,
      ...(opts.write ? {} : { prueba: true as const }),
    },
    written: result.written,
  };
}
