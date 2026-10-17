import type { StoryItem } from '@/lib/social/stories';
import type { markStoryPublished, undoStoryPublished } from './actions';
import { shareGate, type CardCheck, type Gate } from './rules';

/**
 * Lo que pasa al tocar un botón de /admin/historias: compartir, guardar la
 * imagen, copiar el link, marcar y deshacer.
 *
 * Va fuera del componente y recibe de afuera todo lo que toca del navegador
 * (la hoja de compartir, el portapapeles, el reloj), del servidor (las
 * acciones) y de la revisión en vivo (lo que ya está en memoria), para
 * probarlo con dobles. La regla que más importa: Compartir se llama dentro del
 * toque, sin esperar nada; la revisión en vivo ya está hecha y acá solo se lee.
 */

/** Lo que la tarjeta avisa debajo de sus botones. */
export interface Note {
  tone: 'error' | 'warn';
  text: string;
}

/** Lo que las reglas tocan del navegador. La página entrega lo de verdad; los tests, dobles. */
export interface StoryEnv {
  /** La hoja de compartir del teléfono (navigator.share). */
  share(data: { files: File[] }): Promise<void>;
  /** El portapapeles (navigator.clipboard.writeText). */
  writeText(text: string): Promise<void>;
  now(): number;
  later(run: () => void, ms: number): void;
}

export interface StoryActions {
  mark: typeof markStoryPublished;
  undo: typeof undoStoryPublished;
}

/** Lo que las reglas le piden a la pantalla: son los setState del componente. */
export interface StoryUi {
  /** El aviso de una tarjeta; null lo borra. */
  note(key: string, note: Note | null): void;
  /** El botón de copiar que muestra su confirmación. */
  copied(key: string, on: boolean): void;
  /** La tarjeta cuya marca está viajando al servidor, o null. */
  busy(key: string | null): void;
  /** Una oferta quedó marcada (con el id de su marca) o desmarcada (null). */
  published(item: StoryItem, postId: number | null): void;
  /** Una historia ya subida se desmarcó: sale de la lista. */
  unposted(postId: number): void;
  /** Corre la llamada al servidor (en la página, dentro de una transición). */
  run(job: () => Promise<void>): void;
}

export interface StoryConfig {
  /** Cuándo se vio esta lista por primera vez en este teléfono. */
  openedAt: number;
  /** Pasado este rato desde la última revisión del sitio, no se sube sin recargar (si no se pudo revisar en vivo). */
  maxPriceAgeMs: number;
  /** La revisión en vivo de un producto, tal como está ahora en memoria. */
  checkOf(productId: string): CardCheck | undefined;
  /** Pide otra revisión de la lista, sin esperarla. */
  recheck(): void;
  /** La imagen ya bajada a memoria, si está. */
  fileOf(image: string): File | undefined;
}

export interface StoryGestures {
  share(key: string, item: StoryItem): void;
  /** true si se deja guardar la imagen; si no, la tarjeta dice por qué. */
  save(key: string, item: StoryItem): boolean;
  copyLink(key: string, item: StoryItem): Promise<void>;
  mark(item: StoryItem): void;
  undoOffer(item: StoryItem, postId: number): void;
  undoPosted(key: string, postId: number): void;
}

/** Dos toques más seguidos que esto son un doble toque, no dos pedidos. */
const SHARE_GAP_MS = 1500;
/** "Deshacer" queda donde estaba "Ya la publiqué": un segundo toque seguido no debe deshacer. */
const UNDO_AFTER_MARK_MS = 1000;
const COPIED_MS = 2500;

export const COPY_ERROR = 'El teléfono no dejó copiar el link. Mantén el dedo sobre el link de abajo y elige Copiar.';
export const RELOAD_HINT = 'Revisa tu conexión; si sigue igual, toca Actualizar, arriba.';
/** Sin sugerir guardar la imagen con el dedo: eso se salta la revisión del precio. */
export const SHARE_ERROR = 'No se pudo abrir Compartir. Toca Guardar imagen y súbela desde la app.';
/** Marcar siempre se deja (puede que ya la haya subido), pero si Mercado Libre muestra otra cosa, se dice. */
export const MARKED_BUT_CHANGED =
  'Quedó marcada, pero en Mercado Libre cambió: si ya la subiste, bórrala de Instagram y toca Actualizar.';

/**
 * Lo que la acción de marcar avisa si el precio del sitio ya no es el de la
 * tarjeta. Lee lo que traiga la respuesta sin exigirlo: una pestaña abierta
 * con la versión anterior de la acción sigue funcionando. Puro.
 */
export function markNotice(result: unknown, shownPrice: number): string | null {
  const r = result as { warning?: unknown; notice?: unknown; currentPrice?: unknown; priceNow?: unknown } | null;
  if (!r || typeof r !== 'object') return null;
  for (const text of [r.warning, r.notice]) {
    if (typeof text === 'string' && text.trim()) return text.trim();
  }
  for (const price of [r.currentPrice, r.priceNow]) {
    if (typeof price === 'number' && Number.isFinite(price) && price > 0 && Math.round(price) !== Math.round(shownPrice)) {
      return 'Quedó marcada, pero el sitio ya tiene otro precio para este producto: revísalo con Ver en Mercado Libre y toca Actualizar.';
    }
  }
  return null;
}

