'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { AlertTriangle, Check, Circle, Copy, Download, Loader2, Share2 } from 'lucide-react';
import { chileDateTime, formatPrice } from '@/lib/content/captions';
import type { ReadyVideo, VideoNetwork, VideoTexts } from '@/lib/social/videos';
import { markVideoPosted, undoVideoPosted } from './actions';

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
 */

type FileState = 'cargando' | 'lista' | 'error';

/** Una marca de "subido": la fila de social_posts y cuándo se anotó. */
export interface Mark {
  postId: number;
  at: string;
}
export type PostedByNetwork = Partial<Record<VideoNetwork, Mark>>;

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

/** Un botón por texto. YouTube pide título y descripción en campos separados. */
const TEXTS: { key: keyof VideoTexts; label: string }[] = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'youtubeTitle', label: 'YouTube: título' },
  { key: 'youtubeDescription', label: 'YouTube: descripción' },
];

/** Pasado este rato hay que recargar: los precios se revisan cada media hora. */
const MAX_LIST_AGE_MS = 60 * 60_000;

const COPY_ERROR = 'El teléfono no dejó copiar. Mantén el dedo sobre el texto de abajo y elige Copiar.';
const RELOAD_HINT = 'Revisa tu conexión; si sigue igual, toca Actualizar, arriba.';

const BUTTON_SHAPE =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition disabled:opacity-50';
const BUTTON = `${BUTTON_SHAPE} border-border bg-surface text-fg hover:border-accent/50`;
/**
 * Una red ya marcada. Clase aparte y no BUTTON más otros colores: dos colores
 * de texto en el mismo botón los resuelve el orden del CSS, no el de las clases.
 */
const BUTTON_MARKED = `${BUTTON_SHAPE} border-accent/60 bg-accent/10 text-accent`;

const markKey = (videoId: string, network: VideoNetwork) => `${videoId}|${network}`;

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
interface Visit {
  openedAt: number;
  changes: Map<string, Mark | null>;
}
const visits = new Map<number, Visit>();
const MAX_VISITS = 6;

function visitFor(renderedAt: number): Visit {
  const known = visits.get(renderedAt);
  if (known) return known;
  const visit: Visit = { openedAt: Date.now(), changes: new Map() };
  // En el servidor no se guarda: ahí este módulo lo comparten todas las visitas.
  if (typeof window === 'undefined') return visit;
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

/**
 * Baja el video a memoria, o null si no se pudo. Dos intentos: en el teléfono
 * una descarga se corta fácil al pasar a otra app.
 */
export async function fetchVideoFile(url: string, fileName: string, fetcher: typeof fetch = fetch): Promise<File | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetcher(url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (blob.size === 0) throw new Error('archivo vacío');
      // Siempre video/mp4, diga lo que diga el almacén: con ese tipo el teléfono decide a qué apps ofrecerlo.
      return new File([blob], fileName, { type: 'video/mp4' });
    } catch {
      /* se intenta una vez más */
    }
  }
  return null;
}

interface Note {
  tone: 'error' | 'info';
  text: string;
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
  // Para traer videos y precios nuevos está "Actualizar", que recarga la página.
  const [videos] = useState(() => pendingFirst(initial, posted));

