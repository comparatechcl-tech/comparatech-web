import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCheck } from './live-price';
import type { ReadyVideo, VideoBoard } from './videos';

/**
 * La publicación diaria automática de un reel en Instagram y Facebook
 * (lib/social/meta-daily), con la base, Meta y Mercado Libre de mentira.
 * Lo que importa: a lo más uno por día, solo un video que cumple las reglas
 * y con el precio confirmado, Instagram se termina en la segunda pasada, y
 * el token nunca queda escrito.
 */

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

const TOKEN = 'EAA' + 'P'.repeat(90);
const store = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  posts: [] as Record<string, unknown>[],
  events: [] as unknown[],
}));

vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async (_a: unknown, e: unknown) => void store.events.push(e)) }));

function fakeAdmin() {
  return {
    from(table: string) {
      let key = '';
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => {
          key = v;
          return q;
        },
        maybeSingle: async () => ({ data: key in store.settings ? { value: store.settings[key] } : null, error: null }),
        upsert: async (row: { key: string; value: unknown }) => {
          store.settings[row.key] = JSON.parse(JSON.stringify(row.value));
          return { error: null };
        },
        insert: async (row: Record<string, unknown>) => {
          if (table === 'social_posts') store.posts.push(row);
          return { error: null };
        },
      };
      return q;
    },
  } as never;
}

function video(id: string, over: Partial<ReadyVideo> = {}): ReadyVideo {
  return {
    id,
    slug: id,
    name: `Producto ${id}`,
    brand: 'Marca',
    price: 100_000,
    listPrice: 120_000,
    discount: 17,
    checkedAt: '2026-10-25T12:00:00.000Z',
    template: 'estudio',
    videoUrl: `https://x.supabase.co/storage/v1/object/public/reels/2026-10-25/${id}.mp4`,
    coverUrl: `https://x.supabase.co/storage/v1/object/public/reels/2026-10-25/${id}.jpg`,
    fileName: `${id}.mp4`,
    renderedAt: null,
    points: 50,
    reason: 'Audífonos con 17% de descuento',
    link: 'https://meli.la/x',
    texts: { instagram: `IG ${id}`, tiktok: 't', facebook: `FB ${id}`, youtubeTitle: 'y', youtubeDescription: 'y' },
    posted: {},
    mlUrl: null,
    freeShipping: true,
    full: false,
    ...over,
  };
}

function board(videos: ReadyVideo[]): VideoBoard {
  return { videos, stale: 0, hiddenUnread: 0, lastRenderedAt: null, storageReady: true, changedAfterPosting: [] };
}

type Call = { url: string; path: string; params: Record<string, string>; headers: Record<string, string> };
function graph(igStatuses: string[]) {
  const calls: Call[] = [];
  let poll = 0;
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const path = url.hostname === 'rupload.facebook.com' ? `rupload${url.pathname}` : url.pathname.replace('/v26.0/', '');
    calls.push({ url: input, path, params, headers });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (path === '111/video_reels' && params.upload_phase === 'start') return json({ video_id: '555', upload_url: 'https://evil.example/upload' });
    if (path.startsWith('rupload/')) return json({ success: true });
    if (path === '111/video_reels' && params.upload_phase === 'finish') return json({ success: true });
    if (path === '1784/media') return json({ id: 'cont1' });
    if (path === 'cont1') return json({ status_code: igStatuses[Math.min(poll++, igStatuses.length - 1)] });
    if (path === '1784/media_publish') return json({ id: 'media9' });
    if (path === 'media9') return json({ permalink: 'https://www.instagram.com/reel/abc/' });
    return json({ error: { message: `inesperado ${path}`, code: 100 } }, 400);
  };
  return { fetchImpl, calls };
}

const same: LiveCheck = { status: 'same', checkedAt: '2026-10-25T13:30:00.000Z' };
const changed: LiveCheck = {
  status: 'changed',
  checkedAt: '2026-10-25T13:30:00.000Z',
  price: 110_000,
  listPrice: null,
  freeShipping: true,
  full: false,
  saved: true,
  what: 'subió',
};

