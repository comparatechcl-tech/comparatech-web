import type { ReadyVideo, VideoNetwork, VideoTexts } from '@/lib/social/videos';
import type { markVideoPosted, undoVideoPosted } from './actions';

/**
 * Lo que pasa al tocar un botón de /admin/videos: compartir, guardar, copiar
 * y marcar.
 *
 * Va fuera del componente y recibe de afuera todo lo que toca del navegador
 * (la hoja de compartir, el portapapeles, las descargas, el reloj) y del
 * servidor (las acciones), para poder probarlo con dobles: los tests corren
 * sin navegador, y acá están justo las reglas que no se ven a simple vista.
 * Que Compartir se llame dentro del toque, que un doble toque no haga las
 * cosas dos veces, que la memoria del teléfono se suelte.
 */

export type FileState = 'cargando' | 'lista' | 'error';

/** Una marca de "subido": la fila de social_posts y cuándo se anotó. */
export interface Mark {
  postId: number;
  at: string;
}

/** Lo que la tarjeta avisa debajo de sus botones. */
export interface Note {
  tone: 'error' | 'info';
  text: string;
  /** Ofrece además abrir el video directo en otra pestaña: la salida cuando no se pudo bajar. */
  openVideo?: boolean;
}

/** Un botón de copiar: qué dice y qué texto deja en el portapapeles. */
export interface CopyTarget {
  what: 'link' | keyof VideoTexts;
  label: string;
  copiedLabel: string;
  text: string;
}

/**
 * Un botón por texto, en el orden en que se muestran. YouTube pide título y
 * descripción en campos separados. Un Record y no una lista: si el contrato
 * suma un texto, esto deja de compilar en vez de quedar sin botón.
 */
const TEXT_LABELS: Record<keyof VideoTexts, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  youtubeTitle: 'YouTube: título',
  youtubeDescription: 'YouTube: descripción',
};

/** El botón de cada texto con el texto que le toca a esa red. Puro. */
export function textTargets(video: ReadyVideo): CopyTarget[] {
  return (Object.keys(TEXT_LABELS) as (keyof VideoTexts)[]).map((key) => ({
    what: key,
    label: TEXT_LABELS[key],
    copiedLabel: 'Copiado',
    text: video.texts[key],
  }));
}

/** Copiar link deja el link de afiliado del producto, nunca la dirección del archivo de video. Puro. */
export function linkTarget(video: ReadyVideo): CopyTarget {
  return { what: 'link', label: 'Copiar link', copiedLabel: 'Link copiado', text: video.link };
}

export const markKey = (videoId: string, network: VideoNetwork) => `${videoId}|${network}`;

/**
 * ¿Este aparato puede mandar el archivo a las apps de las redes? Solo con
 * pantalla táctil: el computador también "comparte" archivos, pero su panel
 * no llega a Instagram ni a TikTok. Puro.
 */
export function canShareVideos(
  nav: { canShare?: (data: { files: File[] }) => boolean },
  touchScreen: boolean,
  probe: File
): boolean {
  return typeof nav.canShare === 'function' && nav.canShare({ files: [probe] }) && touchScreen;
}

/** Lo que las reglas tocan del navegador. La página entrega lo de verdad; los tests, dobles. */
export interface GestureEnv {
  /** La hoja de compartir del teléfono (navigator.share). */
  share(data: { files: File[] }): Promise<void>;
  /** El portapapeles (navigator.clipboard.writeText). */
  writeText(text: string): Promise<void>;
  /** Baja el video a memoria, o null si no se pudo. */
  fetchFile(url: string, fileName: string): Promise<File | null>;
  createObjectURL(file: File): string;
  revokeObjectURL(url: string): void;
  /** Dispara la descarga de una dirección con ese nombre de archivo. */
  download(url: string, fileName: string): void;
  now(): number;
  later(run: () => void, ms: number): void;
}

export interface GestureActions {
  mark: typeof markVideoPosted;
  undo: typeof undoVideoPosted;
}

/** Lo que las reglas le piden a la pantalla: son los setState del componente. */
export interface GestureUi {
  /** El aviso de una tarjeta; null lo borra. */
  note(videoId: string, note: Note | null): void;
  fileState(videoId: string, state: FileState): void;
  /** El botón Guardar de esa tarjeta está bajando el video. */
  saving(videoId: string, on: boolean): void;
  /** El botón de copiar que muestra su confirmación (`videoId|what`). */
  copied(key: string, on: boolean): void;
  /** Lo último que se copió, dicho en palabras para quien usa lector de pantalla. */
  announce(text: string): void;
  /** El texto que no se pudo copiar, para copiarlo a mano; null lo quita. */
  manual(videoId: string, pending: { label: string; text: string } | null): void;
  /** La marca que está viajando al servidor (`videoId|red`), o null. */
  busy(key: string | null): void;
  /** Una red quedó marcada (con su marca) o desmarcada (null). */
  posted(videoId: string, network: VideoNetwork, mark: Mark | null): void;
  /** Corre la llamada al servidor (en la página, dentro de una transición). */
  run(job: () => Promise<void>): void;
}

