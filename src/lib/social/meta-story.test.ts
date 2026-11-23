import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPiecePath, pieceKey, piecePath, type PieceSnapshot } from './piece-url';
import type { LiveCheck } from './live-price';
import type { StoryItem } from './stories';

/**
 * La historia automática de Instagram (lib/social/meta-story), con la base,
 * Meta y Mercado Libre de mentira. Lo que importa: a lo más una por día,
 * nunca si está en pausa o el dueño ya subió una, solo con el precio
 * confirmado, y sin reintentar si Meta no dijo si salió.
 */

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

const TOKEN = 'EAA' + 'P'.repeat(90);
const ENV = { CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv;
const KEY = pieceKey(ENV)!;
const ID_A = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0a';
const ID_B = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0b';
const ID_C = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c';

const store = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  posts: [] as Record<string, unknown>[],
  events: [] as unknown[],
  failSetting: null as string | null,
  failPosts: false,
}));

vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async (_a: unknown, e: unknown) => void store.events.push(e)) }));

function fakeAdmin() {
  return {
    from(table: string) {
      let key = '';
      const filters: Record<string, unknown> = {};
      let since = '';
      const rows = () =>
        store.posts.filter(
          (p) =>
            p.caption === filters.caption &&
            p.status === filters.status &&
            String(p.posted_at ?? '') >= since &&
            ['instagram', 'tiktok'].includes(String(p.channel))
        );
      const q = {
        select: () => q,
        eq: (column: string, value: string) => {
          if (column === 'key') key = value;
          filters[column] = value;
          return q;
        },
        in: () => q,
        gte: (_c: string, value: string) => {
          since = value;
          return q;
        },
        order: () => q,
        limit: async () => (store.failPosts ? { data: null, error: { message: 'sin base' } } : { data: rows(), error: null }),
        maybeSingle: async () => {
          if (store.failSetting === key) return { data: null, error: { message: 'sin base' } };
          return { data: key in store.settings ? { value: store.settings[key] } : null, error: null };
        },
        upsert: async (row: { key: string; value: unknown }) => {
          store.settings[row.key] = JSON.parse(JSON.stringify(row.value));
          return { error: null };
        },
        insert: async (row: Record<string, unknown>) => {
          if (table === 'social_posts') store.posts.push({ posted_at: new Date().toISOString(), ...row });
          return { error: null };
        },
      };
      return q;
    },
  } as never;
}

function item(id: string, over: Partial<StoryItem> = {}): StoryItem {
  return {
    id,
    slug: id,
    name: `Producto ${id.slice(-1)}`,
    brand: 'Marca',
    price: 100_000,
    listPrice: 125_000,
    discount: 20,
    drop: null,
    checkedAt: '2026-11-23T15:33:00.000Z',
    again: null,
    reason: 'Con 20% de descuento',
    warning: null,
    points: 60,
    image: `/social/pieza/${id}/story.jpg`,
    link: 'https://meli.la/x',
    fileName: `${id}.jpg`,
    mlUrl: null,
    freeShipping: true,
    full: false,
    ...over,
  };
}

type Call = { path: string; params: Record<string, string> };
function graph({
  publishThrows = false,
  containerFails = false,
  videoFails = false,
}: { publishThrows?: boolean; containerFails?: boolean; videoFails?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
    const path = url.pathname.replace('/v26.0/', '');
    calls.push({ path, params });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === '1784/media') {
      if (videoFails && params.video_url) return json({ error: { message: 'video no válido', code: 36001 } }, 400);
      return containerFails ? json({ error: { message: 'imagen no válida', code: 36001 } }, 400) : json({ id: 'cont1' });
    }
    if (path === 'cont1') return json({ status_code: 'FINISHED' });
    if (path === '1784/media_publish') {
      if (publishThrows) throw new TypeError('fetch failed');
      return json({ id: 'media9' });
    }
    if (path === 'media9') return json({ permalink: 'https://www.instagram.com/stories/comparatech.cl/9/' });
    return json({ error: { message: `inesperado ${path}`, code: 100 } }, 400);
  };
  return { fetchImpl, calls };
}

const same: LiveCheck = { status: 'same', checkedAt: '2026-11-23T15:40:00.000Z' };
const changed: LiveCheck = {
  status: 'changed',
  checkedAt: '2026-11-23T15:40:00.000Z',
  price: 110_000,
  listPrice: null,
  freeShipping: true,
  full: false,
  saved: true,
  what: 'subió',
};

const AT = new Date('2026-11-23T15:40:00Z');
const NEXT_DAY = new Date('2026-11-24T15:40:00Z');
const published = (calls: Call[]) => calls.filter((c) => c.path === '1784/media_publish').length;

