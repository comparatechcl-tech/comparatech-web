import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * VideoList por dentro, sin navegador ni React de verdad: los hooks se
 * reemplazan por unos de mentira que guardan el estado entre una "pasada" y
 * la siguiente y anotan los efectos, y la lista se llama como una función.
 *
 * Así se mira el cableado que el HTML estático no muestra: que la lista le
 * entregue a las reglas el navegador de verdad, la visita de esta carga y sus
 * propios setState; que lo que las reglas piden llegue a la tarjeta; y que al
 * salir de la pantalla se suelten los videos bajados.
 */

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  setters: [] as ((action: unknown) => void)[],
  index: 0,
  effects: [] as { run: () => unknown; deps: unknown[] | undefined }[],
  transitions: 0,
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
  function useEffect(run: () => unknown, deps?: unknown[]) {
    hooks.effects.push({ run, deps });
  }
  function startTransition(job: () => unknown) {
    hooks.transitions++;
    job();
  }
  return { ...real, useState, useEffect, useTransition: () => [false, startTransition] };
});

/** Cada vez que la lista arma sus reglas: con qué las armó y lo que devolvió, con attach y detach anotados. */
const made = vi.hoisted(() => [] as { args: unknown[]; gestures: { attach: () => void; detach: () => void } }[]);

vi.mock('@/app/admin/videos/gestures', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/app/admin/videos/gestures')>();
  return {
    ...real,
    createVideoGestures: (...args: Parameters<typeof real.createVideoGestures>) => {
      const built = real.createVideoGestures(...args);
      const gestures = { ...built, attach: vi.fn(built.attach), detach: vi.fn(built.detach) };
      made.push({ args, gestures });
      return gestures;
    },
  };
});

// Las acciones escriben en la base: acá solo importa que la lista se las entregue a las reglas.
vi.mock('@/app/admin/videos/actions', () => ({ markVideoPosted: vi.fn(), undoVideoPosted: vi.fn() }));

import { markVideoPosted, undoVideoPosted } from '@/app/admin/videos/actions';
import type { GestureActions, GestureConfig, GestureEnv, GestureUi, Mark, Note } from '@/app/admin/videos/gestures';
import { VideoCard, VideoList, visitFor, type VideoCardProps } from '@/app/admin/videos/VideoList';
import type { ReadyVideo } from '@/lib/social/videos';

