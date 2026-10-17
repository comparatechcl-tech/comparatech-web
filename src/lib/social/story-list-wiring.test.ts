import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * StoryList por dentro, sin navegador ni React de verdad (como
 * video-page-list.test.ts para Videos): los hooks se reemplazan por unos de
 * mentira que guardan el estado entre una pasada y la siguiente, y los
 * efectos corren cuando cambian sus dependencias. Así se mira lo que el HTML
 * estático no muestra: cuándo se le pide la revisión en vivo al servidor y
 * con qué tarjetas.
 */

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  setters: [] as ((action: unknown) => void)[],
  index: 0,
  effects: [] as { run: () => unknown; deps: unknown[] | undefined }[],
}));

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>();
  function useState(init: unknown) {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = typeof init === 'function' ? (init as () => unknown)() : init;
    if (!hooks.setters[i]) {
      hooks.setters[i] = (action: unknown) => {
        hooks.slots[i] = typeof action === 'function' ? (action as (prev: unknown) => unknown)(hooks.slots[i]) : action;
      };
    }
    return [hooks.slots[i], hooks.setters[i]];
  }
  function useRef(init: unknown) {
    const i = hooks.index++;
    if (!(i in hooks.slots)) hooks.slots[i] = { current: init };
    return hooks.slots[i];
  }
  function useEffect(run: () => unknown, deps?: unknown[]) {
    hooks.effects.push({ run, deps });
  }
  const startTransition = (job: () => unknown) => {
    job();
  };
  return { ...real, useState, useRef, useEffect, useTransition: () => [false, startTransition] };
});

// Las acciones escriben en la base y la revisión en vivo pregunta a Mercado Libre: acá son dobles.
vi.mock('@/app/admin/historias/actions', () => ({ markStoryPublished: vi.fn(), undoStoryPublished: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/app/admin/live-price-actions', () => ({ checkLivePrices: vi.fn(async () => ({})) }));

import { checkLivePrices } from '@/app/admin/live-price-actions';
import { StoryCard, StoryList, type StoryCardProps } from '@/app/admin/historias/StoryList';
import type { PostedStory, StoryItem } from '@/lib/social/stories';

const T0 = new Date('2026-10-17T15:00:00Z').getTime();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let seq = 0;
function story(over: Partial<StoryItem> = {}): StoryItem {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `producto-${seq}`,
    name: `Parlante ${seq}`,
    brand: 'JBL',
    price: 49_990,
    listPrice: 99_990,
    discount: 50,
    drop: null,
    checkedAt: new Date(T0 - 20 * MINUTE).toISOString(),
    again: null,
    reason: 'Parlante JBL',
    warning: null,
    points: 60,
    image: `/social/pieza/${id}/story-${seq}.jpg`,
    link: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    fileName: `f-${seq}.jpg`,
    mlUrl: `https://www.mercadolibre.cl/p/MLC${seq}`,
    freeShipping: true,
    full: false,
    ...over,
  };
}

function posted(over: Partial<PostedStory> = {}): PostedStory {
  return { ...story(), postId: 900 + seq, postedAt: new Date(T0 - 2 * HOUR).toISOString(), postedPrice: 49_990, onSale: true, ...over };
}

interface El {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}
function elements(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) for (const child of node) elements(child, out);
  else if (typeof node === 'object' && node !== null && 'props' in node) {
    out.push(node as El);
    elements((node as El).props.children, out);
  }
  return out;
}
/** Lo que se lee en un elemento ya armado (sin entrar en los componentes). */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && node !== null && 'props' in node) return textOf((node as El).props.children);
  return '';
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** El navegador de mentira: la pestaña (con sus escuchadores), la hoja de compartir y las descargas de las imágenes. */
function phone() {
  const listeners = new Set<() => void>();
  const document = {
    visibilityState: 'visible',
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  };
  const shared: { data: { files: File[] }; self: unknown }[] = [];
  const copied: string[] = [];
  const navigator = {
    canShare: () => true,
    share(this: unknown, data: { files: File[] }) {
      shared.push({ data, self: this });
      return Promise.resolve();
    },
    clipboard: {
      writeText: async (text: string) => {
        copied.push(text);
      },
    },
  };
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
  vi.stubGlobal('navigator', navigator);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['jpg']) })));
  return {
    navigator,
    shared,
    copied,
    listeners,
    /** La pestaña vuelve a verse. */
    show: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

type ListProps = Parameters<typeof StoryList>[0];

/** Las pasadas de la lista, como las haría React: los efectos corren al montar y cuando cambian sus dependencias. */
function mounted(props: ListProps) {
  let lastDeps: (unknown[] | undefined)[] = [];
  const cleanups: (() => void)[] = [];
  function pass() {
    hooks.index = 0;
    hooks.effects = [];
    const tree = StoryList(props);
    hooks.effects.forEach((effect, i) => {
      const before = lastDeps[i];
      const changed =
        before === undefined || effect.deps === undefined || effect.deps.some((dep, j) => !Object.is(dep, before[j]));
      if (changed) {
        const cleanup = effect.run();
        if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
      }
      lastDeps[i] = effect.deps;
    });
    const cards = elements(tree)
      .filter((el) => el.type === StoryCard)
      .map((el) => el.props as unknown as StoryCardProps);
    return { tree, cards };
  }
  const first = pass();
  return {
    first,
    pass,
    unmount: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
      lastDeps = [];
    },
  };
}

