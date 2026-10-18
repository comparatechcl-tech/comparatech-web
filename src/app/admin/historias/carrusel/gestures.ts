import type { CarouselEntry, CarouselSlideFile } from '@/lib/social/carousel';
import type { CarouselCaptions } from '@/lib/content/captions';
import type { markCarouselPublished, undoCarouselPublished } from './actions';
import { COPY_ERROR, RELOAD_HINT, type Note, type StoryEnv } from '../gestures';
import type { CardCheck } from '../rules';
import { carouselGate, relevantCheck, type CarouselGate } from './rules';

/**
 * Lo que pasa al tocar un botón de /admin/historias/carrusel: compartir las
 * láminas de una vez, copiar el texto, guardarlas, marcar el carrusel como
 * publicado y deshacer.
 *
 * Como en Historias (../gestures), recibe de afuera lo que toca del navegador,
 * del servidor y de la revisión en vivo, para probarlo con dobles; y Compartir
 * se llama dentro del toque, sin esperar nada: la revisión ya está hecha.
 */

export type CaptionNetwork = keyof CarouselCaptions;

export interface CarouselEnv extends StoryEnv {
  /** Baja un archivo: un enlace con `download`, tocado por código (mismo sitio: sin blob:). */
  download(url: string, fileName: string): void;
}

export interface CarouselActions {
  mark: typeof markCarouselPublished;
  undo: typeof undoCarouselPublished;
}

/** Una marca hecha: sus filas (una por producto) y cuándo. */
export interface CarouselMark {
  postIds: number[];
  postedAt: string;
}

export interface CarouselUi {
  /** El aviso bajo los botones; null lo borra. */
  note(note: Note | null): void;
  /** El botón de copiar que muestra su confirmación, o null. */
  copied(network: CaptionNetwork | null): void;
  busy(on: boolean): void;
  /** Quedó marcado (con su marca) o desmarcado (null). */
  published(mark: CarouselMark | null): void;
  run(job: () => Promise<void>): void;
}

export interface CarouselConfig {
  openedAt: number;
  maxPriceAgeMs: number;
  checkOf(productId: string): CardCheck | undefined;
  recheck(): void;
  fileOf(image: string): File | undefined;
}

/** Lo que las reglas necesitan del carrusel. */
export interface CarouselParts {
  cover: CarouselSlideFile;
  entries: CarouselEntry[];
  closing: CarouselSlideFile;
  captions: CarouselCaptions;
}

export interface CarouselGestures {
  /** El estado de la compuerta ahora (para dibujar el aviso y las miniaturas). */
  gate(): CarouselGate;
  share(): void;
  copy(network: CaptionNetwork): Promise<void>;
  /** true si se deja guardar una lámina; si no, el aviso dice por qué. */
  save(): boolean;
  saveAll(): void;
  mark(): void;
  undo(mark: CarouselMark): void;
}

/** Las láminas en el orden en que se publican: portada, productos y cierre. */
export function slidesOf(parts: Pick<CarouselParts, 'cover' | 'entries' | 'closing'>): CarouselSlideFile[] {
  return [parts.cover, ...parts.entries, parts.closing];
}

const SHARE_GAP_MS = 1500;
const UNDO_AFTER_MARK_MS = 1000;
const COPIED_MS = 2500;

export const SHARE_ERROR_ALL =
  'No se pudo abrir Compartir. Toca Guardar las imágenes y súbelas desde la app de Instagram.';
export const MISSING_FILES = 'Todavía estoy preparando las imágenes. Espera unos segundos y toca otra vez.';
export const MARKED_BUT_CHANGED_ALL =
  'Quedó marcado, pero en Mercado Libre cambió algo del carrusel: si ya lo subiste, revisa la publicación y toca Actualizar.';