describe('runMetaDaily', () => {
  const day1 = new Date('2026-10-25T13:35:00Z');

  beforeEach(() => {
    vi.stubEnv('META_APP_ID', '1234');
    vi.stubEnv('META_APP_SECRET', 'secreto');
    store.settings = {
      meta_connection: { pageId: '111', pageName: 'ComparaTech Chile', pageToken: TOKEN, igUserId: '1784', igUsername: 'comparatech.cl', scopes: [] },
    };
    store.posts = [];
    store.events = [];
  });

  it('elige el primer video que cumple las reglas y tiene el precio confirmado, y lo publica en las dos redes', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    const { fetchImpl, calls } = graph(['FINISHED']);
    const liveCheck = vi.fn(async () => ({ b: changed, c: same }));
    const videos = [
      video('a', { reason: 'Algo. Ojo: estuvo más barato hace poco' }),
      video('z', { posted: { instagram: { postId: 1, at: '2026-10-20T00:00:00Z' } } }),
      video('b'),
      video('c'),
    ];
    const summary = await runMetaDaily(fakeAdmin(), day1, {
      readBoard: async () => board(videos),
      liveCheck,
      fetchImpl,
      sleep: async () => {},
    });

    // Ni el del "Ojo" ni el ya subido se revisan; b cambió de precio: sale c.
    expect(liveCheck).toHaveBeenCalledWith([
      { productId: 'b', shown: { price: 100_000, listPrice: 120_000, freeShipping: true, full: false } },
      { productId: 'c', shown: { price: 100_000, listPrice: 120_000, freeShipping: true, full: false } },
    ]);
    expect(summary.ok).toBe(true);
    expect(summary.state).toMatchObject({
      day: 20261025,
      productId: 'c',
      facebook: { status: 'publicado', id: '555' },
      instagram: { status: 'publicado', id: 'media9', permalink: 'https://www.instagram.com/reel/abc/' },
    });
    expect(calls.find((c) => c.params.upload_phase === 'finish')?.params.description).toBe('FB c');
    const reel = calls.find((c) => c.path === '1784/media');
    expect(reel?.params).toMatchObject({ media_type: 'REELS', caption: 'IG c', share_to_feed: 'true' });
    expect(reel?.params.video_url).toContain('/c.mp4');
    expect(store.posts).toEqual([
      expect.objectContaining({ product_id: 'c', channel: 'facebook', caption: 'video', posted_price: 100_000, external_id: '555' }),
      expect.objectContaining({ product_id: 'c', channel: 'instagram', caption: 'video', posted_price: 100_000, external_id: 'media9' }),
    ]);
  });

  it('el token va solo a la dirección de subida de Meta, nunca a otra, y no queda escrito', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    const { fetchImpl, calls } = graph(['FINISHED']);
    await runMetaDaily(fakeAdmin(), day1, { readBoard: async () => board([video('c')]), liveCheck: async () => ({ c: same }), fetchImpl, sleep: async () => {} });
    const upload = calls.find((c) => c.path.startsWith('rupload/'));
    expect(upload?.url).toBe('https://rupload.facebook.com/video-upload/v26.0/555');
    expect(upload?.headers.file_url).toContain('/c.mp4');
    expect(calls.some((c) => c.url.includes('evil.example'))).toBe(false);
    expect(JSON.stringify(store.settings.meta_daily)).not.toContain('EAA');
    expect(JSON.stringify(store.events)).not.toContain('EAA');
    expect(JSON.stringify(store.posts)).not.toContain('EAA');
  });

  it('a lo más uno por día: una pasada de más no vuelve a publicar', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    const first = graph(['FINISHED']);
    await runMetaDaily(fakeAdmin(), day1, { readBoard: async () => board([video('c')]), liveCheck: async () => ({ c: same }), fetchImpl: first.fetchImpl, sleep: async () => {} });
    const again = graph(['FINISHED']);
    const readBoard = vi.fn(async () => board([video('d')]));
    const summary = await runMetaDaily(fakeAdmin(), new Date('2026-10-25T15:35:00Z'), { readBoard, liveCheck: async () => ({ d: same }), fetchImpl: again.fetchImpl });
    expect(summary).toMatchObject({ ok: true, skipped: 'Ya se publicó hoy.' });
    expect(again.calls).toHaveLength(0);
    expect(readBoard).not.toHaveBeenCalled();
  });

  it('si Instagram sigue procesando, la segunda pasada lo publica', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    const first = graph(['IN_PROGRESS']);
    const one = await runMetaDaily(fakeAdmin(), day1, {
      readBoard: async () => board([video('c')]),
      liveCheck: async () => ({ c: same }),
      fetchImpl: first.fetchImpl,
      sleep: async () => {},
      igWaitMs: 0,
    });
    expect(one.state?.instagram).toMatchObject({ status: 'procesando', containerId: 'cont1' });
    expect(store.posts.filter((p) => p.channel === 'instagram')).toHaveLength(0);

    const second = graph(['FINISHED']);
    const two = await runMetaDaily(fakeAdmin(), new Date('2026-10-25T15:35:00Z'), {
      readBoard: async () => board([]),
      liveCheck: async () => ({}),
      fetchImpl: second.fetchImpl,
      sleep: async () => {},
    });
    expect(two.state?.instagram).toMatchObject({ status: 'publicado', id: 'media9' });
    expect(second.calls.some((c) => c.path === '1784/media')).toBe(false);
    expect(store.posts.filter((p) => p.channel === 'instagram')).toHaveLength(1);
  });

  it('al otro día elige de nuevo', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    await runMetaDaily(fakeAdmin(), day1, { readBoard: async () => board([video('c')]), liveCheck: async () => ({ c: same }), fetchImpl: graph(['FINISHED']).fetchImpl, sleep: async () => {} });
    const next = await runMetaDaily(fakeAdmin(), new Date('2026-10-26T13:35:00Z'), {
      readBoard: async () => board([video('d')]),
      liveCheck: async () => ({ d: same }),
      fetchImpl: graph(['FINISHED']).fetchImpl,
      sleep: async () => {},
    });
    expect(next.state).toMatchObject({ day: 20261026, productId: 'd' });
  });

  it('sin un video con el precio confirmado no publica nada', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    const { fetchImpl, calls } = graph(['FINISHED']);
    const summary = await runMetaDaily(fakeAdmin(), day1, { readBoard: async () => board([video('b')]), liveCheck: async () => ({ b: changed }), fetchImpl });
    expect(summary).toMatchObject({ ok: true, skipped: expect.stringMatching(/revisión del precio/) });
    expect(calls).toHaveLength(0);
    expect(store.settings.meta_daily).toBeUndefined();
  });

  it('sin Meta conectado no hace nada', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    delete store.settings.meta_connection;
    const readBoard = vi.fn(async () => board([video('c')]));
    const summary = await runMetaDaily(fakeAdmin(), day1, { readBoard, liveCheck: async () => ({}) });
    expect(summary).toMatchObject({ ok: false, skipped: expect.stringMatching(/no está conectado/) });
    expect(readBoard).not.toHaveBeenCalled();
  });

  it('si Meta rechaza la conexión, lo anota sin publicar y sin repetir el día', async () => {
    const { runMetaDaily } = await import('./meta-daily');
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'Any of the pages_read_engagement permission(s) must be granted', code: 190 } }), { status: 400 });
    const summary = await runMetaDaily(fakeAdmin(), day1, { readBoard: async () => board([video('c')]), liveCheck: async () => ({ c: same }), fetchImpl });
    expect(summary.ok).toBe(false);
    expect(summary.state?.facebook).toMatchObject({ status: 'error', error: expect.stringMatching(/Vuelve a conectar/) });
    expect(summary.state?.instagram).toMatchObject({ status: 'error' });
    expect(store.posts).toHaveLength(0);

    // Reconectada, la segunda pasada del mismo día vuelve a intentar.
    const ok = graph(['FINISHED']);
    const retry = await runMetaDaily(fakeAdmin(), new Date('2026-10-25T15:35:00Z'), {
      readBoard: async () => board([video('c')]),
      liveCheck: async () => ({ c: same }),
      fetchImpl: ok.fetchImpl,
      sleep: async () => {},
    });
    expect(retry.state).toMatchObject({ facebook: { status: 'publicado' }, instagram: { status: 'publicado' } });
  });
});
