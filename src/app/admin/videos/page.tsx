import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { chileDateTime } from '@/lib/content/captions';
import { VIDEO_RULES, readVideoBoard, type VideoBoard } from '@/lib/social/videos';
import { VideoList } from './VideoList';

export const dynamic = 'force-dynamic';

/**
 * Videos de hoy: los reels de oferta ya armados, cada uno con el texto de
 * cada red, para subirlos desde el teléfono.
 *
 * Con las cuentas partiendo de cero, el video corto es lo único que las redes
 * le muestran a quien no las sigue. Los videos se arman solos, fuera del
 * sitio, y quedan en el almacén; subirlos es a mano, porque así se les puede
 * poner un audio de la biblioteca de cada app y la etiqueta de contenido
 * comercial de TikTok. Esta página deja todo lo demás listo, para que cada
 * video tome un minuto.
 */

/** Las pasadas del día en que se arman los videos, en hora de Chile. */
const RENDER_TIMES = 'cerca de las 8, las 13 y las 18 horas';

export default async function VideosPage() {
  const admin = getSupabaseAdmin();
  const now = new Date();

  let board: VideoBoard = { videos: [], stale: 0, lastRenderedAt: null, storageReady: true };
  let error: string | null = null;
  if (!admin) error = 'Supabase admin no configurado';
  else {
    try {
      board = await readVideoBoard(admin, now);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const { videos, stale } = board;
  const last = chileDateTime(board.lastRenderedAt);
  const maxAgeHours = Math.round(VIDEO_RULES.maxPriceAgeMs / 3_600_000);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Videos de hoy</h1>
          <p className="mt-1 text-sm text-muted">
            Los reels de oferta ya armados, con el precio de ahora y el texto de cada red. Se suben a mano desde el
            teléfono.
          </p>
        </div>
        {/* Un enlace común y no <Link>: tiene que recargar la página entera, con videos, precios y marcas nuevas. */}
        <a
          href="/admin/videos"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50"
        >
          Actualizar
        </a>
      </div>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          Elige <strong>uno o dos videos al día</strong>. Para una cuenta que parte de cero vale más subir uno todos
          los días que muchos de una vez.
        </li>
        <li>
          Toca <strong>Compartir</strong> y elige Instagram (Reel), TikTok o YouTube. Sube este mismo archivo a cada
          red: un video bajado de otra red lleva su marca de agua y se muestra menos.
        </li>
        <li>
          Antes de publicar, ponle un <strong>audio de la biblioteca de la app</strong>. Los videos en silencio se
          muestran menos.
        </li>
        <li>
          Pega el texto de esa red con su botón. En TikTok activa <strong>&quot;Contenido comercial&quot;</strong> y
          elige <strong>&quot;Contenido de marca&quot;</strong>.
        </li>
        <li>
          Marca en qué redes lo subiste: lo que ya subiste no se vuelve a sugerir en {VIDEO_RULES.repeatAfterDays}{' '}
          días.
        </li>
      </ol>
      <p className="mt-3 text-sm text-muted">
        Un reel no lleva link que se pueda tocar. El link va en tu perfil y en la historia del mismo producto (pestaña{' '}
        <Link href="/admin/historias" className="font-medium text-fg underline underline-offset-2">
          Historias
        </Link>
        ).
      </p>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudieron leer los videos: {error}
        </div>
      )}

      {!error && videos.length === 0 && (
        <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          {board.storageReady ? 'Ahora no hay videos listos.' : 'Todavía no se ha generado el primer video.'} Se
          preparan solos tres veces al día ({RENDER_TIMES}) y aparecen acá cuando están listos.
          {board.storageReady ? ' Vuelve a mirar más tarde.' : ''}
        </p>
      )}

      {stale > 0 && (
        <p className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {stale === 1
            ? '1 video quedó viejo porque el producto cambió de precio: se rehace solo en la próxima pasada.'
            : `${stale} videos quedaron viejos porque el producto cambió de precio: se rehacen solos en la próxima pasada.`}
        </p>
      )}

      {videos.length > 0 && (
        <VideoList videos={videos} maxPriceAgeMs={VIDEO_RULES.maxPriceAgeMs} renderedAt={now.getTime()} />
      )}

      {!error && (
        <p className="mt-6 text-xs text-muted">
          {last ? `Último video generado el ${last.date} a las ${last.time}. ` : ''}
          Se eligen por lo que más puede interesar (qué es, la marca, qué tan comprobada está la oferta y que el precio
          esté al alcance), sumando lo que figura entre los más vendidos de Mercado Libre y lo que recibe más clics en
          el sitio. Solo ofertas sin avisos y con el precio revisado en las últimas {maxAgeHours} horas. Si un producto
          cambia de precio, su video deja de mostrarse; si después de armado aparece algo que mirar, la tarjeta lo dice
          con un &quot;Ojo&quot;. Lo que marcas acá no cuenta para las publicaciones del feed ni para las historias.
        </p>
      )}
    </div>
  );
}
