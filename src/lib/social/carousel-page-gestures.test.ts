import { describe, expect, it, vi } from 'vitest';

/**
 * Lo que pasa al tocar un botón de /admin/historias/carrusel, sin navegador:
 * las reglas (app/admin/historias/carrusel/rules y gestures) reciben dobles de
 * la hoja de compartir, el portapapeles, el reloj, las descargas, las
 * acciones del servidor y la revisión en vivo que ya está en memoria.
 */

import {
  MARKED_BUT_CHANGED_ALL,
  MISSING_FILES,
  SHARE_ERROR_ALL,
  createCarouselGestures,
  slidesOf,
  type CarouselActions,
  type CarouselEnv,
  type CarouselParts,
} from '@/app/admin/historias/carrusel/gestures';
import { carouselCover, carouselGate, carouselLine, carouselTargets, relevantCheck } from '@/app/admin/historias/carrusel/rules';
import { COPY_ERROR, type Note } from '@/app/admin/historias/gestures';
import { CHECKING_WAIT, OLD_LIST, type CardCheck } from '@/app/admin/historias/rules';
import type { CarouselEntry } from '@/lib/social/carousel';
import type { LiveCheck } from '@/lib/social/live-price';

const T0 = new Date('2026-10-18T21:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function entry(rank: number, over: Partial<CarouselEntry> = {}): CarouselEntry {
  const id = `00000000-0000-4000-8000-00000000000${rank}`;
  return {
    id,
    rank,
    slug: `producto-${rank}`,
    name: `Producto ${rank}`,
    brand: 'Marca',
    price: 100_000 * rank,
    listPrice: null,
    dropAmount: 10_000 * rank,
    dropPct: 10,
    since: new Date(T0 - 2 * 86_400_000).toISOString(),
    checkedAt: new Date(T0 - 20 * MINUTE).toISOString(),
    freeShipping: true,
    full: false,
    image: `/social/carrusel/ids/${rank}-bajas-x.jpg`,
    fileName: `comparatech-top3-2026-10-18-${rank}-producto-${rank}.jpg`,
    mlUrl: `https://www.mercadolibre.cl/p/MLC${rank}`,
    ...over,
  };
}

function parts(entries = [entry(1), entry(2), entry(3)]): CarouselParts {
  return {
    cover: { image: '/social/carrusel/ids/portada-bajas-x.jpg', fileName: 'comparatech-top3-2026-10-18-0-portada.jpg' },
    entries,
    closing: { image: '/social/carrusel/ids/cierre-bajas-x.jpg', fileName: 'comparatech-top3-2026-10-18-4-cierre.jpg' },
    captions: { instagram: 'texto de instagram', facebook: 'texto de facebook' },
  };
}

const check = (result: LiveCheck, at: number, pending = false): CardCheck => ({ last: { result, at }, pending });
const same = (at: number) => check({ status: 'same', checkedAt: new Date(at).toISOString() }, at);
const changedTo = (at: number, live: { price: number; listPrice?: number | null; freeShipping?: boolean; full?: boolean }) =>
  check(
    {
      status: 'changed',
      checkedAt: new Date(at).toISOString(),
      price: live.price,
      listPrice: live.listPrice ?? null,
      freeShipping: live.freeShipping ?? true,
      full: live.full ?? false,
      saved: true,
      what: 'El precio cambió.',
    },
    at
  );
const unknown = (at: number) => check({ status: 'unknown', what: 'La revisión en vivo funciona solo en el sitio publicado.' }, at);

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const named = (name: string) => Object.assign(new Error(name), { name });

