import { describe, expect, it, vi } from 'vitest';

/**
 * Lo que pasa al tocar un botón de /admin/historias, sin navegador: las reglas
 * de app/admin/historias/gestures reciben de afuera la hoja de compartir, el
 * portapapeles, el reloj, las acciones del servidor y la revisión en vivo que
 * ya está en memoria, y acá se les entregan dobles. Y la revisión en vivo
 * misma (app/admin/historias/live-checks), con una acción de mentira.
 */

import {
  COPY_ERROR,
  MARKED_BUT_CHANGED,
  SHARE_ERROR,
  createStoryGestures,
  markNotice,
  type Note,
  type StoryActions,
} from '@/app/admin/historias/gestures';
import { AUTO_RECHECK_MS, CHECK_TIMEOUT_MS, createLiveChecker, readResult } from '@/app/admin/historias/live-checks';
import {
  CHECKING_WAIT,
  NOT_CHECKED,
  OLD_LIST,
  STALE_SAME,
  type CardCheck,
  type CheckTarget,
} from '@/app/admin/historias/rules';
import type { LiveCheck } from '@/lib/social/live-price';
import type { StoryItem } from '@/lib/social/stories';

const T0 = new Date('2026-10-15T15:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let seq = 0;
function story(over: Partial<StoryItem> = {}): StoryItem {
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
    drop: null,
    checkedAt: new Date(T0 - 20 * MINUTE).toISOString(),
    again: null,
    reason: 'Parlante JBL, 50% de descuento, de tienda oficial',
    warning: null,
    points: 62.5,
    image: `/social/pieza/${id}/story-49990-99990-1-1-1-abc.jpg`,
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    fileName: `comparatech-producto-${seq}-historia.jpg`,
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const named = (name: string) => Object.assign(new Error(name), { name });

const same = (at: number): CardCheck => ({ last: { result: { status: 'same', checkedAt: new Date(at).toISOString() }, at }, pending: false });
const changed = (at: number, saved = false): CardCheck => ({
  last: {
    result: {
      status: 'changed',
      checkedAt: new Date(at).toISOString(),
      price: 45_990,
      listPrice: 99_990,
      freeShipping: true,
      full: false,
      saved,
      what: 'El precio cambió de $49.990 a $45.990.',
    },
    at,
  },
  pending: false,
});
const unavailable = (at: number): CardCheck => ({
  last: {
    result: {
      status: 'unavailable',
      checkedAt: new Date(at).toISOString(),
      what: 'Ya no está a la venta con un vendedor de reputación verde.',
    },
    at,
  },
  pending: false,
});
const unknown = (at: number, what = NOT_CHECKED): CardCheck => ({ last: { result: { status: 'unknown', what }, at }, pending: false });

/** Las reglas armadas con dobles: un reloj que el test mueve, y todo lo que piden queda anotado. */
function setup(opts: { checks?: Record<string, CardCheck>; openedAt?: number; files?: Map<string, File> } = {}) {
  let now = T0;
  const calls: string[] = [];
  const env = {
    share: vi.fn(async (_data: { files: File[] }) => {
      calls.push('share');
    }),
    writeText: vi.fn(async (_text: string) => {
      calls.push('writeText');
    }),
    now: () => now,
    later: vi.fn((_run: () => void, _ms: number) => {}),
  };
  const actions = {
    mark: vi.fn(async (_id: string, _price?: number) => ({ ok: true as const, postId: 501 })),
    undo: vi.fn(async (_postId: number) => ({ ok: true as const })),
  };
  const notes: Record<string, Note | null> = {};
  const ui = {
    note: vi.fn((key: string, note: Note | null) => {
      notes[key] = note;
    }),
    copied: vi.fn(),
    busy: vi.fn(),
    published: vi.fn(),
    unposted: vi.fn(),
    run: vi.fn((job: () => Promise<void>) => {
      void job();
    }),
  };
  const checks = opts.checks ?? {};
  const config = {
    openedAt: opts.openedAt ?? T0 - 10 * MINUTE,
    maxPriceAgeMs: 6 * HOUR,
    checkOf: vi.fn((productId: string) => {
      calls.push('checkOf');
      return checks[productId];
    }),
    recheck: vi.fn(() => {
      calls.push('recheck');
    }),
    fileOf: vi.fn((image: string) => opts.files?.get(image)),
  };
  const gestures = createStoryGestures(env, actions as unknown as StoryActions, ui, config);
  return {
    gestures,
    env,
    actions,
    ui,
    config,
    notes,
    checks,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function withFile(item: StoryItem) {
  const file = new File(['jpg'], item.fileName, { type: 'image/jpeg' });
  return { file, files: new Map([[item.image, file]]) };
}

describe('Compartir: lo decide la revisión en vivo que ya está en memoria', () => {
  it('con "mismo precio" de hace 5 minutos, abre la hoja de compartir dentro del mismo toque y copia el link', () => {
    const item = story();
    const { file, files } = withFile(item);
    const t = setup({ checks: { [item.id]: same(T0 - 5 * MINUTE) }, files });

    t.gestures.share(item.id, item);

    // Antes de volver del toque, sin esperar nada: así el teléfono deja abrir la hoja.
    expect(t.env.share).toHaveBeenCalledTimes(1);
    expect(t.env.share).toHaveBeenCalledWith({ files: [file] });
    expect(t.env.writeText).toHaveBeenCalledWith(item.link);
    // En el toque no se le pregunta nada al servidor: ni la revisión ni las marcas.
    expect(t.config.recheck).not.toHaveBeenCalled();
    expect(t.actions.mark).not.toHaveBeenCalled();
    expect(t.calls).toEqual(['checkOf', 'writeText', 'share']);
    expect(t.notes[item.id] ?? null).toBeNull();
  });

  it('con "mismo precio" de hace justo 15 minutos todavía deja; a los 16 no, y pide otra revisión sin esperarla', () => {
    const item = story();
    const { files } = withFile(item);
    const t = setup({ checks: { [item.id]: same(T0 - 15 * MINUTE) }, files });
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(1);

    const old = story();
    const t2 = setup({ checks: { [old.id]: same(T0 - 16 * MINUTE) }, files: withFile(old).files });
    t2.gestures.share(old.id, old);
    expect(t2.env.share).not.toHaveBeenCalled();
    expect(t2.notes[old.id]).toEqual({ tone: 'error', text: STALE_SAME });
    expect(t2.config.recheck).toHaveBeenCalledTimes(1);
  });

  it('si ya hay una revisión viajando, no pide otra: dice que espere', () => {
    const item = story();
    const check: CardCheck = { ...same(T0 - 20 * MINUTE), pending: true };
    const t = setup({ checks: { [item.id]: check }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.notes[item.id]).toEqual({ tone: 'error', text: CHECKING_WAIT });
    expect(t.config.recheck).not.toHaveBeenCalled();
  });

  it('antes de la primera respuesta no deja: dice que está revisando', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: { last: null, pending: true } }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.notes[item.id]?.text).toBe(CHECKING_WAIT);
    expect(t.config.recheck).not.toHaveBeenCalled();

    // Si nunca se pidió (no hay nada en memoria), se pide.
    const other = story();
    const t2 = setup({ files: withFile(other).files });
    t2.gestures.share(other.id, other);
    expect(t2.env.share).not.toHaveBeenCalled();
    expect(t2.config.recheck).toHaveBeenCalledTimes(1);
  });

  it('si Mercado Libre muestra otro precio, no deja, con lo que cambió; y no pide revisar de nuevo', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: changed(T0 - MINUTE) }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.env.writeText).not.toHaveBeenCalled();
    expect(t.notes[item.id]).toEqual({ tone: 'error', text: 'El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.' });
    expect(t.config.recheck).not.toHaveBeenCalled();
  });

  it('si el sitio ya tiene el precio nuevo, lo dice (y solo entonces)', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: changed(T0 - MINUTE, true) }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.notes[item.id]?.text).toBe(
      'El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar. El sitio ya tiene el precio nuevo.'
    );

    const other = story();
    const t2 = setup({ checks: { [other.id]: changed(T0 - MINUTE, false) }, files: withFile(other).files });
    t2.gestures.share(other.id, other);
    expect(t2.notes[other.id]?.text).toBe('El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.');
  });

  it('si ya no está a la venta, no deja', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: unavailable(T0 - MINUTE) }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.notes[item.id]?.text).toBe(
      'Ya no está a la venta con un vendedor de reputación verde. No la subas: toca Actualizar.'
    );
  });

  it('si no se pudo revisar, vale la regla de antes: lista de una hora o menos y precio de 6 horas o menos', () => {
    const item = story({ checkedAt: new Date(T0 - 2 * HOUR).toISOString() });
    const t = setup({ checks: { [item.id]: unknown(T0 - MINUTE) }, openedAt: T0 - 59 * MINUTE, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(1);
  });

  it('la regla de antes en sus bordes: una hora justa de lista y seis horas justas de precio todavía dejan', () => {
    const item = story({ checkedAt: new Date(T0 - 6 * HOUR).toISOString() });
    const t = setup({ checks: { [item.id]: unknown(T0 - MINUTE) }, openedAt: T0 - 60 * MINUTE, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(1);

    // Un minuto más de lista, o de precio, y ya no.
    const late = story();
    const t2 = setup({ checks: { [late.id]: unknown(T0 - MINUTE) }, openedAt: T0 - 61 * MINUTE, files: withFile(late).files });
    t2.gestures.share(late.id, late);
    expect(t2.env.share).not.toHaveBeenCalled();
    const stale = story({ checkedAt: new Date(T0 - 6 * HOUR - MINUTE).toISOString() });
    const t3 = setup({ checks: { [stale.id]: unknown(T0 - MINUTE) }, openedAt: T0 - MINUTE, files: withFile(stale).files });
    t3.gestures.share(stale.id, stale);
    expect(t3.env.share).not.toHaveBeenCalled();
  });

  it('con "mismo precio" reciente deja aunque otra revisión vaya en camino; un "cambió" bloquea aunque se esté revisando', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: { ...same(T0 - 2 * MINUTE), pending: true } }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(1);

    const off = story();
    const t2 = setup({ checks: { [off.id]: { ...changed(T0 - 2 * MINUTE), pending: true } }, files: withFile(off).files });
    t2.gestures.share(off.id, off);
    expect(t2.env.share).not.toHaveBeenCalled();
    expect(t2.notes[off.id]?.text).toContain('No la subas: toca Actualizar.');
  });

  it('Compartir nunca espera al servidor: si la revisión que pide no vuelve, el toque igual terminó sin compartir', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: same(T0 - 20 * MINUTE) }, files: withFile(item).files });
    // recheck no devuelve nada que se espere: el toque vuelve de inmediato.
    const back = t.gestures.share(item.id, item);
    expect(back).toBeUndefined();
    expect(t.config.recheck).toHaveBeenCalledTimes(1);
    expect(t.env.share).not.toHaveBeenCalled();
  });

  it('sin revisión y con la lista de más de una hora: lo dice así, y pide revisar de nuevo', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: unknown(T0 - MINUTE) }, openedAt: T0 - 61 * MINUTE, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.notes[item.id]?.text).toBe(OLD_LIST);
    expect(t.config.recheck).toHaveBeenCalledTimes(1);
  });

  it('sin revisión y con el precio revisado hace más de 6 horas: dice eso, no que la lista es vieja', () => {
    const item = story({ checkedAt: new Date(T0 - 7 * HOUR).toISOString() });
    const t = setup({ checks: { [item.id]: unknown(T0 - MINUTE) }, openedAt: T0 - MINUTE, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    const text = t.notes[item.id]?.text ?? '';
    expect(text).toBe('El precio de esta oferta se revisó hace más de 6 horas. Toca Actualizar, arriba.');
    expect(text).not.toContain('lista');
  });

  it('con "mismo precio" reciente, la lista vieja y el precio viejo del sitio no importan: Mercado Libre lo confirmó', () => {
    const item = story({ checkedAt: new Date(T0 - 7 * HOUR).toISOString() });
    const t = setup({ checks: { [item.id]: same(T0 - MINUTE) }, openedAt: T0 - 3 * HOUR, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(1);
  });

  it('sin la imagen en memoria no hace nada (el botón está apagado)', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: same(T0) } });
    t.gestures.share(item.id, item);
    expect(t.env.share).not.toHaveBeenCalled();
    expect(t.env.writeText).not.toHaveBeenCalled();
  });

  it('un doble toque no pide Compartir dos veces', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: same(T0) }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    t.advance(500);
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(1);
    t.advance(1500);
    t.gestures.share(item.id, item);
    expect(t.env.share).toHaveBeenCalledTimes(2);
  });

  it('cerrar la hoja de compartir no es un error; otra falla no sugiere guardar la imagen con el dedo', async () => {
    const item = story();
    const t = setup({ checks: { [item.id]: same(T0) }, files: withFile(item).files });
    t.env.share.mockRejectedValueOnce(named('AbortError'));
    t.gestures.share(item.id, item);
    await settle();
    expect(t.notes[item.id] ?? null).toBeNull();

    t.advance(2000);
    t.env.share.mockRejectedValueOnce(named('NotAllowedError'));
    t.gestures.share(item.id, item);
    await settle();
    expect(t.notes[item.id]?.text).toBe(SHARE_ERROR);
    expect(SHARE_ERROR).not.toMatch(/dedo|mant[eé]n/i);
  });

  it('un bloqueo anterior se borra cuando la revisión ya deja subir', () => {
    const item = story();
    const t = setup({ checks: { [item.id]: { last: null, pending: true } }, files: withFile(item).files });
    t.gestures.share(item.id, item);
    expect(t.notes[item.id]?.text).toBe(CHECKING_WAIT);
    t.checks[item.id] = same(T0);
    t.gestures.share(item.id, item);
    expect(t.notes[item.id]).toBeNull();
    expect(t.env.share).toHaveBeenCalledTimes(1);
  });
});

