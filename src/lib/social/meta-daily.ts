import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminEvent } from '@/lib/admin-audit';
import { chileDay } from './carousel-url';
import type { LiveCheck, ShownOffer } from './live-price';
import { metaCredentials, metaErrorMessage, readMetaConnection, redactTokens, type MetaConnection, type MetaCredentials } from './meta';
import {
  PublishError,
  createInstagramReel,
  instagramContainerStatus,
  publishFacebookReel,
  publishInstagramContainer,
  type PublishDeps,
} from './meta-publish';
import { VIDEO_MARK, VIDEO_WARNING_MARK, type ReadyVideo, type VideoBoard } from './videos';

/**
 * La publicación diaria automática en Instagram y Facebook: un reel de
 * oferta al día, con la app propia de Meta. El dueño la autorizó el
 * 25-10-2026 ("automática, dale con todo"), con las mismas reglas que las
 * publicaciones automáticas del feed:
 * - a lo más 1 por día;
 * - solo un video listo de /admin/videos (con el precio de ahora y revisado
 *   hace poco), sin un "Ojo" que mirar a mano y que no se haya subido a
 *   Instagram ni a Facebook en los últimos 14 días;
 * - y con el precio confirmado en Mercado Libre en el momento.
 *
 * Corre dos veces al día (app/api/cron/meta-diario). La primera elige y
 * publica. Instagram procesa el video por su cuenta: si en la primera no
 * alcanza a estar listo, la segunda lo publica. Lo que se hizo queda en
 * admin_private_settings (clave meta_daily), para no repetir nunca el mismo
 * día aunque la tarea corra de más; en la actividad del admin; y como marca
 * de video en social_posts, así /admin/videos lo muestra subido a esas redes
 * y /hoy lo lista.
 */

export const META_DAILY_KEY = 'meta_daily';
export const DAILY_ACTOR = 'publicación diaria';
/** Cuántos videos se revisan en Mercado Libre, en orden, hasta dar con uno igual. */
export const DAILY_CANDIDATES = 3;
/** Un reel de Instagram que no termina de procesarse en este plazo se da por fallido. */
export const IG_PROCESSING_GIVE_UP_MS = 3 * 3600_000;

type NetworkStatus = 'pendiente' | 'procesando' | 'publicado' | 'error' | 'incierto';

export interface DailyNetwork {
  status: NetworkStatus;
  /** Instagram: el contenedor mientras se procesa. */
  containerId?: string;
  /** El id de lo publicado (media de Instagram o video de Facebook). */
  id?: string;
  permalink?: string | null;
  error?: string;
  at: string;
}

export interface DailyState {
  /** El día en Chile (AAAAMMDD). */
  day: number;
  productId: string;
  name: string;
  price: number;
  videoUrl: string;
  instagram: DailyNetwork;
  facebook: DailyNetwork;
}

export interface DailySummary {
  ok: boolean;
  /** Por qué no se hizo nada hoy, si no se hizo. */
  skipped?: string;
  state?: DailyState;
}

export interface DailyDeps extends PublishDeps {
  readBoard(admin: SupabaseClient, now: Date): Promise<VideoBoard>;
  liveCheck(items: { productId: string; shown: ShownOffer }[]): Promise<Record<string, LiveCheck>>;
  /** Cuánto esperar en esta pasada a que Instagram procese el reel. */
  igWaitMs?: number;
  now?: () => number;
}

/** Lo que el video muestra de la oferta: con esto se compara en Mercado Libre. */
function shownOf(video: ReadyVideo): ShownOffer {
  return { price: video.price, listPrice: video.listPrice, freeShipping: video.freeShipping, full: video.full };
}

/** Los videos que se pueden publicar solos hoy, en el orden de la página (más puntos primero). Puro. */
export function dailyCandidates(videos: ReadyVideo[]): ReadyVideo[] {
  return videos.filter(
    (v) =>
      !v.posted.instagram &&
      !v.posted.facebook &&
      !v.reason.includes(VIDEO_WARNING_MARK) &&
      v.price > 0 &&
      v.videoUrl.startsWith('https://')
  );
}

