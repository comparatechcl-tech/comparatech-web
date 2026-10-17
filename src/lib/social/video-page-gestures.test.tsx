import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Lo que pasa al tocar un botón de /admin/videos, sin navegador: las reglas
 * de app/admin/videos/gestures reciben de afuera la hoja de compartir, el
 * portapapeles, las descargas, el reloj y las acciones del servidor, y acá se
 * les entregan dobles. Al final, la tarjeta de verdad: se arma, se "toca"
 * cada botón (se llama a su onClick) y se mira qué pidió.
 */

// La tarjeta importa las acciones de verdad, que escriben en la base: acá no se usan.
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));
// La revisión en vivo pregunta a Mercado Libre: acá se le entregan las respuestas a mano.
vi.mock('@/app/admin/live-price-actions', () => ({ checkLivePrices: vi.fn() }));

import { VideoCard, saveLabel, visitFor, type Mark, type VideoCardProps } from '@/app/admin/videos/VideoList';
import {
  canShareVideos,
  createVideoGestures,
  linkTarget,
  markWarning,
  textTargets,
  type FileState,
  type GestureActions,
  type Note,
} from '@/app/admin/videos/gestures';
import { CHECKING_NOTE, OLD_LIST, OLD_PRICE, type LiveEntry } from '@/app/admin/videos/live';
import type { LiveCheck } from '@/lib/social/live-price';
import type { ReadyVideo } from '@/lib/social/videos';

