'use server';

/**
 * Acciones de "Aviso del canal" (/admin/historias/aviso). Revisar solo lee:
 * agregar un producto que falta lo hace la acción de Agregar (addFromMl), con
 * sus mismos controles, y marcar una historia como subida, la de Historias.
 *
 * Lo único que escribe es saveNoticePrices: guarda en el sitio el precio que
 * el aviso da para los productos que ya están publicados (lib/channel-sync).
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getMlToken, mlTokenError } from '@/lib/ml-enrichment';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { CHANNEL_OFFER_INFO, noticePrice } from '@/lib/channel-price';
import { dealOutcomeText, processNotices } from '@/lib/channel-sync';
import { UNKNOWN_SELLER_ID, inspectCatalogProduct, saveManualCandidate } from '@/lib/manual-add';
import { approveCandidate } from '../../candidatos/actions';
import type { AddFromMlResult } from '../../candidatos/agregar/actions';
import { notifyIndexNow } from '@/lib/indexnow';
import { isProductionRuntime } from '@/lib/runtime-env';
import { resolveShortLink } from '@/lib/short-links';
import { SITE_URL } from '@/lib/site';
import { directLinksUsable } from '@/lib/admin-settings';
import { readAffiliateSettings } from '@/lib/settings';
import { minCommissionFromEnv } from '@/lib/prospect-filter';
import { pieceKey } from '@/lib/social/piece-url';
import { parseDealNotice, type NoticeDeal } from '@/lib/social/deal-notice';
import { dealContext, reviewDeal, type DealContext, type DealResult } from '@/lib/social/deal-notice-review';

export type NoticeReview =
  | {
      ok: true;
      results: DealResult[];
      /** Productos que no entraron por el tope por aviso. */
      omitted: number;
      /** Cupones sueltos, sin producto: van a Cupones. */
      coupons: string[];
      /** Cuándo se armó: identifica esta revisión en la lista de historias. */
      renderedAt: number;
    }
  | { ok: false; error: string };

export type DealReview = { ok: true; result: DealResult; renderedAt: number } | { ok: false; error: string };

const ML_ID = /^MLC\d{5,15}$/;
const CODE = /^[A-Z0-9]{4,20}$/;
/** Las columnas de precio son integer de Postgres; ningún producto del sitio pasa de esto. */
const MAX_AMOUNT = 99_999_999;

async function context(): Promise<DealContext | { error: string }> {
  const admin = getSupabaseAdmin();
  if (!admin) return { error: 'Supabase admin no configurado' };
  const key = pieceKey();
  if (!key) return { error: 'Falta CRON_SECRET en Vercel: no se pueden armar las imágenes.' };
  const token = await getMlToken();
  if (!token) return { error: `No se pudo conectar con Mercado Libre (${mlTokenError() ?? 'sin detalle'}). Intenta de nuevo.` };
  const usable = await directLinksUsable(admin);
  const settings = usable ? await readAffiliateSettings(admin) : null;
  return dealContext(
    {
      admin,
      token,
      affiliate: settings ? { word: settings.word, tool: settings.tool } : null,
      minCommission: minCommissionFromEnv(),
    },
    key,
    new Date()
  );
}

async function safeReview(deal: NoticeDeal, ctx: DealContext): Promise<DealResult> {
  try {
    return await reviewDeal(deal, ctx);
  } catch (err) {
    return { kind: 'sin_ficha', deal, message: err instanceof Error ? err.message : 'No se pudo revisar.' };
  }
}

/**
 * La ficha exacta del producto, si el link del aviso es uno corto que se puede
 * resolver: se le pregunta al acortador adónde apunta, sin llegar a Mercado
 * Libre (lib/short-links). Con ella no hace falta adivinar por el nombre.
 */
async function withExactId(deal: NoticeDeal): Promise<NoticeDeal> {
  if (deal.mlId || !deal.link) return deal;
  const resolved = await resolveShortLink(deal.link);
  return resolved.status === 'ficha' ? { ...deal, mlId: resolved.mlId } : deal;
}