/** Todo lo que las reglas tocan, con dobles, y lo que la pantalla recibió. */
function setup(opts: {
  checks?: Record<string, CardCheck>;
  files?: boolean;
  share?: () => Promise<void>;
  writeText?: () => Promise<void>;
  mark?: CarouselActions['mark'];
  undo?: CarouselActions['undo'];
  now?: number;
  carousel?: CarouselParts;
}) {
  const carousel = opts.carousel ?? parts();
  let now = opts.now ?? T0;
  const env = {
    share: vi.fn<(data: { files: File[] }) => Promise<void>>(opts.share ?? (async () => {})),
    writeText: vi.fn<(text: string) => Promise<void>>(opts.writeText ?? (async () => {})),
    now: () => now,
    later: vi.fn((run: () => void) => run()),
    download: vi.fn<(url: string, fileName: string) => void>(),
  } satisfies CarouselEnv;
  const actions = {
    mark: vi.fn(opts.mark ?? (async () => ({ ok: true as const, postIds: [7, 8, 9], postedAt: new Date(T0).toISOString() }))),
    undo: vi.fn(opts.undo ?? (async () => ({ ok: true as const }))),
  };
  const shown = { note: null as Note | null, copied: [] as (string | null)[], busy: [] as boolean[], published: [] as unknown[] };
  const jobs: Promise<void>[] = [];
  const ui = {
    note: (note: Note | null) => {
      shown.note = note;
    },
    copied: (network: string | null) => shown.copied.push(network),
    busy: (on: boolean) => shown.busy.push(on),
    published: (mark: unknown) => shown.published.push(mark),
    run: (job: () => Promise<void>) => {
      jobs.push(job());
    },
  };
  const recheck = vi.fn();
  const files = new Map(slidesOf(carousel).map((slide) => [slide.image, new File(['x'], slide.fileName, { type: 'image/jpeg' })]));
  const gestures = createCarouselGestures(env, actions, ui, {
    openedAt: T0 - 5 * MINUTE,
    maxPriceAgeMs: 6 * HOUR,
    checkOf: (id) => (opts.checks ?? {})[id],
    recheck,
    fileOf: (image) => (opts.files === false ? undefined : files.get(image)),
  }, carousel);
  return { env, actions, shown, jobs, recheck, gestures, carousel, files, setNow: (t: number) => (now = t) };
}

const allSame = (entries: CarouselEntry[], at = T0 - MINUTE) => Object.fromEntries(entries.map((e) => [e.id, same(at)]));

describe('carouselGate: el carrusel sale entero', () => {
  const entries = [entry(1), entry(2), entry(3)];
  const ctx = { now: T0, openedAt: T0 - 5 * MINUTE, maxPriceAgeMs: 6 * HOUR };

  it('con todos en "mismo precio" de hace poco, se deja', () => {
    const checks = allSame(entries);
    expect(carouselGate(entries, (id) => checks[id], ctx)).toEqual({ ok: true, caution: null });
  });

  it('si uno cambió de precio en Mercado Libre, no se sube ninguno y se dice cuál', () => {
    const checks = { ...allSame(entries), [entries[1].id]: changedTo(T0 - MINUTE, { price: 210_000 }) };
    const gate = carouselGate(entries, (id) => checks[id], ctx);
    expect(gate).toMatchObject({ ok: false, kind: 'changed', rank: 2, recheck: false });
    expect(!gate.ok && gate.message).toBe('El #2 (Producto 2): El precio cambió. No lo subas: toca Actualizar. El sitio ya tiene el precio nuevo.');
    expect(carouselCover(gate)).toBe('El #2 cambió en Mercado Libre: no lo guardes ni lo subas.');
  });

  it('un cambio solo en el precio sin descuento no cuenta: la lámina no lo dibuja', () => {
    const changedList = changedTo(T0 - MINUTE, { price: 200_000, listPrice: 260_000 });
    const checks = { ...allSame(entries), [entries[1].id]: changedList };
    expect(carouselGate(entries, (id) => checks[id], ctx)).toEqual({ ok: true, caution: null });
    expect(relevantCheck(changedList, entries[1])?.last?.result.status).toBe('same');
    // Si cambia el envío, sí.
    const noShipping = changedTo(T0 - MINUTE, { price: 200_000, freeShipping: false });
    expect(relevantCheck(noShipping, entries[1])).toBe(noShipping);
  });

  it('mientras alguno se revisa, se espera; lo que cambió manda sobre lo que hay que esperar', () => {
    const waiting = { ...allSame(entries), [entries[0].id]: { last: null, pending: true } };
    expect(carouselGate(entries, (id) => waiting[id], ctx)).toMatchObject({ ok: false, kind: 'checking', message: CHECKING_WAIT });
    const both = { ...waiting, [entries[2].id]: changedTo(T0 - MINUTE, { price: 1 }) };
    expect(carouselGate(entries, (id) => both[id], ctx)).toMatchObject({ ok: false, kind: 'changed', rank: 3 });
  });

  it('si no se pudo revisar en vivo, valen las reglas de antes, con el aviso ámbar', () => {
    const offline = Object.fromEntries(entries.map((e) => [e.id, unknown(T0 - MINUTE)]));
    const gate = carouselGate(entries, (id) => offline[id], ctx);
    expect(gate.ok && gate.caution).toMatch(/^No pude revisar en Mercado Libre/);
    // Con la página abierta hace más de una hora, ya no.
    expect(carouselGate(entries, (id) => offline[id], { ...ctx, openedAt: T0 - 61 * MINUTE })).toMatchObject({
      ok: false,
      kind: 'old-list',
      message: OLD_LIST,
    });
    // Y con un precio revisado hace más de 6 horas, tampoco, diciendo cuál.
    const old = [entry(1), entry(2, { checkedAt: new Date(T0 - 7 * HOUR).toISOString() })];
    const gate2 = carouselGate(old, (id) => offline[id], ctx);
    expect(gate2).toMatchObject({ ok: false, kind: 'old-price', rank: 2 });
    expect(!gate2.ok && gate2.message).toBe('El precio del #2 se revisó hace más de 6 horas. Toca Actualizar, arriba.');
  });

  it('la línea de cada producto dice "no lo subas" (el carrusel) cuando cambió', () => {
    const line = carouselLine(changedTo(T0 - MINUTE, { price: 1 }), T0, true);
    expect(line.tone).toBe('bad');
    expect(line.text).toBe('✗ El precio cambió. No lo subas: toca Actualizar. El sitio ya tiene el precio nuevo.');
    expect(carouselLine(same(T0 - MINUTE), T0, true).text).toBe('✓ Mismo precio que en Mercado Libre (hace 1 min)');
  });

  it('se revisa lo que la lámina dibuja: precio, envío y Full, y el precio sin descuento de hoy', () => {
    const e = entry(1, { listPrice: 150_000 });
    expect(carouselTargets([e])).toEqual([{ productId: e.id, shown: { price: 100_000, listPrice: 150_000, freeShipping: true, full: false } }]);
  });
});