async function readState(admin: SupabaseClient): Promise<{ ok: true; state: DailyState | null } | { ok: false; error: string }> {
  const { data, error } = await admin.from('admin_private_settings').select('value').eq('key', META_DAILY_KEY).maybeSingle();
  if (error) return { ok: false, error: error.message };
  const value = data?.value as DailyState | undefined;
  return { ok: true, state: value && typeof value.day === 'number' ? value : null };
}

async function writeState(admin: SupabaseClient, state: DailyState): Promise<boolean> {
  const { error } = await admin
    .from('admin_private_settings')
    .upsert({ key: META_DAILY_KEY, value: state, updated_at: new Date().toISOString() });
  return !error;
}

/** La marca de video (como "Ya lo subí" en /admin/videos), con el id de lo publicado. */
async function markPosted(admin: SupabaseClient, state: DailyState, network: 'instagram' | 'facebook', externalId: string) {
  const { error } = await admin.from('social_posts').insert({
    product_id: state.productId,
    channel: network,
    posted_price: state.price,
    caption: VIDEO_MARK,
    status: 'publicado',
    external_id: externalId,
  });
  if (error) console.error(`[meta-daily] no se pudo marcar ${network}: ${error.message}`);
}

function failure(err: unknown): { status: NetworkStatus; error: string } {
  const uncertain = err instanceof PublishError && err.uncertain;
  const message = err instanceof PublishError ? err.message : metaErrorMessage(err, 'guardada');
  const detail = err instanceof Error ? redactTokens(err.message).slice(0, 300) : '';
  return { status: uncertain ? 'incierto' : 'error', error: detail && detail !== message ? `${message} (${detail})` : message };
}

/**
 * Instagram: si el reel ya está procesado, lo publica; si no, espera hasta
 * `waitMs` en esta pasada. Devuelve el estado nuevo de la red.
 */
async function advanceInstagram(
  conn: MetaConnection,
  creds: MetaCredentials,
  ig: DailyNetwork,
  deps: DailyDeps,
  waitMs: number
): Promise<DailyNetwork> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const containerId = ig.containerId as string;
  const deadline = now() + waitMs;
  for (;;) {
    const code = await instagramContainerStatus(conn, creds, containerId, deps);
    if (code === 'FINISHED') {
      const done = await publishInstagramContainer(conn, creds, containerId, deps);
      return { status: 'publicado', containerId, id: done.mediaId, permalink: done.permalink, at: new Date(now()).toISOString() };
    }
    if (code === 'PUBLISHED') return { ...ig, status: 'publicado', at: new Date(now()).toISOString() };
    if (code === 'ERROR' || code === 'EXPIRED') {
      return { ...ig, status: 'error', error: `Instagram no pudo procesar el reel (${code}).`, at: new Date(now()).toISOString() };
    }
    if (now() - new Date(ig.at).getTime() > IG_PROCESSING_GIVE_UP_MS) {
      return { ...ig, status: 'error', error: 'Instagram no terminó de procesar el reel en 3 horas.', at: new Date(now()).toISOString() };
    }
    if (now() >= deadline) return ig;
    await sleep(5_000);
  }
}