describe('Guardar imagen y Copiar link', () => {
  it('Guardar sigue la misma regla que Compartir', () => {
    const ok = story();
    const bad = story();
    const t = setup({ checks: { [ok.id]: same(T0 - MINUTE), [bad.id]: changed(T0 - MINUTE) } });
    expect(t.gestures.save(ok.id, ok)).toBe(true);
    expect(t.gestures.save(bad.id, bad)).toBe(false);
    expect(t.notes[bad.id]?.text).toContain('No la subas: toca Actualizar.');
  });

  it('Guardar con "mismo precio" vencido, con "no disponible" o con la lista vieja sin revisión tampoco deja', () => {
    const stale = story();
    const gone = story();
    const old = story();
    const t = setup({
      checks: { [stale.id]: same(T0 - 16 * MINUTE), [gone.id]: unavailable(T0 - MINUTE), [old.id]: unknown(T0 - MINUTE) },
      openedAt: T0 - 61 * MINUTE,
    });
    expect(t.gestures.save(stale.id, stale)).toBe(false);
    expect(t.notes[stale.id]?.text).toBe(STALE_SAME);
    expect(t.gestures.save(gone.id, gone)).toBe(false);
    expect(t.notes[gone.id]?.text).toContain('Ya no está a la venta');
    expect(t.gestures.save(old.id, old)).toBe(false);
    expect(t.notes[old.id]?.text).toBe(OLD_LIST);
    // Lo vencido y la lista vieja piden otra revisión; lo que cambió no.
    expect(t.config.recheck).toHaveBeenCalledTimes(2);
  });

  it('Copiar link no lleva precio y se deja siempre; si el teléfono no deja, dice cómo copiarlo a mano', async () => {
    const item = story();
    const t = setup({ checks: { [item.id]: changed(T0) } });
    await t.gestures.copyLink(item.id, item);
    expect(t.env.writeText).toHaveBeenCalledWith(item.link);
    expect(t.ui.copied).toHaveBeenCalledWith(item.id, true);

    t.env.writeText.mockRejectedValueOnce(new Error('no'));
    await t.gestures.copyLink(item.id, item);
    expect(t.notes[item.id]?.text).toBe(COPY_ERROR);
  });
});

