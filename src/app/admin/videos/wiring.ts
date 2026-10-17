import type { Dispatch, SetStateAction, TransitionStartFunction } from 'react';
import type { VideoNetwork } from '@/lib/social/videos';
import { markKey, type FileState, type GestureEnv, type GestureUi, type Mark, type Note } from './gestures';
import type { LiveChecker } from './live';

/**
 * El cableado de /admin/videos: lo que une las reglas de ./gestures con el
 * navegador de verdad y con el estado de la pantalla.
 *
 * Va aparte de VideoList para probarlo con dobles: un navigator, un document
 * y un URL de mentira, y setters que anotan lo que reciben. Acá hay reglas que
 * no se ven a simple vista: que Compartir llegue al teléfono dentro del toque,
 * que la descarga lleve el nombre del archivo, que lo marcado sobreviva a ir a
 * otra pestaña y volver.
 */

/** Dónde figura subido un video, red por red. */
export type PostedByNetwork = Partial<Record<VideoNetwork, Mark>>;

/** El texto que no se pudo copiar, para copiarlo a mano. */
export interface ManualCopy {
  label: string;
  text: string;
}

/** Lo hecho en una carga de la página (ver visitFor, en VideoList). */
export interface Visit {
  /** Cuándo se vio la lista por primera vez en este teléfono. */
  openedAt: number;
  /** Lo marcado (con su marca) o desmarcado (null) desde entonces, por `videoId|red`. */
  changes: Map<string, Mark | null>;
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

/** Lo que el cableado usa del navegador. `globalThis` lo trae todo; los tests, dobles. */
export interface BrowserGlobals {
  navigator: {
    share(data: { files: File[] }): Promise<void>;
    clipboard: { writeText(text: string): Promise<void> };
  };
  document: {
    createElement(tag: 'a'): HTMLAnchorElement;
    body: { appendChild(node: HTMLAnchorElement): unknown };
  };
  URL: {
    createObjectURL(file: File): string;
    revokeObjectURL(url: string): void;
  };
}

/**
 * Lo que las reglas de ./gestures tocan del navegador, de verdad. Nada se lee
 * del navegador hasta que hay un toque: en el servidor no hay document, y la
 * página igual se arma ahí.
 */
export function browserEnv(web: BrowserGlobals): GestureEnv {
  return {
    // Directo, sin esperar nada antes: el teléfono abre la hoja de compartir solo dentro del toque.
    share: (data) => web.navigator.share(data),
    writeText: (text) => web.navigator.clipboard.writeText(text),
    fetchFile: (url, fileName) => fetchVideoFile(url, fileName),
    createObjectURL: (file) => web.URL.createObjectURL(file),
    revokeObjectURL: (url) => web.URL.revokeObjectURL(url),
    download: (url, fileName) => {
      const anchor = web.document.createElement('a');
      anchor.href = url;
      // Sin download el clic abre el video en vez de guardarlo; con él, se guarda con este nombre.
      anchor.download = fileName;
      web.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    now: () => Date.now(),
    later: (run, ms) => {
      setTimeout(run, ms);
    },
  };
}

/** Cada cuánto se mueve el reloj de la lista: el "hace N min" de cada tarjeta y la revisión sola. */
export const LIVE_CLOCK_MS = 30_000;

/** Lo que la revisión en vivo usa del navegador, fuera de los toques. Los tests, dobles. */
export interface LiveGlobals {
  document: {
    visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
  /** Corre `run` cada `ms`; devuelve cómo pararlo. */
  every(run: () => void, ms: number): () => void;
  now(): number;
}

/**
 * Lo que mueve la revisión en vivo sin que nadie toque nada: al montar la
 * lista revisa todo; al volver a la pestaña, si la última revisión tiene más
 * de 5 minutos; y cada medio minuto adelanta el reloj de las tarjetas y, con
 * la pestaña a la vista, revisa antes de que el "mismo precio" venza.
 * Devuelve cómo soltarlo todo al desmontar.
 */
export function watchLive(
  web: LiveGlobals,
  checker: Pick<LiveChecker, 'start' | 'stop' | 'visible' | 'tick'>,
  clock: (now: number) => void
): () => void {
  const shown = () => web.document.visibilityState === 'visible';
  const onChange = () => {
    if (!shown()) return;
    clock(web.now());
    checker.visible();
  };
  checker.start();
  web.document.addEventListener('visibilitychange', onChange);
  const stop = web.every(() => {
    clock(web.now());
    if (shown()) checker.tick();
  }, LIVE_CLOCK_MS);
  return () => {
    web.document.removeEventListener('visibilitychange', onChange);
    stop();
    checker.stop();
  };
}

/** Los setState de VideoList que las reglas mueven. */
export interface ScreenSetters {
  setNotes: Dispatch<SetStateAction<Record<string, Note>>>;
  setFileState: Dispatch<SetStateAction<Record<string, FileState>>>;
  setSaving: Dispatch<SetStateAction<Record<string, boolean>>>;
  setCopied: Dispatch<SetStateAction<string | null>>;
  setAnnounced: Dispatch<SetStateAction<string>>;
  setManual: Dispatch<SetStateAction<Record<string, ManualCopy>>>;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setPosted: Dispatch<SetStateAction<Record<string, PostedByNetwork>>>;
  startTransition: TransitionStartFunction;
}

/** Quita una entrada de un estado por producto, sin crear otro objeto si no estaba (así no se redibuja de balde). Puro. */
export function without<T>(all: Record<string, T>, videoId: string): Record<string, T> {
  if (!(videoId in all)) return all;
  const rest = { ...all };
  delete rest[videoId];
  return rest;
}

/** Lo que las reglas le piden a la pantalla, llevado a los setState de la lista y a la visita. */
export function screenUi(set: ScreenSetters, visit: Visit): GestureUi {
  return {
    note: (videoId, note) => set.setNotes((n) => (note ? { ...n, [videoId]: note } : without(n, videoId))),
    fileState: (videoId, state) => set.setFileState((s) => ({ ...s, [videoId]: state })),
    saving: (videoId, on) => set.setSaving((s) => ({ ...s, [videoId]: on })),
    copied: (key, on) => set.setCopied((c) => (on ? key : c === key ? null : c)),
    announce: (text) => set.setAnnounced(text),
    manual: (videoId, pending) => set.setManual((m) => (pending ? { ...m, [videoId]: pending } : without(m, videoId))),
    busy: (key) => set.setBusy(key),
    posted: (videoId, network, mark) => {
      // También en la visita: es lo que sobrevive a ir a otra pestaña y volver con "atrás".
      visit.changes.set(markKey(videoId, network), mark);
      set.setPosted((p) => {
        const next: PostedByNetwork = { ...(p[videoId] ?? {}) };
        if (mark) next[network] = mark;
        else delete next[network];
        return { ...p, [videoId]: next };
      });
    },
    run: (job) => set.startTransition(job),
  };
}