function deps(g: ReturnType<typeof graph>, picks: StoryItem[], checks: Record<string, LiveCheck>) {
  return {
    key: KEY,
    siteUrl: 'https://www.comparatech.cl',
    readPicks: vi.fn(async () => picks),
    liveCheck: vi.fn(async () => checks),
    fetchImpl: g.fetchImpl,
    sleep: async () => {},
  };
}

describe('runMetaStory', () => {
  beforeEach(() => {
    vi.stubEnv('META_APP_ID', '1234');
    vi.stubEnv('META_APP_SECRET', 'secreto');
    store.settings = {
      meta_connection: { pageId: '111', pageName: 'ComparaTech Chile', pageToken: TOKEN, igUserId: '1784', igUsername: 'comparatech.cl', scopes: [] },
    };
    store.posts = [];
    store.events = [];
    store.failSetting = null;
    store.failPosts = false;
  });

  it('publica como historia la primera oferta sin "Ojo" y con el precio confirmado, con la imagen "perfil", y la marca', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const d = deps(g, [item(ID_A, { warning: 'Ojo: estuvo más barato' }), item(ID_B), item(ID_C)], { [ID_B]: changed, [ID_C]: same });
    const summary = await runMetaStory(fakeAdmin(), AT, d);

    expect(summary).toMatchObject({ ok: true, state: { productId: ID_C, status: 'publicado', id: 'media9', price: 100_000 } });
    expect(d.liveCheck.mock.calls[0]).toEqual([
      [
        { productId: ID_B, shown: { price: 100_000, listPrice: 125_000, freeShipping: true, full: false } },
        { productId: ID_C, shown: { price: 100_000, listPrice: 125_000, freeShipping: true, full: false } },
      ],
    ]);

    const container = g.calls.find((c) => c.path === '1784/media')!;
    expect(container.params.media_type).toBe('STORIES');
    expect(container.params.caption).toBeUndefined();
    const image = new URL(container.params.image_url);
    expect(image.origin).toBe('https://www.comparatech.cl');
    const [, , , productId, file] = image.pathname.split('/');
    expect(file.startsWith('perfil-')).toBe(true);
    expect(checkPiecePath(productId, file, KEY, Math.floor(AT.getTime() / 1000))).toMatchObject({
      ok: true,
      snapshot: { productId: ID_C, format: 'perfil', price: 100_000, listPrice: 125_000, freeShipping: true, full: false },
    });

    expect(store.posts).toEqual([
      expect.objectContaining({ product_id: ID_C, channel: 'instagram', posted_price: 100_000, caption: 'historia', status: 'publicado', external_id: 'media9' }),
    ]);
    expect(store.events).toEqual([expect.objectContaining({ actor: 'historia diaria', action: 'publicar_meta' })]);
    expect(JSON.stringify(store.events)).not.toContain(TOKEN);
  });

  it('no publica dos veces el mismo día, y al día siguiente vuelve a publicar', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const d = deps(g, [item(ID_A)], { [ID_A]: same });
    await runMetaStory(fakeAdmin(), AT, d);
    const second = await runMetaStory(fakeAdmin(), new Date(AT.getTime() + 3 * 3600_000), d);
    expect(second).toMatchObject({ ok: true, skipped: 'Ya se publicó hoy.' });
    expect(published(g.calls)).toBe(1);
    expect(store.posts).toHaveLength(1);

    store.posts = [];
    await runMetaStory(fakeAdmin(), NEXT_DAY, d);
    expect(published(g.calls)).toBe(2);
  });

  it('en pausa no publica: la de hoy se acaba sola al otro día y la indefinida sigue', async () => {
    const { runMetaStory, writeStoryPause } = await import('./meta-story');
    const g = graph();
    const d = deps(g, [item(ID_A)], { [ID_A]: same });

    await writeStoryPause(fakeAdmin(), 'hoy', AT);
    expect(await runMetaStory(fakeAdmin(), AT, d)).toMatchObject({ ok: true, skipped: 'La historia automática está en pausa.' });
    expect(d.readPicks).not.toHaveBeenCalled();

    await writeStoryPause(fakeAdmin(), 'indefinida', AT);
    expect(await runMetaStory(fakeAdmin(), NEXT_DAY, d)).toMatchObject({ skipped: 'La historia automática está en pausa.' });
    expect(published(g.calls)).toBe(0);

    await writeStoryPause(fakeAdmin(), 'hoy', AT);
    await runMetaStory(fakeAdmin(), NEXT_DAY, d);
    expect(published(g.calls)).toBe(1);
  });

  it('si el dueño ya marcó una historia hoy no publica; una de ayer no cuenta', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const d = deps(g, [item(ID_A)], { [ID_A]: same });

    store.posts = [{ channel: 'tiktok', caption: 'historia', status: 'publicado', posted_at: '2026-11-23T13:00:00.000Z' }];
    expect(await runMetaStory(fakeAdmin(), AT, d)).toMatchObject({ ok: true, skipped: 'Hoy ya se subió una historia.' });
    expect(published(g.calls)).toBe(0);

    // El 22 a las 23:00 de Chile es otro día, aunque en UTC ya sea 23.
    store.posts = [{ channel: 'instagram', caption: 'historia', status: 'publicado', posted_at: '2026-11-23T02:00:00.000Z' }];
    await runMetaStory(fakeAdmin(), AT, d);
    expect(published(g.calls)).toBe(1);
  });

  it('si ninguna tiene el precio igual en Mercado Libre, no publica ni anota el día', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const summary = await runMetaStory(fakeAdmin(), AT, deps(g, [item(ID_A), item(ID_B)], { [ID_A]: changed, [ID_B]: { status: 'unknown', what: 'sin respuesta' } }));
    expect(summary).toMatchObject({ ok: true, skipped: 'Ninguna oferta pasó la revisión del precio en Mercado Libre.' });
    expect(g.calls).toEqual([]);
    expect(store.settings.meta_story).toBeUndefined();
  });

  it('sin ofertas limpias no consulta Mercado Libre', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const d = deps(g, [item(ID_A, { warning: 'Ojo: algo' })], {});
    expect(await runMetaStory(fakeAdmin(), AT, d)).toMatchObject({ ok: true, skipped: 'No hay una oferta sin avisos para la historia de hoy.' });
    expect(d.liveCheck).not.toHaveBeenCalled();
  });

  it('si Meta no responde al publicar queda "incierto", sin marca, y la pasada siguiente no reintenta', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph({ publishThrows: true });
    const d = deps(g, [item(ID_A)], { [ID_A]: same });
    const first = await runMetaStory(fakeAdmin(), AT, d);
    expect(first).toMatchObject({ ok: false, state: { status: 'incierto' } });
    expect(store.posts).toEqual([]);

    const second = await runMetaStory(fakeAdmin(), new Date(AT.getTime() + 3 * 3600_000), d);
    expect(second.skipped).toContain('no llegó respuesta');
    expect(published(g.calls)).toBe(1);
  });

  it('un corte con el día ya anotado ("pendiente") tampoco reintenta', async () => {
    const { runMetaStory } = await import('./meta-story');
    store.settings.meta_story = { day: 20261123, productId: ID_A, name: 'x', price: 1, status: 'pendiente', at: AT.toISOString() };
    const g = graph();
    const summary = await runMetaStory(fakeAdmin(), AT, deps(g, [item(ID_B)], { [ID_B]: same }));
    expect(summary.skipped).toContain('no llegó respuesta');
    expect(g.calls).toEqual([]);
  });

  it('un error en que no salió nada se reintenta en la pasada siguiente', async () => {
    const { runMetaStory } = await import('./meta-story');
    const bad = graph({ containerFails: true });
    const first = await runMetaStory(fakeAdmin(), AT, deps(bad, [item(ID_A)], { [ID_A]: same }));
    expect(first).toMatchObject({ ok: false, state: { status: 'error' } });
    expect(published(bad.calls)).toBe(0);

    const good = graph();
    const second = await runMetaStory(fakeAdmin(), new Date(AT.getTime() + 3 * 3600_000), deps(good, [item(ID_A)], { [ID_A]: same }));
    expect(second).toMatchObject({ ok: true, state: { status: 'publicado' } });
    expect(published(good.calls)).toBe(1);
  });

  it('con el video de la oferta armado, publica el video con música y no la imagen', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const videoUrl = 'https://almacen.example/reels/2026-11-23/historia.mp4';
    const findVideo = vi.fn(async (_item: StoryItem) => videoUrl);
    const summary = await runMetaStory(fakeAdmin(), AT, { ...deps(g, [item(ID_A)], { [ID_A]: same }), findVideo });

    expect(summary).toMatchObject({ ok: true, state: { status: 'publicado', withMusic: true } });
    expect(findVideo.mock.calls[0][0]).toMatchObject({ id: ID_A });
    const containers = g.calls.filter((c) => c.path === '1784/media');
    expect(containers).toHaveLength(1);
    expect(containers[0].params).toMatchObject({ media_type: 'STORIES', video_url: videoUrl });
    expect(containers[0].params.image_url).toBeUndefined();
    expect(published(g.calls)).toBe(1);
    expect(store.events).toEqual([expect.objectContaining({ after: expect.objectContaining({ con_musica: true }) })]);
  });

  it('sin el video armado sale la imagen, y queda anotado por qué', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const summary = await runMetaStory(fakeAdmin(), AT, { ...deps(g, [item(ID_A)], { [ID_A]: same }), findVideo: async () => null });
    expect(summary).toMatchObject({ ok: true, state: { status: 'publicado', withMusic: false, musicProblem: 'El video de hoy no estaba armado.' } });
    expect(g.calls.find((c) => c.path === '1784/media')?.params.image_url).toContain('/social/pieza/');
    expect(published(g.calls)).toBe(1);
  });

  it('si Instagram rechaza el video, publica la imagen una sola vez', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph({ videoFails: true });
    const summary = await runMetaStory(fakeAdmin(), AT, {
      ...deps(g, [item(ID_A)], { [ID_A]: same }),
      findVideo: async () => 'https://almacen.example/reels/x.mp4',
    });
    expect(summary).toMatchObject({ ok: true, state: { status: 'publicado', withMusic: false } });
    expect(summary.state?.musicProblem).toContain('video no válido');
    expect(g.calls.filter((c) => c.path === '1784/media').map((c) => Boolean(c.params.video_url))).toEqual([true, false]);
    expect(published(g.calls)).toBe(1);
  });

  it('si el video se manda a publicar y Meta no responde, no se publica también la imagen', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph({ publishThrows: true });
    const summary = await runMetaStory(fakeAdmin(), AT, {
      ...deps(g, [item(ID_A)], { [ID_A]: same }),
      findVideo: async () => 'https://almacen.example/reels/x.mp4',
    });
    expect(summary).toMatchObject({ ok: false, state: { status: 'incierto' } });
    expect(g.calls.filter((c) => c.path === '1784/media')).toHaveLength(1);
    expect(published(g.calls)).toBe(1);
  });

  it('sin poder leer la pausa, el estado o las marcas de hoy, no publica', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const d = deps(g, [item(ID_A)], { [ID_A]: same });

    store.failSetting = 'meta_story_pause';
    expect((await runMetaStory(fakeAdmin(), AT, d)).ok).toBe(false);
    store.failSetting = 'meta_story';
    expect((await runMetaStory(fakeAdmin(), AT, d)).ok).toBe(false);
    store.failSetting = null;
    store.failPosts = true;
    expect((await runMetaStory(fakeAdmin(), AT, d)).ok).toBe(false);
    expect(g.calls).toEqual([]);
  });

  it('sin Meta conectado o sin la clave de la firma, no publica', async () => {
    const { runMetaStory } = await import('./meta-story');
    const g = graph();
    const noKey = await runMetaStory(fakeAdmin(), AT, { ...deps(g, [item(ID_A)], { [ID_A]: same }), key: null });
    expect(noKey.ok).toBe(false);
    delete store.settings.meta_connection;
    const noMeta = await runMetaStory(fakeAdmin(), AT, deps(g, [item(ID_A)], { [ID_A]: same }));
    expect(noMeta.ok).toBe(false);
    expect(g.calls).toEqual([]);
  });
});