describe('Ya la publiqué: siempre se deja marcar', () => {
  it('marca con el precio de la tarjeta, aunque Mercado Libre muestre otro, y lo avisa', async () => {
    const item = story();
    const t = setup({ checks: { [item.id]: changed(T0) } });
    t.gestures.mark(item);
    await settle();
    expect(t.actions.mark).toHaveBeenCalledWith(item.id, 49_990);
    expect(t.ui.published).toHaveBeenCalledWith(item, 501);
    expect(t.notes[item.id]).toEqual({ tone: 'warn', text: MARKED_BUT_CHANGED });
  });

  it('si la acción avisa que el precio del sitio ya es otro, la tarjeta lo muestra', async () => {
    const item = story();
    const t = setup({ checks: { [item.id]: same(T0) } });
    t.actions.mark.mockResolvedValueOnce({
      ok: true,
      postId: 502,
      warning: 'El precio del sitio ya es $45.990: si la subiste a $49.990, bórrala y súbela de nuevo.',
    } as never);
    t.gestures.mark(item);
    await settle();
    expect(t.notes[item.id]).toEqual({
      tone: 'warn',
      text: 'El precio del sitio ya es $45.990: si la subiste a $49.990, bórrala y súbela de nuevo.',
    });
  });

  it('con el precio igual no avisa nada', async () => {
    const item = story();
    const t = setup({ checks: { [item.id]: same(T0) } });
    t.gestures.mark(item);
    await settle();
    expect(t.ui.published).toHaveBeenCalledWith(item, 501);
    expect(t.notes[item.id] ?? null).toBeNull();
  });

  it('un error de la acción queda en la tarjeta y no la marca', async () => {
    const item = story();
    const t = setup();
    t.actions.mark.mockResolvedValueOnce({ ok: false, error: 'Ese producto ya no está a la venta en el sitio.' } as never);
    t.gestures.mark(item);
    await settle();
    expect(t.ui.published).not.toHaveBeenCalled();
    expect(t.notes[item.id]?.text).toBe('Ese producto ya no está a la venta en el sitio.');
  });

  it('"Deshacer" justo después de marcar no deshace (es el mismo botón); un rato después sí', async () => {
    const item = story();
    const t = setup();
    t.gestures.mark(item);
    await settle();
    t.advance(500);
    t.gestures.undoOffer(item, 501);
    await settle();
    expect(t.actions.undo).not.toHaveBeenCalled();
    t.advance(1000);
    t.gestures.undoOffer(item, 501);
    await settle();
    expect(t.actions.undo).toHaveBeenCalledWith(501);
    expect(t.ui.published).toHaveBeenLastCalledWith(item, null);
  });

  it('"No la publiqué: deshacer" saca la historia ya subida', async () => {
    const t = setup();
    t.gestures.undoPosted('publicada-77', 77);
    await settle();
    expect(t.actions.undo).toHaveBeenCalledWith(77);
    expect(t.ui.unposted).toHaveBeenCalledWith(77);
  });

  it('markNotice entiende un precio actual distinto aunque venga sin frase, e ignora lo demás', () => {
    expect(markNotice({ ok: true, postId: 1 }, 49_990)).toBeNull();
    expect(markNotice({ ok: true, postId: 1, currentPrice: 49_990 }, 49_990)).toBeNull();
    expect(markNotice({ ok: true, postId: 1, currentPrice: 45_990 }, 49_990)).toContain('otro precio');
    expect(markNotice(null, 1)).toBeNull();
  });
});

