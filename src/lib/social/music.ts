import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * La música de fondo de los reels. Por la API de Meta no se puede usar la
 * biblioteca de música de Instagram (pasó con el primer reel automático, el
 * 25-10-2026: salió en silencio), así que la canción va mezclada dentro del
 * video cuando se arma (scripts/reels/generar.mjs, con --musica).
 *
 * Las canciones viven en un bucket PRIVADO de Supabase Storage ("musica"),
 * no en el repositorio: el repositorio es público y las licencias de música
 * gratis suelen prohibir repartir el archivo suelto. El plan de videos
 * (/api/social/videos/plan) entrega, por cada video por armar, una
 * dirección firmada de corta duración para bajar su canción.
 *
 * Sin canciones en el bucket (o sin bucket), los videos salen como antes,
 * con una pista en silencio.
 */

export const MUSIC_BUCKET = 'musica';
/** Lo que dura la dirección firmada: de sobra para una pasada del generador. */
export const MUSIC_URL_TTL_S = 2 * 3600;
const AUDIO_RE = /\.(mp3|m4a|aac|wav|ogg)$/i;
/** Nombres simples: se imprimen en el registro público de GitHub Actions. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,80}$/i;

/** Las canciones del bucket, ordenadas por nombre. [] si no hay bucket o no se pudo leer. */
export async function listMusic(admin: SupabaseClient): Promise<string[]> {
  try {
    const { data, error } = await admin.storage.from(MUSIC_BUCKET).list('', { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    if (error || !data) return [];
    return data
      .map((f) => f.name)
      .filter((name) => AUDIO_RE.test(name) && NAME_RE.test(name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Una canción al azar pero fija para la misma semilla. Hoy solo desempata
 * en chooseTrack, entre las que llevan el mismo tiempo sin usarse. Puro.
 */
export function pickTrack(tracks: readonly string[], seed: string): string | null {
  if (tracks.length === 0) return null;
  const n = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return tracks[n % tracks.length];
}

/**
 * Canciones navideñas: en el bucket se llaman "navidad-N.mp3". Van solo en
 * los videos de la plantilla navideña; los demás usan el resto. Así, mientras
 * la Navidad está encendida, las publicaciones alternan música navideña y
 * normal, y al apagarla las navideñas dejan de sonar solas.
 */
export const CHRISTMAS_TRACK_PREFIX = 'navidad-';
const CHRISTMAS_TEMPLATE = 'navidad';

export function isChristmasTrack(name: string): boolean {
  return name.startsWith(CHRISTMAS_TRACK_PREFIX);
}

/** Las canciones que le tocan a un video según su plantilla. Una plantilla navideña sin canciones navideñas usa las normales. Puro. */
export function tracksForTemplate(tracks: readonly string[], template: string): string[] {
  const regular = tracks.filter((t) => !isChristmasTrack(t));
  if (template !== CHRISTMAS_TEMPLATE) return regular;
  const christmas = tracks.filter(isChristmasTrack);
  return christmas.length > 0 ? christmas : regular;
}

/** Qué canción llevó un video: el día y el producto bastan, porque cada producto tiene un solo video al día. */
export interface TrackUse {
  date: string;
  productId: string;
  track: string;
}

/**
 * Antes cada video sacaba su canción al azar (pickTrack) y la misma salía
 * varios días seguidos: el dueño lo notó el 10-11-2026 (la 7 sonó el 7, el 8 y
 * el 9 de noviembre, y la 2 y la 4 nunca). Ahora toca la que lleva más tiempo
 * sin usarse, según la lista de lo ya asignado (lo más nuevo al final). Con
 * 6 o 7 videos al día y 8 canciones o más por lista, el reel de un día nunca
 * repite la del anterior. El mismo video conserva su canción si se vuelve a
 * pedir el mismo día. Puro.
 */
export function chooseTrack(
  pool: readonly string[],
  log: readonly TrackUse[],
  date: string,
  productId: string
): string | null {
  if (pool.length === 0) return null;
  const known = log.find((u) => u.date === date && u.productId === productId && pool.includes(u.track));
  if (known) return known.track;
  const lastUse = new Map<string, number>(pool.map((t) => [t, -1]));
  log.forEach((u, i) => {
    if (lastUse.has(u.track)) lastUse.set(u.track, i);
  });
  const oldest = Math.min(...lastUse.values());
  return pickTrack(
    pool.filter((t) => lastUse.get(t) === oldest),
    `${date}|${productId}`
  );
}

/** Dónde se anota qué canción llevó cada video (admin_private_settings). */
export const MUSIC_LOG_KEY = 'reels_musica';
/** Cuántas asignaciones se guardan: unas dos semanas de videos, de sobra para no repetir. */
export const MUSIC_LOG_MAX = 120;

function isTrackUse(value: unknown): value is TrackUse {
  const u = value as TrackUse | null;
  return !!u && typeof u.date === 'string' && typeof u.productId === 'string' && typeof u.track === 'string';
}

/** Lo asignado hasta ahora, lo más nuevo al final. [] si no se pudo leer: ahí la canción sale como antes, sin historia. */
export async function readMusicLog(admin: SupabaseClient): Promise<TrackUse[]> {
  try {
    const { data, error } = await admin.from('admin_private_settings').select('value').eq('key', MUSIC_LOG_KEY).maybeSingle();
    if (error || !data) return [];
    const list = (data.value as { uses?: unknown } | null)?.uses;
    return Array.isArray(list) ? list.filter(isTrackUse) : [];
  } catch {
    return [];
  }
}

/** Guarda lo asignado (solo lo último). Si falla, el video sale igual: solo se pierde la memoria de esta vez. */
export async function writeMusicLog(admin: SupabaseClient, log: readonly TrackUse[]): Promise<boolean> {
  try {
    const { error } = await admin
      .from('admin_private_settings')
      .upsert({ key: MUSIC_LOG_KEY, value: { uses: log.slice(-MUSIC_LOG_MAX) }, updated_at: new Date().toISOString() });
    return !error;
  } catch {
    return false;
  }
}

/** Dirección firmada para bajar una canción. null si no se pudo firmar. */
export async function signMusic(admin: SupabaseClient, name: string): Promise<string | null> {
  try {
    const { data, error } = await admin.storage.from(MUSIC_BUCKET).createSignedUrl(name, MUSIC_URL_TTL_S);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