export async function runMetaDaily(admin: SupabaseClient, at: Date, deps: DailyDeps): Promise<DailySummary> {
  const now = deps.now ?? Date.now;
  const creds = metaCredentials();
  const { connection } = await readMetaConnection(admin);
  if (!creds || !connection) return { ok: false, skipped: 'Meta no está conectado (Configuración → Instagram y Facebook).' };

  const read = await readState(admin);
  // Sin poder leer lo que ya se hizo hoy, no se publica: podría repetirse.
  if (!read.ok) return { ok: false, skipped: `No se pudo leer el estado de hoy: ${read.error}` };
  const today = chileDay(at);
  let state = read.state && read.state.day === today ? read.state : null;
  // Si las dos redes fallaron sin publicar nada (por ejemplo, con la conexión rota), la pasada siguiente lo intenta de nuevo.
  if (state && state.facebook.status === 'error' && state.instagram.status === 'error') state = null;

  if (state) {
    // Segunda pasada (o una de más): solo terminar Instagram si quedó procesándose.
    if (state.instagram.status !== 'procesando') {
      const posted = state.facebook.status === 'publicado' || state.instagram.status === 'publicado';
      return {
        ok: true,
        skipped: posted ? 'Ya se publicó hoy.' : 'Hoy ya se intentó y una red quedó sin respuesta: hay que mirarla a mano.',
        state,
      };
    }
    try {
      const ig = await advanceInstagram(connection, creds, state.instagram, deps, deps.igWaitMs ?? 40_000);
      state = { ...state, instagram: ig };
    } catch (err) {
      state = { ...state, instagram: { ...state.instagram, ...failure(err), at: new Date(now()).toISOString() } };
    }
    await writeState(admin, state);
    await logResult(admin, state, 'instagram');
    if (state.instagram.status === 'publicado' && state.instagram.id) await markPosted(admin, state, 'instagram', state.instagram.id);
    return { ok: state.instagram.status !== 'error' && state.instagram.status !== 'incierto', state };
  }

  // Primera pasada del día: elegir el video.
  const board = await deps.readBoard(admin, at);
  const candidates = dailyCandidates(board.videos).slice(0, DAILY_CANDIDATES);
  if (candidates.length === 0) return { ok: true, skipped: 'No hay un video listo que cumpla las reglas hoy.' };
  const checks = await deps.liveCheck(candidates.map((v) => ({ productId: v.id, shown: shownOf(v) })));
  const video = candidates.find((v) => checks[v.id]?.status === 'same');
  if (!video) return { ok: true, skipped: 'Ningún video pasó la revisión del precio en Mercado Libre.' };

  const stamp = new Date(now()).toISOString();
  state = {
    day: today,
    productId: video.id,
    name: video.name,
    price: video.price,
    videoUrl: video.videoUrl,
    instagram: { status: 'pendiente', at: stamp },
    facebook: { status: 'pendiente', at: stamp },
  };
  // Primero se anota el día: si después algo se corta, la próxima pasada no vuelve a publicar.
  if (!(await writeState(admin, state))) return { ok: false, skipped: 'No se pudo anotar el día: no se publicó nada.' };

  try {
    const fb = await publishFacebookReel(connection, creds, { videoUrl: video.videoUrl, description: video.texts.facebook }, deps);
    state = { ...state, facebook: { status: 'publicado', id: fb.videoId, at: new Date(now()).toISOString() } };
    await markPosted(admin, state, 'facebook', fb.videoId);
  } catch (err) {
    state = { ...state, facebook: { ...failure(err), at: new Date(now()).toISOString() } };
  }
  await writeState(admin, state);
  await logResult(admin, state, 'facebook');

  try {
    const containerId = await createInstagramReel(
      connection,
      creds,
      { videoUrl: video.videoUrl, caption: video.texts.instagram, coverUrl: video.coverUrl },
      deps
    );
    const processing: DailyNetwork = { status: 'procesando', containerId, at: new Date(now()).toISOString() };
    state = { ...state, instagram: processing };
    await writeState(admin, state);
    const ig = await advanceInstagram(connection, creds, processing, deps, deps.igWaitMs ?? 30_000);
    state = { ...state, instagram: ig };
  } catch (err) {
    state = { ...state, instagram: { ...state.instagram, ...failure(err), at: new Date(now()).toISOString() } };
  }
  await writeState(admin, state);
  if (state.instagram.status !== 'procesando') await logResult(admin, state, 'instagram');
  if (state.instagram.status === 'publicado' && state.instagram.id) await markPosted(admin, state, 'instagram', state.instagram.id);

  const bad = (s: NetworkStatus) => s === 'error' || s === 'incierto';
  return { ok: !bad(state.facebook.status) || !bad(state.instagram.status), state };
}

async function logResult(admin: SupabaseClient, state: DailyState, network: 'instagram' | 'facebook') {
  const n = state[network];
  await logAdminEvent(admin, {
    actor: DAILY_ACTOR,
    action: 'publicar_meta',
    target: `video:${state.day}:${state.productId}`,
    after: { red: network, estado: n.status, producto: state.name, precio: state.price, id: n.id ?? null, permalink: n.permalink ?? null, error: n.error ?? null },
  });
}