describe('La revisión en vivo (live-checks)', () => {
  function target(i: number): CheckTarget {
    return { productId: `p${i}`, shown: { price: 1000 + i, listPrice: null, freeShipping: false, full: false } };
  }

  function checker(check: (items: CheckTarget[]) => Promise<Record<string, LiveCheck>>) {
    let now = T0;
    const timers: { run: () => void; ms: number }[] = [];
    const published: Record<string, CardCheck>[] = [];
    const c = createLiveChecker({
      check: vi.fn(check),
      now: () => now,
      later: (run, ms) => {
        timers.push({ run, ms });
      },
      publish: (state) => {
        published.push(state);
      },
    });
    return { c, timers, published, advance: (ms: number) => (now += ms), last: () => published[published.length - 1] };
  }

  it('pide en tandas de 16, de a una y en orden; lo que no vuelve queda como "no pude revisar"', async () => {
    const calls: string[][] = [];
    const t = checker(async (items) => {
      calls.push(items.map((i) => i.productId));
      const out: Record<string, LiveCheck> = {};
      for (const i of items) if (i.productId !== 'p3') out[i.productId] = { status: 'same', checkedAt: new Date(T0).toISOString() };
      return out;
    });
    const targets = Array.from({ length: 20 }, (_, i) => target(i));
    const running = t.c.run(targets);
    // Lo primero que se publica: todo "revisando".
    expect(t.published[0].p0).toEqual({ last: null, pending: true });
    expect(t.c.running()).toBe(true);
    await running;
    expect(calls.map((c) => c.length)).toEqual([16, 4]);
    expect(calls[0][0]).toBe('p0');
    expect(t.c.get('p0')?.last?.result.status).toBe('same');
    expect(t.c.get('p3')?.last?.result).toEqual({ status: 'unknown', what: NOT_CHECKED });
    expect(t.c.get('p19')?.pending).toBe(false);
    expect(t.c.running()).toBe(false);
  });

  it('si la llamada falla, esa tanda queda como "no pude revisar", nunca como "mismo precio"', async () => {
    const t = checker(async () => {
      throw new Error('sin conexión');
    });
    await t.c.run([target(1)]);
    expect(t.c.get('p1')?.last?.result).toEqual({ status: 'unknown', what: NOT_CHECKED });
  });

  it('si el servidor no contesta a tiempo, se corta', async () => {
    const t = checker(() => new Promise(() => {}));
    const running = t.c.run([target(1)]);
    expect(t.timers[0].ms).toBe(CHECK_TIMEOUT_MS);
    t.timers[0].run();
    await running;
    expect(t.c.get('p1')?.last?.result.status).toBe('unknown');
    expect(t.c.running()).toBe(false);
  });

  it('con una revisión viajando no se pide otra; un "cambió" se conserva mientras se revisa de nuevo', async () => {
    let answer: Record<string, LiveCheck> = {
      p1: {
        status: 'changed',
        checkedAt: '',
        price: 900,
        listPrice: null,
        freeShipping: false,
        full: false,
        saved: false,
        what: 'El precio cambió de $1.001 a $900.',
      },
    };
    let release: () => void = () => {};
    const t = checker(
      () =>
        new Promise((resolve) => {
          release = () => resolve(answer);
        })
    );
    const first = t.c.run([target(1)]);
    void t.c.run([target(1)]);
    release();
    await first;
    expect(t.c.get('p1')?.last?.result.status).toBe('changed');

    answer = { p1: { status: 'same', checkedAt: '' } };
    const second = t.c.run([target(1)]);
    expect(t.c.get('p1')).toEqual({ last: expect.objectContaining({ result: expect.objectContaining({ status: 'changed' }) }), pending: true });
    release();
    await second;
    expect(t.c.get('p1')?.last?.result.status).toBe('same');
  });

  it('al volver a la pestaña revisa solo si la última revisión tiene más de 5 minutos; sola, cada 12', async () => {
    const check = vi.fn(async () => ({}));
    const t = checker(check);
    await t.c.run([target(1)]);
    expect(check).toHaveBeenCalledTimes(1);

    t.advance(4 * MINUTE);
    t.c.visible([target(1)]);
    expect(check).toHaveBeenCalledTimes(1);
    t.advance(2 * MINUTE);
    t.c.visible([target(1)]);
    await settle();
    expect(check).toHaveBeenCalledTimes(2);

    t.advance(AUTO_RECHECK_MS - MINUTE);
    t.c.tick([target(1)]);
    expect(check).toHaveBeenCalledTimes(2);
    t.advance(2 * MINUTE);
    t.c.tick([target(1)]);
    await settle();
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('readResult solo acepta la forma acordada', () => {
    expect(readResult({ status: 'same', checkedAt: 'x' })).toEqual({ status: 'same', checkedAt: 'x' });
    expect(readResult({ status: 'raro' })).toEqual({ status: 'unknown', what: NOT_CHECKED });
    expect(readResult({ status: 'changed', what: 'x' })).toEqual({ status: 'unknown', what: NOT_CHECKED });
    expect(readResult({ status: 'unavailable' })).toEqual({ status: 'unknown', what: NOT_CHECKED });
    expect(readResult(undefined)).toEqual({ status: 'unknown', what: NOT_CHECKED });
  });
});