export interface GestureConfig {
  /** Pasado este rato desde la última revisión del precio, el video no se sube sin recargar. */
  maxPriceAgeMs: number;
  /** Cuándo se vio esta lista por primera vez en este teléfono. */
  openedAt: number;
}

export interface VideoGestures {
  share(video: ReadyVideo): void;
  save(video: ReadyVideo): void;
  copy(video: ReadyVideo, target: CopyTarget): Promise<void>;
  /** Marca o desmarca una red. `current` es la marca que la tarjeta muestra ahora, si hay. */
  toggle(video: ReadyVideo, network: VideoNetwork, current: Mark | undefined): void;
  /** La lista está en pantalla. */
  attach(): void;
  /** La lista salió de pantalla: se sueltan los archivos bajados. */
  detach(): void;
}

/** Pasado este rato hay que recargar: los precios se revisan cada media hora. */
const MAX_LIST_AGE_MS = 60 * 60_000;
/** Dos toques más seguidos que esto son un doble toque, no dos pedidos. */
const SHARE_GAP_MS = 1500;
const SAVE_GAP_MS = 1500;
const TOGGLE_GAP_MS = 1000;
/** Lo que vive la dirección de la descarga: el navegador sigue leyendo el archivo después del clic. */
const SAVE_URL_LIFE_MS = 60_000;
const COPIED_MS = 2500;

const COPY_ERROR = 'El teléfono no dejó copiar. Mantén el dedo sobre el texto de abajo y elige Copiar.';
const RELOAD_HINT = 'Revisa tu conexión; si sigue igual, toca Actualizar, arriba.';
const OLD_LIST = 'Esta lista ya tiene rato y el precio puede haber cambiado. Toca Actualizar, arriba, antes de subir el video.';
/**
 * La descarga pasa por otro dominio (el almacén) y puede fallar aunque haya
 * conexión, mientras el reproductor sí funciona: por eso el aviso no culpa
 * solo a la conexión y deja a mano el video directo.
 */
const DOWNLOAD_ERROR =
  'No se pudo bajar el video. Revisa tu conexión y prueba otra vez. Si sigue igual, toca Abrir el video, acá abajo, y descárgalo desde el menú del reproductor (los tres puntos).';
/** Compartir manda solo el archivo: el texto hay que llevarlo copiado desde antes de salir a la app. */
const SHARE_READY = 'Video listo. Copia primero el texto de la red y toca el botón otra vez para elegir la app.';
const SHARE_ERROR = 'No se pudo abrir Compartir. Toca Guardar video y súbelo desde la app de la red.';
const SAVED = 'Video guardado. Búscalo en Descargas.';