export function createCarouselGestures(
  env: CarouselEnv,
  actions: CarouselActions,
  ui: CarouselUi,
  config: CarouselConfig,
  parts: CarouselParts
): CarouselGestures {
  let shown: Note | null = null;
  let lastShare = 0;
  let lastMark = 0;
  let inFlight = false;

  function say(note: Note) {
    shown = note;
    ui.note(note);
  }
  const fail = (text: string) => say({ tone: 'error', text });
  function clear() {
    if (!shown) return;
    shown = null;
    ui.note(null);
  }

  function gate(): CarouselGate {
    return carouselGate(parts.entries, config.checkOf, {
      now: env.now(),
      openedAt: config.openedAt,
      maxPriceAgeMs: config.maxPriceAgeMs,
    });
  }

  function allowed(): boolean {
    const g = gate();
    if (g.ok) {
      // Un bloqueo anterior ya no vale; otro aviso (la copia, la marca) sigue a la vista.
      if (shown?.tone === 'error' && shown.text !== COPY_ERROR) clear();
      return true;
    }
    fail(g.message);
    if (g.recheck) config.recheck();
    return false;
  }

  async function copy(network: CaptionNetwork) {
    try {
      await env.writeText(parts.captions[network]);
    } catch {
      fail(COPY_ERROR);
      return;
    }
    ui.copied(network);
    if (shown?.text === COPY_ERROR) clear();
    env.later(() => ui.copied(null), COPIED_MS);
  }

  function share() {
    const files = slidesOf(parts).map((slide) => config.fileOf(slide.image));
    if (files.some((file) => !file)) {
      fail(MISSING_FILES);
      return;
    }
    if (!allowed()) return;
    if (env.now() - lastShare < SHARE_GAP_MS) return;
    lastShare = env.now();
    // Las dos cosas dentro del mismo toque: el texto de Instagram queda copiado para pegarlo.
    void copy('instagram');
    let sharing: Promise<void>;
    try {
      sharing = env.share({ files: files as File[] });
    } catch (err) {
      sharing = Promise.reject(err);
    }
    sharing.catch((err: unknown) => {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      fail(SHARE_ERROR_ALL);
    });
  }

  function mark() {
    if (inFlight) return;
    inFlight = true;
    ui.busy(true);
    clear();
    ui.run(async () => {
      try {
        // Con el precio de cada lámina, que es el que se publicó.
        const result = await actions.mark(parts.entries.map((e) => ({ productId: e.id, price: e.price })));
        if (!result.ok) {
          fail(result.error);
          return;
        }
        lastMark = env.now();
        ui.published({ postIds: result.postIds, postedAt: result.postedAt });
        const changed = parts.entries.some((e) => {
          const status = relevantCheck(config.checkOf(e.id), e)?.last?.result.status;
          return status === 'changed' || status === 'unavailable';
        });
        const notice = result.warning ?? (changed ? MARKED_BUT_CHANGED_ALL : null);
        if (notice) say({ tone: 'warn', text: notice });
      } catch {
        fail(`No se pudo guardar. ${RELOAD_HINT}`);
      } finally {
        inFlight = false;
        ui.busy(false);
      }
    });
  }

  function undo(done: CarouselMark) {
    // "Deshacer" queda donde estaba "Ya lo publiqué": un segundo toque seguido no debe deshacer.
    if (inFlight || env.now() - lastMark < UNDO_AFTER_MARK_MS) return;
    inFlight = true;
    ui.busy(true);
    clear();
    ui.run(async () => {
      try {
        const result = await actions.undo(done.postIds);
        if (!result.ok) {
          fail(result.error);
          return;
        }
        ui.published(null);
      } catch {
        fail(`No se pudo deshacer. ${RELOAD_HINT}`);
      } finally {
        inFlight = false;
        ui.busy(false);
      }
    });
  }

  return {
    gate,
    share,
    copy,
    save: allowed,
    saveAll() {
      if (!allowed()) return;
      // En orden y en el mismo toque: el teléfono puede preguntar una vez si deja bajar varios archivos.
      for (const slide of slidesOf(parts)) env.download(slide.image, slide.fileName);
    },
    mark,
    undo,
  };
}
