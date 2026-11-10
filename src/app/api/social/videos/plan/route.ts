import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { SITE_URL } from '@/lib/site';
import { isProductionRuntime } from '@/lib/runtime-env';
import { chooseTrack, listMusic, readMusicLog, signMusic, tracksForTemplate, writeMusicLog } from '@/lib/social/music';
import {
  VIDEO_PLAN_MAX,
  VIDEO_RULES,
  ensureVideoBucket,
  readVideoPicks,
  removeOldVideos,
  signVideoUploads,
  videoPhoto,
  type VideoPick,
  type VideoUploads,
} from '@/lib/social/videos';

/**
 * Qué videos armar hoy: los productos elegidos, en orden de interés, con lo
 * que el generador necesita para dibujar cada uno (nombre, precio, foto) y a
 * dónde subirlo.
 *
 * Lo llama el generador de videos, que corre fuera del sitio, con el mismo
 * secreto de los crons. ?n= pide otra cantidad (1 a 6).
 *
 * No publica ni marca nada. Toca el almacén (crea el bucket la primera vez,
 * entrega direcciones firmadas para subir lo que falta y borra los videos de
 * hace más de tres días) y anota qué canción le tocó a cada video, para que
 * no se repita (lib/social/music). De un producto cuyo video de hoy
 * ya está arriba (`ya_existe`) no entrega dónde subir: no hay que rehacerlo.
 *
 * `archivo` es "AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>". La huella
 * resume lo demás que el video lleva escrito (nombre_corto, marca,
 * precio_lista, descuento, baja_historial, envio_gratis y full, tal como van
 * en esta respuesta) y la calcula solo el sitio: el generador usa el nombre
 * tal cual. `ya_existe` es true solo si está ese nombre exacto: si al
 * producto le cambió algo de eso, es otro archivo y se arma de nuevo.
 *
 * `subir` trae tres direcciones: el video (con música), su portada y su copia
 * sin música (`sinMusica`, "<archivo>-sin-musica.mp4"), que es la que se baja
 * desde /admin/videos. Son un permiso de escritura que dura dos horas: quien
 * llama no las imprime ni las guarda.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function describe(
  item: VideoPick,
  uploads: VideoUploads | null,
  music: { nombre: string; url: string } | null = null
) {
  const p = item.product;
  // Lo que el video dice sale de videos.ts (videoClaims), ya calculado: es lo
  // mismo sobre lo que se sacó la huella de `archivo`. Acá no se arma de
  // nuevo, para que lo que se dibuja y el nombre del archivo no se separen.
  const says = item.claims;
  return {
    id: p.id,
    slug: p.slug,
    nombre: p.name,
    nombre_corto: says.nombre_corto,
    marca: says.marca,
    categoria: p.category,
    precio: p.price,
    precio_lista: says.precio_lista,
    descuento: says.descuento,
    baja_historial: says.baja_historial,
    envio_gratis: says.envio_gratis,
    full: says.full,
    precio_revisado: p.price_checked_at,
    puntos: item.score.points,
    motivo: item.score.reason,
    foto: videoPhoto(p.image_url),
    plantilla: item.template,
    archivo: item.file,
    ya_existe: item.exists,
    // `sinMusica`: la copia sin música, para /admin/videos (VIDEO_SILENT_SUFFIX).
    // Un generador anterior a la copia no la usa, y uno nuevo con un plan sin
    // ella sube como antes: se pueden publicar en cualquier orden.
    subir: uploads ? { video: uploads.video, portada: uploads.cover, sinMusica: uploads.silent } : null,
    // La canción de fondo (lib/social/music), solo para lo que hay que armar.
    musica: music,
  };
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const asked = Number(req.nextUrl.searchParams.get('n'));
  const count = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, VIDEO_PLAN_MAX) : VIDEO_RULES.maxPosts;
  const now = new Date();

  try {
    await ensureVideoBucket(admin);
    const plan = await readVideoPicks(admin, now, count);

    const tracks = await listMusic(admin);
    // La canción que lleva más tiempo sin sonar (lib/social/music: chooseTrack),
    // anotada para la próxima vez. Solo en producción: una copia de prueba con
    // la base de producción no debe mover la cuenta.
    const log = tracks.length > 0 ? await readMusicLog(admin) : [];
    let logged = false;
    const seleccion = [];
    for (const item of plan.picks) {
      if (item.exists) {
        seleccion.push(describe(item, null));
        continue;
      }
      const track = chooseTrack(tracksForTemplate(tracks, item.template), log, plan.date, item.product.id);
      if (track && !log.some((u) => u.date === plan.date && u.productId === item.product.id && u.track === track)) {
        log.push({ date: plan.date, productId: item.product.id, track });
        logged = true;
      }
      const url = track ? await signMusic(admin, track) : null;
      seleccion.push(describe(item, await signVideoUploads(admin, item.file), track && url ? { nombre: track, url } : null));
    }
    if (logged && isProductionRuntime()) await writeMusicLog(admin, log);

    // Al final: si no se pudo limpiar, el plan sale igual (removeOldVideos no lanza).
    const borrados = await removeOldVideos(admin, now);

    return NextResponse.json({
      ok: true,
      generado: now.toISOString(),
      fecha: plan.date,
      sitio: SITE_URL,
      // Productos cuyo historial de precios no se pudo leer ahora: no se proponen.
      historial_sin_leer: plan.unreadHistory,
      borrados,
      seleccion,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