const T0 = new Date('2026-10-13T15:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STORAGE = 'https://abcd1234.supabase.co/storage/v1/object/public/reels';

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
    checkedAt: new Date(T0 - 20 * MINUTE).toISOString(),
    template: 'estudio',
    videoUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.mp4`,
    coverUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.jpg`,
    fileName: `comparatech-producto-${seq}-reel.mp4`,
    renderedAt: '2026-10-13T11:05:00.000Z',
    points: 62.5,
    reason: 'Parlante JBL, 50% de descuento, de tienda oficial',
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    texts: {
      instagram: `Texto de Instagram ${seq}`,
      tiktok: `Texto de TikTok ${seq}`,
      facebook: `Texto de Facebook ${seq}`,
      youtubeTitle: `Título de YouTube ${seq}`,
      youtubeDescription: `Descripción de YouTube ${seq}`,
    },
    posted: {},
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

/** Lo que dijo la revisión en vivo, llegado a la hora `at` del reloj del teléfono. */
const done = (check: LiveCheck, at = T0): LiveEntry => ({ result: { check, at }, checking: false });
const SAME = (at = T0) => done({ status: 'same', checkedAt: new Date(at).toISOString() }, at);
const CHANGED = (at = T0, saved = false) =>
  done(
    {
      status: 'changed',
      checkedAt: new Date(at).toISOString(),
      price: 45_990,
      listPrice: 99_990,
      freeShipping: true,
      full: false,
      saved,
      what: 'El precio cambió de $49.990 a $45.990.',
    },
    at
  );
const UNAVAILABLE = (at = T0) =>
  done({ status: 'unavailable', checkedAt: new Date(at).toISOString(), what: 'Ya no está a la venta con un vendedor de reputación verde.' }, at);
const UNKNOWN = (at = T0, what = 'No pude revisar Mercado Libre ahora.') => done({ status: 'unknown', what }, at);
const CHECKING: LiveEntry = { result: null, checking: true };

/** Una promesa que se resuelve cuando el test lo decide: una descarga o una llamada que todavía viaja. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Deja correr todo lo que quedó pendiente (promesas ya resueltas y sus continuaciones). */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const named = (name: string) => Object.assign(new Error(name), { name });

/**
 * Las reglas con todo de mentira, y la "pantalla" anotada en un objeto para
 * mirarla. La revisión en vivo dice "mismo precio", recién llegada, salvo
 * que el test diga otra cosa (`live.set` para un video, `live.fallback` para todos).
 */
function setup(config: { maxPriceAgeMs?: number; fallback?: LiveEntry | undefined } = {}) {
  const clock = { now: T0 };
  const answers = new Map<string, LiveEntry | undefined>();
  const live = {
    fallback: 'fallback' in config ? config.fallback : SAME(),
    set: (videoId: string, entry: LiveEntry | undefined) => void answers.set(videoId, entry),
    entry: vi.fn((videoId: string) => (answers.has(videoId) ? answers.get(videoId) : live.fallback)),
    recheck: vi.fn<(videoIds: string[]) => void>(),
  };
  const timers: { run: () => void; at: number }[] = [];
  let blobs = 0;

  const env = {
    share: vi.fn<(data: { files: File[] }) => Promise<void>>(async () => {}),
    writeText: vi.fn<(text: string) => Promise<void>>(async () => {}),
    fetchFile: vi.fn<(url: string, fileName: string) => Promise<File | null>>(
      async (_url, fileName) => new File(['contenido del video'], fileName, { type: 'video/mp4' })
    ),
    createObjectURL: vi.fn<(file: File) => string>(() => `blob:https://comparatech.cl/${++blobs}`),
    revokeObjectURL: vi.fn<(url: string) => void>(),
    download: vi.fn<(url: string, fileName: string) => void>(),
    now: () => clock.now,
    later: (run: () => void, ms: number) => {
      timers.push({ run, at: clock.now + ms });
    },
  };
  const actions = {
    mark: vi.fn<GestureActions['mark']>(async () => ({ ok: true, postId: 500 })),
    undo: vi.fn<GestureActions['undo']>(async () => ({ ok: true })),
  };

  const screen = {
    notes: new Map<string, Note>(),
    fileState: new Map<string, FileState>(),
    saving: new Map<string, boolean>(),
    copied: new Set<string>(),
    announced: [] as string[],
    manual: new Map<string, { label: string; text: string }>(),
    busy: null as string | null,
    busyLog: [] as (string | null)[],
    posted: new Map<string, Mark | null>(),
    /** Las llamadas al servidor que se echaron a correr. */
    jobs: [] as Promise<void>[],
  };
  const gestures = createVideoGestures(
    env,
    actions,
    {
      note: (videoId, note) => {
        if (note) screen.notes.set(videoId, note);
        else screen.notes.delete(videoId);
      },
      fileState: (videoId, state) => void screen.fileState.set(videoId, state),
      saving: (videoId, on) => void screen.saving.set(videoId, on),
      copied: (key, on) => void (on ? screen.copied.add(key) : screen.copied.delete(key)),
      announce: (text) => void screen.announced.push(text),
      manual: (videoId, pending) => {
        if (pending) screen.manual.set(videoId, pending);
        else screen.manual.delete(videoId);
      },
      busy: (key) => {
        screen.busy = key;
        screen.busyLog.push(key);
      },
      posted: (videoId, network, mark) => void screen.posted.set(`${videoId}|${network}`, mark),
      run: (job) => void screen.jobs.push(job()),
    },
    { maxPriceAgeMs: config.maxPriceAgeMs ?? 6 * HOUR, openedAt: T0, live }
  );

  /** Adelanta el reloj y dispara los temporizadores que vencieron. */
  function advance(ms: number) {
    clock.now += ms;
    for (const timer of timers.splice(0)) {
      if (timer.at <= clock.now) timer.run();
      else timers.push(timer);
    }
  }

  return { env, actions, screen, gestures, advance, timers, live, clock };
}

const DOWNLOAD_ERROR =
  'No se pudo bajar el video. Revisa tu conexión y prueba otra vez. Si sigue igual, toca Abrir el video, acá abajo, y descárgalo desde el menú del reproductor (los tres puntos).';
const COPY_ERROR = 'El teléfono no dejó copiar. Mantén el dedo sobre el texto de abajo y elige Copiar.';

describe('Compartir', () => {
  it('el primer toque solo baja el video: no abre Compartir ni cuando la descarga termina', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    const gate = deferred<File | null>();
    env.fetchFile.mockReturnValueOnce(gate.promise);

    gestures.share(item);
    expect(env.fetchFile.mock.calls).toEqual([[item.videoUrl, item.fileName]]);
    expect(screen.fileState.get(item.id)).toBe('cargando');
    expect(env.share).not.toHaveBeenCalled();

    gate.resolve(new File(['contenido'], item.fileName, { type: 'video/mp4' }));
    await settle();
    expect(screen.fileState.get(item.id)).toBe('lista');
    // El permiso del toque ya venció: abrir la hoja ahora fallaría en el teléfono.
    expect(env.share).not.toHaveBeenCalled();
    // Compartir manda solo el archivo: el aviso recuerda llevar el texto copiado.
    expect(screen.notes.get(item.id)).toEqual({
      tone: 'info',
      text: 'Video listo. Copia primero el texto de la red y toca el botón otra vez para elegir la app.',
    });
  });

  it('con el archivo listo, el toque llama a Compartir ahí mismo, con ese archivo y nada más', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    gestures.share(item);
    await settle();
    const file = await env.fetchFile.mock.results[0].value;

    gestures.share(item);
    // Sin esperar nada entre el toque y esta línea: la llamada ocurrió dentro del toque.
    expect(env.share).toHaveBeenCalledTimes(1);
    expect(env.share.mock.calls[0]).toEqual([{ files: [file] }]);
    expect(Object.keys(env.share.mock.calls[0][0])).toEqual(['files']);
    expect(env.share.mock.calls[0][0].files[0]).toBe(file);
    // No lo baja de nuevo, y el aviso de "video listo" se va.
    expect(env.fetchFile).toHaveBeenCalledTimes(1);
    expect(screen.notes.has(item.id)).toBe(false);
  });

  it('un doble toque abre Compartir una sola vez; pasado un segundo y medio se puede de nuevo', async () => {
    const { env, gestures, advance } = setup();
    const item = video();
    gestures.share(item);
    await settle();

    gestures.share(item);
    gestures.share(item);
    advance(1499);
    gestures.share(item);
    expect(env.share).toHaveBeenCalledTimes(1);

    advance(1);
    gestures.share(item);
    expect(env.share).toHaveBeenCalledTimes(2);
  });

  it('cerrar la hoja de compartir no es un error; que el teléfono la rechace, sí', async () => {
    const { env, screen, gestures, advance } = setup();
    const item = video();
    gestures.share(item);
    await settle();

    env.share.mockRejectedValueOnce(named('AbortError'));
    gestures.share(item);
    await settle();
    expect(screen.notes.has(item.id)).toBe(false);

    advance(2000);
    env.share.mockRejectedValueOnce(named('NotAllowedError'));
    gestures.share(item);
    await settle();
    expect(screen.notes.get(item.id)).toEqual({
      tone: 'error',
      text: 'No se pudo abrir Compartir. Toca Guardar video y súbelo desde la app de la red.',
    });

    // Un navegador que ni siquiera tiene la función también termina en el aviso, no en un error suelto.
    advance(2000);
    screen.notes.clear();
    env.share.mockImplementationOnce(() => {
      throw new TypeError('navigator.share is not a function');
    });
    expect(() => gestures.share(item)).not.toThrow();
    await settle();
    expect(screen.notes.get(item.id)?.text).toContain('No se pudo abrir Compartir');
  });

  it('si la descarga falla lo dice, ofrece abrir el video directo y deja reintentar', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    env.fetchFile.mockResolvedValueOnce(null);

    gestures.share(item);
    await settle();
    expect(screen.fileState.get(item.id)).toBe('error');
    // No culpa solo a la conexión: deja a mano la salida que funciona aunque el almacén no deje bajar.
    expect(screen.notes.get(item.id)).toEqual({ tone: 'error', text: DOWNLOAD_ERROR, openVideo: true });
    expect(env.share).not.toHaveBeenCalled();

    // El toque siguiente lo pide de nuevo, y esta vez llega.
    gestures.share(item);
    expect(screen.notes.has(item.id)).toBe(false);
    await settle();
    expect(env.fetchFile).toHaveBeenCalledTimes(2);
    expect(screen.fileState.get(item.id)).toBe('lista');
    expect(screen.notes.get(item.id)?.tone).toBe('info');
  });

  it('una descarga que revienta en vez de devolver null también queda como falla', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    env.fetchFile.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    gestures.share(item);
    await settle();
    expect(screen.fileState.get(item.id)).toBe('error');
    expect(screen.notes.get(item.id)?.openVideo).toBe(true);
  });

  it('sin revisión en vivo, una lista con más de una hora no se comparte ni se guarda: manda a actualizar', async () => {
    // "No pude revisar": vale la regla de siempre (con "mismo precio" reciente, la edad de la lista no importa).
    const { env, screen, gestures, advance } = setup({ fallback: UNKNOWN() });
    const item = video({ checkedAt: null });

    advance(60 * MINUTE);
    gestures.share(item);
    await settle();
    // Justo a la hora todavía sirve.
    expect(env.fetchFile).toHaveBeenCalledTimes(1);

    const other = video({ checkedAt: null });
    advance(1);
    gestures.share(other);
    gestures.save(other);
    // Tampoco el que ya estaba bajado.
    gestures.share(item);
    await settle();
    expect(env.fetchFile).toHaveBeenCalledTimes(1);
    expect(env.share).not.toHaveBeenCalled();
    expect(env.download).not.toHaveBeenCalled();
    expect(screen.notes.get(other.id)).toEqual({ tone: 'error', text: OLD_LIST });
    expect(screen.notes.get(item.id)).toEqual({ tone: 'error', text: OLD_LIST });
  });

  it('sin revisión en vivo y con el precio revisado hace más del plazo tampoco, aunque la lista sea reciente: lo dice así', async () => {
    const { env, screen, gestures, live } = setup({ maxPriceAgeMs: 6 * HOUR, fallback: UNKNOWN() });
    const fresh = video({ checkedAt: new Date(T0 - 6 * HOUR).toISOString() });
    const old = video({ checkedAt: new Date(T0 - 6 * HOUR - 1).toISOString() });

    gestures.share(fresh);
    gestures.share(old);
    gestures.save(old);
    await settle();
    expect(env.fetchFile.mock.calls.map((call) => call[0])).toEqual([fresh.videoUrl]);
    // Su propio mensaje: el precio es el viejo, no la lista.
    expect(screen.notes.get(old.id)).toEqual({ tone: 'error', text: OLD_PRICE });
    expect(OLD_PRICE).not.toContain('lista');
    expect(env.download).not.toHaveBeenCalled();
    // Y pide otra revisión, sin esperarla.
    expect(live.recheck).toHaveBeenCalledWith([old.id]);
  });

  it('con "mismo precio" reciente, la lista vieja y el precio viejo del sitio no importan: Mercado Libre lo confirmó', async () => {
    const { env, gestures, advance, live } = setup();
    const item = video({ checkedAt: new Date(T0 - 9 * HOUR).toISOString() });
    advance(2 * HOUR);
    live.fallback = SAME(T0 + 2 * HOUR - MINUTE);
    gestures.share(item);
    await settle();
    gestures.share(item);
    expect(env.share).toHaveBeenCalledTimes(1);
  });
});

