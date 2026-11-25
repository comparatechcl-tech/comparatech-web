import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminEvent } from '@/lib/admin-audit';
import { channelPriceDecision, type ChannelSkip } from '@/lib/channel-price';
import { PRICED_COLUMNS, applyPricing, type PricedProduct, type PricingOutcome } from '@/lib/pricing';
import { resolveShortLink, type ShortLinkResult } from '@/lib/short-links';
import { parseDealNotice, type NoticeDeal } from '@/lib/social/deal-notice';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { isChannelName, readChannel, type ChannelPost, type ChannelRead } from '@/lib/telegram-channel';

/**
 * Lleva al sitio los precios que Mercado Libre publica en su canal oficial
 * de afiliados en Telegram.
 *
 * Cada pasada lee la vista pública del canal (lib/telegram-channel: un pedido
 * a t.me), toma los avisos que no había visto, saca de cada uno sus productos
 * con precio (lib/social/deal-notice, el mismo lector de los avisos pegados a
 * mano), le pregunta al acortador a qué ficha apunta cada link
 * (lib/short-links: nunca a Mercado Libre) y, para los productos que ya están
 * en el sitio, guarda ese precio con la hora del aviso (lib/channel-price).
 *
 * No se le pide nada a Mercado Libre en ningún paso.
 *
 * Los productos del aviso que no están en el sitio quedan anotados en el
 * resumen de la pasada (`no_estan`): agregarlos lo decide una persona.
 */

/** Quién firma estos cambios en Actividad. */
export const CHANNEL_ACTOR = 'canal de afiliados';
/** El nombre de la pasada en la bitácora de los crons. */
export const CHANNEL_JOB = 'canal';

