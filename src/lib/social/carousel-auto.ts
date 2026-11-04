import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminEvent } from '@/lib/admin-audit';
import { getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { CAROUSEL_RULES, buildWeeklyCarousel, pickCarouselDrops, type CarouselPick } from '@/lib/social/carousel';
import { CAROUSEL_CHANNEL, CAROUSEL_MARK, lastShownAt, readCarouselMarks } from '@/lib/social/carousel-marks';
import { carouselPublishTarget, publishState, type MetaNetwork, type PublishEvent } from '@/lib/social/carousel-publish';
import { addDays, carouselKey, chileDay } from '@/lib/social/carousel-url';
import type { LiveCheck, ShownOffer } from '@/lib/social/live-price';
import { metaCredentials, metaErrorMessage, readMetaConnection, redactTokens } from '@/lib/social/meta';
import { PublishError, publishFacebookPhotos, publishInstagramCarousel, type PublishDeps } from '@/lib/social/meta-publish';
import { readFreshSocialProducts } from '@/lib/social/telegram';

/**
 * El carrusel "Top bajas de la semana" sale solo en Instagram y Facebook los
 * jueves, y además el 28 y el 30-11-2026 (Black Friday). El dueño lo
 * autorizó el 03-11-2026 (letra E del plan): solo bajas que confirma el
 * historial propio y con el precio revisado en Mercado Libre en el momento.
 *
 * Es el mismo carrusel de /admin/historias/carrusel, con las mismas reglas:
 * si ya salió uno en los últimos 7 días no se arma otro (salvo los días
 * extra), un producto cuyo precio cambió en Mercado Libre se saca, y con
 * menos de 3 bajas no sale. Cada intento queda en la actividad
 * ('publicar_meta', el mismo registro del botón), así una pasada de más
 * nunca lo publica dos veces, y si sale queda marcado como publicado.
 */

export const CAROUSEL_AUTO_ACTOR = 'carrusel automático';
/** Jueves (getUTCDay de la fecha en Chile). */
export const CAROUSEL_AUTO_WEEKDAY = 4;
/** Los días extra: viernes 27 y lunes 30 son del Black Friday, el jueves 26 ya es día normal. */
export const CAROUSEL_AUTO_EXTRA_DAYS: readonly number[] = [20261128, 20261130];

const LOOKBACK_MS = 8 * 86_400_000;
const MARKS_LOOKBACK_MS = 14 * 86_400_000;

export interface CarouselAutoDeps extends PublishDeps {
  liveCheck(items: { productId: string; shown: ShownOffer }[]): Promise<Record<string, LiveCheck>>;
  siteUrl: string;
}

export interface CarouselAutoSummary {
  ok: boolean;
  skipped?: string;
  day?: number;
  products?: number;
  /** Productos que se sacaron porque el precio cambió en Mercado Libre. */
  removed?: number;
  results?: Partial<Record<MetaNetwork, { ok: boolean; permalink?: string | null; error?: string; already?: boolean }>>;
  marked?: boolean;
}

/** ¿Hoy toca? Jueves o un día extra (fecha en Chile, AAAAMMDD). Puro. */
export function isCarouselAutoDay(day: number): boolean {
  const y = Math.floor(day / 10_000);
  const m = Math.floor(day / 100) % 100;
  const d = day % 100;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === CAROUSEL_AUTO_WEEKDAY || CAROUSEL_AUTO_EXTRA_DAYS.includes(day);
}

/** Lo que muestra la lámina de un producto: con esto se compara en Mercado Libre. */
function shownOf(pick: CarouselPick): ShownOffer {
  const p = pick.product;
  return {
    price: Math.round(p.price),
    listPrice: p.original_price && p.original_price > p.price ? Math.round(p.original_price) : null,
    freeShipping: p.offer_info?.free_shipping === true,
    full: p.offer_info?.is_full === true,
  };
}

export async function runCarouselAuto(admin: SupabaseClient, now: Date, deps: CarouselAutoDeps): Promise<CarouselAutoSummary> {
  const day = chileDay(now);
  if (!isCarouselAutoDay(day)) return { ok: true, skipped: 'Hoy no toca carrusel (sale los jueves).', day };

  const key = carouselKey();
  if (!key) return { ok: false, skipped: 'Falta CRON_SECRET: no se pueden firmar las láminas.', day };
  const creds = metaCredentials();
  const { connection } = await readMetaConnection(admin);
  if (!creds || !connection) return { ok: false, skipped: 'Meta no está conectado (Configuración → Instagram y Facebook).', day };

  const batches = await readCarouselMarks(admin, new Date(now.getTime() - MARKS_LOOKBACK_MS));
  const latest = batches[0];
  const extra = CAROUSEL_AUTO_EXTRA_DAYS.includes(day);
  if (latest) {
    const latestDay = chileDay(new Date(latest.postedAt));
    if (latestDay === day) return { ok: true, skipped: 'El carrusel de hoy ya salió.', day };
    if (!extra && day < addDays(latestDay, CAROUSEL_RULES.everyDays)) {
      return { ok: true, skipped: 'Ya salió un carrusel en los últimos 7 días.', day };
    }
  }

  const read = await readFreshSocialProducts(admin, new Date(now.getTime() - CAROUSEL_RULES.maxPriceAgeMs).toISOString());
  if (read.error) return { ok: false, skipped: `No se pudo leer el catálogo: ${read.error}`, day };
  const history = await getPriceStatsManyChecked(read.rows.map((p) => p.id));
  const selection = pickCarouselDrops(read.rows, history.stats, { now, shownAt: lastShownAt(batches) });
  if (selection.picks.length < CAROUSEL_RULES.minSize) {
    return { ok: true, skipped: `Hay ${selection.picks.length} bajas confirmadas esta semana: con menos de ${CAROUSEL_RULES.minSize} no sale.`, day };
  }

  // El precio en Mercado Libre, ahora: lo que cambió no va.
  const checks = await deps.liveCheck(selection.picks.map((pick) => ({ productId: pick.product.id, shown: shownOf(pick) })));
  const kept = selection.picks.filter((pick) => checks[pick.product.id]?.status === 'same');
  const removed = selection.picks.length - kept.length;
  const carousel = buildWeeklyCarousel(kept, { now, key, siteUrl: deps.siteUrl });
  if (!carousel) {
    return { ok: true, skipped: `Después de revisar en Mercado Libre quedaron ${kept.length} bajas: con menos de ${CAROUSEL_RULES.minSize} no sale.`, day, removed };
  }

  const base = deps.siteUrl.replace(/\/+$/, '');
  const imageUrls = [carousel.cover.image, ...carousel.entries.map((e) => e.image), carousel.closing.image].map((path) => `${base}${path}`);
  const target = carouselPublishTarget({ kind: carousel.kind, day: carousel.day, ids: carousel.entries.map((e) => e.id) });

  const historyRead = await admin
    .from('admin_audit_log')
    .select('at, after')
    .eq('action', 'publicar_meta')
    .eq('target', target)
    .gte('at', new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .order('at', { ascending: false })
    .limit(50);
  if (historyRead.error) return { ok: false, skipped: 'No se pudo revisar si este carrusel ya se publicó.', day };
  const events = (historyRead.data ?? []) as PublishEvent[];
  const log = (red: MetaNetwork, after: Record<string, unknown>) =>
    logAdminEvent(admin, { actor: CAROUSEL_AUTO_ACTOR, action: 'publicar_meta', target, after: { red, ...after } });

  const results: NonNullable<CarouselAutoSummary['results']> = {};
  for (const network of ['instagram', 'facebook'] as const) {
    const state = publishState(events, network, now.getTime());
    if (state.kind === 'publicado') {
      results[network] = { ok: true, permalink: state.permalink, already: true };
      continue;
    }
    if (state.kind === 'en-curso') {
      results[network] = { ok: false, error: 'Hay un intento de hace menos de 10 minutos sin respuesta final.' };
      continue;
    }
    await log(network, { estado: 'publicando' });
    try {
      const done =
        network === 'instagram'
          ? await publishInstagramCarousel(connection, creds, { imageUrls, caption: carousel.captions.instagram }, deps).then((r) => ({
              id: r.mediaId,
              permalink: r.permalink,
            }))
          : await publishFacebookPhotos(connection, creds, { imageUrls, message: carousel.captions.facebook }, deps).then((r) => ({
              id: r.postId,
              permalink: r.permalink,
            }));
      await log(network, { estado: 'publicado', id: done.id, permalink: done.permalink, precios: carousel.entries.map((e) => e.price) });
      results[network] = { ok: true, permalink: done.permalink };
    } catch (err) {
      const uncertain = err instanceof PublishError && err.uncertain;
      const error = err instanceof PublishError ? err.message : metaErrorMessage(err, 'guardada');
      const detalle = err instanceof Error ? redactTokens(err.message).slice(0, 500) : null;
      await log(network, { estado: uncertain ? 'incierto' : 'error', error, detalle });
      results[network] = { ok: false, error };
    }
  }

  const anyNew = Object.values(results).some((r) => r?.ok && !r.already);
  let marked = false;
  if (anyNew) {
    // Todas con la misma hora: esa hora es el carrusel (lib/social/carousel-marks). Así /hoy muestra sus productos.
    const postedAt = new Date(now.getTime()).toISOString();
    const { error } = await admin.from('social_posts').insert(
      carousel.entries.map((e) => ({
        product_id: e.id,
        channel: CAROUSEL_CHANNEL,
        posted_price: e.price,
        caption: CAROUSEL_MARK,
        status: 'publicado',
        posted_at: postedAt,
      }))
    );
    marked = !error;
    if (error) console.error(`[carousel-auto] no se pudo marcar: ${error.message}`);
  }

  const ok = Object.values(results).every((r) => r?.ok);
  return { ok, day, products: carousel.entries.length, removed, results, marked };
}