describe('Compartir', () => {
  it('manda las láminas en orden (portada, productos, cierre) y deja copiado el texto de Instagram, en el mismo toque', () => {
    const s = setup({ checks: allSame(parts().entries) });
    s.gestures.share();
    expect(s.env.share).toHaveBeenCalledTimes(1);
    const files = s.env.share.mock.calls[0][0].files.map((f) => f.name);
    expect(files).toEqual(slidesOf(s.carousel).map((slide) => slide.fileName));
    expect(s.env.writeText).toHaveBeenCalledWith('texto de instagram');
  });

  it('con un producto que cambió no abre Compartir y dice cuál', () => {
    const entries = parts().entries;
    const s = setup({ checks: { ...allSame(entries), [entries[0].id]: changedTo(T0 - MINUTE, { price: 5 }) } });
    s.gestures.share();
    expect(s.env.share).not.toHaveBeenCalled();
    expect(s.shown.note).toEqual({ tone: 'error', text: expect.stringMatching(/^El #1 \(Producto 1\): /) });
  });

  it('sin todas las imágenes en memoria no abre Compartir', () => {
    const s = setup({ checks: allSame(parts().entries), files: false });
    s.gestures.share();
    expect(s.env.share).not.toHaveBeenCalled();
    expect(s.shown.note).toEqual({ tone: 'error', text: MISSING_FILES });
  });

  it('un doble toque no pide Compartir dos veces', () => {
    const s = setup({ checks: allSame(parts().entries) });
    s.gestures.share();
    s.gestures.share();
    expect(s.env.share).toHaveBeenCalledTimes(1);
  });

  it('cerrar la hoja no es un error; si falla de verdad, lo dice', async () => {
    const closed = setup({ checks: allSame(parts().entries), share: () => Promise.reject(named('AbortError')) });
    closed.gestures.share();
    await settle();
    expect(closed.shown.note).toBeNull();
    const failed = setup({ checks: allSame(parts().entries), share: () => Promise.reject(named('NotAllowedError')) });
    failed.gestures.share();
    await settle();
    expect(failed.shown.note).toEqual({ tone: 'error', text: SHARE_ERROR_ALL });
  });

  it('si la revisión vence, pide otra sin esperarla', () => {
    const s = setup({ checks: allSame(parts().entries, T0 - 16 * MINUTE) });
    s.gestures.share();
    expect(s.env.share).not.toHaveBeenCalled();
    expect(s.recheck).toHaveBeenCalledTimes(1);
  });
});

describe('Copiar texto y Guardar', () => {
  it('copia el texto de cada red', async () => {
    const s = setup({});
    await s.gestures.copy('facebook');
    expect(s.env.writeText).toHaveBeenCalledWith('texto de facebook');
    expect(s.shown.copied).toEqual(['facebook', null]);
  });

  it('si el teléfono no deja copiar, dice cómo hacerlo a mano', async () => {
    const s = setup({ writeText: () => Promise.reject(new Error('no')) });
    await s.gestures.copy('instagram');
    expect(s.shown.note).toEqual({ tone: 'error', text: COPY_ERROR });
  });

  it('Guardar las imágenes baja las láminas en orden, solo si se puede subir', () => {
    const ok = setup({ checks: allSame(parts().entries) });
    ok.gestures.saveAll();
    expect(ok.env.download.mock.calls.map(([, name]) => name)).toEqual(slidesOf(ok.carousel).map((slide) => slide.fileName));
    expect(ok.gestures.save()).toBe(true);

    const entries = parts().entries;
    const blocked = setup({ checks: { ...allSame(entries), [entries[2].id]: changedTo(T0 - MINUTE, { price: 3 }) } });
    blocked.gestures.saveAll();
    expect(blocked.env.download).not.toHaveBeenCalled();
    expect(blocked.gestures.save()).toBe(false);
  });
});

describe('Ya lo publiqué y Deshacer', () => {
  it('marca con el precio de cada lámina y queda publicado', async () => {
    const s = setup({ checks: allSame(parts().entries) });
    s.gestures.mark();
    await Promise.all(s.jobs);
    expect(s.actions.mark).toHaveBeenCalledWith([
      { productId: s.carousel.entries[0].id, price: 100_000 },
      { productId: s.carousel.entries[1].id, price: 200_000 },
      { productId: s.carousel.entries[2].id, price: 300_000 },
    ]);
    expect(s.shown.published).toEqual([{ postIds: [7, 8, 9], postedAt: new Date(T0).toISOString() }]);
    expect(s.shown.busy).toEqual([true, false]);
    expect(s.shown.note).toBeNull();
  });

  it('el aviso del servidor se muestra; si en vivo cambió algo, también se avisa', async () => {
    const withWarning = setup({
      checks: allSame(parts().entries),
      mark: async () => ({ ok: true, postIds: [1], postedAt: new Date(T0).toISOString(), warning: 'Quedó marcado, pero…' }),
    });
    withWarning.gestures.mark();
    await Promise.all(withWarning.jobs);
    expect(withWarning.shown.note).toEqual({ tone: 'warn', text: 'Quedó marcado, pero…' });

    const entries = parts().entries;
    const changed = setup({ checks: { ...allSame(entries), [entries[0].id]: changedTo(T0 - MINUTE, { price: 9 }) } });
    changed.gestures.mark();
    await Promise.all(changed.jobs);
    expect(changed.shown.note).toEqual({ tone: 'warn', text: MARKED_BUT_CHANGED_ALL });
  });

  it('un segundo toque mientras se guarda no marca dos veces', async () => {
    const s = setup({});
    s.gestures.mark();
    s.gestures.mark();
    await Promise.all(s.jobs);
    expect(s.actions.mark).toHaveBeenCalledTimes(1);
  });

  it('deshacer justo después de marcar no deshace (un doble toque); un rato después, sí', async () => {
    const s = setup({});
    s.gestures.mark();
    await Promise.all(s.jobs);
    const mark = { postIds: [7, 8, 9], postedAt: new Date(T0).toISOString() };
    s.gestures.undo(mark);
    expect(s.actions.undo).not.toHaveBeenCalled();
    s.setNow(T0 + 2_000);
    s.gestures.undo(mark);
    await Promise.all(s.jobs);
    expect(s.actions.undo).toHaveBeenCalledWith([7, 8, 9]);
    expect(s.shown.published).toEqual([mark, null]);
  });

  it('si el servidor no puede, lo dice y no cambia nada', async () => {
    const s = setup({ mark: async () => ({ ok: false, error: 'Un producto del carrusel ya no está en el sitio. Toca Actualizar.' }) });
    s.gestures.mark();
    await Promise.all(s.jobs);
    expect(s.shown.published).toEqual([]);
    expect(s.shown.note).toEqual({ tone: 'error', text: 'Un producto del carrusel ya no está en el sitio. Toca Actualizar.' });
  });
});