describe('Guardar video', () => {
  it('dice que está bajando, guarda desde el archivo en memoria y dice que guardó', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    const gate = deferred<File | null>();
    env.fetchFile.mockReturnValueOnce(gate.promise);

    gestures.save(item);
    expect(env.fetchFile.mock.calls).toEqual([[item.videoUrl, item.fileName]]);
    expect(screen.saving.get(item.id)).toBe(true);
    expect(screen.fileState.get(item.id)).toBe('cargando');
    expect(env.download).not.toHaveBeenCalled();

    const file = new File(['contenido'], item.fileName, { type: 'video/mp4' });
    gate.resolve(file);
    await settle();
    expect(screen.saving.get(item.id)).toBe(false);
    expect(env.createObjectURL.mock.calls).toEqual([[file]]);
    // La descarga sale de la dirección del archivo en memoria, con su nombre: un
    // enlace directo al almacén, que es otro dominio, no descargaría nada.
    const url = env.createObjectURL.mock.results[0].value as string;
    expect(env.download.mock.calls).toEqual([[url, item.fileName]]);
    expect(url).toMatch(/^blob:/);
    expect(url).not.toBe(item.videoUrl);
    expect(screen.notes.get(item.id)).toEqual({ tone: 'info', text: 'Video guardado. Búscalo en Descargas.' });
  });

  it('suelta la dirección del archivo al minuto, no antes', async () => {
    const { env, gestures, advance } = setup();
    const item = video();
    gestures.save(item);
    await settle();
    const url = env.createObjectURL.mock.results[0].value as string;

    // Con margen: el navegador sigue leyendo el archivo después del clic.
    advance(59_999);
    expect(env.revokeObjectURL).not.toHaveBeenCalled();
    advance(1);
    expect(env.revokeObjectURL.mock.calls).toEqual([[url]]);
  });

  it('un doble toque guarda una vez; el toque siguiente guarda de nuevo sin volver a bajar el video', async () => {
    const { env, screen, gestures, advance } = setup();
    const item = video();
    gestures.save(item);
    gestures.save(item);
    await settle();
    advance(1499);
    gestures.save(item);
    await settle();
    expect(env.download).toHaveBeenCalledTimes(1);

    advance(1);
    screen.saving.clear();
    gestures.save(item);
    await settle();
    expect(env.download).toHaveBeenCalledTimes(2);
    expect(env.fetchFile).toHaveBeenCalledTimes(1);
    // Con el archivo ya en memoria no hay espera que avisar: el botón no cambia.
    expect(screen.saving.has(item.id)).toBe(false);
    // Cada descarga tiene su dirección, y cada una se suelta.
    advance(60_000);
    expect(env.revokeObjectURL.mock.calls.map((call) => call[0])).toEqual(env.createObjectURL.mock.results.map((r) => r.value));
    expect(env.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('el video se baja una sola vez aunque se pida desde Guardar y desde Compartir', async () => {
    const { env, gestures } = setup();
    const item = video();
    const gate = deferred<File | null>();
    env.fetchFile.mockReturnValueOnce(gate.promise);

    gestures.save(item);
    gestures.share(item);
    const file = new File(['contenido'], item.fileName, { type: 'video/mp4' });
    gate.resolve(file);
    await settle();
    expect(env.fetchFile).toHaveBeenCalledTimes(1);
    expect(env.download).toHaveBeenCalledTimes(1);

    // Ya está en memoria: el toque en Compartir lo comparte de inmediato.
    gestures.share(item);
    expect(env.share.mock.calls).toEqual([[{ files: [file] }]]);
  });

  it('si no se pudo bajar no guarda nada, deja de decir que baja y ofrece el video directo', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    env.fetchFile.mockResolvedValueOnce(null);
    gestures.save(item);
    await settle();
    expect(screen.saving.get(item.id)).toBe(false);
    expect(env.createObjectURL).not.toHaveBeenCalled();
    expect(env.download).not.toHaveBeenCalled();
    expect(screen.notes.get(item.id)).toEqual({ tone: 'error', text: DOWNLOAD_ERROR, openVideo: true });
  });

  it('el botón dice en qué va', () => {
    expect(saveLabel(false)).toBe('Guardar video');
    expect(saveLabel(true)).toBe('Bajando…');
  });
});

describe('Copiar', () => {
  it('cada botón de texto lleva el texto de su red, en el orden de la tarjeta', () => {
    const item = video();
    expect(textTargets(item).map((t) => [t.what, t.label, t.text, t.copiedLabel])).toEqual([
      ['instagram', 'Instagram', item.texts.instagram, 'Copiado'],
      ['tiktok', 'TikTok', item.texts.tiktok, 'Copiado'],
      ['facebook', 'Facebook', item.texts.facebook, 'Copiado'],
      ['youtubeTitle', 'YouTube: título', item.texts.youtubeTitle, 'Copiado'],
      ['youtubeDescription', 'YouTube: descripción', item.texts.youtubeDescription, 'Copiado'],
    ]);
  });

  it('Copiar link lleva el link de afiliado del producto, no la dirección del video', () => {
    const item = video();
    expect(linkTarget(item)).toEqual({ what: 'link', label: 'Copiar link', copiedLabel: 'Link copiado', text: item.link });
    expect(linkTarget(item).text).not.toBe(item.videoUrl);
  });

  it('deja el texto en el portapapeles, lo confirma en su botón un par de segundos y lo anuncia', async () => {
    const { env, screen, gestures, advance } = setup();
    const item = video();
    const facebook = textTargets(item)[2];

    await gestures.copy(item, facebook);
    expect(env.writeText.mock.calls).toEqual([[item.texts.facebook]]);
    expect([...screen.copied]).toEqual([`${item.id}|facebook`]);
    expect(screen.announced).toEqual([`Texto copiado para Facebook (${item.name})`]);

    await gestures.copy(item, linkTarget(item));
    expect(env.writeText.mock.calls[1]).toEqual([item.link]);
    expect(screen.announced[1]).toBe(`Link copiado (${item.name})`);

    advance(2499);
    expect(screen.copied.size).toBe(2);
    advance(1);
    expect(screen.copied.size).toBe(0);
  });

  it('si el teléfono no deja copiar, lo dice y deja el texto completo en la tarjeta', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    const tiktok = textTargets(item)[1];
    env.writeText.mockRejectedValueOnce(named('NotAllowedError'));

    await gestures.copy(item, tiktok);
    expect(screen.notes.get(item.id)).toEqual({ tone: 'error', text: COPY_ERROR });
    expect(screen.manual.get(item.id)).toEqual({ label: 'TikTok', text: item.texts.tiktok });
    expect(screen.copied.size).toBe(0);
    expect(screen.announced).toEqual([]);

    // Cuando después sí copia, el aviso y el texto a mano se van.
    await gestures.copy(item, tiktok);
    expect(screen.notes.has(item.id)).toBe(false);
    expect(screen.manual.has(item.id)).toBe(false);
  });

  it('un navegador sin portapapeles termina en el mismo aviso', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    env.writeText.mockImplementationOnce(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'writeText')");
    });
    await gestures.copy(item, linkTarget(item));
    expect(screen.notes.get(item.id)?.text).toBe(COPY_ERROR);
    expect(screen.manual.get(item.id)).toEqual({ label: 'Copiar link', text: item.link });
  });

  it('copiar el link no borra otro aviso de la tarjeta; un texto, que lleva el precio, sigue la regla de Compartir', async () => {
    const { env, screen, gestures, advance } = setup({ fallback: UNKNOWN() });
    const item = video();
    advance(61 * MINUTE);
    gestures.share(item);
    expect(screen.notes.get(item.id)?.text).toBe(OLD_LIST);

    // El link no lleva precio: se copia con la lista vieja, y el aviso de actualizar queda a la vista.
    await gestures.copy(item, linkTarget(item));
    expect(screen.copied.size).toBe(1);
    expect(screen.notes.get(item.id)?.text).toBe(OLD_LIST);

    // El texto lleva el precio escrito: no se copia.
    await gestures.copy(item, textTargets(item)[0]);
    expect(env.writeText.mock.calls).toEqual([[item.link]]);
    expect(screen.notes.get(item.id)?.text).toBe(OLD_LIST);
  });
});

