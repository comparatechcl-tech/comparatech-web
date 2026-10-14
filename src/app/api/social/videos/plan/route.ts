import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { SITE_URL } from '@/lib/site';
import { shortProductName } from '@/lib/text';
import {
  VIDEO_PLAN_MAX,
  VIDEO_RULES,
  ensureVideoBucket,
  readVideoPicks,
  removeOldVideos,
  signVideoUploads,
  videoPhoto,
  type VideoPick,
} from '@/lib/social/videos';

/**
 * Qué videos armar hoy: los productos elegidos, en orden de interés, con lo
 * que el generador necesita para dibujar cada uno (nombre, precio, foto) y a
 * dónde subirlo.
 *
 * Lo llama el generador de videos, que corre fuera del sitio, con el mismo
 * secreto de los crons. ?n= pide otra cantidad (1 a 6).
 *
 * No publica ni marca nada. Lo único que toca es el almacén: crea el bucket
 * la primera vez, entrega direcciones firmadas para subir lo que falta y
 * borra los videos de hace más de tres días. De un producto cuyo video de hoy
 * ya está arriba (`ya_existe`) no entrega dónde subir: no hay que rehacerlo.
 *
 * Las direcciones de `subir` son un permiso de escritura que dura dos horas:
 * quien llama no las imprime ni las guarda.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function describe(item: VideoPick, uploads: { video: string; cover: string } | null) {
  const p = item.product;
  return {
    id: p.id,
    slug: p.slug,
    nombre: p.name,
    nombre_corto: shortProductName(p.name),
    marca: p.brand || null,
    categoria: p.category,
    precio: p.price,
    precio_lista: item.discount > 0 ? p.original_price : null,
    descuento: item.discount,
    baja_historial: item.drop === null ? null : Math.round(item.drop),
    // Como booleanos: el generador escribe "Envío gratis" y "Full" solo con un sí explícito.
    envio_gratis: p.offer_info?.free_shipping === true,
    full: p.offer_info?.is_full === true,
    precio_revisado: p.price_checked_at,
    puntos: item.score.points,
    motivo: item.score.reason,
    foto: videoPhoto(p.image_url),
    plantilla: item.template,
    archivo: item.file,
    ya_existe: item.exists,
    subir: uploads ? { video: uploads.video, portada: uploads.cover } : null,
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

    const seleccion = [];
    for (const item of plan.picks) {
      seleccion.push(describe(item, item.exists ? null : await signVideoUploads(admin, item.file)));
    }

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
