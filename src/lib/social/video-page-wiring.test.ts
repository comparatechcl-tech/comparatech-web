import type { SetStateAction, TransitionStartFunction } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * El cableado de /admin/videos (app/admin/videos/wiring), con dobles: un
 * navigator, un document y un URL de mentira que anotan cómo se los llamó, y
 * setters que guardan lo que reciben como lo haría React. Es lo que une las
 * reglas de los botones con el teléfono y con la pantalla; las reglas mismas
 * están en video-page-gestures.test.tsx.
 */

// Las reglas importan el tipo de las acciones; el módulo de verdad escribe en la base.
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));

import { createVideoGestures, type FileState, type GestureActions, type Mark, type Note } from '@/app/admin/videos/gestures';
import {
  browserEnv,
  screenUi,
  without,
  type BrowserGlobals,
  type ManualCopy,
  type PostedByNetwork,
  type ScreenSetters,
  type Visit,
} from '@/app/admin/videos/wiring';
import type { ReadyVideo } from '@/lib/social/videos';

const T0 = new Date('2026-10-13T15:00:00Z').getTime();
const STORAGE = 'https://abcd1234.supabase.co/storage/v1/object/public/reels';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

let seq = 0;
function video(over: Partial<ReadyVideo> = {}): ReadyVideo {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `producto-${seq}`,
    name: `Parlante Bluetooth JBL Go ${seq}`,
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    checkedAt: new Date(T0 - 20 * 60_000).toISOString(),
    template: 'estudio',
    videoUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.mp4`,
    coverUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.jpg`,
    fileName: `comparatech-producto-${seq}-reel.mp4`,
    renderedAt: '2026-10-13T11:05:00.000Z',
    points: 62.5,
    reason: 'Parlante JBL, 50% de descuento',
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    texts: {
      instagram: `Texto de Instagram ${seq}`,
      tiktok: `Texto de TikTok ${seq}`,
      facebook: `Texto de Facebook ${seq}`,
      youtubeTitle: `Título de YouTube ${seq}`,
      youtubeDescription: `Descripción de YouTube ${seq}`,
    },
    posted: {},
    ...over,
  };
}

/** Deja correr las promesas pendientes. setImmediate no lo tocan los relojes de mentira de este archivo. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Lo que pasó con un enlace de descarga, mirado en el momento del clic. */
interface Click {
  href: string;
  download: string;
  inPage: boolean;
}

/** Un navegador de mentira: anota cada llamada, con quién era `this` (el de verdad falla si no es el suyo). */
function fakeBrowser() {
  const log = {
    share: [] as { data: { files: File[] }; self: unknown }[],
    writeText: [] as { text: string; self: unknown }[],
    created: [] as string[],
    clicks: [] as Click[],
    /** Enlaces que quedaron puestos en la página después de la descarga. */
    leftInPage: 0,
    objectUrls: [] as { file: File; self: unknown }[],
    revoked: [] as { url: string; self: unknown }[],
  };
  const shared = { promise: Promise.resolve() as Promise<void> };
  const copied = { promise: Promise.resolve() as Promise<void> };
  let blobs = 0;

  const clipboard = {
    writeText(this: unknown, text: string) {
      log.writeText.push({ text, self: this });
      return copied.promise;
    },
  };
  const navigator = {
    share(this: unknown, data: { files: File[] }) {
      log.share.push({ data, self: this });
      return shared.promise;
    },
    clipboard,
  };
  const body = {
    children: new Set<object>(),
    appendChild(node: HTMLAnchorElement) {
      body.children.add(node);
      return node;
    },
  };
  const document = {
    createElement(tag: 'a') {
      log.created.push(tag);
      const anchor = {
        href: '',
        download: '',
        click() {
          log.clicks.push({ href: anchor.href, download: anchor.download, inPage: body.children.has(anchor) });
        },
        remove() {
          body.children.delete(anchor);
        },
      };
      return anchor as unknown as HTMLAnchorElement;
    },
    body,
  };
  const URL = {
    createObjectURL(this: unknown, file: File) {
      log.objectUrls.push({ file, self: this });
      return `blob:https://comparatech.cl/${++blobs}`;
    },
    revokeObjectURL(this: unknown, url: string) {
      log.revoked.push({ url, self: this });
    },
  };
  const web: BrowserGlobals = { navigator, document, URL };
  return { web, log, navigator, clipboard, URL, body, shared, copied };
}

