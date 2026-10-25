import { beforeEach, describe, expect, it, vi } from 'vitest';
import { carouselExpiry, carouselKey, carouselPath, type CarouselSet, type CarouselSlide } from './carousel-url';
import { GRAPH_VERSION } from './meta';

/**
 * La acción "Publicar en Instagram y Facebook" del carrusel
 * (app/admin/historias/carrusel/meta-actions), con la base, la actividad y
 * Meta de mentira: publica lo que dicen las láminas firmadas, con el precio
 * de la base, marca el carrusel, y un segundo toque no vuelve a publicar.
 */

const IDS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const TOKEN = 'EAA' + 'P'.repeat(90);

const store = vi.hoisted(() => ({
  events: [] as Array<{ at: string; action: string; target: string | null; after: unknown }>,
  meta: null as unknown,
  products: [] as Array<Record<string, unknown>>,
  marks: [] as unknown[],
  clock: 0,
}));

// cache() de React solo existe en el runtime de servidor de Next (lo usa lib/settings).
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn(async () => 'cristopher') }));
vi.mock('@/lib/admin-audit', () => ({
  logAdminEvent: vi.fn(async (_admin: unknown, e: { action: string; target?: string; after?: unknown }) => {
    store.clock += 1000;
    store.events.push({ at: new Date(Date.UTC(2026, 9, 24, 23, 0, 0) + store.clock).toISOString(), action: e.action, target: e.target ?? null, after: e.after });
  }),
}));
vi.mock('@/app/admin/historias/carrusel/actions', () => ({
  markCarouselPublished: vi.fn(async (items: unknown) => {
    store.marks.push(items);
    return { ok: true, postIds: [1, 2], postedAt: '2026-10-24T23:05:00.000Z' };
  }),
}));
vi.mock('@/lib/social/telegram', async (importOriginal) => {
  const real = await importOriginal<typeof import('./telegram')>();
  return {
    ...real,
    selectSocialProducts: vi.fn(async () => ({ rows: store.products, has0017: true, error: null })),
  };
});
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          filters[col] = value;
          return q;
        },
        gte: () => q,
        order: () => q,
        limit: async () => ({
          data: store.events.filter((e) => e.action === filters.action && e.target === filters.target).map(({ at, after }) => ({ at, after })),
          error: null,
        }),
        maybeSingle: async () => ({ data: table === 'admin_private_settings' && store.meta ? { value: store.meta } : null, error: null }),
      };
      return q;
    },
  }),
}));

function product(id: string, name: string, price: number) {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    brand: 'Marca',
    category: 'audio',
    image_url: 'https://http2.mlstatic.com/x.jpg',
    affiliate_url: 'https://meli.la/x',
    price,
    original_price: null,
    is_active: true,
    is_hidden: false,
    deleted_at: null,
    price_checked_at: '2026-10-24T22:50:00.000Z',
    ml_product_id: 'MLC1',
    offer_info: null,
  };
}

function slides(key: Buffer, prices: number[]): string[] {
  const now = new Date('2026-10-24T23:00:00Z');
  const s = Math.floor(now.getTime() / 1000);
  const set: CarouselSet = { kind: 'bajas', day: 20261024, ids: IDS, expiresAt: carouselExpiry(now) };
  const list: CarouselSlide[] = [
    { type: 'portada', set },
    ...IDS.map((_, i) => ({
      type: 'producto' as const,
      set,
      item: { rank: i + 1, price: prices[i], dropAmount: 10_000, dropSince: s - 86_400, checkedAt: s - 600, freeShipping: false, full: false },
    })),
    { type: 'cierre', set },
  ];
  return list.map((slide) => carouselPath(slide, key) as string);
}

type Call = { path: string; params: Record<string, string> };
function stubGraph() {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
    const path = url.pathname.replace(`/${GRAPH_VERSION}/`, '');
    calls.push({ path, params });
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === '1784/media' && params.is_carousel_item) return json({ id: `child-${params.image_url.length}-${calls.length}` });
    if (path === '1784/media') return json({ id: 'carousel1' });
    if (path === 'carousel1') return json({ status_code: 'FINISHED' });
    if (path === '1784/media_publish') return json({ id: 'media9' });
    if (path === 'media9') return json({ permalink: 'https://www.instagram.com/p/abc/' });
    if (path === '111/photos') return json({ id: `photo-${calls.length}` });
    if (path === '111/feed') return json({ id: '111_999' });
    if (path === '111_999') return json({ permalink_url: 'https://www.facebook.com/111/posts/999' });
    return new Response(JSON.stringify({ error: { message: `inesperado ${path}`, code: 100 } }), { status: 400 });
  });
  return calls;
}