/** Los productos de cada llamada a la revisión en vivo. */
const asked = () => vi.mocked(checkLivePrices).mock.calls.map(([items]) => items.map((item) => item.productId));

beforeEach(() => {
  hooks.slots = [];
  hooks.setters = [];
  hooks.effects = [];
  vi.mocked(checkLivePrices).mockClear();
  vi.mocked(checkLivePrices).mockImplementation(async () => ({}));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('StoryList: la revisión en vivo', () => {
  it('al montar pide revisar las ofertas y las ya subidas que siguen vivas y a la venta, con lo que muestra cada una', async () => {
    phone();
    const offer = story({ price: 29_990, listPrice: null, discount: 0, freeShipping: false, full: true });
    const alive = posted();
    const gone = posted({ onSale: false });
    const expired = posted({ postedAt: new Date(T0 - 25 * HOUR).toISOString() });
    const list = mounted({ items: [offer], posted: [alive, gone, expired], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });

    expect(vi.mocked(checkLivePrices).mock.calls).toEqual([
      [
        [
          { productId: offer.id, shown: { price: 29_990, listPrice: null, freeShipping: false, full: true } },
          { productId: alive.id, shown: { price: 49_990, listPrice: 99_990, freeShipping: true, full: false } },
        ],
      ],
    ]);
    // Mientras viaja, cada tarjeta lo sabe.
    expect(list.pass().cards.find((card) => card.item.id === offer.id)?.check).toEqual({ last: null, pending: true });
    await settle();
    expect(list.pass().cards.find((card) => card.item.id === offer.id)?.check?.pending).toBe(false);
    list.unmount();
  });

  it('una historia que se deshizo deja de revisarse: la revisión usa las ya subidas de ahora, no las de la carga', async () => {
    phone();
    const offer = story();
    const a = posted();
    const b = posted();
    const list = mounted({ items: [offer], posted: [a, b], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });
    await settle();
    expect(asked()).toEqual([[offer.id, a.id, b.id]]);

    // "No la publiqué: deshacer" en la primera.
    const { cards } = list.pass();
    cards[0].gestures.undoPosted(`publicada-${a.postId}`, a.postId);
    await settle();
    const after = list.pass();
    expect(after.cards.map((card) => card.item.id)).toEqual([offer.id, b.id]);

    // "Revisar otra vez", arriba.
    const again = elements(after.tree).find((el) => el.type === 'button' && textOf(el).includes('Revisar otra vez'));
    expect(again).toBeDefined();
    (again?.props.onClick as () => void)();
    expect(asked()[1]).toEqual([offer.id, b.id]);
    list.unmount();
  });

  it('al volver a la pestaña revisa solo si la última revisión tiene más de 5 minutos', async () => {
    const p = phone();
    const list = mounted({ items: [story()], posted: [], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });
    await settle();
    expect(checkLivePrices).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 4 * MINUTE);
    p.show();
    await settle();
    expect(checkLivePrices).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 6 * MINUTE);
    p.show();
    await settle();
    expect(checkLivePrices).toHaveBeenCalledTimes(2);

    // Escondida no revisa.
    vi.setSystemTime(T0 + 20 * MINUTE);
    (document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    p.show();
    await settle();
    expect(checkLivePrices).toHaveBeenCalledTimes(2);
    list.unmount();
    expect(p.listeners.size).toBe(0);
  });

  it('volver a dibujar la lista no vuelve a preguntar: la revisión no corre por cada pasada', async () => {
    phone();
    const list = mounted({ items: [story(), story()], posted: [], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });
    await settle();
    for (let i = 0; i < 5; i++) list.pass();
    await settle();
    expect(checkLivePrices).toHaveBeenCalledTimes(1);
    list.unmount();
  });

  it('con la imagen lista y "mismo precio", Compartir llega a navigator.share en el mismo toque, con esa imagen', async () => {
    const p = phone();
    const item = story();
    vi.mocked(checkLivePrices).mockImplementationOnce(async () => ({ [item.id]: { status: 'same', checkedAt: new Date(T0).toISOString() } }));
    const list = mounted({ items: [item], posted: [], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });
    // La imagen se baja sola al montar; la revisión llega del servidor.
    await settle();
    await settle();
    const card = list.pass().cards[0];
    expect(card.fileState).toBe('lista');
    expect(card.canShare).toBe(true);

    card.gestures.share(card.cardKey, card.item);
    // Sin esperar nada: dentro del mismo toque, como método del navigator.
    expect(p.shared).toHaveLength(1);
    expect(p.shared[0].self).toBe(p.navigator);
    expect(p.shared[0].data.files.map((file) => [file.name, file.type])).toEqual([[item.fileName, 'image/jpeg']]);
    // Y el link quedó copiado para el sticker.
    await settle();
    expect(p.copied).toEqual([item.link]);
    expect(checkLivePrices).toHaveBeenCalledTimes(1);
    list.unmount();
  });

  it('con un cambio, Compartir no llega a navigator.share', async () => {
    const p = phone();
    const item = story();
    vi.mocked(checkLivePrices).mockImplementationOnce(async () => ({
      [item.id]: {
        status: 'changed',
        checkedAt: new Date(T0).toISOString(),
        price: 45_990,
        listPrice: 99_990,
        freeShipping: true,
        full: false,
        saved: false,
        what: 'El precio cambió de $49.990 a $45.990.',
      },
    }));
    const list = mounted({ items: [item], posted: [], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });
    await settle();
    await settle();
    const card = list.pass().cards[0];
    card.gestures.share(card.cardKey, card.item);
    expect(p.shared).toHaveLength(0);
    expect(p.copied).toEqual([]);
    expect(list.pass().cards[0].note).toEqual({ tone: 'error', text: 'El precio cambió de $49.990 a $45.990. No la subas: toca Actualizar.' });
    list.unmount();
  });

  it('la respuesta del servidor llega a la tarjeta de su producto', async () => {
    phone();
    const [a, b] = [story(), story()];
    vi.mocked(checkLivePrices).mockImplementationOnce(async () => ({
      [a.id]: { status: 'same', checkedAt: new Date(T0).toISOString() },
      [b.id]: {
        status: 'changed',
        checkedAt: new Date(T0).toISOString(),
        price: 45_990,
        listPrice: 99_990,
        freeShipping: true,
        full: false,
        saved: true,
        what: 'El precio cambió de $49.990 a $45.990.',
      },
    }));
    const list = mounted({ items: [a, b], posted: [], maxPriceAgeMs: 6 * HOUR, renderedAt: T0 });
    await settle();
    const byId = new Map(list.pass().cards.map((card) => [card.item.id, card]));
    expect(byId.get(a.id)?.check?.last?.result.status).toBe('same');
    expect(byId.get(b.id)?.check?.last?.result).toMatchObject({ status: 'changed', price: 45_990 });
    list.unmount();
  });
});