describe('browserEnv: las reglas llegan al navegador de verdad', () => {
  it('Compartir llama a navigator.share en la misma vuelta, sin esperar nada antes, y entrega su respuesta tal cual', () => {
    const b = fakeBrowser();
    const env = browserEnv(b.web);
    const data = { files: [new File(['x'], 'reel.mp4', { type: 'video/mp4' })] };
    b.shared.promise = new Promise<void>(() => {});

    const out = env.share(data);
    // Ya, antes de cualquier await o microtarea: el teléfono abre la hoja solo dentro del toque.
    expect(b.log.share).toHaveLength(1);
    expect(b.log.share[0].data).toBe(data);
    // Como método del navigator: suelta, el navegador de verdad la rechaza ("Illegal invocation").
    expect(b.log.share[0].self).toBe(b.navigator);
    // La misma promesa: cerrar la hoja (AbortError) o un rechazo llegan a las reglas sin pasar por otra.
    expect(out).toBe(b.shared.promise);
  });

  it('si navigator.share lanza al llamarlo, el error sale ahí mismo, en el toque', () => {
    const b = fakeBrowser();
    b.navigator.share = () => {
      throw new TypeError('Not allowed');
    };
    expect(() => browserEnv(b.web).share({ files: [] })).toThrow('Not allowed');
  });

  it('copiar escribe ese texto en el portapapeles, como método del portapapeles, y entrega su respuesta', () => {
    const b = fakeBrowser();
    const out = browserEnv(b.web).writeText('Texto de Instagram');
    expect(b.log.writeText).toEqual([{ text: 'Texto de Instagram', self: b.clipboard }]);
    expect(out).toBe(b.copied.promise);
  });

  it('la descarga es un enlace con el nombre del archivo, puesto en la página solo para el clic', () => {
    const b = fakeBrowser();
    browserEnv(b.web).download('blob:https://comparatech.cl/7', 'comparatech-parlante-reel.mp4');
    expect(b.log.created).toEqual(['a']);
    // Un solo clic, con la dirección y el nombre ya puestos y el enlace dentro de la página.
    expect(b.log.clicks).toEqual([{ href: 'blob:https://comparatech.cl/7', download: 'comparatech-parlante-reel.mp4', inPage: true }]);
    // Después del clic no queda nada en la página.
    expect(b.body.children.size).toBe(0);
  });

  it('crea y suelta la dirección del archivo con URL, como método de URL', () => {
    const b = fakeBrowser();
    const env = browserEnv(b.web);
    const file = new File(['x'], 'reel.mp4');
    expect(env.createObjectURL(file)).toBe('blob:https://comparatech.cl/1');
    expect(b.log.objectUrls).toEqual([{ file, self: b.URL }]);
    env.revokeObjectURL('blob:https://comparatech.cl/1');
    expect(b.log.revoked).toEqual([{ url: 'blob:https://comparatech.cl/1', self: b.URL }]);
  });

  it('baja el video con fetch, desde su dirección y con su nombre', async () => {
    const fetcher = vi.fn(async (_url: string) => ({ ok: true, status: 200, blob: async () => new Blob(['contenido del video']) }));
    vi.stubGlobal('fetch', fetcher);
    const file = await browserEnv(fakeBrowser().web).fetchFile(`${STORAGE}/a.mp4`, 'comparatech-parlante-reel.mp4');
    expect(fetcher.mock.calls).toEqual([[`${STORAGE}/a.mp4`]]);
    expect(file?.name).toBe('comparatech-parlante-reel.mp4');
    expect(file?.type).toBe('video/mp4');
  });

  it('la hora es la del reloj y "más tarde" es después del plazo, no antes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 });
    const env = browserEnv(fakeBrowser().web);
    expect(env.now()).toBe(T0);
    const run = vi.fn();
    env.later(run, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('no toca el navegador al armarse: en el servidor no hay document', () => {
    const touched: string[] = [];
    const spy = new Proxy({} as BrowserGlobals, {
      get(_target, key) {
        touched.push(String(key));
        return undefined;
      },
    });
    browserEnv(spy);
    expect(touched).toEqual([]);
  });
});

describe('browserEnv con las reglas de verdad: Guardar y Compartir de punta a punta', () => {
  function setup() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: T0 });
    const b = fakeBrowser();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['contenido del video']) }))
    );
    const notes = new Map<string, Note | null>();
    const actions: GestureActions = { mark: vi.fn(), undo: vi.fn() };
    const gestures = createVideoGestures(
      browserEnv(b.web),
      actions,
      {
        note: (videoId, note) => void notes.set(videoId, note),
        fileState: () => {},
        saving: () => {},
        copied: () => {},
        announce: () => {},
        manual: () => {},
        busy: () => {},
        posted: () => {},
        run: (job) => void job(),
      },
      { maxPriceAgeMs: 6 * 3600_000, openedAt: T0 }
    );
    return { b, gestures, notes };
  }

  it('Guardar descarga el archivo con su nombre y suelta la dirección al minuto, no antes', async () => {
    const { b, gestures } = setup();
    const item = video();
    gestures.save(item);
    await settle();

    expect(b.log.clicks).toHaveLength(1);
    const [click] = b.log.clicks;
    expect(click.download).toBe(item.fileName);
    // Desde la memoria del teléfono: el almacén está en otro dominio y ahí el nombre no se respeta.
    expect(click.href).toBe('blob:https://comparatech.cl/1');
    expect(b.log.objectUrls[0].file.name).toBe(item.fileName);

    vi.advanceTimersByTime(59_999);
    expect(b.log.revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(b.log.revoked.map((r) => r.url)).toEqual([click.href]);
  });

  it('con el archivo ya bajado, Compartir llega a navigator.share dentro del mismo toque, con ese archivo', async () => {
    const { b, gestures, notes } = setup();
    const item = video();
    gestures.share(item);
    await settle();
    // El primer toque solo baja: la hoja todavía no se abre.
    expect(b.log.share).toEqual([]);
    expect(notes.get(item.id)?.tone).toBe('info');

    gestures.share(item);
    // Sin await de por medio.
    expect(b.log.share).toHaveLength(1);
    expect(b.log.share[0].self).toBe(b.navigator);
    const [file] = b.log.share[0].data.files;
    expect(b.log.share[0].data.files).toHaveLength(1);
    expect(file.name).toBe(item.fileName);
    expect(file.type).toBe('video/mp4');
  });
});