describe('Marcar dónde se subió', () => {
  it('marca con el precio del video, no con el de lista, y deja anotada la marca', async () => {
    const { actions, screen, gestures } = setup();
    const item = video({ price: 49_990, listPrice: 99_990 });

    gestures.toggle(item, 'tiktok', undefined);
    expect(screen.busy).toBe(`${item.id}|tiktok`);
    await Promise.all(screen.jobs);

    expect(actions.mark.mock.calls).toEqual([[item.id, 'tiktok', 49_990]]);
    expect(actions.undo).not.toHaveBeenCalled();
    expect(screen.posted.get(`${item.id}|tiktok`)).toEqual({ postId: 500, at: new Date(T0).toISOString() });
    expect(screen.busy).toBeNull();
    expect(screen.notes.has(item.id)).toBe(false);
  });

  it('un doble toque marca una vez, y mientras la marca viaja no se anota otra', async () => {
    const { actions, screen, gestures } = setup();
    const item = video();
    const other = video();
    const gate = deferred<{ ok: true; postId: number }>();
    actions.mark.mockReturnValueOnce(gate.promise);

    gestures.toggle(item, 'instagram', undefined);
    gestures.toggle(item, 'instagram', undefined);
    // Ni en otra red ni en otra tarjeta: de a una.
    gestures.toggle(item, 'youtube', undefined);
    gestures.toggle(other, 'instagram', undefined);
    expect(actions.mark).toHaveBeenCalledTimes(1);
    expect(screen.jobs).toHaveLength(1);

    gate.resolve({ ok: true, postId: 77 });
    await Promise.all(screen.jobs);
    expect(screen.posted.get(`${item.id}|instagram`)?.postId).toBe(77);
    expect(screen.busyLog).toEqual([`${item.id}|instagram`, null]);
  });

  it('recién marcada, un toque seguido no la desmarca; pasado un segundo deshace esa marca y no otra', async () => {
    const { actions, screen, gestures, advance } = setup();
    const item = video();
    gestures.toggle(item, 'facebook', undefined);
    await Promise.all(screen.jobs);
    const made = screen.posted.get(`${item.id}|facebook`) as Mark;

    advance(999);
    gestures.toggle(item, 'facebook', made);
    expect(actions.undo).not.toHaveBeenCalled();
    // El candado es de esa red: otra se puede marcar altiro.
    gestures.toggle(item, 'youtube', undefined);
    await Promise.all(screen.jobs);
    expect(actions.mark).toHaveBeenCalledTimes(2);

    advance(1);
    gestures.toggle(item, 'facebook', made);
    await Promise.all(screen.jobs);
    expect(actions.undo.mock.calls).toEqual([[500]]);
    expect(actions.mark).toHaveBeenCalledTimes(2);
    expect(screen.posted.get(`${item.id}|facebook`)).toBeNull();
  });

  it('deshace con el id de la marca que muestra la tarjeta', async () => {
    const { actions, screen, gestures } = setup();
    const item = video();
    gestures.toggle(item, 'instagram', { postId: 4321, at: '2026-10-13T12:00:00.000Z' });
    await Promise.all(screen.jobs);
    expect(actions.undo.mock.calls).toEqual([[4321]]);
    expect(actions.mark).not.toHaveBeenCalled();
    expect(screen.posted.get(`${item.id}|instagram`)).toBeNull();
  });

  it('si el servidor rechaza la marca lo dice y no la anota; se puede reintentar de inmediato', async () => {
    const { actions, screen, gestures } = setup();
    const item = video();
    actions.mark.mockResolvedValueOnce({ ok: false, error: 'Ese producto ya no está a la venta en el sitio.' });

    gestures.toggle(item, 'instagram', undefined);
    await Promise.all(screen.jobs);
    expect(screen.notes.get(item.id)).toEqual({ tone: 'error', text: 'Ese producto ya no está a la venta en el sitio.' });
    expect(screen.posted.has(`${item.id}|instagram`)).toBe(false);
    expect(screen.busy).toBeNull();

    gestures.toggle(item, 'instagram', undefined);
    await Promise.all(screen.jobs);
    expect(actions.mark).toHaveBeenCalledTimes(2);
    expect(screen.posted.get(`${item.id}|instagram`)?.postId).toBe(500);
    // El aviso del intento fallido se fue al tocar de nuevo.
    expect(screen.notes.has(item.id)).toBe(false);
  });

  it('sin conexión lo dice y suelta el candado', async () => {
    const { actions, screen, gestures } = setup();
    const item = video();
    actions.mark.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    gestures.toggle(item, 'youtube', undefined);
    await Promise.all(screen.jobs);
    expect(screen.notes.get(item.id)).toEqual({
      tone: 'error',
      text: 'No se pudo guardar. Revisa tu conexión; si sigue igual, toca Actualizar, arriba.',
    });
    expect(screen.posted.size).toBe(0);
    expect(screen.busy).toBeNull();

    gestures.toggle(item, 'youtube', undefined);
    await Promise.all(screen.jobs);
    expect(actions.mark).toHaveBeenCalledTimes(2);
  });

  it('una marca que ya estaba deshecha queda desmarcada sin aviso; una falla al deshacer la deja marcada', async () => {
    const { actions, screen, gestures } = setup();
    const item = video();
    const current = { postId: 9, at: '2026-10-13T12:00:00.000Z' };

    actions.undo.mockResolvedValueOnce({ ok: false, error: 'Esa marca ya no existe.', gone: true });
    gestures.toggle(item, 'instagram', current);
    await Promise.all(screen.jobs);
    expect(screen.posted.get(`${item.id}|instagram`)).toBeNull();
    expect(screen.notes.has(item.id)).toBe(false);

    actions.undo.mockResolvedValueOnce({ ok: false, error: 'se cayó' });
    gestures.toggle(item, 'tiktok', current);
    await Promise.all(screen.jobs);
    expect(screen.posted.has(`${item.id}|tiktok`)).toBe(false);
    expect(screen.notes.get(item.id)).toEqual({ tone: 'error', text: 'se cayó' });
  });
});

