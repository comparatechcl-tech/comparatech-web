import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { isCronAuthorized } from '@/lib/cron-auth';
import { startCronRun, type CronRun } from '@/lib/cron-runs';
import { resolveOutboundUrl } from '@/lib/outbound';
import { readAffiliateSettings } from '@/lib/settings';
import { dropSince, priceStats, type PricePoint } from '@/lib/deals';
import { captionDiscount } from '@/lib/content/captions';
import {
  TELEGRAM_RULES,
  pickForTelegram,
  selectSocialProducts,
  sendPhoto,
  telegramCaption,
  telegramConfig,
  type SocialProduct,
  type TelegramPick,
} from '@/lib/social/telegram';

/**
 * Publica en el canal de Telegram las mejores ofertas del momento (3 a 5).
 *
 * ?dry=1 devuelve la selección sin publicar nada, para revisarla antes de
 * encender el bot (funciona aunque falte el token).
 *
 * Sin TELEGRAM_BOT_TOKEN responde ok y no hace nada: el canal es opcional y
 * un cron que falla todos los días solo genera alertas inútiles.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Pausa entre posts: una ráfaga de 5 queda muy bajo el límite de 20 por minuto. */
const POST_SPACING_MS = 1200;

const NOOP_RUN: CronRun = { finish: async () => {} };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Productos ya publicados en Telegram en los últimos 14 días: los posts
 * registrados más los marcados a mano desde el admin. null si la tabla
 * social_posts todavía no existe.
 */
async function recentlyPosted(
  admin: SupabaseClient,
  rows: SocialProduct[],
  now: Date
): Promise<Set<string> | null> {
  const since = new Date(now.getTime() - TELEGRAM_RULES.repeatAfterDays * 86_400_000);
  const ids = new Set<string>();
  for (const p of rows) {
    if (p.rrss_channel === 'telegram' && p.rrss_published_at && new Date(p.rrss_published_at) >= since) {
      ids.add(p.id);
    }
  }

  const { data, error } = await admin
    .from('social_posts')
    .select('product_id')
    .eq('channel', 'telegram')
    .neq('status', 'error')
    .gte('posted_at', since.toISOString());
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
 * Bajas de precio confirmadas por el historial propio (en %), solo para los
 * que no llegan al descuento mínimo: a los demás no les hace falta. Sin la
 * tabla price_history, ninguna.
 */
async function historyDrops(admin: SupabaseClient, rows: SocialProduct[], now: Date): Promise<Map<string, number>> {
  const drops = new Map<string, number>();
  const ids = rows.filter((p) => captionDiscount(p) < TELEGRAM_RULES.minDiscount).map((p) => p.id);
  if (ids.length === 0) return drops;

  // 60 días alcanzan para ver el precio anterior a una baja de los últimos
  // 30, que es lo que dropSince considera noticia.
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('price_history')
    .select('product_id, price, observed_at')
    .in('product_id', ids)
    .gte('observed_at', since)
    .order('observed_at', { ascending: true })
    .limit(5000);
  if (error) {
    if (!isMissingSchemaError(error)) console.warn('[social-telegram] historial no disponible:', error.message);
    return drops;
  }

  const byProduct = new Map<string, PricePoint[]>();
  for (const row of (data ?? []) as (PricePoint & { product_id: string })[]) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push({ price: row.price, observed_at: row.observed_at });
    byProduct.set(row.product_id, list);
  }
  for (const p of rows) {
    const history = byProduct.get(p.id);
    if (!history) continue;
    const drop = dropSince(priceStats(history, now.getTime()), p.price, now.getTime());
    if (drop) drops.set(p.id, (drop.amount / (p.price + drop.amount)) * 100);
  }
  return drops;
}

