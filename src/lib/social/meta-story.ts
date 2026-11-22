import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminEvent } from '@/lib/admin-audit';
import { SITE_URL } from '@/lib/site';
import { chileDay } from './carousel-url';
import type { LiveCheck, ShownOffer } from './live-price';
import { metaCredentials, metaErrorMessage, readMetaConnection, redactTokens } from './meta';
import { PublishError, publishInstagramImage, type PublishDeps } from './meta-publish';
import { STORY_MARK } from './networks';
import { piecePath, snapshotOf } from './piece-url';
import type { StoryItem } from './stories';
import { STORY_NETWORKS } from './story-networks';

/**
 * La historia automática de Instagram: una al día, para los días en que el
 * dueño no alcanza a subir ninguna (decisión del 22-11-2026).
 *
 * La API no pone el sticker de enlace, así que la imagen dice "Link en el
 * perfil" en ese lugar (formato 'perfil' de lib/social/piece-url). Las
 * historias con link siguen siendo a mano, desde /admin/historias.
 *
 * Reglas:
 * - a lo más 1 por día de Chile, y ninguna si el dueño ya marcó una ese día;
 * - solo de la lista de /admin/historias, sin un "Ojo" que mirar, y con el
 *   precio, el descuento y el envío confirmados en Mercado Libre en el momento;
 * - el día se anota ANTES de publicar: si algo se corta o Meta no responde,
 *   no se vuelve a publicar. Solo se reintenta un error en que no salió nada;
 * - se puede pausar por hoy o hasta encenderla (meta_story_pause).
 *
 * La llama app/api/cron/historia-diaria dos veces al día (migración 0020): la
 * segunda pasada solo hace algo si la primera no pudo.
 */

export const META_STORY_KEY = 'meta_story';
export const META_STORY_PAUSE_KEY = 'meta_story_pause';
export const STORY_ACTOR = 'historia diaria';
/** Cuántas ofertas se revisan en Mercado Libre, en orden, hasta dar con una igual. */
export const STORY_CANDIDATES = 3;

/** Cuánto hacia atrás se miran las marcas para saber si hubo una hoy: un día de Chile cabe de sobra. */
const MARK_LOOKBACK_MS = 36 * 3600_000;

export type StoryStatus = 'pendiente' | 'publicado' | 'error' | 'incierto';

export interface StoryState {
  /** El día en Chile (AAAAMMDD). */
  day: number;
  productId: string;
  name: string;
  price: number;
  status: StoryStatus;
  /** El id de lo publicado en Instagram. */
  id?: string;
  permalink?: string | null;
  error?: string;
  at: string;
}

export type StoryPauseMode = 'activa' | 'hoy' | 'indefinida';

export interface StoryPause {
  mode: StoryPauseMode;
  /** Con 'hoy': el día en Chile (AAAAMMDD) que queda en pausa. */
  day?: number;
  at?: string;
}

export interface StorySummary {
  ok: boolean;
  /** Por qué no se publicó hoy, si no se publicó. */
  skipped?: string;
  state?: StoryState;
}

export interface StoryDeps extends PublishDeps {
  /** La clave que firma la imagen (pieceKey). Sin ella no se publica. */
  key: Buffer | null;
  readPicks(admin: SupabaseClient, now: Date, key: Buffer): Promise<StoryItem[]>;
  liveCheck(items: { productId: string; shown: ShownOffer }[]): Promise<Record<string, LiveCheck>>;
  siteUrl?: string;
  now?: () => number;
}

/** ¿Está en pausa ese día? La de "hoy" se acaba sola al cambiar el día. Puro. */
export function isStoryPaused(pause: StoryPause | null, today: number): boolean {
  if (!pause) return false;
  if (pause.mode === 'indefinida') return true;
  return pause.mode === 'hoy' && pause.day === today;
}

/** Las ofertas que pueden salir solas: sin un "Ojo" que mirar, en el orden de la lista. Puro. */
export function storyCandidates(items: StoryItem[]): StoryItem[] {
  return items.filter((item) => item.warning === null && item.price > 0).slice(0, STORY_CANDIDATES);
}