describe('al salir de la página', () => {
  it('se sueltan los archivos bajados: son varios megas de memoria del teléfono', async () => {
    const { env, gestures } = setup();
    const item = video();
    gestures.share(item);
    await settle();
    expect(env.fetchFile).toHaveBeenCalledTimes(1);

    gestures.detach();
    gestures.attach();
    // Ya no está en memoria: el toque lo baja de nuevo en vez de compartir.
    gestures.share(item);
    await settle();
    expect(env.fetchFile).toHaveBeenCalledTimes(2);
    expect(env.share).not.toHaveBeenCalled();
  });

  it('una descarga que termina después de salir no avisa ni guarda nada', async () => {
    const { env, screen, gestures } = setup();
    const item = video();
    const gate = deferred<File | null>();
    env.fetchFile.mockReturnValueOnce(gate.promise);

    gestures.save(item);
    gestures.detach();
    gate.resolve(new File(['contenido'], item.fileName, { type: 'video/mp4' }));
    await settle();
    expect(screen.fileState.get(item.id)).toBe('cargando');
    expect(screen.notes.size).toBe(0);
    expect(env.createObjectURL).not.toHaveBeenCalled();
    expect(env.download).not.toHaveBeenCalled();
  });
});

describe('¿este aparato puede compartir el archivo?', () => {
  const probe = new File([''], 'reel.mp4', { type: 'video/mp4' });

  it('solo un teléfono que acepta archivos', () => {
    const yes = vi.fn(() => true);
    expect(canShareVideos({ canShare: yes }, true, probe)).toBe(true);
    expect(yes.mock.calls).toEqual([[{ files: [probe] }]]);
    // El computador también "comparte" archivos, pero su panel no llega a las redes.
    expect(canShareVideos({ canShare: yes }, false, probe)).toBe(false);
    expect(canShareVideos({ canShare: () => false }, true, probe)).toBe(false);
    expect(canShareVideos({}, true, probe)).toBe(false);
  });
});

describe('la visita: lo marcado sobrevive a volver con "atrás"', () => {
  it('la misma carga recupera lo anotado; una carga nueva parte de cero', () => {
    const first = visitFor(900_001, T0, true);
    first.changes.set('producto|instagram', { postId: 1, at: '2026-10-13T12:00:00.000Z' });

    // Volver con "atrás" monta la lista de nuevo con la misma hora de carga.
    const again = visitFor(900_001, T0 + 5 * MINUTE, true);
    expect(again).toBe(first);
    expect(again.openedAt).toBe(T0);
    expect(again.changes.size).toBe(1);

    const fresh = visitFor(900_002, T0 + 5 * MINUTE, true);
    expect(fresh).not.toBe(first);
    expect(fresh.openedAt).toBe(T0 + 5 * MINUTE);
    expect(fresh.changes.size).toBe(0);
  });

  it('en el servidor no se guarda nada: ahí el módulo lo comparten todas las visitas', () => {
    const a = visitFor(900_100, T0, false);
    a.changes.set('producto|tiktok', null);
    const b = visitFor(900_100, T0 + 1, false);
    expect(b).not.toBe(a);
    expect(b.changes.size).toBe(0);
    // Y sin navegador ese es el comportamiento por omisión.
    expect(visitFor(900_101)).not.toBe(visitFor(900_101));
  });

  it('guarda solo las últimas cargas', () => {
    const oldest = visitFor(900_200, T0, true);
    for (let i = 1; i <= 6; i++) visitFor(900_200 + i, T0, true);
    expect(visitFor(900_200, T0, true)).not.toBe(oldest);
  });
});

// ---------------------------------------------------------------------------
// La tarjeta de verdad, tocada.

interface El {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}
const isEl = (node: unknown): node is El => typeof node === 'object' && node !== null && 'type' in node && 'props' in node;

/** Todos los elementos de un árbol de React ya armado, en el orden en que se dibujan. */
function all(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const child of node) all(child, out);
  else if (isEl(node)) {
    out.push(node);
    all(node.props.children, out);
  }
  return out;
}

/** Lo que se lee en un elemento, sin lo escondido (íconos y el texto apilado que no se ve). */
function read(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(read).join('');
  if (!isEl(node) || node.props['aria-hidden'] === true) return '';
  return read(node.props.children);
}

const buttonsIn = (node: unknown) => all(node).filter((el) => el.type === 'button');
const tap = (el: El) => (el.props.onClick as () => void)();

function drawCard(over: Partial<VideoCardProps> & Pick<VideoCardProps, 'video' | 'gestures'>): El {
  const props: VideoCardProps = {
    posted: {},
    fileState: undefined,
    saving: false,
    canShare: true,
    copied: null,
    busy: null,
    note: undefined,
    manual: undefined,
    // Sin revisión todavía, salvo que el test diga otra cosa.
    live: undefined,
    now: T0,
    ...over,
  };
  // La tarjeta no usa hooks: se puede llamar como función y recorrer lo que devuelve.
  return VideoCard(props) as unknown as El;
}

function group(card: El, id: string): El {
  const found = all(card).find((el) => el.props['aria-labelledby'] === id);
  if (!found) throw new Error(`no está el grupo ${id}`);
  return found;
}

function byLabel(buttons: El[], label: string): El {
  const found = buttons.filter((el) => read(el).trim() === label);
  if (found.length !== 1) throw new Error(`"${label}": ${found.length} botones (${buttons.map((el) => read(el).trim()).join(' | ')})`);
  return found[0];
}