  /** Archivos ya bajados y descargas en curso, por producto. */
  const files = useRef(new Map<string, File>());
  const downloads = useRef(new Map<string, Promise<File | null>>());
  const alive = useRef(true);
  const lastShare = useRef(0);
  const lastSave = useRef(new Map<string, number>());
  const lastToggle = useRef(new Map<string, number>());
  /** Hay una marca viajando al servidor. En una referencia: dos toques seguidos leen el mismo estado. */
  const inFlight = useRef(false);
  const [fileState, setFileState] = useState<Record<string, FileState>>({});
  /** null hasta saber si este aparato puede compartir archivos. */
  const [canShare, setCanShare] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Lo último que se copió, dicho en palabras para quien usa lector de pantalla. */
  const [announced, setAnnounced] = useState('');
  /** El texto que no se pudo copiar, para copiarlo a mano. */
  const [manual, setManual] = useState<Record<string, { label: string; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Solo con pantalla táctil: el computador también "comparte" archivos,
    // pero su panel no llega a Instagram ni a TikTok.
    const probe = new File([''], 'reel.mp4', { type: 'video/mp4' });
    setCanShare(
      typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [probe] }) &&
        window.matchMedia('(pointer: coarse)').matches
    );
  }, []);

  useEffect(() => {
    alive.current = true;
    const store = files.current;
    const running = downloads.current;
    return () => {
      // Al salir se sueltan los archivos: cada uno son varios megas de memoria del teléfono.
      alive.current = false;
      store.clear();
      running.clear();
    };
  }, []);

  const say = (videoId: string, tone: Note['tone'], text: string) => setNotes((n) => ({ ...n, [videoId]: { tone, text } }));
  const fail = (videoId: string, text: string) => say(videoId, 'error', text);
  const clear = (videoId: string) =>
    setNotes((n) => {
      if (!(videoId in n)) return n;
      const rest = { ...n };
      delete rest[videoId];
      return rest;
    });

  /** Una pestaña que quedó abierta lleva los precios de cuando se cargó, y el video también. */
  function tooOld(video: ReadyVideo): boolean {
    const oldPrice = video.checkedAt ? Date.now() - new Date(video.checkedAt).getTime() > maxPriceAgeMs : false;
    const oldList = Date.now() - visit.openedAt > MAX_LIST_AGE_MS;
    if (!oldPrice && !oldList) return false;
    fail(video.id, 'Esta lista ya tiene rato y el precio puede haber cambiado. Toca Actualizar, arriba, antes de subir el video.');
    return true;
  }

  /** Baja el video una sola vez, aunque se pida desde Compartir y desde Guardar. */
  function load(video: ReadyVideo): Promise<File | null> {
    const ready = files.current.get(video.id);
    if (ready) return Promise.resolve(ready);
    const running = downloads.current.get(video.id);
    if (running) return running;

    setFileState((s) => ({ ...s, [video.id]: 'cargando' }));
    const job = fetchVideoFile(video.videoUrl, video.fileName).then((file) => {
      downloads.current.delete(video.id);
      // Si ya se salió de la página no queda nada que avisar ni que guardar.
      if (!alive.current) return null;
      if (file) files.current.set(video.id, file);
      setFileState((s) => ({ ...s, [video.id]: file ? 'lista' : 'error' }));
      if (!file) fail(video.id, `No se pudo bajar el video. ${RELOAD_HINT}`);
      return file;
    });
    downloads.current.set(video.id, job);
    return job;
  }

  function share(video: ReadyVideo) {
    if (tooOld(video)) return;
    const file = files.current.get(video.id);
    if (!file) {
      // Primer toque: solo baja. La hoja de compartir no se puede abrir cuando termine, porque el permiso del toque ya venció.
      clear(video.id);
      void load(video).then((got) => {
        if (got) say(video.id, 'info', 'Video listo. Toca el botón otra vez para elegir la app.');
      });
      return;
    }
    // Un doble toque no vuelve a pedir Compartir: el navegador rechaza el segundo y quedaría un error falso.
    if (Date.now() - lastShare.current < 1500) return;
    lastShare.current = Date.now();
    clear(video.id);
    navigator.share({ files: [file] }).catch((err: unknown) => {
      // Cerrar la hoja de compartir no es un error.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      fail(video.id, 'No se pudo abrir Compartir. Toca Guardar video y súbelo desde la app de la red.');
    });
  }

  /**
   * Guarda el video en el teléfono. El archivo está en otro dominio (el
   * almacén), y ahí el navegador ignora el atributo download de un enlace:
   * se baja a memoria y la descarga se dispara desde ese archivo.
   */
  function save(video: ReadyVideo) {
    if (tooOld(video)) return;
    // Un doble toque no lo guarda dos veces. Mientras se baja, el botón está apagado.
    if (Date.now() - (lastSave.current.get(video.id) ?? 0) < 1500) return;
    lastSave.current.set(video.id, Date.now());
    clear(video.id);
    void load(video).then((file) => {
      if (!file) return;
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = video.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Con margen: el navegador sigue leyendo el archivo después del clic.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    });
  }

  async function copy(video: ReadyVideo, what: string, label: string, text: string) {
    const key = `${video.id}|${what}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      // El nombre entre paréntesis: "YouTube: título" ya trae dos puntos.
      setAnnounced(what === 'link' ? `Link copiado (${video.name})` : `Texto copiado para ${label} (${video.name})`);
      setManual((m) => {
        if (!(video.id in m)) return m;
        const rest = { ...m };
        delete rest[video.id];
        return rest;
      });
      // Solo se borra el aviso de la copia: otro aviso (lista vieja, Compartir) sigue a la vista.
      setNotes((n) => {
        if (n[video.id]?.text !== COPY_ERROR) return n;
        const rest = { ...n };
        delete rest[video.id];
        return rest;
      });
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2500);
    } catch {
      // Queda escrito en la tarjeta, completo, para copiarlo con el dedo.
      setManual((m) => ({ ...m, [video.id]: { label, text } }));
      fail(video.id, COPY_ERROR);
    }
  }

  function remember(videoId: string, network: VideoNetwork, mark: Mark | null) {
    visit.changes.set(markKey(videoId, network), mark);
    setPosted((p) => {
      const next: PostedByNetwork = { ...(p[videoId] ?? {}) };
      if (mark) next[network] = mark;
      else delete next[network];
      return { ...p, [videoId]: next };
    });
  }

  /** Marca o desmarca una red. El mismo botón hace las dos cosas. */
  function toggle(video: ReadyVideo, network: VideoNetwork) {
    const key = markKey(video.id, network);
    // De a una, y un doble toque no marca y desmarca de corrido.
    if (inFlight.current || Date.now() - (lastToggle.current.get(key) ?? 0) < 1000) return;
    const current = posted[video.id]?.[network];
    inFlight.current = true;
    setBusy(key);
    clear(video.id);
    startTransition(async () => {
      try {
        if (current) {
          const result = await undoVideoPosted(current.postId);
          // Si la marca ya estaba deshecha (un intento anterior llegó, pero su
          // respuesta se perdió), el botón queda desmarcado igual: es lo que hay en la base.
          if (!result.ok && !result.gone) {
            fail(video.id, result.error);
            return;
          }
          remember(video.id, network, null);
        } else {
          // Con el precio de la tarjeta, que es el que lleva escrito el video.
          const result = await markVideoPosted(video.id, network, video.price);
          if (!result.ok) {
            fail(video.id, result.error);
            return;
          }
          remember(video.id, network, { postId: result.postId, at: new Date().toISOString() });
        }
        lastToggle.current.set(key, Date.now());
      } catch {
        fail(video.id, `No se pudo guardar. ${RELOAD_HINT}`);
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    });
  }

  function copyButton(video: ReadyVideo, what: string, label: string, text: string, copiedLabel: string, extra = '') {
    const done = copied === `${video.id}|${what}`;
    return (
      <button
        key={what}
        type="button"
        onClick={() => void copy(video, what, label, text)}
        disabled={!text}
        className={`${BUTTON} ${extra}`}
      >
        {done ? <Check size={15} className="shrink-0 text-accent" aria-hidden /> : <Copy size={15} className="shrink-0" aria-hidden />}
        {/* Los dos textos ocupan el mismo lugar y solo se ve uno: el botón mide lo mismo antes y después de copiar, y nada se corre. */}
        <span className="grid text-center">
          <span aria-hidden={done} className={`col-start-1 row-start-1 ${done ? 'invisible' : ''}`}>
            {label}
          </span>
          <span aria-hidden={!done} className={`col-start-1 row-start-1 ${done ? '' : 'invisible'}`}>
            {copiedLabel}
          </span>
        </span>
      </button>
    );
  }

  function card(video: ReadyVideo) {
    const mine = posted[video.id] ?? {};
    const everywhere = isEverywhere(mine);
    const state = fileState[video.id];
    const made = chileDateTime(video.renderedAt);
    const note = notes[video.id];
    const pending = manual[video.id];
    const { why, warning } = splitReason(video.reason);

    return (
      <li
        key={video.id}
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-3 sm:p-4"
      >
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
          {/* Si no caben en un renglón, el precio de lista baja entero al siguiente: no se parte en el punto. */}
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-fg">
            <strong className="font-heading text-lg">{formatPrice(video.price)}</strong>
            {video.listPrice !== null && video.discount > 0 && (
              <span className="whitespace-nowrap text-xs text-muted">
                lista <s>{formatPrice(video.listPrice)}</s> · -{video.discount}%
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
                onClick={() => share(video)}
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
            <button type="button" onClick={() => save(video)} disabled={state === 'cargando'} className={BUTTON}>
              <Download size={15} className="shrink-0" aria-hidden /> Guardar video
            </button>
            {copyButton(video, 'link', 'Copiar link', video.link, 'Link copiado')}
          </div>

          <div role="group" aria-labelledby={`textos-${video.id}`}>
            <p id={`textos-${video.id}`} className="text-xs font-medium text-muted">
              Copiar texto para:
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TEXTS.map((t, i) =>
                // Son cinco: en el teléfono el último ocupa la fila entera y su nombre, que es largo, no se parte.
                copyButton(video, t.key, t.label, video.texts[t.key], 'Copiado', i === TEXTS.length - 1 ? 'col-span-2 sm:col-span-1' : '')
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
                const marked = Boolean(mine[network]);
                const key = markKey(video.id, network);
                return (
                  <button
                    key={network}
                    type="button"
                    aria-pressed={marked}
                    onClick={() => toggle(video, network)}
                    disabled={busy !== null}
                    className={marked ? BUTTON_MARKED : BUTTON}
                  >
                    {/* El visto y el círculo vacío dicen el estado sin depender del color. */}
                    {marked ? (
                      <Check size={15} className="shrink-0" aria-hidden />
                    ) : (
                      <Circle size={15} className="shrink-0 text-muted" aria-hidden />
                    )}
                    {busy === key ? 'Guardando…' : NETWORK_LABELS[network]}
                  </button>
                );
              })}
            </div>
          </div>

          {pending && (
            <div className="rounded-md border border-border bg-bg p-2">
              <p className="text-[11px] font-medium text-muted">{pending.label}</p>
              <p className="mt-1 select-all whitespace-pre-wrap break-words text-xs text-fg">{pending.text}</p>
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
        </div>
      </li>
    );
  }

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
      <ul className="flex flex-col gap-4">{videos.map(card)}</ul>
    </div>
  );
}