describe('el control de /admin/historias', () => {
  beforeEach(() => {
    store.settings = {};
    store.failSetting = null;
  });

  it('dice si está en pausa y qué pasó hoy; lo de ayer no cuenta', async () => {
    const { readStoryAutoStatus, writeStoryPause } = await import('./meta-story');
    store.settings.meta_story = { day: 20261123, productId: ID_A, name: 'Producto A', price: 1, status: 'publicado', permalink: null, at: AT.toISOString() };
    expect(await readStoryAutoStatus(fakeAdmin(), AT)).toEqual({ pause: 'activa', today: { name: 'Producto A', status: 'publicado', permalink: null } });
    expect((await readStoryAutoStatus(fakeAdmin(), NEXT_DAY)).today).toBeNull();

    await writeStoryPause(fakeAdmin(), 'hoy', AT);
    expect((await readStoryAutoStatus(fakeAdmin(), AT)).pause).toBe('hoy');
    expect((await readStoryAutoStatus(fakeAdmin(), NEXT_DAY)).pause).toBe('activa');
  });
});

describe('el formato "perfil" de la imagen', () => {
  const snapshot: PieceSnapshot = {
    productId: ID_A,
    format: 'perfil',
    price: 100_000,
    listPrice: 125_000,
    checkedAt: 1_800_000_000 - 600,
    freeShipping: true,
    full: false,
    expiresAt: 1_800_000_000 + 3600,
  };

  it('va firmado, y la firma de una historia común no sirve para él', () => {
    const path = piecePath(snapshot, KEY)!;
    const file = path.split('/').pop()!;
    expect(file.startsWith('perfil-')).toBe(true);
    expect(checkPiecePath(ID_A, file, KEY, 1_800_000_000)).toMatchObject({ ok: true, snapshot: { format: 'perfil' } });

    const story = piecePath({ ...snapshot, format: 'story' }, KEY)!.split('/').pop()!;
    expect(checkPiecePath(ID_A, story.replace(/^story-/, 'perfil-'), KEY, 1_800_000_000)).toEqual({ ok: false, reason: 'firma' });
  });
});