function describe(pick: TelegramPick<SocialProduct>) {
  return {
    id: pick.product.id,
    nombre: pick.product.name,
    categoria: pick.product.category,
    precio: pick.product.price,
    descuento: pick.discount,
    baja_historial: pick.drop === null ? null : Math.round(pick.drop),
    comision_estimada: pick.commission,
    motivo: pick.reason,
  };
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dry = req.nextUrl.searchParams.get('dry') === '1';
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  if (!dry && !hasToken) return NextResponse.json({ ok: true, skipped: 'Falta TELEGRAM_BOT_TOKEN' });
  const cfg = telegramConfig();
  if (!dry && !cfg) return NextResponse.json({ ok: true, skipped: 'Falta TELEGRAM_CHANNEL_ID' });

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const run = dry ? NOOP_RUN : await startCronRun(admin, 'social-telegram');
  const now = new Date();
  const freshSince = new Date(now.getTime() - TELEGRAM_RULES.maxPriceAgeMs).toISOString();

  try {
    const read = await selectSocialProducts((columns, has0017) => {
      let query = admin
        .from('products')
        .select(columns)
        .eq('is_active', true)
        .eq('is_hidden', false)
        .gte('price_checked_at', freshSince);
      if (has0017) query = query.is('deleted_at', null);
      return query;
    });
    if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);

    const posted = await recentlyPosted(admin, read.rows, now);
    const drops = await historyDrops(admin, read.rows, now);
    const picks = pickForTelegram(read.rows, { now, recentlyPosted: posted ?? new Set(), drops });

    if (dry) {
      return NextResponse.json({
        ok: true,
        dry: true,
        falta_token: !hasToken,
        falta_canal: !process.env.TELEGRAM_CHANNEL_ID?.trim(),
        falta_tabla_social_posts: posted === null,
        con_precio_fresco: read.rows.length,
        seleccion: picks.map(describe),
        aviso:
          picks.length < TELEGRAM_RULES.minPosts
            ? `Solo ${picks.length} producto(s) cumplen las reglas hoy; se publicarían igual.`
            : undefined,
      });
    }

    // Sin la tabla no hay cómo evitar repetir ni corregir los posts después:
    // mejor no publicar.
    if (posted === null) {
      const summary = { ok: true, skipped: 'Falta la tabla social_posts (migración 0017)' };
      await run.finish(true, summary);
      return NextResponse.json(summary);
    }

    if (!cfg) throw new Error('Falta la configuración de Telegram');
    const settings = await readAffiliateSettings(admin);
    const published: ReturnType<typeof describe>[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const [i, pick] of picks.entries()) {
      if (i > 0) await sleep(POST_SPACING_MS);
      const p = pick.product;
      // El mismo destino que el botón del sitio: si los links directos están
      // encendidos, también acá.
      const link = resolveOutboundUrl(p, settings);
      const caption = telegramCaption(p, link, now);
      const sent = await sendPhoto(cfg, { photoUrl: p.image_url, caption, buttonUrl: link });

      if (!sent.ok) {
        errors.push({ id: p.id, error: sent.error });
        await admin.from('social_posts').insert({
          product_id: p.id,
          channel: 'telegram',
          posted_price: p.price,
          caption,
          status: 'error',
          error: sent.error,
        });
        continue;
      }

      published.push(describe(pick));
      const { error: insertError } = await admin.from('social_posts').insert({
        product_id: p.id,
        channel: 'telegram',
        external_id: String(sent.messageId),
        posted_price: p.price,
        caption,
        status: 'publicado',
      });
      if (insertError) console.error('[social-telegram] no se pudo registrar el post:', insertError.message);

      const stamp = { rrss_status: 'publicado', rrss_published_at: now.toISOString(), rrss_channel: 'telegram' };
      const { error: markError } = await admin.from('products').update(stamp).eq('id', p.id);
      if (markError && isMissingSchemaError(markError)) {
        await admin.from('products').update({ rrss_status: 'publicado' }).eq('id', p.id);
      }
    }

    const summary = {
      ok: errors.length === 0 || published.length > 0,
      publicados: published.length,
      errores: errors,
      seleccion: published,
    };
    await run.finish(summary.ok, summary, errors.length ? errors.map((e) => e.error).join(' | ') : undefined);
    return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
