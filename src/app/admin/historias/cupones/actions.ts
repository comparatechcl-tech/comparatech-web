'use server';

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { SITE_URL } from '@/lib/site';
import { chileDay } from '@/lib/social/carousel-url';
import { publishState, type PublishEvent } from '@/lib/social/carousel-publish';
import {
  couponCaptions,
  couponDayLabel,
  couponPublishTarget,
  couponsProblem,
  parseCouponTargets,
  toCoupons,
  type Coupon,
  type CouponTarget,
} from '@/lib/social/coupons';
import { couponExpiry, couponKey, couponPath } from '@/lib/social/coupons-url';
import { metaCredentials, metaErrorMessage, readMetaConnection, redactTokens } from '@/lib/social/meta';
import { PublishError, publishFacebookPhotos, publishInstagramImage } from '@/lib/social/meta-publish';

/**
 * Los cupones del canal de afiliados, desde /admin/historias/cupones: armar
 * la imagen (feed e historia) con su texto, y publicarla en Instagram y
 * Facebook con la app de Meta cuando el dueño toca el botón.
 *
 * El servidor arma todo de nuevo con lo que llega: las mismas direcciones
 * firmadas que vio el dueño y el texto de cada red. Cada intento queda en la
 * actividad ('publicar_meta', con target cupones:{día}:{códigos}): así un
 * segundo toque u otra pestaña no publican dos veces lo mismo en el mismo
 * lugar.
 */

export interface PreparedCoupons {
  day: number;
  dayLabel: string;
  /** Rutas firmadas de las dos imágenes (sin dominio). */
  feed: string;
  historia: string;
  captions: { instagram: string; facebook: string };
}

export type PrepareResult = ({ ok: true } & PreparedCoupons) | { ok: false; error: string };

export type TargetResult = { ok: true; permalink: string | null; already?: true } | { ok: false; error: string; uncertain?: true };

export type PublishCouponsResult =
  | { ok: false; error: string }
  | { ok: true; dayLabel: string; results: Partial<Record<CouponTarget, TargetResult>> };

const LOOKBACK_MS = 3 * 86_400_000;

function prepare(raw: unknown, now: Date): { ok: true; coupons: Coupon[]; prepared: PreparedCoupons } | { ok: false; error: string } {
  const coupons = toCoupons(raw);
  if (!coupons) return { ok: false, error: 'Los cupones no tienen la forma esperada. Recarga la página.' };
  const problem = couponsProblem(coupons);
  if (problem) return { ok: false, error: problem };
  const key = couponKey();
  if (!key) return { ok: false, error: 'Falta CRON_SECRET: no se pueden firmar las imágenes.' };
  const day = chileDay(now);
  const set = { day, coupons, expiresAt: couponExpiry(now) };
  const feed = couponPath(set, 'feed', key);
  const historia = couponPath(set, 'historia', key);
  if (!feed || !historia) return { ok: false, error: 'No se pudo armar la imagen con estos cupones.' };
  return {
    ok: true,
    coupons,
    prepared: { day, dayLabel: couponDayLabel(day), feed, historia, captions: couponCaptions(coupons, day, SITE_URL) },
  };
}

export async function prepareCoupons(input: { coupons: unknown }): Promise<PrepareResult> {
  await requireAdmin();
  const r = prepare(input?.coupons, new Date());
  return r.ok ? { ok: true, ...r.prepared } : r;
}

/** Que la imagen se pueda bajar antes de pedirle a Meta que la baje: así el error es claro y queda lista en caché. */
async function imageReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/jpeg');
  } catch {
    return false;
  }
}