/** Lo que la imagen muestra de la oferta: con esto se compara en Mercado Libre. */
function shownOf(item: StoryItem): ShownOffer {
  return { price: item.price, listPrice: item.listPrice, freeShipping: item.freeShipping, full: item.full };
}

/** La dirección firmada de la historia con "Link en el perfil", con los mismos datos que se revisaron. Pura. */
export function profileStoryPath(item: StoryItem, key: Buffer, now: Date): string | null {
  const snapshot = snapshotOf(
    {
      id: item.id,
      price: item.price,
      original_price: item.listPrice,
      price_checked_at: item.checkedAt,
      offer_info: { free_shipping: item.freeShipping, is_full: item.full },
    },
    'perfil',
    now
  );
  return piecePath(snapshot, key);
}

type SettingRead<T> = { ok: true; value: T | null } | { ok: false; error: string };

async function readSetting<T>(admin: SupabaseClient, key: string): Promise<SettingRead<T>> {
  const { data, error } = await admin.from('admin_private_settings').select('value').eq('key', key).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, value: (data?.value as T | undefined) ?? null };
}

async function writeSetting(admin: SupabaseClient, key: string, value: unknown): Promise<boolean> {
  const { error } = await admin.from('admin_private_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  return !error;
}

/** ¿Ya hay una historia marcada hoy, en cualquier red? */
async function markedToday(admin: SupabaseClient, at: Date): Promise<{ ok: true; marked: boolean } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('social_posts')
    .select('posted_at')
    .in('channel', [...STORY_NETWORKS])
    .eq('caption', STORY_MARK)
    .eq('status', 'publicado')
    .gte('posted_at', new Date(at.getTime() - MARK_LOOKBACK_MS).toISOString())
    .order('posted_at', { ascending: false })
    .limit(200);
  if (error) return { ok: false, error: error.message };
  const today = chileDay(at);
  return { ok: true, marked: ((data ?? []) as { posted_at: string }[]).some((row) => chileDay(new Date(row.posted_at)) === today) };
}

function failure(err: unknown): { status: StoryStatus; error: string } {
  const uncertain = err instanceof PublishError && err.uncertain;
  const message = err instanceof PublishError ? err.message : metaErrorMessage(err, 'guardada');
  const detail = err instanceof Error ? redactTokens(err.message).slice(0, 300) : '';
  return { status: uncertain ? 'incierto' : 'error', error: detail && detail !== message ? `${message} (${detail})` : message };
}

