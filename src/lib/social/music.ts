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
 * La canción de un video: siempre la misma para el mismo día y producto (si
 * una pasada falla, la siguiente usa la misma), y repartida entre todas. Puro.
 */
export function pickTrack(tracks: readonly string[], seed: string): string | null {
  if (tracks.length === 0) return null;
  const n = createHash('sha256').update(seed).digest().readUInt32BE(0);
  return tracks[n % tracks.length];
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