/** Lee el aviso pegado y revisa cada producto. */
export async function reviewNotice(text: string): Promise<NoticeReview> {
  await requireAdmin();
  const parsed = parseDealNotice(String(text ?? ''));
  if (parsed.deals.length === 0 && parsed.coupons.length === 0) {
    return {
      ok: false,
      error: 'No encontré productos con su link en lo que pegaste. En WhatsApp, copia el aviso completo y pégalo de nuevo.',
    };
  }
  if (parsed.deals.length === 0) {
    return { ok: true, results: [], omitted: 0, coupons: parsed.coupons, renderedAt: Date.now() };
  }

  const ctx = await context();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const results = await mapWithConcurrency(parsed.deals, 3, async (deal) => safeReview(await withExactId(deal), ctx));
  return { ok: true, results, omitted: parsed.omitted, coupons: parsed.coupons, renderedAt: Date.now() };
}

/** Lo que llega del navegador, como NoticeDeal limpio (o null si no tiene la forma). */
function toDeal(raw: unknown): NoticeDeal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== 'string' || o.name.trim().length === 0 || o.name.length > 200) return null;
  const price = typeof o.price === 'number' && Number.isSafeInteger(o.price) && o.price > 0 ? o.price : null;
  const coupon = typeof o.coupon === 'string' && CODE.test(o.coupon) ? o.coupon : null;
  const mlId = typeof o.mlId === 'string' && ML_ID.test(o.mlId) ? o.mlId : null;
  // Lo que lib/channel-price mira para saber si el aviso da un precio sin condiciones.
  const amounts = Array.isArray(o.amounts)
    ? o.amounts.filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT).slice(0, 6)
    : undefined;
  const discountPct =
    typeof o.discountPct === 'number' && o.discountPct > 0 && o.discountPct < 100 ? Math.round(o.discountPct) : null;
  return {
    name: o.name.trim(),
    price,
    coupon,
    mlId,
    ...(amounts ? { amounts } : {}),
    discountPct,
    conditional: o.conditional === true || coupon !== null,
  };
}

/** Por qué el precio de un aviso no sirve para agregar el producto al sitio. */
const NO_PRICE_REASON: Record<string, string> = {
  con_condiciones: 'El aviso ata el precio a un cupón, una tarjeta o cuotas: no sirve como precio del producto.',
  sin_precio: 'El aviso no trae el precio de este producto.',
  precio_ambiguo: 'El aviso trae varios montos y no queda claro cuál es el precio.',
};

/**
 * Agrega al sitio un producto de un aviso del canal que todavía no está, con
 * el precio del aviso. Desde el 23-11-2026 Mercado Libre no entrega precios
 * ni vendedores, y sin eso "Agregar desde Mercado Libre" no puede revisar un
 * producto nuevo; el aviso del canal oficial sí trae el precio.
 *
 * El producto entra sin nada del vendedor (lib/manual-add: UNKNOWN_SELLER_ID)
 * y con la marca del canal en su oferta, así que el sitio muestra el precio
 * con su fecha y nada más. Lo demás es lo de siempre: la misma cola, la misma
 * aprobación y el mismo link de afiliado.
 */
