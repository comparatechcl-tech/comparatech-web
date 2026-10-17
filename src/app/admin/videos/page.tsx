import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { chileDateTime } from '@/lib/content/captions';
import { HISTORY_UNREAD_EXAMPLE } from '@/lib/social/warning-help';
import { VIDEO_RULES, readVideoBoard, type VideoBoard } from '@/lib/social/videos';
import { WarningGuide } from '../WarningGuide';
import { NextPass } from './NextPass';
import { changedAfterPostingText, staleText } from './texts';
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

export default async function VideosPage() {
  const admin = getSupabaseAdmin();
  const now = new Date();

  let board: VideoBoard = {
    videos: [],
    stale: 0,
    lastRenderedAt: null,
    storageReady: true,
    hiddenUnread: 0,
    changedAfterPosting: [],
  };
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
  // Comparado y no tomado tal cual: un número que no sea mayor que cero no se cuenta.
  const hidden = board.hiddenUnread > 0 ? board.hiddenUnread : 0;
  // Lo ya subido cuyo precio ya no es el que se subió: las publicaciones de las redes siguen diciendo el viejo.
  const changedAfter = Array.isArray(board.changedAfterPosting) ? board.changedAfterPosting : [];
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

      {/*
        Siempre a la vista: cuándo llegan videos nuevos. La hora sale del
        horario de GitHub en UTC, pasado a hora de Chile: el cambio de hora se
        ajusta solo.
      */}
      <p className="mt-3 text-sm text-muted">
        <NextPass renderedAt={now.getTime()} />
      </p>

      {/*
        Un video ya subido no se corrige: si el precio cambió después de
        marcarlo, lo que está en las redes dice otro precio. Arriba y en rojo,
        porque hay que ir a esas apps.
      */}
      {changedAfter.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <ul className="space-y-1.5">
            {/* Uno por producto y precio marcado: el mismo producto puede venir dos veces. */}
            {changedAfter.map((item, i) => (
              <li key={`${item.productId}|${item.postedPrice}|${i}`} className="font-medium">
                {changedAfterPostingText(item)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">
            Un video subido no se puede editar: lo que promete un precio más bajo que el de ahora hay que sacarlo de
            esa red. Si bajó de precio no hace falta: no se avisa.
          </p>
        </div>
      )}

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          Elige <strong>uno o dos videos al día</strong>. Para una cuenta que parte de cero vale más subir uno todos
          los días que muchos de una vez.
        </li>
        {/* Antes de copiar nada: el texto y el video llevan el precio escrito. */}
        <li>
          Mira la línea bajo el precio. Si dice <strong>✓ Mismo precio que en Mercado Libre</strong>, súbelo. Si dice
          en rojo que cambió, no lo subas y toca <strong>Actualizar</strong>. Si no pude revisar, toca{' '}
          <strong>Ver en Mercado Libre</strong> y compara el precio antes de subirlo.
        </li>
        {/* Antes de Compartir: Compartir manda solo el archivo, y una vez en la app ya no hay de dónde copiar. */}
        <li>
          <strong>Copia el texto</strong> de la red donde lo vas a subir, con su botón: queda copiado en el teléfono.
        </li>
        <li>
          Toca <strong>Compartir</strong> y elige Instagram (Reel), TikTok, YouTube o Facebook. Sube este mismo archivo
          a cada red: un video bajado de otra red lleva su marca de agua y se muestra menos.
        </li>
        <li>
          En la app, pega el texto y ponle un <strong>audio de la biblioteca de la app</strong>: los videos en silencio
          se muestran menos. En TikTok activa <strong>&quot;Contenido comercial&quot;</strong> y elige{' '}
          <strong>&quot;Contenido de marca&quot;</strong>.
        </li>
        <li>
          Marca en qué redes lo subiste: lo que ya subiste no se vuelve a sugerir en {VIDEO_RULES.repeatAfterDays}{' '}
          días.
        </li>
      </ol>
      {/*
        El link del perfil lleva a /hoy, que suma por su cuenta los productos
        con un video marcado como subido. No se manda a Historias: llevan otra
        selección, y el producto del reel puede no estar ahí.
      */}
      <p className="mt-3 text-sm text-muted">
        Un reel no lleva link que se pueda tocar. El link de tu perfil ya lleva a la página{' '}
        <Link href="/hoy" className="font-medium text-fg underline underline-offset-2">
          Lo de hoy
        </Link>{' '}
        del sitio, donde aparecen los productos de los videos que marcas como subidos: no lo cambies.{' '}
        <strong className="font-medium text-fg">Copiar link</strong> sirve para el sticker de la historia de este
        producto.
      </p>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudieron leer los videos: {error}
        </div>
      )}

      {/*
        Con videos escondidos por un rato no se dice que no hay: sí hay, y el
        aviso de abajo dice por qué no se ven. La hora de la próxima pasada ya
        está arriba: acá no se repite (ni se escribe a mano).
      */}
      {!error && videos.length === 0 && hidden === 0 && (
        <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          {board.storageReady ? 'Ahora no hay videos listos.' : 'Todavía no se ha generado el primer video.'} Aparecen
          acá cuando una pasada los arma.
          {board.storageReady ? ' Vuelve a mirar después de la próxima pasada.' : ''}
        </p>
      )}

      {/*
        Sin el historial de precios no se sabe si lo que dice el video (la
        baja) sigue en pie, y el video no se muestra. Es por un rato: vuelve
        solo en otra carga, sin armarlo de nuevo.
      */}
      {hidden > 0 && (
        <p className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {hidden === 1 ? '1 video no se muestra' : `${hidden} videos no se muestran`} ahora porque no se pudo revisar su
          historial de precios. Vuelve a mirar en unos minutos.
        </p>
      )}

      {/*
        Sin prometer que se rehace: un video deja de mostrarse también cuando
        el producto salió del sitio o ya no entra entre los sugeridos, y uno ya
        marcado en alguna red no se vuelve a armar en 14 días.
      */}
      {stale > 0 && (
        <p className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {staleText(stale, VIDEO_RULES.repeatAfterDays)}
        </p>
      )}

      {/*
        La key es la hora de esta carga: con datos nuevos del servidor la lista
        se monta de cero y los toma (su estado se lee una sola vez, al montar).
        Volver con "atrás" trae esta misma carga, con la misma key, y conserva
        lo marcado.
      */}
      {videos.length > 0 && (
        <VideoList
          key={now.getTime()}
          videos={videos}
          maxPriceAgeMs={VIDEO_RULES.maxPriceAgeMs}
          renderedAt={now.getTime()}
        />
      )}

      {/* Un video sin historial de precios no se muestra: ese aviso no se explica acá. */}
      {!error && <WarningGuide className="mt-6" omit={[HISTORY_UNREAD_EXAMPLE]} />}

      {!error && (
        <p className="mt-6 text-xs text-muted">
          {last ? `Último video generado el ${last.date} a las ${last.time}. ` : ''}
          Se eligen por lo que más puede interesar (qué es, la marca, qué tan comprobada está la oferta y que el precio
          esté al alcance), sumando lo que figura entre los más vendidos de Mercado Libre y lo que recibe más clics en
          el sitio. Solo ofertas sin avisos y con el precio revisado en las últimas {maxAgeHours} horas. Si un producto
          cambia de precio o de oferta, su video deja de mostrarse; si después de armado aparece algo que mirar, la
          tarjeta lo dice con un &quot;Ojo&quot;. Al abrir esta página, cada video se compara con su ficha de Mercado
          Libre: si ya no calza, no deja compartirlo, guardarlo ni copiar su texto. Lo que marcas acá no cuenta para
          las publicaciones del feed ni para las historias.
        </p>
      )}
    </div>
  );
}
