'use client';

import { useEffect, useState, useTransition } from 'react';
import { AlertTriangle, Check, Circle, Copy, Download, ExternalLink, Loader2, Share2 } from 'lucide-react';
import { chileDateTime, formatPrice } from '@/lib/content/captions';
import type { ReadyVideo, VideoNetwork } from '@/lib/social/videos';
import { markVideoPosted, undoVideoPosted } from './actions';
import {
  canShareVideos,
  createVideoGestures,
  linkTarget,
  markKey,
  textTargets,
  type CopyTarget,
  type FileState,
  type Mark,
  type Note,
  type VideoGestures,
} from './gestures';
import { browserEnv, screenUi, type ManualCopy, type PostedByNetwork, type Visit } from './wiring';

/**
 * Los videos del día, pensados para el teléfono: compartir el archivo directo
 * a cada red, copiar el texto que le toca y marcar dónde ya se subió.
 *
 * El video NO se baja al cargar la página: pesa varios megas y de ocho se
 * suben uno o dos. Se baja con el primer toque en Compartir y queda en
 * memoria; el toque siguiente lo comparte. Son dos toques porque el teléfono
 * solo abre la hoja de compartir si la llamada ocurre dentro del toque: si
 * hubiera que bajar el archivo en ese instante, el permiso se pierde.
 *
 * El reproductor muestra la portada y no pide el video hasta que se le da
 * play (preload="none"), por lo mismo.
 *
 * Lo que pasa al tocar cada botón está en ./gestures, que no sabe de React ni
 * del navegador; lo que une esas reglas con el navegador y con el estado de
 * la pantalla, en ./wiring. Acá queda el estado y el dibujo.
 */

export type { Mark, PostedByNetwork };

/**
 * Las redes, en el orden en que se muestran. Un Record y no una lista: si el
 * contrato suma una red, esto deja de compilar en vez de quedar sin botón.
 * Se escribe acá porque lib/social/videos es solo de servidor.
 */
const NETWORK_LABELS: Record<VideoNetwork, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  facebook: 'Facebook',
};
const NETWORK_KEYS = Object.keys(NETWORK_LABELS) as VideoNetwork[];

const BUTTON_SHAPE =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition disabled:opacity-50';
const BUTTON = `${BUTTON_SHAPE} border-border bg-surface text-fg hover:border-accent/50`;
/**
 * Una red ya marcada. Clase aparte y no BUTTON más otros colores: dos colores
 * de texto en el mismo botón los resuelve el orden del CSS, no el de las clases.
 */
const BUTTON_MARKED = `${BUTTON_SHAPE} border-accent/60 bg-accent/10 text-accent`;

/**
 * Lo hecho en cada carga de la página (hora del servidor en que se armó la
 * lista → cuándo se vio por primera vez en este teléfono y qué se marcó o
 * desmarcó desde entonces; null = desmarcado).
 *
 * Fuera del componente a propósito: al ir a otra pestaña del admin y volver
 * con "atrás", Next muestra la misma lista sin pedirla de nuevo y monta el
 * componente desde cero. Sin esto, lo recién marcado volvería como pendiente
 * y una lista vieja parecería recién cargada. Va por carga y no por producto:
 * una lista pedida de nuevo trae del servidor lo que vale, y lo anotado para
 * la anterior no se le aplica.
 */
const visits = new Map<number, Visit>();
const MAX_VISITS = 6;

/**
 * La visita de una carga: la misma mientras la carga sea la misma. En el
 * servidor no se guarda (`keep`): ahí este módulo lo comparten todas las visitas.
 */
export function visitFor(renderedAt: number, now: number = Date.now(), keep: boolean = typeof window !== 'undefined'): Visit {
  const known = visits.get(renderedAt);
  if (known) return known;
  const visit: Visit = { openedAt: now, changes: new Map() };
  if (!keep) return visit;
  visits.set(renderedAt, visit);
  // Un Map entrega sus llaves en el orden en que entraron: la primera es la carga más antigua.
  while (visits.size > MAX_VISITS) {
    const oldest = visits.keys().next().value;
    if (oldest === undefined) break;
    visits.delete(oldest);
  }
  return visit;
}

/** Dónde figura subido un video: lo que trajo el servidor, corregido con lo hecho en esta visita. Puro. */
export function mergePosted(video: ReadyVideo, changes: Map<string, Mark | null>): PostedByNetwork {
  const posted: PostedByNetwork = {};
  for (const network of NETWORK_KEYS) {
    const change = changes.get(markKey(video.id, network));
    const mark = change === undefined ? video.posted[network] : change;
    if (mark) posted[network] = mark;
  }
  return posted;
}