export async function runMetaStory(admin: SupabaseClient, at: Date, deps: StoryDeps): Promise<StorySummary> {
  const now = deps.now ?? Date.now;
  const creds = metaCredentials();
  const { connection } = await readMetaConnection(admin);
  if (!creds || !connection) return { ok: false, skipped: 'Meta no está conectado (Configuración → Instagram y Facebook).' };
  const today = chileDay(at);

  // Sin poder leer la pausa ni lo hecho hoy, no se publica: podría ir contra lo que pidió el dueño o repetirse.
  const pause = await readSetting<StoryPause>(admin, META_STORY_PAUSE_KEY);
  if (!pause.ok) return { ok: false, skipped: `No se pudo leer la pausa: ${pause.error}` };
  if (isStoryPaused(pause.value, today)) return { ok: true, skipped: 'La historia automática está en pausa.' };

  const read = await readSetting<StoryState>(admin, META_STORY_KEY);
  if (!read.ok) return { ok: false, skipped: `No se pudo leer el estado de hoy: ${read.error}` };
  const previous = read.value && read.value.day === today ? read.value : null;
  if (previous && previous.status !== 'error') {
    return {
      ok: true,
      skipped:
        previous.status === 'publicado'
          ? 'Ya se publicó hoy.'
          : 'Hoy ya se intentó y no llegó respuesta de Instagram: hay que mirarla a mano.',
      state: previous,
    };
  }

  const marks = await markedToday(admin, at);
  if (!marks.ok) return { ok: false, skipped: `No se pudo leer las historias de hoy: ${marks.error}` };
  if (marks.marked) return { ok: true, skipped: 'Hoy ya se subió una historia.' };

  if (!deps.key) return { ok: false, skipped: 'Falta la clave para firmar la imagen (CRON_SECRET).' };
  const candidates = storyCandidates(await deps.readPicks(admin, at, deps.key));
  if (candidates.length === 0) return { ok: true, skipped: 'No hay una oferta sin avisos para la historia de hoy.' };
  const checks = await deps.liveCheck(candidates.map((item) => ({ productId: item.id, shown: shownOf(item) })));
  const item = candidates.find((c) => checks[c.id]?.status === 'same');
  if (!item) return { ok: true, skipped: 'Ninguna oferta pasó la revisión del precio en Mercado Libre.' };
  const path = profileStoryPath(item, deps.key, at);
  if (!path) return { ok: false, skipped: 'No se pudo firmar la imagen.' };

  let state: StoryState = {
    day: today,
    productId: item.id,
    name: item.name,
    price: item.price,
    status: 'pendiente',
    at: new Date(now()).toISOString(),
  };
  // Primero se anota el día: si después algo se corta, la próxima pasada no vuelve a publicar.
  if (!(await writeSetting(admin, META_STORY_KEY, state))) return { ok: false, skipped: 'No se pudo anotar el día: no se publicó nada.' };

  try {
    const base = (deps.siteUrl ?? SITE_URL).replace(/\/+$/, '');
    const done = await publishInstagramImage(connection, creds, { imageUrl: `${base}${path}`, story: true }, deps);
    state = { ...state, status: 'publicado', id: done.mediaId, permalink: done.permalink, at: new Date(now()).toISOString() };
  } catch (err) {
    state = { ...state, ...failure(err), at: new Date(now()).toISOString() };
  }
  await writeSetting(admin, META_STORY_KEY, state);

  if (state.status === 'publicado') {
    // La misma marca de "Ya la subí": aparece en /admin/historias y no vuelve en 14 días.
    const { error } = await admin.from('social_posts').insert({
      product_id: state.productId,
      channel: 'instagram',
      posted_price: state.price,
      caption: STORY_MARK,
      status: 'publicado',
      external_id: state.id,
    });
    if (error) console.error(`[meta-story] no se pudo marcar la historia: ${error.message}`);
  }
  await logAdminEvent(admin, {
    actor: STORY_ACTOR,
    action: 'publicar_meta',
    target: `historia:${state.day}:${state.productId}`,
    after: {
      red: 'instagram',
      estado: state.status,
      producto: state.name,
      precio: state.price,
      id: state.id ?? null,
      permalink: state.permalink ?? null,
      error: state.error ?? null,
    },
  });
  return { ok: state.status === 'publicado', state };
}

/** Lo que muestra el control de /admin/historias. */
export interface StoryAutoStatus {
  pause: StoryPauseMode;
  today: Pick<StoryState, 'name' | 'status' | 'permalink'> | null;
}

/** La pausa vigente y lo que pasó hoy. Lanza si no se pudo leer: la página sigue sin el control. */
export async function readStoryAutoStatus(admin: SupabaseClient, at: Date): Promise<StoryAutoStatus> {
  const [pause, state] = await Promise.all([
    readSetting<StoryPause>(admin, META_STORY_PAUSE_KEY),
    readSetting<StoryState>(admin, META_STORY_KEY),
  ]);
  if (!pause.ok) throw new Error(pause.error);
  if (!state.ok) throw new Error(state.error);
  const today = chileDay(at);
  const s = state.value && state.value.day === today ? state.value : null;
  return {
    pause: isStoryPaused(pause.value, today) ? (pause.value?.mode ?? 'activa') : 'activa',
    today: s ? { name: s.name, status: s.status, permalink: s.permalink ?? null } : null,
  };
}

/** Guarda la pausa: 'hoy' vale solo para el día de Chile de `at`. */
export async function writeStoryPause(admin: SupabaseClient, mode: StoryPauseMode, at: Date): Promise<boolean> {
  const value: StoryPause = { mode, at: at.toISOString(), ...(mode === 'hoy' ? { day: chileDay(at) } : {}) };
  return writeSetting(admin, META_STORY_PAUSE_KEY, value);
}