/**
 * El nombre público del canal (lo que va después de t.me/). Mientras no esté,
 * la pasada no hace nada. Es un dato público, no un secreto; la variable
 * CANAL_AFILIADOS_TELEGRAM permite cambiarlo sin tocar el código.
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

type SkipReason = ChannelSkip | 'sin_ficha' | 'link_sin_resolver' | 'no_esta_en_el_sitio' | 'no_se_guardo';

export interface ChannelWrite {
  id: string;
  slug: string;
  name: string;
  price: number;
  changed: boolean;
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

export interface ChannelSyncDeps {
  read: (channel: string) => Promise<ChannelRead>;
  resolve: (link: string) => Promise<ShortLinkResult>;
  apply: (admin: SupabaseClient, outcomes: PricingOutcome[], concurrency: number) => Promise<number>;
}

const REAL_DEPS: ChannelSyncDeps = { read: readChannel, resolve: resolveShortLink, apply: applyPricing };

interface Item {
  postId: number;
  postedAt: string;
  deal: NoticeDeal;
  mlId: string;
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
 * Una pasada. Nunca lanza por Telegram ni por el acortador (quedan en el
 * resumen); sí por la base, que la ruta anota como falla.
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
  const skipped: Partial<Record<SkipReason, number>> = {};
  const skip = (reason: SkipReason) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  // Lo que trae cada aviso, con la ficha de cada producto.
  const items: Item[] = [];
  /** Avisos con un link que el acortador no alcanzó a responder: se vuelven a mirar en la pasada siguiente. */
  const pending = new Set<number>();
  let products = 0;
  let asked = 0;
  for (const post of fresh) {
    const parsed = parseDealNotice(post.text);
    if (parsed.deals.length === 0) continue;
    products += parsed.deals.length;
    // Un cupón suelto en el aviso, o un producto con condiciones, pone en duda todos sus precios.
    const conditional = parsed.coupons.length > 0 || parsed.deals.some((d) => d.conditional || d.coupon);
    for (const deal of parsed.deals) {
      if (conditional) {
        skip('con_condiciones');
        continue;
      }
      let mlId = deal.mlId;
      if (!mlId) {
        if (!deal.link || asked >= MAX_LINKS) {
          if (deal.link) pending.add(post.id);
          skip(deal.link ? 'link_sin_resolver' : 'sin_ficha');
          continue;
        }
        asked += 1;
        const resolved = await deps.resolve(deal.link);
        if (resolved.status === 'ficha') mlId = resolved.mlId;
        else {
          // 'otro' es definitivo (no es una ficha); 'sin_resolver' puede ser pasajero.
          if (resolved.status === 'sin_resolver') pending.add(post.id);
          skip(resolved.status === 'otro' ? 'sin_ficha' : 'link_sin_resolver');
          continue;
        }
      }
      items.push({ postId: post.id, postedAt: post.postedAt, deal, mlId });
    }
  }

  // Si un producto sale en dos avisos, vale el más nuevo.
  const latest = new Map<string, Item>();
  for (const item of items) latest.set(item.mlId, item);

  const rows = await readProducts(admin, [...latest.keys()]);
  const byMlId = new Map<string, Row[]>();
  for (const row of rows) byMlId.set(row.ml_product_id, [...(byMlId.get(row.ml_product_id) ?? []), row]);

  const missing: NonNullable<ChannelSyncSummary['no_estan']> = [];
  const decided: { row: Row; outcome: PricingOutcome; price: number; listPrice: number | null; postedAt: string; postId: number }[] = [];
  for (const item of latest.values()) {
    const matches = byMlId.get(item.mlId) ?? [];
    if (matches.length === 0) {
      skip('no_esta_en_el_sitio');
      if (missing.length < MAX_MISSING) missing.push({ ml_id: item.mlId, nombre: item.deal.name, precio: item.deal.price });
      continue;
    }
    for (const row of matches) {
      const decision = channelPriceDecision(row, item.deal, item.postedAt, now);
      if (!decision.ok) {
        skip(decision.reason);
        continue;
      }
      decided.push({
        row,
        outcome: decision.outcome,
        price: decision.value.price,
        listPrice: decision.value.listPrice,
        postedAt: decision.postedAt,
        postId: item.postId,
      });
    }
  }

  const written: ChannelWrite[] = [];
  if (opts.write) {
    // De a uno: así se sabe cuál quedó escrito y cuál no.
    for (const d of decided) {
      const failed = await deps.apply(admin, [d.outcome], 1);
      if (failed > 0) {
        skip('no_se_guardo');
        pending.add(d.postId);
        continue;
      }
      written.push({ id: d.row.id, slug: d.row.slug, name: d.row.name, price: d.price, changed: d.outcome.priceChanged });
      await logAdminEvent(admin, {
        actor: CHANNEL_ACTOR,
        action: 'precio_canal',
        target: d.row.id,
        before: { precio: d.row.price, tachado: d.row.original_price ?? null, revisado: d.row.price_checked_at },
        after: { nombre: d.row.name, precio: d.price, tachado: d.listPrice, aviso: d.postId, publicado: d.postedAt },
      });
    }
  }

  // Hasta dónde queda visto: el aviso anterior al primero que quedó pendiente
  // (si todavía es reciente); si no hay pendientes, el último de la página.
  const seenAll = read.posts.reduce((max, p) => Math.max(max, p.id), opts.since ?? 0) || null;
  const firstPending = fresh.find((p) => pending.has(p.id));
  const last = firstPending ? Math.max(firstPending.id - 1, opts.since ?? 0) || null : seenAll;

  const total = opts.write ? written.length : decided.length;
  return {
    summary: {
      ok: true,
      canal: opts.channel,
      avisos: read.posts.length,
      avisos_nuevos: fresh.length,
      productos: products,
      precios: total,
      cambios: opts.write ? written.filter((w) => w.changed).length : decided.filter((d) => d.outcome.priceChanged).length,
      saltados: skipped,
      no_estan: missing,
      ultimo_aviso: last,
      ...(opts.write ? {} : { prueba: true as const }),
    },
    written,
  };
}