describe('la tarjeta, al tocar cada botón', () => {
  it('cada botón de texto copia el suyo: Facebook no copia el de Instagram', async () => {
    const { env, gestures } = setup();
    const item = video();
    const texts = group(drawCard({ video: item, gestures }), `textos-${item.id}`);
    // El grupo tiene nombre para quien no ve la pantalla.
    expect(texts.props.role).toBe('group');
    expect(all(texts).find((el) => el.props.id === `textos-${item.id}`)).toBeDefined();

    const expected: [string, string][] = [
      ['Instagram', item.texts.instagram],
      ['TikTok', item.texts.tiktok],
      ['Facebook', item.texts.facebook],
      ['YouTube: título', item.texts.youtubeTitle],
      ['YouTube: descripción', item.texts.youtubeDescription],
    ];
    expect(buttonsIn(texts).map((el) => read(el).trim())).toEqual(expected.map(([label]) => label));
    for (const [label, text] of expected) {
      env.writeText.mockClear();
      tap(byLabel(buttonsIn(texts), label));
      await settle();
      expect(env.writeText.mock.calls, label).toEqual([[text]]);
    }
  });

  it('Copiar link copia el link de afiliado y no la dirección del video', async () => {
    const { env, gestures } = setup();
    const item = video();
    tap(byLabel(buttonsIn(drawCard({ video: item, gestures })), 'Copiar link'));
    await settle();
    expect(env.writeText.mock.calls).toEqual([[item.link]]);
  });

  it('el botón recién copiado muestra su confirmación y los demás no', () => {
    const { gestures } = setup();
    const item = video();
    const card = drawCard({ video: item, gestures, copied: `${item.id}|facebook` });
    const labels = buttonsIn(group(card, `textos-${item.id}`)).map((el) => read(el).trim());
    expect(labels).toEqual(['Instagram', 'TikTok', 'Copiado', 'YouTube: título', 'YouTube: descripción']);
    expect(buttonsIn(card).map((el) => read(el).trim())).toContain('Copiar link');
  });

  it('Compartir y Guardar piden el video de esta tarjeta', async () => {
    const { env, gestures } = setup();
    const item = video();
    const card = drawCard({ video: item, gestures });

    tap(byLabel(buttonsIn(card), 'Compartir'));
    await settle();
    expect(env.fetchFile.mock.calls).toEqual([[item.videoUrl, item.fileName]]);
    expect(env.share).not.toHaveBeenCalled();

    // Con el archivo listo, el toque en el botón es el que abre la hoja.
    const ready = drawCard({ video: item, gestures, fileState: 'lista' });
    tap(byLabel(buttonsIn(ready), 'Listo: toca para compartir'));
    expect(env.share).toHaveBeenCalledTimes(1);

    tap(byLabel(buttonsIn(ready), 'Guardar video'));
    await settle();
    expect(env.download.mock.calls).toEqual([[env.createObjectURL.mock.results[0].value, item.fileName]]);
  });

  it('mientras baja, Compartir y Guardar quedan apagados y Guardar dice que está bajando', () => {
    const { gestures } = setup();
    const item = video();
    const card = drawCard({ video: item, gestures, fileState: 'cargando', saving: true });
    const share = byLabel(buttonsIn(card), 'Preparando el video…');
    const save = byLabel(buttonsIn(card), 'Bajando…');
    expect(share.props.disabled).toBe(true);
    expect(save.props.disabled).toBe(true);
    // El ícono de Guardar gira mientras baja.
    const html = renderToStaticMarkup(save as unknown as ReactElement);
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('lucide-download');

    // Si la descarga la pidió Compartir, Guardar no dice que baja: solo espera.
    const shared = drawCard({ video: item, gestures, fileState: 'cargando' });
    const idle = byLabel(buttonsIn(shared), 'Guardar video');
    expect(idle.props.disabled).toBe(true);
    expect(renderToStaticMarkup(idle as unknown as ReactElement)).toContain('lucide-download');
  });

  it('cada red marca la suya con el precio del video, y una ya marcada deshace su marca', async () => {
    const { actions, screen, gestures } = setup();
    const item = video({ price: 219_990, listPrice: 399_990 });
    const marked: Mark = { postId: 808, at: '2026-10-13T12:00:00.000Z' };
    const card = drawCard({ video: item, gestures, posted: { youtube: marked } });
    const networks = buttonsIn(group(card, `subido-${item.id}`));
    expect(networks.map((el) => [read(el).trim(), el.props['aria-pressed']])).toEqual([
      ['Instagram', false],
      ['TikTok', false],
      ['YouTube', true],
      ['Facebook', false],
    ]);

    for (const label of ['Instagram', 'TikTok', 'Facebook']) {
      tap(byLabel(networks, label));
      await Promise.all(screen.jobs);
    }
    expect(actions.mark.mock.calls).toEqual([
      [item.id, 'instagram', 219_990],
      [item.id, 'tiktok', 219_990],
      [item.id, 'facebook', 219_990],
    ]);

    tap(byLabel(networks, 'YouTube'));
    await Promise.all(screen.jobs);
    expect(actions.undo.mock.calls).toEqual([[808]]);
  });

  it('con una marca viajando, las cuatro redes quedan apagadas y la que viaja lo dice', () => {
    const { gestures } = setup();
    const item = video();
    const card = drawCard({ video: item, gestures, busy: `${item.id}|tiktok` });
    const networks = buttonsIn(group(card, `subido-${item.id}`));
    expect(networks.map((el) => read(el).trim())).toEqual(['Instagram', 'Guardando…', 'YouTube', 'Facebook']);
    for (const el of networks) expect(el.props.disabled).toBe(true);

    // La marca de otra tarjeta también las apaga, pero acá ninguna dice que guarda.
    const other = drawCard({ video: item, gestures, busy: 'otro-producto|tiktok' });
    const idle = buttonsIn(group(other, `subido-${item.id}`));
    expect(idle.map((el) => read(el).trim())).toEqual(['Instagram', 'TikTok', 'YouTube', 'Facebook']);
    for (const el of idle) expect(el.props.disabled).toBe(true);
  });

  it('sin poder compartir no hay botón Compartir, y lo demás sigue', () => {
    const { gestures } = setup();
    const item = video();
    for (const canShare of [false, null]) {
      const labels = buttonsIn(drawCard({ video: item, gestures, canShare })).map((el) => read(el).trim());
      expect(labels).not.toContain('Compartir');
      expect(labels.slice(0, 2)).toEqual(['Guardar video', 'Copiar link']);
      expect(labels).toHaveLength(11);
    }
  });

  it('el aviso se lee en la tarjeta, y solo el de la descarga fallida trae el enlace al video', () => {
    const { gestures } = setup();
    // Sin ficha de Mercado Libre: así el único enlace que puede aparecer es el del video.
    const item = video({ mlUrl: null });
    const draw = (note: Note | undefined) =>
      renderToStaticMarkup(drawCard({ video: item, gestures, note }) as unknown as ReactElement);

    const quiet = draw(undefined);
    expect(quiet).not.toContain('Abrir el video');
    expect(quiet).not.toMatch(/<a\b/);

    const info = draw({ tone: 'info', text: 'Video guardado. Búscalo en Descargas.' });
    expect(info).toMatch(/<p role="status" aria-live="polite" class="[^"]*text-fg[^"]*">Video guardado\. Búscalo en Descargas\.<\/p>/);
    expect(info).not.toMatch(/<a\b/);

    const failed = draw({ tone: 'error', text: DOWNLOAD_ERROR, openVideo: true });
    expect(failed).toMatch(/<p role="status" aria-live="polite" class="[^"]*text-red-400[^"]*">No se pudo bajar el video\./);
    const link = /<a\b[^>]*>[\s\S]*?<\/a>/.exec(failed)?.[0] ?? '';
    // El video directo, en otra pestaña: la página no se pierde, con sus marcas y lo ya bajado.
    expect(link).toContain(`href="${item.videoUrl}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain('Abrir el video');
    // Del alto de un botón, para tocarlo con el dedo; y sin download, que entre dominios no hace nada.
    expect(link).toMatch(/\bmin-h-11\b/);
    expect(link).not.toContain('download');
    // Después del aviso que lo nombra.
    expect(failed.indexOf('<a ')).toBeGreaterThan(failed.indexOf('acá abajo'));
  });

  it('una dirección que no es web nunca llega a un enlace', () => {
    const { gestures } = setup();
    const note: Note = { tone: 'error', text: DOWNLOAD_ERROR, openVideo: true };
    // React avisa por consola de la dirección rara en el reproductor: acá se mira solo el enlace.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const videoUrl of ['javascript:alert(1)', 'data:text/html,hola', '/storage/video.mp4', '']) {
        const html = renderToStaticMarkup(drawCard({ video: video({ videoUrl, mlUrl: null }), gestures, note }) as unknown as ReactElement);
        expect(html, videoUrl).not.toMatch(/<a\b/);
      }
    } finally {
      quiet.mockRestore();
    }
  });

  it('el texto que no se pudo copiar queda escrito en la tarjeta, completo', () => {
    const { gestures } = setup();
    const item = video();
    const html = renderToStaticMarkup(
      drawCard({ video: item, gestures, manual: { label: 'TikTok', text: 'Parlante JBL a $49.990\n#ofertas' } }) as unknown as ReactElement
    );
    expect(html).toContain('>TikTok</p>');
    expect(html).toMatch(/<p class="[^"]*select-all[^"]*whitespace-pre-wrap[^"]*">Parlante JBL a \$49\.990\n#ofertas<\/p>/);
  });
});

// ---------------------------------------------------------------------------
// La revisión en vivo decide: Compartir, Guardar y Copiar texto leen lo que ya
// está en memoria, sin esperar al servidor dentro del toque.

/** Baja el video con un primer toque y deja el archivo en memoria. */
async function ready(t: ReturnType<typeof setup>, item: ReadyVideo) {
  t.gestures.share(item);
  await settle();
  expect(t.env.fetchFile).toHaveBeenCalled();
  t.env.share.mockClear();
  t.live.recheck.mockClear();
  t.screen.notes.clear();
}

const OFF_TEXT = '✗ El precio cambió de $49.990 a $45.990. No lo subas: toca Actualizar.';

describe('la revisión en vivo: Compartir', () => {
  it('con "mismo precio" reciente, el segundo toque llama a Compartir en la misma vuelta, sin preguntar nada', async () => {
    const t = setup();
    const item = video();
    await ready(t, item);
    t.live.fallback = SAME(T0 - 5 * MINUTE);
    const calls: string[] = [];
    t.live.entry.mockImplementation((_id: string) => {
      calls.push('entry');
      return t.live.fallback;
    });
    t.env.share.mockImplementation(async () => {
      calls.push('share');
    });

    t.gestures.share(item);
    // Antes de volver del toque: lo que se sabe se lee, y se comparte.
    expect(calls).toEqual(['entry', 'share']);
    expect(t.live.recheck).not.toHaveBeenCalled();
  });

  it('a los 15 minutos justos todavía comparte; pasado eso no, y pide otra revisión sin esperarla', async () => {
    const t = setup();
    const item = video();
    await ready(t, item);
    t.live.fallback = SAME(T0 - 15 * MINUTE);
    t.gestures.share(item);
    expect(t.env.share).toHaveBeenCalledTimes(1);

    const late = setup();
    const other = video();
    await ready(late, other);
    late.live.fallback = SAME(T0 - 15 * MINUTE - 1);
    late.gestures.share(other);
    expect(late.env.share).not.toHaveBeenCalled();
    expect(late.screen.notes.get(other.id)).toEqual({ tone: 'error', text: CHECKING_NOTE });
    expect(late.live.recheck.mock.calls).toEqual([[[other.id]]]);
  });

  it('si ya hay una revisión en camino, dice que espere y no pide otra', async () => {
    const t = setup();
    const item = video();
    await ready(t, item);
    t.live.fallback = { ...SAME(T0 - 20 * MINUTE), checking: true };
    t.gestures.share(item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)?.text).toBe(CHECKING_NOTE);
    expect(t.live.recheck).not.toHaveBeenCalled();
  });

  it('si cambió, no comparte y dice qué cambió; no pide revisar de nuevo (hay que actualizar)', async () => {
    const t = setup();
    const item = video();
    await ready(t, item);
    t.live.fallback = CHANGED();
    t.gestures.share(item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)).toEqual({ tone: 'error', text: OFF_TEXT });
    expect(t.live.recheck).not.toHaveBeenCalled();

    // Con el precio nuevo ya en el sitio, lo dice.
    t.live.fallback = CHANGED(T0, true);
    t.gestures.share(item);
    expect(t.screen.notes.get(item.id)?.text).toBe(`${OFF_TEXT} El sitio ya tiene el precio nuevo.`);
  });

  it('si ya no está a la venta en Mercado Libre, tampoco', async () => {
    const t = setup();
    const item = video();
    await ready(t, item);
    t.live.fallback = UNAVAILABLE();
    t.gestures.share(item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)?.text).toBe(
      '✗ Ya no está a la venta con un vendedor de reputación verde. No lo subas: toca Actualizar.'
    );
  });

  it('un "cambió" se ve ya en el primer toque: ni siquiera baja el video', async () => {
    const t = setup({ fallback: CHANGED() });
    const item = video();
    t.gestures.share(item);
    await settle();
    expect(t.env.fetchFile).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)?.text).toBe(OFF_TEXT);
  });

  it('el primer toque baja igual con la revisión en camino o vencida, y pide otra si hace falta, para tenerla al segundo', async () => {
    // Sin respuesta y revisando: baja, y no pide otra.
    const checking = setup({ fallback: CHECKING });
    const a = video();
    checking.gestures.share(a);
    await settle();
    expect(checking.env.fetchFile).toHaveBeenCalledTimes(1);
    expect(checking.live.recheck).not.toHaveBeenCalled();
    expect(checking.screen.notes.get(a.id)?.tone).toBe('info');

    // "Mismo precio" de hace 20 minutos: baja, y pide otra.
    const stale = setup({ fallback: SAME(T0 - 20 * MINUTE) });
    const b = video();
    stale.gestures.share(b);
    await settle();
    expect(stale.env.fetchFile).toHaveBeenCalledTimes(1);
    expect(stale.live.recheck.mock.calls).toEqual([[[b.id]]]);

    // "Mismo precio" de hace 6 minutos todavía deja, pero ya conviene repetirla (más de 5): la pide.
    const aging = setup({ fallback: SAME(T0 - 6 * MINUTE) });
    const c = video();
    aging.gestures.share(c);
    await settle();
    expect(aging.live.recheck.mock.calls).toEqual([[[c.id]]]);

    // Reciente: no pide nada.
    const fresh = setup({ fallback: SAME(T0 - 2 * MINUTE) });
    const d = video();
    fresh.gestures.share(d);
    await settle();
    expect(fresh.live.recheck).not.toHaveBeenCalled();
  });

  it('sin revisión en vivo vale la regla de siempre: lista de una hora o menos y precio de 6 horas o menos', async () => {
    const t = setup({ fallback: UNKNOWN(T0, 'La revisión en vivo funciona solo en el sitio publicado.') });
    const item = video({ checkedAt: new Date(T0 - 5 * HOUR).toISOString() });
    t.gestures.share(item);
    await settle();
    // Una hora justa de lista y seis justas de precio: todavía deja.
    t.advance(60 * MINUTE);
    t.gestures.share(item);
    expect(t.env.share).toHaveBeenCalledTimes(1);
    expect(t.live.recheck).not.toHaveBeenCalled();
  });

  it('cuando llega la revisión, se va el "estoy revisando" que quedó en la tarjeta, y solo ese', async () => {
    const t = setup({ fallback: CHECKING });
    const item = video();
    const other = video();
    await ready(t, item);
    t.gestures.share(item);
    expect(t.screen.notes.get(item.id)?.text).toBe(CHECKING_NOTE);
    // La otra tarjeta ya sabe que cambió: su aviso es otro.
    t.live.set(other.id, CHANGED());
    t.gestures.share(other);
    expect(t.screen.notes.get(other.id)?.text).toBe(OFF_TEXT);

    t.gestures.liveSettled([item.id, other.id]);
    expect(t.screen.notes.has(item.id)).toBe(false);
    // Lo que dijo otra cosa sigue a la vista.
    expect(t.screen.notes.get(other.id)?.text).toBe(OFF_TEXT);
  });
});

describe('la revisión en vivo: Guardar video y Copiar texto', () => {
  it('Guardar sigue la misma regla: con un cambio no baja ni guarda nada', async () => {
    const t = setup({ fallback: CHANGED() });
    const item = video();
    t.gestures.save(item);
    await settle();
    expect(t.env.fetchFile).not.toHaveBeenCalled();
    expect(t.env.download).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)?.text).toBe(OFF_TEXT);
  });

  it('Guardar con "mismo precio" vencido tampoco, y pide otra revisión', async () => {
    const t = setup({ fallback: SAME(T0 - 16 * MINUTE) });
    const item = video();
    t.gestures.save(item);
    await settle();
    expect(t.env.download).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)?.text).toBe(CHECKING_NOTE);
    expect(t.live.recheck.mock.calls).toEqual([[[item.id]]]);
  });

  it('un texto lleva el precio escrito: con un cambio no se copia; el link, que no lleva precio, sí', async () => {
    const t = setup({ fallback: UNAVAILABLE() });
    const item = video();
    await t.gestures.copy(item, textTargets(item)[0]);
    expect(t.env.writeText).not.toHaveBeenCalled();
    expect(t.screen.notes.get(item.id)?.text).toContain('No lo subas: toca Actualizar.');

    await t.gestures.copy(item, linkTarget(item));
    expect(t.env.writeText.mock.calls).toEqual([[item.link]]);
  });

  it('con "mismo precio" reciente se copia el texto', async () => {
    const t = setup({ fallback: SAME(T0 - MINUTE) });
    const item = video();
    await t.gestures.copy(item, textTargets(item)[1]);
    expect(t.env.writeText.mock.calls).toEqual([[item.texts.tiktok]]);
  });
});

describe('la revisión en vivo: marcar siempre se deja', () => {
  it('con un cambio marca igual, con el precio del video, y avisa que se revise lo subido', async () => {
    const t = setup({ fallback: CHANGED() });
    const item = video();
    t.gestures.toggle(item, 'instagram', undefined);
    await Promise.all(t.screen.jobs);
    expect(t.actions.mark.mock.calls).toEqual([[item.id, 'instagram', 49_990]]);
    expect(t.screen.posted.get(`${item.id}|instagram`)?.postId).toBe(500);
    expect(t.screen.notes.get(item.id)).toEqual({
      tone: 'error',
      text: 'Lo marqué, pero ojo: El precio cambió de $49.990 a $45.990. Revisa lo que subiste en esa red.',
    });
  });

  it('si la acción avisa que el precio del sitio ya es otro, ese aviso es el que se muestra', async () => {
    const t = setup();
    const item = video();
    const warning = 'Ojo: el precio cambió a $45.990 desde que cargaste la lista. Si ya lo subiste, revisa la publicación.';
    t.actions.mark.mockResolvedValueOnce({ ok: true, postId: 501, priceNow: 45_990, warning });
    t.gestures.toggle(item, 'tiktok', undefined);
    await Promise.all(t.screen.jobs);
    expect(t.screen.posted.get(`${item.id}|tiktok`)?.postId).toBe(501);
    expect(t.screen.notes.get(item.id)).toEqual({ tone: 'error', text: warning });
  });

  it('con el mismo precio no avisa nada', async () => {
    const t = setup();
    const item = video();
    t.gestures.toggle(item, 'youtube', undefined);
    await Promise.all(t.screen.jobs);
    expect(t.screen.notes.has(item.id)).toBe(false);
  });

  it('markWarning lee el aviso con cuidado: llega del servidor', () => {
    expect(markWarning({ ok: true, postId: 1, warning: '  Ojo: cambió.  ' })).toBe('Ojo: cambió.');
    for (const result of [null, undefined, 'texto', { ok: true, postId: 1 }, { warning: 7 }, { warning: '   ' }]) {
      expect(markWarning(result), JSON.stringify(result)).toBeNull();
    }
  });
});

describe('la tarjeta tocada, con la revisión en vivo', () => {
  it('con un cambio, tocar Compartir con el archivo listo no abre la hoja', async () => {
    const t = setup();
    const item = video();
    await ready(t, item);
    // El video ya estaba bajado cuando llegó la revisión que dice que cambió.
    t.live.fallback = CHANGED();
    const card = drawCard({ video: item, gestures: t.gestures, fileState: 'lista', live: CHANGED() });
    tap(byLabel(buttonsIn(card), 'Listo: toca para compartir'));
    expect(t.env.share).not.toHaveBeenCalled();
    // Y la tarjeta no ofrece el reproductor, desde cuyo menú se podría bajar igual.
    expect(all(card).some((el) => el.type === 'video')).toBe(false);
  });
});