export async function publishCouponsOnMeta(input: { coupons: unknown; targets: unknown }): Promise<PublishCouponsResult> {
  const actor = await requireAdmin();
  const targets = parseCouponTargets(input?.targets);
  if (!targets) return { ok: false, error: 'Elige al menos un lugar donde publicar.' };
  const ready = prepare(input?.coupons, new Date());
  if (!ready.ok) return ready;
  const { coupons, prepared } = ready;

  const creds = metaCredentials();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };
  const { connection } = await readMetaConnection(admin);
  if (!creds || !connection) return { ok: false, error: 'Meta no está conectado. Conéctalo en Configuración → Instagram y Facebook.' };
  const conn = connection;
  const appCreds = creds;

  const base = SITE_URL.replace(/\/+$/, '');
  const feedUrl = `${base}${prepared.feed}`;
  const storyUrl = `${base}${prepared.historia}`;
  const needed = [targets.some((t) => t !== 'historia') ? feedUrl : null, targets.includes('historia') ? storyUrl : null].filter(
    (u): u is string => u !== null
  );
  const images = await Promise.all(needed.map(imageReady));
  if (images.some((ok) => !ok)) return { ok: false, error: 'El sitio no pudo armar la imagen ahora. Prueba otra vez en un minuto.' };

  const target = couponPublishTarget(prepared.day, coupons);
  const history = await admin
    .from('admin_audit_log')
    .select('at, after')
    .eq('action', 'publicar_meta')
    .eq('target', target)
    .gte('at', new Date(Date.now() - LOOKBACK_MS).toISOString())
    .order('at', { ascending: false })
    .limit(50);
  if (history.error) return { ok: false, error: 'No pude revisar si estos cupones ya se publicaron. Prueba otra vez en un momento.' };
  const events = (history.data ?? []) as PublishEvent[];

  const log = (red: CouponTarget, after: Record<string, unknown>) =>
    logAdminEvent(admin, { actor, action: 'publicar_meta', target, after: { red, ...after } });

  async function publishOn(t: CouponTarget): Promise<TargetResult> {
    const state = publishState(events, t, Date.now());
    if (state.kind === 'publicado') return { ok: true, permalink: state.permalink, already: true };
    if (state.kind === 'en-curso') {
      return {
        ok: false,
        error: state.uncertain
          ? 'Hace poco no llegó la respuesta de Meta: revisa si salió antes de volver a intentar (en 10 minutos se puede de nuevo).'
          : 'Se está publicando desde otra pestaña o un toque anterior. Espera un minuto.',
      };
    }
    await log(t, { estado: 'publicando' });
    try {
      const done =
        t === 'instagram'
          ? await publishInstagramImage(conn, appCreds, { imageUrl: feedUrl, caption: prepared.captions.instagram }).then((r) => ({
              id: r.mediaId,
              permalink: r.permalink,
            }))
          : t === 'historia'
            ? await publishInstagramImage(conn, appCreds, { imageUrl: storyUrl, story: true }).then((r) => ({
                id: r.mediaId,
                permalink: r.permalink,
              }))
            : await publishFacebookPhotos(conn, appCreds, { imageUrls: [feedUrl], message: prepared.captions.facebook }).then((r) => ({
                id: r.postId,
                permalink: r.permalink,
              }));
      await log(t, { estado: 'publicado', id: done.id, permalink: done.permalink, codigos: coupons.map((c) => c.code) });
      return { ok: true, permalink: done.permalink };
    } catch (err) {
      const uncertain = err instanceof PublishError && err.uncertain;
      const error = err instanceof PublishError ? err.message : metaErrorMessage(err, 'guardada');
      const detalle = err instanceof Error ? redactTokens(err.message).slice(0, 500) : null;
      await log(t, { estado: uncertain ? 'incierto' : 'error', error, detalle });
      return uncertain ? { ok: false, error, uncertain: true } : { ok: false, error };
    }
  }

  const settled = await Promise.all(targets.map(async (t) => [t, await publishOn(t)] as const));
  const results: Partial<Record<CouponTarget, TargetResult>> = {};
  for (const [t, result] of settled) results[t] = result;
  return { ok: true, dayLabel: prepared.dayLabel, results };
}