/** ¿Ya está en las cuatro redes? Puro. */
export function isEverywhere(posted: PostedByNetwork | undefined): boolean {
  return NETWORK_KEYS.every((network) => Boolean(posted?.[network]));
}

/** Primero lo que falta por subir a alguna red y al final lo ya subido a todas, sin tocar el orden de cada grupo. Puro. */
export function pendingFirst(videos: ReadyVideo[], posted: Record<string, PostedByNetwork>): ReadyVideo[] {
  const done = (video: ReadyVideo) => isEverywhere(posted[video.id]);
  return [...videos.filter((video) => !done(video)), ...videos.filter(done)];
}

/** Así separa lib/social/videos el motivo de lo que hay que mirar antes de subir el video. */
const WARNING_MARK = '. Ojo: ';

/**
 * El motivo y el aviso, por separado, para que el aviso no pase por una frase
 * más del motivo. Si el texto no trae la marca, todo es motivo. Puro.
 */
export function splitReason(reason: string): { why: string; warning: string | null } {
  const at = reason.indexOf(WARNING_MARK);
  if (at < 0) return { why: reason, warning: null };
  return { why: reason.slice(0, at), warning: reason.slice(at + WARNING_MARK.length) };
}

/** Lo que dice el botón Compartir según cómo va la descarga del archivo. Puro. */
export function shareLabel(state: FileState | undefined): string {
  if (state === 'cargando') return 'Preparando el video…';
  if (state === 'lista') return 'Listo: toca para compartir';
  if (state === 'error') return 'No se pudo bajar: reintentar';
  return 'Compartir';
}

/** Lo que dice el botón Guardar: mientras baja el video para guardarlo, lo dice. Puro. */
export function saveLabel(saving: boolean): string {
  return saving ? 'Bajando…' : 'Guardar video';
}

/**
 * El navegador de verdad. globalThis y no window: este módulo también se
 * carga en el servidor, donde no hay window; nada se lee hasta que hay un toque.
 */
const BROWSER = browserEnv(globalThis);

/** El video directo solo se enlaza si es una dirección web: nunca otro esquema en un href. */
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

function copyButton(video: ReadyVideo, target: CopyTarget, copied: string | null, gestures: CardGestures, extra = '') {
  const done = copied === `${video.id}|${target.what}`;
  return (
    <button
      key={target.what}
      type="button"
      onClick={() => void gestures.copy(video, target)}
      disabled={!target.text}
      className={`${BUTTON} ${extra}`}
    >
      {done ? <Check size={15} className="shrink-0 text-accent" aria-hidden /> : <Copy size={15} className="shrink-0" aria-hidden />}
      {/* Los dos textos ocupan el mismo lugar y solo se ve uno: el botón mide lo mismo antes y después de copiar, y nada se corre. */}
      <span className="grid text-center">
        <span aria-hidden={done} className={`col-start-1 row-start-1 ${done ? 'invisible' : ''}`}>
          {target.label}
        </span>
        <span aria-hidden={!done} className={`col-start-1 row-start-1 ${done ? '' : 'invisible'}`}>
          {target.copiedLabel}
        </span>
      </span>
    </button>
  );
}

type CardGestures = Pick<VideoGestures, 'share' | 'save' | 'copy' | 'toggle'>;

export interface VideoCardProps {
  video: ReadyVideo;
  posted: PostedByNetwork;
  fileState: FileState | undefined;
  /** El botón Guardar está bajando el video. */
  saving: boolean;
  /** null hasta saber si este aparato puede compartir archivos. */
  canShare: boolean | null;
  /** El botón de copiar que muestra su confirmación (`videoId|what`). */
  copied: string | null;
  /** La marca que está viajando al servidor (`videoId|red`), de cualquier tarjeta. */
  busy: string | null;
  note: Note | undefined;
  /** El texto que no se pudo copiar, para copiarlo a mano. */
  manual: ManualCopy | undefined;
  gestures: CardGestures;
}

/**
 * La tarjeta de un video. Sin estado propio: dibuja lo que recibe y cada botón
 * llama a su regla. Así un test puede armarla, "tocar" un botón y ver qué
 * pidió, sin navegador.
 */