/** Un setState de mentira: guarda el valor y aplica las funciones como React. */
function slot<T>(initial: T) {
  const box = { value: initial, calls: 0 };
  const set = (action: SetStateAction<T>) => {
    box.calls++;
    box.value = typeof action === 'function' ? (action as (prev: T) => T)(box.value) : action;
  };
  return { box, set };
}

function screen(visit: Visit = { openedAt: T0, changes: new Map() }) {
  const notes = slot<Record<string, Note>>({});
  const fileState = slot<Record<string, FileState>>({});
  const saving = slot<Record<string, boolean>>({});
  const copied = slot<string | null>(null);
  const announced = slot('');
  const manual = slot<Record<string, ManualCopy>>({});
  const busy = slot<string | null>(null);
  const posted = slot<Record<string, PostedByNetwork>>({});
  const transitions: (() => unknown)[] = [];
  const startTransition = ((job: () => unknown) => {
    transitions.push(job);
    job();
  }) as TransitionStartFunction;
  const setters: ScreenSetters = {
    setNotes: notes.set,
    setFileState: fileState.set,
    setSaving: saving.set,
    setCopied: copied.set,
    setAnnounced: announced.set,
    setManual: manual.set,
    setBusy: busy.set,
    setPosted: posted.set,
    startTransition,
  };
  const all = { notes, fileState, saving, copied, announced, manual, busy, posted };
  /** Cuántas veces se llamó a cada setter: cada pedido llega a uno solo. */
  const calls = () => {
    const out: Record<string, number> = {};
    for (const name of Object.keys(all) as (keyof typeof all)[]) out[name] = all[name].box.calls;
    return out;
  };
  return { ui: screenUi(setters, visit), visit, transitions, calls, ...all };
}

const mark = (postId: number): Mark => ({ postId, at: '2026-10-13T15:00:00.000Z' });