describe('publishCarouselOnMeta', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T23:01:00Z'));
    vi.stubEnv('CRON_SECRET', 'c'.repeat(48));
    vi.stubEnv('META_APP_ID', '1234');
    vi.stubEnv('META_APP_SECRET', 'secreto');
    store.events = [];
    store.marks = [];
    store.clock = 0;
    store.meta = { pageId: '111', pageName: 'ComparaTech Chile', pageToken: TOKEN, igUserId: '1784', igUsername: 'comparatech.cl', scopes: [] };
    store.products = [product(IDS[0], 'Audífonos Uno', 50_000), product(IDS[1], 'Parlante Dos', 80_000)];
  });

  it('publica en las dos redes con el texto de cada una, marca el carrusel y deja registro', async () => {
    const calls = stubGraph();
    const { publishCarouselOnMeta } = await import('@/app/admin/historias/carrusel/meta-actions');
    const key = carouselKey() as Buffer;
    const result = await publishCarouselOnMeta({ slides: slides(key, [50_000, 80_000]), networks: ['instagram', 'facebook'] });

    expect(result).toEqual({
      ok: true,
      results: {
        instagram: { ok: true, permalink: 'https://www.instagram.com/p/abc/' },
        facebook: { ok: true, permalink: 'https://www.facebook.com/111/posts/999' },
      },
      mark: { postIds: [1, 2], postedAt: '2026-10-24T23:05:00.000Z' },
    });
    // 4 láminas por red: portada, 2 productos y cierre, en direcciones públicas del sitio.
    const igImages = calls.filter((c) => c.params.is_carousel_item).map((c) => c.params.image_url);
    expect(igImages).toHaveLength(4);
    for (const url of igImages) expect(url).toMatch(/^https?:\/\/[^/]+\/social\/carrusel\//);
    const caption = calls.find((c) => c.params.media_type === 'CAROUSEL')?.params.caption ?? '';
    expect(caption).toContain('Audífonos Uno');
    expect(caption).toContain('bajó');
    // El texto de Facebook (con el link a /hoy en producción; aquí depende de SITE_URL).
    expect(calls.find((c) => c.path === '111/feed')?.params.message).toContain('Links de compra');
    expect(store.marks).toEqual([[{ productId: IDS[0], price: 50_000 }, { productId: IDS[1], price: 80_000 }]]);
    expect(store.events.map((e) => (e.after as { estado: string }).estado).sort()).toEqual(['publicado', 'publicado', 'publicando', 'publicando']);
    expect(JSON.stringify(store.events)).not.toContain('EAA');
  });

  it('un segundo toque no vuelve a publicar', async () => {
    stubGraph();
    const { publishCarouselOnMeta } = await import('@/app/admin/historias/carrusel/meta-actions');
    const key = carouselKey() as Buffer;
    const paths = slides(key, [50_000, 80_000]);
    await publishCarouselOnMeta({ slides: paths, networks: ['instagram', 'facebook'] });

    const again = stubGraph();
    const second = await publishCarouselOnMeta({ slides: paths, networks: ['instagram', 'facebook'] });
    expect(second.ok && second.results.instagram).toEqual({ ok: true, permalink: 'https://www.instagram.com/p/abc/', already: true });
    expect(second.ok && second.results.facebook).toEqual({ ok: true, permalink: 'https://www.facebook.com/111/posts/999', already: true });
    expect(again).toHaveLength(0);
  });

  it('si el precio de la base ya no es el de la lámina, no publica nada', async () => {
    const calls = stubGraph();
    store.products = [product(IDS[0], 'Audífonos Uno', 52_000), product(IDS[1], 'Parlante Dos', 80_000)];
    const { publishCarouselOnMeta } = await import('@/app/admin/historias/carrusel/meta-actions');
    const result = await publishCarouselOnMeta({ slides: slides(carouselKey() as Buffer, [50_000, 80_000]), networks: ['instagram'] });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/cambió/) });
    expect(calls).toHaveLength(0);
    expect(store.marks).toHaveLength(0);
  });

  it('sin Meta conectado, lo dice y no publica', async () => {
    const calls = stubGraph();
    store.meta = null;
    const { publishCarouselOnMeta } = await import('@/app/admin/historias/carrusel/meta-actions');
    const result = await publishCarouselOnMeta({ slides: slides(carouselKey() as Buffer, [50_000, 80_000]), networks: ['instagram'] });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no está conectado/) });
    expect(calls).toHaveLength(0);
  });

  it('si falla una red, la otra igual sale y queda marcado', async () => {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = url.pathname.replace(`/${GRAPH_VERSION}/`, '');
      const params: Record<string, string> = {};
      if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
      calls.push({ path, params });
      if (path === '111/photos') return new Response(JSON.stringify({ id: 'p' }), { status: 200 });
      if (path === '111/feed') return new Response(JSON.stringify({ id: '111_1' }), { status: 200 });
      if (path === '111_1') return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'Media download has failed', code: 9004 } }), { status: 400 });
    });
    const { publishCarouselOnMeta } = await import('@/app/admin/historias/carrusel/meta-actions');
    const result = await publishCarouselOnMeta({ slides: slides(carouselKey() as Buffer, [50_000, 80_000]), networks: ['instagram', 'facebook'] });
    expect(result.ok && result.results.instagram).toEqual({ ok: false, error: expect.stringMatching(/download/) });
    expect(result.ok && result.results.facebook).toEqual({ ok: true, permalink: null });
    expect(store.marks).toHaveLength(1);
    expect(store.events.some((e) => (e.after as { red: string; estado: string }).red === 'instagram' && (e.after as { estado: string }).estado === 'error')).toBe(true);
  });
});
