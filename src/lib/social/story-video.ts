import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chileDateKey } from '@/lib/clicks';
import type { StoryItem } from './stories';
import { VIDEO_BUCKET } from './videos';

/**
 * La historia automática en video, con música (el dueño, 23-11-2026). La API
 * de Instagram no da acceso a su biblioteca de música, así que la canción va
 * dentro del archivo: la imagen de la historia, 10 segundos, con música.
 *
 * El video lo arma scripts/reels/historia.mjs en GitHub Actions, junto a los
 * reels. Queda en el bucket "reels", en la carpeta del día (se borra sola con
 * los demás), con un nombre que no se confunde con el de un reel.
 *
 * El nombre lleva el día, el producto, el precio y una huella de lo demás que
 * la imagen dice: si algo de eso cambió, el nombre ya no calza y a esa hora
 * sale la imagen, nunca un video con datos viejos.
 */

/** Súbelo si cambia cómo se ve el video: los ya armados dejan de servir. */
const STORY_VIDEO_VERSION = 1;

/** Con este "producto" se anota la canción del día: una sola, aunque se armen varias ofertas. */
export const STORY_TRACK_ID = 'historia';

export type StoryVideoItem = Pick<StoryItem, 'id' | 'name' | 'brand' | 'price' | 'listPrice' | 'freeShipping' | 'full'>;

/** "AAAA-MM-DD/historia-<id>-<precio>-<huella>.mp4". Pura. */
export function storyVideoObject(item: StoryVideoItem, at: Date): string {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([STORY_VIDEO_VERSION, item.name, item.brand, item.listPrice ?? 0, item.freeShipping, item.full]))
    .digest('hex')
    .slice(0, 8);
  return `${chileDateKey(at)}/historia-${item.id}-${Math.round(item.price)}-${fingerprint}.mp4`;
}

/** La dirección pública del video de esta oferta, o null si no está (o no se pudo mirar). */
export async function findStoryVideo(admin: SupabaseClient, item: StoryVideoItem, at: Date): Promise<string | null> {
  const object = storyVideoObject(item, at);
  const [folder, file] = object.split('/');
  try {
    const bucket = admin.storage.from(VIDEO_BUCKET);
    const { data, error } = await bucket.list(folder, { limit: 5, search: file });
    if (error || !(data ?? []).some((entry) => entry.name === file)) return null;
    return bucket.getPublicUrl(object).data.publicUrl || null;
  } catch {
    return null;
  }
}

/** Permiso de escritura para subir un video: no se imprime ni se guarda. Dura dos horas. */
export async function signStoryVideoUpload(admin: SupabaseClient, object: string): Promise<string> {
  const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUploadUrl(object, { upsert: true });
  if (error || !data?.signedUrl) {
    throw new Error(`No se pudo preparar la subida del video: ${error?.message ?? 'el almacén no entregó la dirección'}`);
  }
  return data.signedUrl;
}