describe('screenUi: lo que las reglas piden llega a la pantalla', () => {
  it('el aviso de una tarjeta llega a su estado, y null lo borra sin tocar el de otra', () => {
    const s = screen();
    const error: Note = { tone: 'error', text: 'No se pudo bajar el video.', openVideo: true };
    const info: Note = { tone: 'info', text: 'Video guardado.' };
    s.ui.note('a', error);
    s.ui.note('b', info);
    expect(s.notes.box.value).toEqual({ a: error, b: info });
    s.ui.note('a', null);
    expect(s.notes.box.value).toEqual({ b: info });
    // Borrar uno que no está deja el mismo objeto: así la pantalla no se redibuja de balde.
    const before = s.notes.box.value;
    s.ui.note('zzz', null);
    expect(s.notes.box.value).toBe(before);
    expect(s.calls()).toMatchObject({ notes: 4, fileState: 0, saving: 0, manual: 0, copied: 0, busy: 0, posted: 0, announced: 0 });
  });

  it('"Bajando…" del botón Guardar llega a su estado, por tarjeta', () => {
    const s = screen();
    s.ui.saving('a', true);
    s.ui.saving('b', true);
    s.ui.saving('a', false);
    expect(s.saving.box.value).toEqual({ a: false, b: true });
    expect(s.calls()).toMatchObject({ saving: 3, notes: 0, fileState: 0 });
  });

  it('el estado de la descarga llega al botón Compartir de esa tarjeta', () => {
    const s = screen();
    s.ui.fileState('a', 'cargando');
    s.ui.fileState('b', 'error');
    s.ui.fileState('a', 'lista');
    expect(s.fileState.box.value).toEqual({ a: 'lista', b: 'error' });
    expect(s.calls()).toMatchObject({ fileState: 3, saving: 0, notes: 0 });
  });

  it('el "Copiado" se prende en un botón y solo ese lo apaga: uno viejo no apaga al nuevo', () => {
    const s = screen();
    s.ui.copied('a|instagram', true);
    expect(s.copied.box.value).toBe('a|instagram');
    s.ui.copied('a|tiktok', true);
    // Vence el temporizador del primero: el segundo sigue a la vista.
    s.ui.copied('a|instagram', false);
    expect(s.copied.box.value).toBe('a|tiktok');
    s.ui.copied('a|tiktok', false);
    expect(s.copied.box.value).toBeNull();
    expect(s.calls()).toMatchObject({ copied: 4, busy: 0 });
  });

  it('lo copiado se anuncia para el lector de pantalla', () => {
    const s = screen();
    s.ui.announce('Link copiado (Parlante)');
    expect(s.announced.box.value).toBe('Link copiado (Parlante)');
    expect(s.calls()).toMatchObject({ announced: 1, notes: 0 });
  });

  it('el texto que no se pudo copiar queda en su tarjeta, y null lo quita', () => {
    const s = screen();
    s.ui.manual('a', { label: 'Instagram', text: 'Texto de Instagram' });
    s.ui.manual('b', { label: 'Copiar link', text: 'https://x' });
    s.ui.manual('a', null);
    expect(s.manual.box.value).toEqual({ b: { label: 'Copiar link', text: 'https://x' } });
    const before = s.manual.box.value;
    s.ui.manual('zzz', null);
    expect(s.manual.box.value).toBe(before);
    expect(s.calls()).toMatchObject({ manual: 4, notes: 0 });
  });

  it('la marca que viaja al servidor llega a su estado, y null la suelta', () => {
    const s = screen();
    s.ui.busy('a|youtube');
    expect(s.busy.box.value).toBe('a|youtube');
    s.ui.busy(null);
    expect(s.busy.box.value).toBeNull();
    expect(s.calls()).toMatchObject({ busy: 2, copied: 0 });
  });

  it('lo marcado queda en la pantalla y en la visita, que es lo que sobrevive a volver con "atrás"', () => {
    const s = screen();
    s.ui.posted('a', 'instagram', mark(10));
    s.ui.posted('a', 'tiktok', mark(11));
    s.ui.posted('b', 'facebook', mark(12));
    expect(s.posted.box.value).toEqual({ a: { instagram: mark(10), tiktok: mark(11) }, b: { facebook: mark(12) } });
    expect([...s.visit.changes]).toEqual([
      ['a|instagram', mark(10)],
      ['a|tiktok', mark(11)],
      ['b|facebook', mark(12)],
    ]);
  });

  it('lo desmarcado también queda en la visita, como null: así no vuelve la marca que trajo el servidor', () => {
    const s = screen();
    s.posted.box.value = { a: { instagram: mark(10), youtube: mark(13) } };
    s.ui.posted('a', 'instagram', null);
    expect(s.posted.box.value).toEqual({ a: { youtube: mark(13) } });
    expect(s.visit.changes.has('a|instagram')).toBe(true);
    expect(s.visit.changes.get('a|instagram')).toBeNull();
  });

  it('escribe en la visita que recibe, no en otra', () => {
    const visit: Visit = { openedAt: T0 - 3_600_000, changes: new Map([['x|youtube', mark(1)]]) };
    const s = screen(visit);
    s.ui.posted('a', 'youtube', mark(2));
    expect(visit.changes.get('a|youtube')).toEqual(mark(2));
    expect(visit.changes.get('x|youtube')).toEqual(mark(1));
  });

  it('la llamada al servidor corre dentro de una transición, una vez', async () => {
    const s = screen();
    const job = vi.fn(async () => {});
    s.ui.run(job);
    expect(s.transitions).toEqual([job]);
    expect(job).toHaveBeenCalledTimes(1);
  });

  it('without quita una entrada sin tocar el original', () => {
    const all = { a: 1, b: 2 };
    expect(without(all, 'a')).toEqual({ b: 2 });
    expect(all).toEqual({ a: 1, b: 2 });
    expect(without(all, 'c')).toBe(all);
  });
});

