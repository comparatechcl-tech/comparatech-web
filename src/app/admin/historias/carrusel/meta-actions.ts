'use server';

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { buildCarouselCaptions } from '@/lib/content/captions';
import { socialProductName } from '@/lib/content/social-name';
import { SITE_URL } from '@/lib/site';
import { carouselKey, carouselRangeLabel } from '@/lib/social/carousel-url';
import {
  carouselPublishTarget,
  parseNetworks,
  publishState,
  verifyCarouselSlides,
  type MetaNetwork,
  type PublishEvent,
} from '@/lib/social/carousel-publish';
import { metaCredentials, metaErrorMessage, readMetaConnection } from '@/lib/social/meta';
import { PublishError, publishFacebookPhotos, publishInstagramCarousel } from '@/lib/social/meta-publish';
import { isOnSale, selectSocialProducts } from '@/lib/social/telegram';
import { markCarouselPublished } from './actions';

/**
 * Publicar el carrusel de la semana en Instagram y en la página de Facebook
 * con la app propia de Meta, cuando el dueño toca el botón. Sin pasar por
 * Compartir, así que las láminas salen completas (4:5), sin el recorte
 * cuadrado de esa vía.
 *
 * Lo que se publica sale de las direcciones firmadas de las láminas que el
 * dueño está viendo (lib/social/carousel-publish) y de los precios de la
 * base en este momento: si alguno cambió, no se publica. El texto lo arma el
 * servidor igual que la página.
 *
 * Cada intento queda en la actividad ('publicar_meta'): así un segundo toque,
 * otra pestaña o un reintento no publican dos veces el mismo carrusel en la
 * misma red. Si sale en alguna red, queda marcado como publicado (lo mismo
 * que "Ya lo publiqué").
 */

export type NetworkResult =
  | { ok: true; permalink: string | null; already?: true }
  | { ok: false; error: string; uncertain?: true };

export type PublishCarouselResult =
  | { ok: false; error: string }
  | {
      ok: true;
      results: Partial<Record<MetaNetwork, NetworkResult>>;
      mark: { postIds: number[]; postedAt: string } | null;
      markError?: string;
    };

const LOOKBACK_MS = 8 * 86_400_000;

export async function publishCarouselOnMeta(input: { slides: string[]; networks: MetaNetwork[] }): Promise<PublishCarouselResult> {
  const actor = await requireAdmin();
  const networks = parseNetworks(input?.networks);
  if (!networks) return { ok: false, error: 'Elige Instagram, Facebook o las dos.' };

  const key = carouselKey();
  if (!key) return { ok: false, error: 'Falta CRON_SECRET: no se pueden revisar las imágenes.' };
  const verified = verifyCarouselSlides(input?.slides, key, Math.floor(Date.now() / 1000));
  if (!verified.ok) return verified;
  const { set, items, paths } = verified.carousel;

  const creds = metaCredentials();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };
  const { connection } = await readMetaConnection(admin);
  if (!creds || !connection) {
    return { ok: false, error: 'Meta no está conectado. Conéctalo en Configuración → Instagram y Facebook.' };
  }
  const conn = connection;
  const appCreds = creds;

  // Lo que dicen las láminas tiene que seguir siendo cierto en la base.
  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', set.ids));
  if (read.error) return { ok: false, error: read.error };
  const byId = new Map(read.rows.map((p) => [p.id, p]));
  const names: string[] = [];
  for (let i = 0; i < set.ids.length; i++) {
    const product = byId.get(set.ids[i]);
    if (!isOnSale(product)) return { ok: false, error: 'Un producto del carrusel ya no está a la venta. Toca Actualizar.' };
    const name = socialProductName(product);
    if (Math.round(product.price) !== items[i].price) {
      return { ok: false, error: `El precio de ${name} cambió desde que se armó el carrusel. Toca Actualizar.` };
    }
    names.push(name);
  }

  const captions = buildCarouselCaptions(
    items.map((item, i) => ({
      name: names[i],
      price: item.price,
      dropAmount: item.dropAmount,
      price_checked_at: item.checkedAt > 0 ? new Date(item.checkedAt * 1000).toISOString() : null,
    })),
    { rangeLabel: carouselRangeLabel(set.kind, set.day), siteUrl: SITE_URL }
  );
  const base = SITE_URL.replace(/\/+$/, '');
  const imageUrls = paths.map((path) => `${base}${path}`);
  const target = carouselPublishTarget(set);

  const history = await admin
    .from('admin_audit_log')
    .select('at, after')
    .eq('action', 'publicar_meta')
    .eq('target', target)
    .gte('at', new Date(Date.now() - LOOKBACK_MS).toISOString())
    .order('at', { ascending: false })
    .limit(50);
  if (history.error) return { ok: false, error: 'No pude revisar si este carrusel ya se publicó. Prueba otra vez en un momento.' };
  const events = (history.data ?? []) as PublishEvent[];

  const log = (red: MetaNetwork, after: Record<string, unknown>) =>
    logAdminEvent(admin, { actor, action: 'publicar_meta', target, after: { red, ...after } });

  async function publishOn(network: MetaNetwork): Promise<NetworkResult> {
    const state = publishState(events, network, Date.now());
    if (state.kind === 'publicado') return { ok: true, permalink: state.permalink, already: true };
    if (state.kind === 'en-curso') {
      return {
        ok: false,
        error: state.uncertain
          ? 'Hace poco no llegó la respuesta de Meta: revisa si salió antes de volver a intentar (en 10 minutos se puede de nuevo).'
          : 'Se está publicando desde otra pestaña o un toque anterior. Espera un minuto y toca Actualizar.',
      };
    }
    await log(network, { estado: 'publicando' });
    try {
      const done =
        network === 'instagram'
          ? await publishInstagramCarousel(conn, appCreds, {
              imageUrls,
              caption: captions.instagram,
            }).then((r) => ({ id: r.mediaId, permalink: r.permalink }))
          : await publishFacebookPhotos(conn, appCreds, {
              imageUrls,
              message: captions.facebook,
            }).then((r) => ({ id: r.postId, permalink: r.permalink }));
      await log(network, { estado: 'publicado', id: done.id, permalink: done.permalink, precios: items.map((i) => i.price) });
      return { ok: true, permalink: done.permalink };
    } catch (err) {
      const uncertain = err instanceof PublishError && err.uncertain;
      const error = err instanceof PublishError ? err.message : metaErrorMessage(err);
      await log(network, { estado: uncertain ? 'incierto' : 'error', error });
      return uncertain ? { ok: false, error, uncertain: true } : { ok: false, error };
    }
  }

  const settled = await Promise.all(networks.map(async (network) => [network, await publishOn(network)] as const));
  const results: Partial<Record<MetaNetwork, NetworkResult>> = {};
  for (const [network, result] of settled) results[network] = result;

  // Salió en alguna red: queda marcado igual que con "Ya lo publiqué" (no repite si ya estaba).
  if (!settled.some(([, result]) => result.ok)) return { ok: true, results, mark: null };
  const mark = await markCarouselPublished(set.ids.map((id, i) => ({ productId: id, price: items[i].price })));
  return mark.ok
    ? { ok: true, results, mark: { postIds: mark.postIds, postedAt: mark.postedAt } }
    : { ok: true, results, mark: null, markError: mark.error };
}