const T0 = new Date('2026-10-13T15:00:00Z').getTime();
const HOUR = 3_600_000;
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
    checkedAt: new Date(T0 - 20 * 60_000).toISOString(),
    template: 'estudio',
    videoUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.mp4`,
    coverUrl: `${STORAGE}/2026-10-13/${id}-49990-estudio-0a1b2c3d.jpg`,
    fileName: `comparatech-producto-${seq}-reel.mp4`,
    renderedAt: '2026-10-13T11:05:00.000Z',
    points: 62.5,
    reason: 'Parlante JBL, 50% por debajo del precio de lista',
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

const mark = (postId: number): Mark => ({ postId, at: '2026-10-13T12:00:00.000Z' });

/** Un navegador de mentira, puesto en globalThis como lo vería la página en el teléfono. */
function phone({ canShare = true, touch = true } = {}) {
  const log = {
    share: [] as { data: unknown; self: unknown }[],
    clicks: [] as { href: string; download: string }[],
    media: [] as string[],
  };
  const navigator = {
    canShare: () => canShare,
    share(this: unknown, data: unknown) {
      log.share.push({ data, self: this });
      return Promise.resolve();
    },
    clipboard: { writeText: async () => {} },
  };
  const document = {
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        click: () => log.clicks.push({ href: anchor.href, download: anchor.download }),
        remove: () => {},
      };
      return anchor;
    },
    body: { appendChild: () => {} },
  };
  vi.stubGlobal('navigator', navigator);
  vi.stubGlobal('document', document);
  // Con window, visitFor guarda la visita: es lo que pasa en el teléfono.
  vi.stubGlobal('window', {
    matchMedia: (query: string) => {
      log.media.push(query);
      return { matches: touch };
    },
  });
  return { log, navigator };
}

/** Un elemento de React ya armado, sin dibujar. */
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

type ListProps = Parameters<typeof VideoList>[0];

/** Una pasada de la lista, como la haría React: los hooks en orden, con el estado de la pasada anterior. */
function pass(props: ListProps) {
  hooks.index = 0;
  hooks.effects = [];
  const tree = VideoList(props);
  const cards = elements(tree)
    .filter((el) => el.type === VideoCard)
    .map((el) => el.props as unknown as VideoCardProps);
  const status = elements(tree).find((el) => el.type === 'p' && el.props.role === 'status');
  return { tree, cards, announced: status?.props.children, effects: hooks.effects };
}

/** Monta la lista: la primera pasada y sus efectos. Devuelve lo que React correría al desmontarla. */
function mount(props: ListProps) {
  const first = pass(props);
  const cleanups = first.effects.map((effect) => effect.run()).filter((out): out is () => void => typeof out === 'function');
  return { first, unmount: () => cleanups.forEach((cleanup) => cleanup()) };
}

function wiring() {
  expect(made).toHaveLength(1);
  const [env, actions, ui, config] = made[0].args as [GestureEnv, GestureActions, GestureUi, GestureConfig];
  return { env, actions, ui, config, gestures: made[0].gestures };
}

let renderedAt = T0;

beforeEach(() => {
  hooks.slots = [];
  hooks.setters = [];
  hooks.effects = [];
  hooks.transitions = 0;
  made.length = 0;
  // Cada test con su propia carga: las visitas se guardan por carga, fuera del componente.
  renderedAt += 1000;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VideoList arma las reglas con lo de verdad', () => {
  it('una sola vez por lista, con el plazo del precio y la edad contada desde la visita, no desde que se armaron', () => {
    phone();
    // La visita de esta carga empezó hace 50 minutos: se volvió a la lista con "atrás".
    const visit = visitFor(renderedAt, T0 - 50 * 60_000, true);
    const props = { videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt };
    pass(props);
    pass(props);
    pass(props);
    const { config } = wiring();
    expect(config).toEqual({ maxPriceAgeMs: 6 * HOUR, openedAt: T0 - 50 * 60_000 });
    expect(config.openedAt).toBe(visit.openedAt);
  });

  it('les entrega las acciones del servidor', () => {
    phone();
    pass({ videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt });
    const { actions } = wiring();
    expect(actions.mark).toBe(markVideoPosted);
    expect(actions.undo).toBe(undoVideoPosted);
  });

  it('el navegador que reciben es el del teléfono: Compartir llega a navigator.share en la misma vuelta', () => {
    const p = phone();
    pass({ videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt });
    const { env } = wiring();
    const data = { files: [new File(['x'], 'reel.mp4', { type: 'video/mp4' })] };
    void env.share(data);
    expect(p.log.share).toEqual([{ data, self: p.navigator }]);
  });

  it('y Guardar dispara la descarga con el nombre del archivo', () => {
    const p = phone();
    pass({ videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt });
    wiring().env.download('blob:https://comparatech.cl/1', 'comparatech-parlante-reel.mp4');
    expect(p.log.clicks).toEqual([{ href: 'blob:https://comparatech.cl/1', download: 'comparatech-parlante-reel.mp4' }]);
  });
});

describe('VideoList: lo que piden las reglas llega a la pantalla', () => {
  it('cada pedido llega a la tarjeta que corresponde, y a ninguna otra', () => {
    phone();
    const [a, b] = [video(), video()];
    const props = { videos: [a, b], maxPriceAgeMs: 6 * HOUR, renderedAt };
    mount(props);
    const { ui } = wiring();
    const note: Note = { tone: 'error', text: 'No se pudo bajar el video.', openVideo: true };

    ui.note(a.id, note);
    ui.fileState(a.id, 'cargando');
    ui.saving(a.id, true);
    ui.copied(`${a.id}|link`, true);
    ui.busy(`${b.id}|tiktok`);
    ui.manual(a.id, { label: 'Instagram', text: a.texts.instagram });
    ui.announce(`Link copiado (${a.name})`);
    ui.posted(b.id, 'youtube', mark(31));

    const { cards, announced } = pass(props);
    const [cardA, cardB] = cards;
    expect(cardA.video.id).toBe(a.id);
    expect(cardB.video.id).toBe(b.id);

    expect(cardA.note).toEqual(note);
    expect(cardB.note).toBeUndefined();
    expect(cardA.fileState).toBe('cargando');
    expect(cardB.fileState).toBeUndefined();
    expect(cardA.saving).toBe(true);
    expect(cardB.saving).toBe(false);
    expect(cardA.manual).toEqual({ label: 'Instagram', text: a.texts.instagram });
    expect(cardB.manual).toBeUndefined();
    // El "Copiado" y la marca que viaja son de toda la lista: cada uno en su lugar, sin cruzarse.
    for (const card of cards) {
      expect(card.copied).toBe(`${a.id}|link`);
      expect(card.busy).toBe(`${b.id}|tiktok`);
    }
    expect(cardB.posted).toEqual({ youtube: mark(31) });
    expect(cardA.posted).toEqual({});
    expect(announced).toBe(`Link copiado (${a.name})`);

    // Y se apagan: el aviso se borra, Guardar vuelve, la marca deja de viajar, el copiado se apaga.
    ui.note(a.id, null);
    ui.saving(a.id, false);
    ui.busy(null);
    ui.copied(`${a.id}|link`, false);
    ui.manual(a.id, null);
    const after = pass(props).cards[0];
    expect(after.note).toBeUndefined();
    expect(after.saving).toBe(false);
    expect(after.busy).toBeNull();
    expect(after.copied).toBeNull();
    expect(after.manual).toBeUndefined();
  });

  it('lo marcado queda en la visita de esta carga: al volver con "atrás" la lista nueva lo trae', () => {
    phone();
    const item = video();
    const props = { videos: [item], maxPriceAgeMs: 6 * HOUR, renderedAt };
    mount(props);
    wiring().ui.posted(item.id, 'instagram', mark(40));
    expect(visitFor(renderedAt).changes.get(`${item.id}|instagram`)).toEqual(mark(40));

    // "Atrás": la misma carga monta la lista desde cero (estado nuevo), con los datos de entonces.
    hooks.slots = [];
    hooks.setters = [];
    made.length = 0;
    const back = pass(props);
    expect(back.cards[0].posted).toEqual({ instagram: mark(40) });
  });

  it('las llamadas al servidor corren dentro de una transición', () => {
    phone();
    mount({ videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt });
    const job = vi.fn(async () => {});
    wiring().ui.run(job);
    expect(hooks.transitions).toBe(1);
    expect(job).toHaveBeenCalledTimes(1);
  });
});

describe('VideoList al entrar y salir de la pantalla', () => {
  it('al salir suelta los videos bajados, y al volver a montarse (modo estricto) prende las reglas de nuevo', () => {
    phone();
    const { first, unmount } = mount({ videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt });
    const { gestures } = wiring();
    expect(gestures.attach).toHaveBeenCalledTimes(1);
    expect(gestures.detach).not.toHaveBeenCalled();
    // El efecto depende solo de las reglas, que son las mismas toda la vida de la lista: no se repite en cada pasada.
    expect(first.effects.some((effect) => effect.deps?.length === 1 && effect.deps[0] === gestures)).toBe(true);

    unmount();
    expect(gestures.detach).toHaveBeenCalledTimes(1);
    expect(gestures.attach).toHaveBeenCalledTimes(1);
  });

  it('Compartir aparece solo después de montar, y solo en un teléfono que comparte archivos', () => {
    const cases = [
      { canShare: true, touch: true, expected: true },
      { canShare: true, touch: false, expected: false },
      { canShare: false, touch: true, expected: false },
    ];
    for (const { canShare, touch, expected } of cases) {
      hooks.slots = [];
      hooks.setters = [];
      made.length = 0;
      const p = phone({ canShare, touch });
      const props = { videos: [video()], maxPriceAgeMs: 6 * HOUR, renderedAt };
      const { first } = mount(props);
      // En la primera pasada (la del servidor) todavía no se sabe.
      expect(first.cards[0].canShare).toBeNull();
      expect(pass(props).cards[0].canShare).toBe(expected);
      expect(p.log.media).toEqual(['(pointer: coarse)']);
      vi.unstubAllGlobals();
    }
  });
});