describe('screenUi con las reglas de verdad', () => {
  function setup(env: Partial<Parameters<typeof createVideoGestures>[0]> = {}) {
    const s = screen();
    const gestures = createVideoGestures(
      {
        share: async () => {},
        writeText: async () => {},
        fetchFile: async (_url, fileName) => new File(['contenido'], fileName, { type: 'video/mp4' }),
        createObjectURL: () => 'blob:https://comparatech.cl/1',
        revokeObjectURL: () => {},
        download: () => {},
        now: () => T0,
        later: () => {},
        ...env,
      },
      {
        mark: vi.fn<GestureActions['mark']>(async () => ({ ok: true, postId: 77 })),
        undo: vi.fn<GestureActions['undo']>(async () => ({ ok: true })),
      },
      s.ui,
      { maxPriceAgeMs: 6 * 3600_000, openedAt: T0 }
    );
    return { s, gestures };
  }

  it('Guardar pasa por "Bajando…", vuelve a "Guardar video" y avisa que guardó', async () => {
    const { s, gestures } = setup();
    const item = video();
    gestures.save(item);
    expect(s.saving.box.value).toEqual({ [item.id]: true });
    expect(s.fileState.box.value).toEqual({ [item.id]: 'cargando' });
    await settle();
    expect(s.saving.box.value).toEqual({ [item.id]: false });
    expect(s.fileState.box.value).toEqual({ [item.id]: 'lista' });
    expect(s.notes.box.value[item.id]).toEqual({ tone: 'info', text: 'Video guardado. Búscalo en Descargas.' });
  });

  it('marcar una red la deja marcada en la pantalla y en la visita, y suelta el "Guardando…"', async () => {
    const { s, gestures } = setup();
    const item = video();
    gestures.toggle(item, 'tiktok', undefined);
    expect(s.busy.box.value).toBe(`${item.id}|tiktok`);
    await settle();
    expect(s.busy.box.value).toBeNull();
    expect(s.posted.box.value[item.id]?.tiktok?.postId).toBe(77);
    expect(s.visit.changes.get(`${item.id}|tiktok`)?.postId).toBe(77);
  });

  it('si el teléfono no deja copiar, el aviso y el texto a mano llegan a la tarjeta', async () => {
    const { s, gestures } = setup({
      writeText: async () => {
        throw new Error('denied');
      },
    });
    const item = video();
    await gestures.copy(item, { what: 'instagram', label: 'Instagram', copiedLabel: 'Copiado', text: item.texts.instagram });
    expect(s.manual.box.value[item.id]).toEqual({ label: 'Instagram', text: item.texts.instagram });
    expect(s.notes.box.value[item.id]?.tone).toBe('error');
    expect(s.copied.box.value).toBeNull();
  });
});