export function createStoryGestures(env: StoryEnv, actions: StoryActions, ui: StoryUi, config: StoryConfig): StoryGestures {
  /** El aviso que muestra cada tarjeta ahora. */
  const shown = new Map<string, Note>();
  let lastShare = 0;
  let lastMark = 0;
  /** Hay una marca viajando al servidor: de a una, para toda la lista. */
  let inFlight = false;

  function say(key: string, note: Note) {
    shown.set(key, note);
    ui.note(key, note);
  }
  const fail = (key: string, text: string) => say(key, { tone: 'error', text });
  function clear(key: string) {
    if (!shown.has(key)) return;
    shown.delete(key);
    ui.note(key, null);
  }

  function gateOf(item: StoryItem): Gate {
    return shareGate(config.checkOf(item.id), {
      now: env.now(),
      openedAt: config.openedAt,
      checkedAt: item.checkedAt,
      maxPriceAgeMs: config.maxPriceAgeMs,
    });
  }

  /** ¿Se puede subir? Si no, la tarjeta dice por qué y, si sirve, se pide otra revisión (sin esperarla). */
  function allowed(key: string, item: StoryItem): boolean {
    const gate = gateOf(item);
    if (gate.ok) {
      // Un bloqueo anterior ya no vale; otro aviso (la copia, la marca) sigue a la vista.
      if (shown.get(key)?.tone === 'error' && shown.get(key)?.text !== COPY_ERROR) clear(key);
      return true;
    }
    fail(key, gate.message);
    if (gate.recheck) config.recheck();
    return false;
  }

  async function copyLink(key: string, item: StoryItem) {
    try {
      await env.writeText(item.link);
    } catch {
      fail(key, COPY_ERROR);
      return;
    }
    ui.copied(key, true);
    // Solo se borra el aviso de la copia: otro aviso (precio, Compartir) sigue a la vista.
    if (shown.get(key)?.text === COPY_ERROR) clear(key);
    env.later(() => ui.copied(key, false), COPIED_MS);
  }

  function share(key: string, item: StoryItem) {
    const file = config.fileOf(item.image);
    if (!file || !allowed(key, item)) return;
    // Un doble toque no vuelve a pedir Compartir: el navegador rechaza el segundo y quedaría un error falso.
    if (env.now() - lastShare < SHARE_GAP_MS) return;
    lastShare = env.now();
    // Las dos cosas dentro del mismo toque, sin esperar nada antes: el link se pega después en el sticker.
    void copyLink(key, item);
    let sharing: Promise<void>;
    try {
      sharing = env.share({ files: [file] });
    } catch (err) {
      sharing = Promise.reject(err);
    }
    sharing.catch((err: unknown) => {
      // Cerrar la hoja de compartir no es un error.
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      fail(key, SHARE_ERROR);
    });
  }

  function mark(item: StoryItem) {
    if (inFlight) return;
    inFlight = true;
    ui.busy(item.id);
    clear(item.id);
    ui.run(async () => {
      try {
        // Con el precio de la tarjeta, que es el que lleva la imagen compartida.
        const result = await actions.mark(item.id, item.price);
        if (!result.ok) {
          fail(item.id, result.error);
          return;
        }
        lastMark = env.now();
        ui.published(item, result.postId);
        const live = config.checkOf(item.id)?.last?.result.status;
        const notice =
          markNotice(result, item.price) ?? (live === 'changed' || live === 'unavailable' ? MARKED_BUT_CHANGED : null);
        if (notice) say(item.id, { tone: 'warn', text: notice });
      } catch {
        fail(item.id, `No se pudo guardar. ${RELOAD_HINT}`);
      } finally {
        inFlight = false;
        ui.busy(null);
      }
    });
  }

  /** Deshace una marca. `after` corre solo si se deshizo. */
  function undo(key: string, postId: number, after: () => void) {
    if (inFlight) return;
    inFlight = true;
    ui.busy(key);
    clear(key);
    ui.run(async () => {
      try {
        const result = await actions.undo(postId);
        if (!result.ok) {
          fail(key, result.error);
          return;
        }
        after();
      } catch {
        fail(key, `No se pudo deshacer. ${RELOAD_HINT}`);
      } finally {
        inFlight = false;
        ui.busy(null);
      }
    });
  }

  return {
    share,
    save(key, item) {
      return allowed(key, item);
    },
    copyLink,
    mark,
    undoOffer(item, postId) {
      if (env.now() - lastMark < UNDO_AFTER_MARK_MS) return;
      undo(item.id, postId, () => ui.published(item, null));
    },
    undoPosted(key, postId) {
      undo(key, postId, () => ui.unposted(postId));
    },
  };
}
