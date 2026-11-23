import { NextRequest, NextResponse } from 'next/server';
import { chileDateKey } from '@/lib/clicks';
import { offerThemeAt } from '@/lib/content/christmas';
import { isCronAuthorized } from '@/lib/cron-auth';
import { isProductionRuntime } from '@/lib/runtime-env';
import { profileStoryPath, readStoryAutoStatus, storyCandidates } from '@/lib/social/meta-story';
import { chooseTrack, listMusic, readMusicLog, signMusic, tracksForTemplate, writeMusicLog } from '@/lib/social/music';
import { pieceKey } from '@/lib/social/piece-url';
import { readStoryPicks } from '@/lib/social/stories';
import { STORY_TRACK_ID, findStoryVideo, signStoryVideoUpload, storyVideoObject } from '@/lib/social/story-video';
import { ensureVideoBucket } from '@/lib/social/videos';
import { getSupabaseAdmin } from '@/lib/supabase/server';

/**
 * Qué videos de la historia de hoy hay que armar (scripts/reels/historia.mjs,
 * en GitHub Actions, con el secreto de los crons): las mismas ofertas entre
 * las que la historia automática va a elegir, con su imagen, una canción para
 * el día y dónde subir cada video.
 *
 * No publica nada. Con ?seco=1 solo dice qué haría: no firma ni anota la canción.
 * Las direcciones de la respuesta son permisos: quien llama no las imprime.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  const key = pieceKey();
  if (!key) return NextResponse.json({ error: 'Falta la clave para firmar la imagen' }, { status: 500 });

  const dry = req.nextUrl.searchParams.get('seco') === '1';
  const now = new Date();
  const fecha = chileDateKey(now);
  const skip = (omitida: string) => NextResponse.json({ ok: true, fecha, omitida, musica: null, seleccion: [] });

  try {
    const status = await readStoryAutoStatus(admin, now);
    if (status.pause !== 'activa') return skip('La historia automática está en pausa.');
    if (status.today && status.today.status !== 'error') return skip('La historia de hoy ya salió.');

    if (!dry) await ensureVideoBucket(admin);
    const items = storyCandidates(await readStoryPicks(admin, now, key));
    const found = await Promise.all(items.map((item) => findStoryVideo(admin, item, now)));
    const pending = found.some((url) => url === null);

    let musica: { nombre: string; url: string } | null = null;
    if (pending && !dry) {
      const tracks = await listMusic(admin);
      const pool = tracksForTemplate(tracks, offerThemeAt(now) ? 'navidad' : 'impacto');
      const log = await readMusicLog(admin);
      const track = chooseTrack(pool, log, fecha, STORY_TRACK_ID);
      const url = track ? await signMusic(admin, track) : null;
      if (!track || !url) return skip('No hay una canción disponible: hoy sale la imagen.');
      musica = { nombre: track, url };
      // Solo en producción: una copia de prueba con la misma base no debe mover la cuenta.
      if (isProductionRuntime() && !log.some((u) => u.date === fecha && u.productId === STORY_TRACK_ID && u.track === track)) {
        await writeMusicLog(admin, [...log, { date: fecha, productId: STORY_TRACK_ID, track }]);
      }
    }

    const seleccion = [];
    for (const [i, item] of items.entries()) {
      const imagen = profileStoryPath(item, key, now);
      if (!imagen) continue;
      const archivo = storyVideoObject(item, now);
      const ya_existe = found[i] !== null;
      const subir = ya_existe || dry ? null : await signStoryVideoUpload(admin, archivo);
      seleccion.push({ id: item.id, nombre: item.name, precio: item.price, archivo, imagen, ya_existe, subir });
    }
    return NextResponse.json({ ok: true, fecha, musica, seleccion });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