export function VideoCard({ video, posted, fileState: state, saving, canShare, copied, busy, note, manual, gestures }: VideoCardProps) {
  const everywhere = isEverywhere(posted);
  const made = chileDateTime(video.renderedAt);
  const { why, warning } = splitReason(video.reason);
  const texts = textTargets(video);

  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-3 sm:p-4">
      {/* Ancho fijo: en el escritorio un video vertical a todo el ancho no cabría en la pantalla. */}
      <div
        className={`aspect-[9/16] w-36 self-start overflow-hidden rounded-md bg-bg sm:row-span-2 sm:w-44 ${everywhere ? 'opacity-60' : ''}`}
      >
        <video
          controls
          playsInline
          preload="none"
          poster={video.coverUrl}
          src={video.videoUrl}
          aria-label={`Video de ${video.name}`}
          className="h-full w-full object-contain"
        />
      </div>

      <div className="min-w-0">
        {/* Hay nombres que parten por el código del modelo: la marca dice de qué se trata. */}
        {video.brand && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{video.brand}</p>}
        <p className="text-sm font-semibold leading-snug text-fg">{video.name}</p>
        {/* Si no caben en un renglón, "sin descuento $X · -N%" baja entero al siguiente: no se parte en el punto. */}
        <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-fg">
          <strong className="font-heading text-lg">{formatPrice(video.price)}</strong>
          {video.listPrice !== null && video.discount > 0 && (
            <span className="whitespace-nowrap text-xs text-muted">
              sin descuento <s>{formatPrice(video.listPrice)}</s> · -{video.discount}%
            </span>
          )}
        </p>
        {/* Por qué se sugiere este producto y, si desde que se armó el video apareció algo que mirar, eso aparte. */}
        {why && <p className="mt-1 text-xs leading-snug text-muted">{why}.</p>}
        {warning && (
          <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-400">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>Ojo: {warning}.</span>
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted">
          Plantilla {video.template}
          {made ? ` · hecho el ${made.date} a las ${made.time}` : ''}
        </p>
        {/* Junto al video, que es más alto que este bloque: aparece al marcar la cuarta red sin correr los botones. */}
        {everywhere && (
          <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-accent">
            <Check size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>Ya está en las cuatro redes.</span>
          </p>
        )}
      </div>

      <div className="col-span-2 flex min-w-0 flex-col gap-3 sm:col-span-1 sm:col-start-2">
        <div className="grid grid-cols-2 gap-2">
          {canShare && (
            <button
              type="button"
              onClick={() => gestures.share(video)}
              disabled={state === 'cargando'}
              className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50"
            >
              {state === 'cargando' ? (
                <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden />
              ) : (
                <Share2 size={15} className="shrink-0" aria-hidden />
              )}
              {shareLabel(state)}
            </button>
          )}
          {/* Las celdas de la grilla miden lo mismo diga lo que diga el botón: al cambiar de texto nada se corre. */}
          <button type="button" onClick={() => gestures.save(video)} disabled={state === 'cargando'} className={BUTTON}>
            {saving ? (
              <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden />
            ) : (
              <Download size={15} className="shrink-0" aria-hidden />
            )}
            {saveLabel(saving)}
          </button>
          {copyButton(video, linkTarget(video), copied, gestures)}
        </div>

        <div role="group" aria-labelledby={`textos-${video.id}`}>
          <p id={`textos-${video.id}`} className="text-xs font-medium text-muted">
            Copiar texto para:
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {texts.map((target, i) =>
              // Son cinco: en el teléfono el último ocupa la fila entera y su nombre, que es largo, no se parte.
              copyButton(video, target, copied, gestures, i === texts.length - 1 ? 'col-span-2 sm:col-span-1' : '')
            )}
          </div>
        </div>

        <div role="group" aria-labelledby={`subido-${video.id}`}>
          <p id={`subido-${video.id}`} className="text-xs font-medium text-muted">
            Subido en:
          </p>
          {/* La misma grilla antes y después de marcar: si la tarjeta cambiara de alto, las de abajo se correrían bajo el dedo. */}
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {NETWORK_KEYS.map((network) => {
              const marked = Boolean(posted[network]);
              return (
                <button
                  key={network}
                  type="button"
                  aria-pressed={marked}
                  onClick={() => gestures.toggle(video, network, posted[network])}
                  disabled={busy !== null}
                  className={marked ? BUTTON_MARKED : BUTTON}
                >
                  {/* El visto y el círculo vacío dicen el estado sin depender del color. */}
                  {marked ? (
                    <Check size={15} className="shrink-0" aria-hidden />
                  ) : (
                    <Circle size={15} className="shrink-0 text-muted" aria-hidden />
                  )}
                  {busy === markKey(video.id, network) ? 'Guardando…' : NETWORK_LABELS[network]}
                </button>
              );
            })}
          </div>
        </div>

        {manual && (
          <div className="rounded-md border border-border bg-bg p-2">
            <p className="text-[11px] font-medium text-muted">{manual.label}</p>
            <p className="mt-1 select-all whitespace-pre-wrap break-words text-xs text-fg">{manual.text}</p>
          </div>
        )}
        {/* Completo y seleccionable: es el respaldo si el teléfono no deja copiar con el botón. */}
        <p className="select-all break-all text-[11px] text-muted" aria-label="Link de afiliado">
          {video.link}
        </p>
        <p
          role="status"
          aria-live="polite"
          className={`min-h-4 text-xs ${note?.tone === 'info' ? 'font-medium text-fg' : 'text-red-400'}`}
        >
          {note?.text ?? ''}
        </p>
        {/*
          La salida cuando la página no pudo bajar el archivo: el video directo,
          que el navegador abre por su cuenta y deja descargar desde su menú.
          Sin el atributo download, que entre dominios no hace nada.
        */}
        {note?.openVideo && isWebUrl(video.videoUrl) && (
          <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" className={BUTTON}>
            <ExternalLink size={15} className="shrink-0" aria-hidden /> Abrir el video
          </a>
        )}
      </div>
    </li>
  );
}

export function VideoList({
  videos: initial,
  maxPriceAgeMs,
  renderedAt,
}: {
  videos: ReadyVideo[];
  maxPriceAgeMs: number;
  /** Cuándo armó la lista el servidor: identifica esta carga de la página. */
  renderedAt: number;
}) {
  // La edad de la lista se mide con el reloj de este teléfono, no contra la hora del servidor.
  const [visit] = useState(() => visitFor(renderedAt));
  const [posted, setPosted] = useState<Record<string, PostedByNetwork>>(() => {
    const start: Record<string, PostedByNetwork> = {};
    for (const video of initial) start[video.id] = mergePosted(video, visit.changes);
    return start;
  });
  // Copia local, y el orden se decide una sola vez: si una tarjeta se fuera al
  // final al marcar la cuarta red, las de abajo se correrían bajo el dedo.
  // Videos y precios nuevos llegan con otra carga de la página, que monta esta
  // lista de cero (la página le pone de key la hora de la carga).
  const [videos] = useState(() => pendingFirst(initial, posted));

  const [fileState, setFileState] = useState<Record<string, FileState>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  /** null hasta saber si este aparato puede compartir archivos. */
  const [canShare, setCanShare] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Lo último que se copió, dicho en palabras para quien usa lector de pantalla. */
  const [announced, setAnnounced] = useState('');
  /** El texto que no se pudo copiar, para copiarlo a mano. */
  const [manual, setManual] = useState<Record<string, ManualCopy>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [, startTransition] = useTransition();

  // Las reglas se arman una vez por lista: guardan los archivos ya bajados y
  // los candados de doble toque, que tienen que durar de un toque al siguiente.
  const [gestures] = useState(() =>
    createVideoGestures(
      BROWSER,
      { mark: markVideoPosted, undo: undoVideoPosted },
      screenUi(
        { setNotes, setFileState, setSaving, setCopied, setAnnounced, setManual, setBusy, setPosted, startTransition },
        visit
      ),
      // La edad de la lista cuenta desde la visita, no desde que se armaron las reglas: volver con "atrás" no la rejuvenece.
      { maxPriceAgeMs, openedAt: visit.openedAt }
    )
  );

  useEffect(() => {
    const probe = new File([''], 'reel.mp4', { type: 'video/mp4' });
    setCanShare(canShareVideos(navigator, window.matchMedia('(pointer: coarse)').matches, probe));
  }, []);

  useEffect(() => {
    gestures.attach();
    return () => gestures.detach();
  }, [gestures]);

  return (
    <div className="mt-6 flex flex-col gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announced}
      </p>
      {canShare === false && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          El botón <strong className="text-fg">Compartir</strong> aparece en el teléfono, con Chrome o Safari. Acá
          puedes guardar el video y copiar los textos.
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            video={video}
            posted={posted[video.id] ?? {}}
            fileState={fileState[video.id]}
            saving={Boolean(saving[video.id])}
            canShare={canShare}
            copied={copied}
            busy={busy}
            note={notes[video.id]}
            manual={manual[video.id]}
            gestures={gestures}
          />
        ))}
      </ul>
    </div>
  );
}
