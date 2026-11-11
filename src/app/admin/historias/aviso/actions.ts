'use server';

/**
 * Acciones de "Aviso del canal" (/admin/historias/aviso). Solo leen: agregar
 * un producto que falta lo hace la acción de Agregar (addFromMl), con sus
 * mismos controles, y marcar una historia como subida, la de Historias.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getMlToken, mlTokenError } from '@/lib/ml-enrichment';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { requireAdmin } from '@/lib/admin-auth';
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
  const results = await mapWithConcurrency(parsed.deals, 3, (deal) => safeReview(deal, ctx));
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
  return { name: o.name.trim(), price, coupon, mlId };
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