export function createVideoGestures(
  env: GestureEnv,
  actions: GestureActions,
  ui: GestureUi,
  config: GestureConfig
): VideoGestures {
  /** Archivos ya bajados y descargas en curso, por producto. */
  const files = new Map<string, File>();
  const downloads = new Map<string, Promise<File | null>>();
  /** El aviso que muestra cada tarjeta ahora. */
  const shown = new Map<string, Note>();
  const lastSave = new Map<string, number>();
  const lastToggle = new Map<string, number>();
  let lastShare = 0;
  let alive = true;
  /** Hay una marca viajando al servidor: de a una, para toda la lista. */
  let inFlight = false;

  function say(videoId: string, note: Note) {
    shown.set(videoId, note);
    ui.note(videoId, note);
  }
  const fail = (videoId: string, text: string) => say(videoId, { tone: 'error', text });
  function clear(videoId: string) {
    shown.delete(videoId);
    ui.note(videoId, null);
  }

  /** Una pestaña que quedó abierta lleva los precios de cuando se cargó, y el video también. */
  function tooOld(video: ReadyVideo): boolean {
    const oldPrice = video.checkedAt ? env.now() - new Date(video.checkedAt).getTime() > config.maxPriceAgeMs : false;
    const oldList = env.now() - config.openedAt > MAX_LIST_AGE_MS;
    if (!oldPrice && !oldList) return false;
    fail(video.id, OLD_LIST);
    return true;
  }

  /** Baja el video una sola vez, aunque se pida desde Compartir y desde Guardar. */
  function load(video: ReadyVideo): Promise<File | null> {
    const ready = files.get(video.id);
    if (ready) return Promise.resolve(ready);
    const running = downloads.get(video.id);
    if (running) return running;

    ui.fileState(video.id, 'cargando');
    const job = env
      .fetchFile(video.videoUrl, video.fileName)
      .catch(() => null)
      .then((file) => {
        downloads.delete(video.id);
        // Si ya se salió de la página no queda nada que avisar ni que guardar.
        if (!alive) return null;
        if (file) files.set(video.id, file);
        ui.fileState(video.id, file ? 'lista' : 'error');
        if (!file) say(video.id, { tone: 'error', text: DOWNLOAD_ERROR, openVideo: true });
        return file;
      });
    downloads.set(video.id, job);
    return job;
  }

  function share(video: ReadyVideo) {
    if (tooOld(video)) return;
    const file = files.get(video.id);
    if (!file) {
      // Primer toque: solo baja. La hoja de compartir no se puede abrir cuando
      // termine, porque el permiso del toque ya venció.
      clear(video.id);
      void load(video).then((got) => {
        if (got) say(video.id, { tone: 'info', text: SHARE_READY });
      });
      return;
    }
    // Un doble toque no vuelve a pedir Compartir: el navegador rechaza el segundo y quedaría un error falso.
    if (env.now() - lastShare < SHARE_GAP_MS) return;
    lastShare = env.now();
    clear(video.id);
    // Acá mismo, sin esperar nada antes: es lo que mantiene la llamada dentro del toque.
    let sharing: Promise<void>;
    try {
      sharing = env.share({ files: [file] });
    } catch (err) {
      sharing = Promise.reject(err);
    }
    sharing.catch((err: unknown) => {
      // Cerrar la hoja de compartir no es un error.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      fail(video.id, SHARE_ERROR);
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
    if (env.now() - (lastSave.get(video.id) ?? 0) < SAVE_GAP_MS) return;
    lastSave.set(video.id, env.now());
    clear(video.id);
    // Con el archivo ya en memoria no hay nada que esperar: el botón no cambia.
    const waiting = !files.has(video.id);
    if (waiting) ui.saving(video.id, true);
    void load(video).then((file) => {
      if (waiting && alive) ui.saving(video.id, false);
      if (!file) return;
      const url = env.createObjectURL(file);
      env.download(url, video.fileName);
      // Con margen, y siempre: una dirección sin soltar retiene el video entero en memoria.
      env.later(() => env.revokeObjectURL(url), SAVE_URL_LIFE_MS);
      say(video.id, { tone: 'info', text: SAVED });
    });
  }

  async function copy(video: ReadyVideo, target: CopyTarget) {
    const key = `${video.id}|${target.what}`;
    try {
      await env.writeText(target.text);
    } catch {
      // Queda escrito en la tarjeta, completo, para copiarlo con el dedo.
      ui.manual(video.id, { label: target.label, text: target.text });
      fail(video.id, COPY_ERROR);
      return;
    }
    ui.copied(key, true);
    // El nombre entre paréntesis: "YouTube: título" ya trae dos puntos.
    ui.announce(
      target.what === 'link' ? `Link copiado (${video.name})` : `Texto copiado para ${target.label} (${video.name})`
    );
    ui.manual(video.id, null);
    // Solo se borra el aviso de la copia: otro aviso (lista vieja, Compartir) sigue a la vista.
    if (shown.get(video.id)?.text === COPY_ERROR) clear(video.id);
    env.later(() => ui.copied(key, false), COPIED_MS);
  }

  /** Marca o desmarca una red. El mismo botón hace las dos cosas. */
  function toggle(video: ReadyVideo, network: VideoNetwork, current: Mark | undefined) {
    const key = markKey(video.id, network);
    // De a una, y un doble toque no marca y desmarca de corrido.
    if (inFlight || env.now() - (lastToggle.get(key) ?? 0) < TOGGLE_GAP_MS) return;
    inFlight = true;
    ui.busy(key);
    clear(video.id);
    ui.run(async () => {
      try {
        if (current) {
          const result = await actions.undo(current.postId);
          // Si la marca ya estaba deshecha (un intento anterior llegó, pero su
          // respuesta se perdió), el botón queda desmarcado igual: es lo que hay en la base.
          if (!result.ok && !result.gone) {
            fail(video.id, result.error);
            return;
          }
          ui.posted(video.id, network, null);
        } else {
          // Con el precio de la tarjeta, que es el que lleva escrito el video.
          const result = await actions.mark(video.id, network, video.price);
          if (!result.ok) {
            fail(video.id, result.error);
            return;
          }
          ui.posted(video.id, network, { postId: result.postId, at: new Date(env.now()).toISOString() });
        }
        lastToggle.set(key, env.now());
      } catch {
        fail(video.id, `No se pudo guardar. ${RELOAD_HINT}`);
      } finally {
        inFlight = false;
        ui.busy(null);
      }
    });
  }

  return {
    share,
    save,
    copy,
    toggle,
    attach() {
      alive = true;
    },
    detach() {
      // Al salir se sueltan los archivos: cada uno son varios megas de memoria del teléfono.
      alive = false;
      files.clear();
      downloads.clear();
    },
  };
}