export async function addFromNotice(raw: unknown, publish: boolean): Promise<AddFromMlResult> {
  const actor = await requireAdmin();
  const deal = toDeal(raw);
  if (!deal?.mlId) return { ok: false, error: 'No se sabe a qué ficha apunta este producto del aviso.' };
  const price = noticePrice(deal);
  if (!price.ok) return { ok: false, error: NO_PRICE_REASON[price.reason] ?? 'El aviso no da un precio que se pueda usar.' };

  const ctx = await context();
  if ('error' in ctx) return { ok: false, error: ctx.error };

  const id = deal.mlId;
  let inspected: Awaited<ReturnType<typeof inspectCatalogProduct>>;
  try {
    inspected = await inspectCatalogProduct(id, id, ctx, { ...price.value, seenAt: new Date().toISOString() });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'No se pudo revisar. Intenta de nuevo.' };
  }
  if ('notFound' in inspected) return { ok: false, error: `Mercado Libre no tiene una ficha con el código ${id}.` };
  const { preview, candidate } = inspected;
  if (preview.state === 'en_sitio') return { ok: false, error: 'Este producto ya está en el sitio.' };
  if (!candidate) return { ok: false, error: preview.reason ?? 'No se puede agregar este producto.' };

  const saved = await saveManualCandidate(ctx.admin, candidate);
  if (!saved.ok) return saved;

  await logAdminEvent(ctx.admin, {
    actor,
    action: 'agregar_desde_ml',
    target: saved.id,
    after: { ml_product_id: id, name: preview.name, price: preview.price, origen: 'aviso del canal', publish },
  });
  revalidatePath('/admin/candidatos');

  if (!publish) return { ok: true, outcome: 'en_cola' };

  const approved = await approveCandidate(saved.id, '');
  if (!approved.ok) return { ok: true, outcome: 'en_cola', notPublished: approved.error };

  // Entró sin nada de la oferta: con la marca del canal el sitio no muestra
  // vendedor, envío ni garantía. Solo si sigue siendo ese el precio que se
  // vio (si Mercado Libre reabriera los precios, la revisión de la
  // aprobación ya habría dejado los datos de verdad).
  const { error: markError } = await ctx.admin
    .from('products')
    .update({ offer_info: CHANNEL_OFFER_INFO })
    .eq('ml_product_id', id)
    .eq('seller_id', UNKNOWN_SELLER_ID);
  if (markError) console.error('[aviso] no se pudo marcar la oferta del producto nuevo:', markError.message);
  revalidateTag('catalog');
  revalidatePath('/', 'layout');

  return {
    ok: true,
    outcome: approved.outcome,
    slug: approved.slug,
    ...(approved.reason ? { reason: approved.reason } : {}),
  };
}

/** Revisa de nuevo un producto del aviso, por ejemplo recién agregado al sitio. */
export async function reviewNoticeDeal(raw: unknown): Promise<DealReview> {
  await requireAdmin();
  const deal = toDeal(raw);
  if (!deal) return { ok: false, error: 'Producto no válido.' };
  const ctx = await context();
  if ('error' in ctx) return { ok: false, error: ctx.error };
  return { ok: true, result: await safeReview(deal, ctx), renderedAt: Date.now() };
}

export type NoticePricesResult =
  | {
      ok: true;
      /** Precios guardados (o que se guardarían, en modo prueba). */
      saved: number;
      /** Qué pasó con cada producto del aviso, en su orden. */
      lines: { name: string; text: string; saved: boolean }[];
      /** Fuera del sitio publicado no se escribe: se muestra qué se guardaría. */
      test: boolean;
    }
  | { ok: false; error: string };

/**
 * Guarda en el sitio el precio que el aviso da para cada producto que ya está
 * publicado. Lo usa el dueño cuando pega un aviso de hoy del canal oficial de
 * afiliados: el precio queda con la hora en que lo pegó, que es cuando lo vio.
 *
 * Se lee de nuevo el texto en el servidor (no se confía en precios que manda
 * el navegador) y valen las reglas de lib/channel-price: sin cupones ni
 * tarjetas, sin cambios de más del doble o menos de la mitad, y sin volver a
 * publicar productos en pausa.
 *
 * Solo escribe en el sitio publicado; en cualquier otro lado responde qué
 * guardaría.
 */
export async function saveNoticePrices(text: string): Promise<NoticePricesResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const notice = String(text ?? '');
  if (parseDealNotice(notice).deals.length === 0) {
    return { ok: false, error: 'No encontré productos con su link en lo que pegaste.' };
  }

  const now = new Date();
  const write = isProductionRuntime();
  try {
    const result = await processNotices(
      admin,
      [{ id: 0, postedAt: now.toISOString(), text: notice }],
      { now: now.getTime(), write, actor }
    );
    if (result.written.length > 0) {
      // El precio se ve en casi todas las páginas públicas: se vuelve a armar todo.
      revalidateTag('catalog');
      revalidatePath('/', 'layout');
      // Bing (de donde lee ChatGPT) vuelve a leer esas fichas. Nunca lanza.
      await notifyIndexNow(result.written.map((w) => `${SITE_URL}/producto/${w.slug}`));
    }
    return {
      ok: true,
      saved: result.saved,
      test: !write,
      lines: result.deals.map((d) => ({ name: d.name, text: dealOutcomeText(d, !write), saved: d.status === 'guardado' })),
    };
  } catch (err) {
    console.error('[aviso] no se pudieron guardar los precios:', err instanceof Error ? err.message : err);
    return { ok: false, error: 'No se pudieron guardar los precios. Intenta de nuevo.' };
  }
}
