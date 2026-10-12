import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// La lectura del historial va a Supabase: acá solo se prueba lo puro.
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(async () => new Map()) }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// El catálogo se entrega ya leído; la selección es la de verdad.
vi.mock('@/lib/social/telegram', async (original) => ({
  ...(await original<typeof import('@/lib/social/telegram')>()),
  readFreshSocialProducts: vi.fn(),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import { readAffiliateSettings } from '@/lib/settings';
import { checkPiecePath, pieceKey } from '@/lib/social/piece-url';
import { NETWORK_RULES, STORY_MARK, postedOnNetworks } from '@/lib/social/networks';
import {
  STORY_REPOST_DROP,
  STORY_RULES,
  buildStoryItem,
  droppedSinceStory,
  readPostedStories,
  readStoryHistory,
  readStoryPicks,
} from '@/lib/social/stories';
import { pickByRules, readFreshSocialProducts, type SocialProduct } from '@/lib/social/telegram';

const NOW = new Date('2026-10-12T15:00:00Z');
const KEY = pieceKey({ CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv)!;
const DIRECT = { word: 'comparatech', tool: '12345', directLinks: true };
const MELI_LA = { word: null, tool: null, directLinks: false };

let seq = 0;
function product(over: Partial<SocialProduct> = {}): SocialProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: `Audífonos Marca Modelo ${seq}`,
    brand: 'Marca',
    category: 'audio',
    price: 80_000,
    original_price: 100_000,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: 'MLC123',
    ml_family_id: null,
    price_checked_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    seller_reputation: 'verde',
    seller_sales_count: 10_000,
    is_active: true,
    is_hidden: false,
    offer_info: { free_shipping: true, is_full: false },
    ml_root_category: null,
    deleted_at: null,
    ...over,
  };
}

function pickOne(p: SocialProduct, drops?: Map<string, number>) {
  const [pick] = pickByRules([p], { now: NOW, recentlyPosted: new Set(), drops }, STORY_RULES);
  return pick;
}

/** Una base de mentira: anota lo que se le pide y devuelve las filas dadas, sin filtrar. */
function fakeAdmin(rows: unknown[], error: { code?: string; message: string } | null = null) {
  const calls: unknown[][] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'gte', 'order']) {
    builder[method] = (...args) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.limit = (...args) => {
    calls.push(['limit', ...args]);
    return Promise.resolve({ data: error ? null : rows, error });
  };
  const admin = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

const story = (productId: string, price: number | null, daysAgo: number) => ({
  product_id: productId,
  posted_price: price,
  posted_at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
});

beforeEach(() => {
  vi.mocked(readAffiliateSettings).mockResolvedValue(DIRECT);
  vi.mocked(readFreshSocialProducts).mockReset();
});

describe('STORY_RULES', () => {
  it('usa las reglas del plan de publicaciones, con más productos', () => {
    expect(STORY_RULES.minDiscount).toBe(NETWORK_RULES.minDiscount);
    expect(STORY_RULES.maxPriceAgeMs).toBe(NETWORK_RULES.maxPriceAgeMs);
    expect(STORY_RULES.repeatAfterDays).toBe(NETWORK_RULES.repeatAfterDays);
    expect(STORY_RULES.maxPosts).toBeGreaterThan(NETWORK_RULES.maxPosts);
  });
});

describe('droppedSinceStory', () => {
  it('sin historias anteriores no hay nada con qué comparar', () => {
    expect(droppedSinceStory(undefined, 80_000)).toBe(false);
  });

  it('vuelve solo si bajó 3% o más respecto del precio más bajo con que se subió', () => {
    const history = { lowest: 100_000, lastAt: NOW.toISOString() };
    expect(STORY_REPOST_DROP).toBe(0.03);
    expect(droppedSinceStory(history, 100_000)).toBe(false);
    expect(droppedSinceStory(history, 97_001)).toBe(false);
    expect(droppedSinceStory(history, 97_000)).toBe(true);
    expect(droppedSinceStory(history, 120_000)).toBe(false);
  });

  it('una historia sin precio anotado no permite decir que bajó', () => {
    expect(droppedSinceStory({ lowest: null, lastAt: NOW.toISOString() }, 1)).toBe(false);
  });
});

describe('readStoryHistory', () => {
  it('pide solo las historias vigentes y junta el precio más bajo y la última fecha', async () => {
    const since = new Date(NOW.getTime() - 14 * 86_400_000);
    // De la más nueva a la más antigua, como las entrega la consulta.
    const { admin, calls } = fakeAdmin([
      story('a', 95_000, 1),
      story('b', null, 2),
      story('a', 90_000, 5),
      story('a', 110_000, 9),
      story('b', 50_000, 10),
      { product_id: null, posted_price: 1, posted_at: NOW.toISOString() },
    ]);
    const history = await readStoryHistory(admin, since);

    expect(history.get('a')).toEqual({ lowest: 90_000, lastAt: story('a', 0, 1).posted_at });
    expect(history.get('b')).toEqual({ lowest: 50_000, lastAt: story('b', 0, 2).posted_at });
    expect(history.size).toBe(2);

    expect(calls).toContainEqual(['from', 'social_posts']);
    expect(calls).toContainEqual(['eq', 'channel', 'instagram']);
    expect(calls).toContainEqual(['eq', 'caption', STORY_MARK]);
    expect(calls).toContainEqual(['neq', 'status', 'error']);
    expect(calls).toContainEqual(['gte', 'posted_at', since.toISOString()]);
  });

  it('sin la tabla no hay historias; con otro error, falla', async () => {
    const missing = fakeAdmin([], { code: '42P01', message: 'no existe' });
    expect((await readStoryHistory(missing.admin, NOW)).size).toBe(0);
    const broken = fakeAdmin([], { code: '500', message: 'se cayó' });
    await expect(readStoryHistory(broken.admin, NOW)).rejects.toThrow('se cayó');
  });
});

describe('postedOnNetworks', () => {
  it('no cuenta las historias subidas a mano: no le quitan productos al plan de publicaciones', async () => {
    const { admin } = fakeAdmin([
      { product_id: 'feed-metricool', caption: 'Texto del post' },
      { product_id: 'marcado-a-mano', caption: null },
      { product_id: 'solo-historia', caption: STORY_MARK },
    ]);
    const posted = await postedOnNetworks(admin, NOW);
    expect([...(posted ?? [])].sort()).toEqual(['feed-metricool', 'marcado-a-mano']);
  });
});

describe('buildStoryItem', () => {
  it('entrega la pieza de historia firmada, con el precio de ahora', () => {
    const p = product();
    const item = buildStoryItem(pickOne(p), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(item.image.startsWith(`/social/pieza/${p.id}/story-80000-100000-`)).toBe(true);

    const file = item.image.split('/').pop()!;
    const check = checkPiecePath(p.id, file, KEY, Math.floor(NOW.getTime() / 1000));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.snapshot.format).toBe('story');
      expect(check.snapshot.price).toBe(80_000);
      expect(check.snapshot.listPrice).toBe(100_000);
    }
  });

  it('el link es el mismo destino que el botón del sitio', () => {
    const p = product();
    const direct = buildStoryItem(pickOne(p), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(direct.link).toBe('https://www.mercadolibre.cl/p/MLC123?matt_word=comparatech&matt_tool=12345');
    const saved = buildStoryItem(pickOne(p), { now: NOW, settings: MELI_LA, key: KEY })!;
    expect(saved.link).toBe('https://meli.la/abc');
  });

  it('muestra el descuento y el precio de lista solo cuando hay rebaja', () => {
    const withList = buildStoryItem(pickOne(product()), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(withList).toMatchObject({ discount: 20, listPrice: 100_000, drop: null, again: null });

    // Sin precio de lista entra solo por la baja que confirma el historial.
    const p = product({ original_price: null });
    const byDrop = buildStoryItem(pickOne(p, new Map([[p.id, 7.6]])), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(byDrop).toMatchObject({ discount: 0, listPrice: null, drop: 8 });
    expect(byDrop.image).toContain('/story-80000-0-');
  });

  it('si ya se subió, dice a cuánto y cuándo', () => {
    const history = { lowest: 90_000, lastAt: '2026-10-09T12:00:00.000Z' };
    const item = buildStoryItem(pickOne(product()), { now: NOW, settings: DIRECT, key: KEY, history })!;
    expect(item.again).toEqual({ price: 90_000, at: '2026-10-09T12:00:00.000Z' });
  });

  it('acorta el nombre y arma un nombre de archivo sin caracteres raros', () => {
    const p = product({ slug: 'Audífonos_Sony/WH-1000XM5 ', name: `Audífonos Sony WH-1000XM5 ${'muy largo '.repeat(12)}` });
    const item = buildStoryItem(pickOne(p), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(item.fileName).toMatch(/^comparatech-[a-z0-9-]+-historia\.jpg$/);
    expect(item.name.length).toBeLessThanOrEqual(55);
  });

  it('sin precio válido no hay imagen ni historia', () => {
    const pick = pickOne(product());
    const broken = { ...pick, product: { ...pick.product, price: 0 } };
    expect(buildStoryItem(broken, { now: NOW, settings: DIRECT, key: KEY })).toBeNull();
  });
});

describe('readStoryPicks', () => {
  const categories = ['audio', 'gaming', 'hogar', 'celulares', 'computacion'];

  it('entrega hasta ocho, dos por categoría como máximo', async () => {
    const rows = categories.flatMap((category) => Array.from({ length: 5 }, () => product({ category })));
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows, error: null });

    const items = await readStoryPicks(fakeAdmin([]).admin, NOW, KEY);
    expect(items).toHaveLength(8);
    const perCategory = new Map<string, number>();
    for (const item of items) {
      const category = rows.find((p) => p.id === item.id)!.category;
      perCategory.set(category, (perCategory.get(category) ?? 0) + 1);
    }
    expect(Math.max(...perCategory.values())).toBe(2);
  });

  it('no repite una historia ya subida, salvo que haya bajado; esas van primero', async () => {
    const posted = product({ category: 'audio' }); // 80.000, subida a 80.000: no vuelve
    const cheaper = product({ category: 'gaming' }); // 80.000, subida a 90.000: vuelve
    const backToUsual = product({ category: 'hogar' }); // subida a 80.000 y a 95.000: sigue en su precio más bajo
    const fresh = product({ category: 'celulares' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [fresh, posted, cheaper, backToUsual], error: null });
    const { admin } = fakeAdmin([
      story(posted.id, 80_000, 2),
      story(cheaper.id, 90_000, 3),
      story(backToUsual.id, 95_000, 1),
      story(backToUsual.id, 80_000, 4),
    ]);

    const items = await readStoryPicks(admin, NOW, KEY);
    expect(items.map((item) => item.id)).toEqual([cheaper.id, fresh.id]);
    expect(items[0].again).toMatchObject({ price: 90_000 });
    expect(items[1].again).toBeNull();
  });

  it('si el catálogo no se pudo leer, falla en vez de mostrar una lista vacía', async () => {
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [], error: 'sin conexión' });
    await expect(readStoryPicks(fakeAdmin([]).admin, NOW, KEY)).rejects.toThrow('sin conexión');
  });
});

describe('readPostedStories', () => {
  /** Una base de mentira con dos tablas: devuelve las filas de la tabla pedida, sin filtrar, y anota los pedidos. */
  function fakeTables(tables: Record<string, unknown[]>, errors: Record<string, { code?: string; message: string }> = {}) {
    const asked: string[] = [];
    const admin = {
      from: (table: string) => {
        asked.push(table);
        const result = errors[table] ? { data: null, error: errors[table] } : { data: tables[table] ?? [], error: null };
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'neq', 'in', 'gte', 'order', 'limit']) builder[method] = () => builder;
        builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
        return builder;
      },
    } as unknown as SupabaseClient;
    return { admin, asked };
  }

  const mark = (id: number, productId: string, price: number | null, hoursAgo: number) => ({
    id,
    product_id: productId,
    posted_price: price,
    posted_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
  });

  it('entrega la última marca de cada producto que sigue a la venta, con lo necesario para compartirla de nuevo', async () => {
    const a = product({ price: 75_000 });
    const b = product();
    const gone = product({ is_active: false });
    // De la más nueva a la más antigua, como las entrega la consulta.
    const { admin } = fakeTables({
      social_posts: [mark(30, b.id, 80_000, 1), mark(20, gone.id, 80_000, 2), mark(11, a.id, 80_000, 3), mark(10, a.id, 90_000, 20)],
      products: [a, b, gone],
    });

    const stories = await readPostedStories(admin, NOW, KEY);
    expect(stories.map((st) => [st.id, st.postId])).toEqual([
      [b.id, 30],
      [a.id, 11],
    ]);
    // La imagen y el precio son los de ahora; el precio con que se subió queda aparte.
    expect(stories[1]).toMatchObject({ price: 75_000, postedPrice: 80_000, postedAt: mark(11, a.id, 0, 3).posted_at, again: null });
    expect(stories[1].image).toContain(`/social/pieza/${a.id}/story-75000-100000-`);
    expect(stories[1].link).toBe('https://www.mercadolibre.cl/p/MLC123?matt_word=comparatech&matt_tool=12345');
  });

  it('sin marcas no lee los productos', async () => {
    const { admin, asked } = fakeTables({ social_posts: [], products: [product()] });
    expect(await readPostedStories(admin, NOW, KEY)).toEqual([]);
    expect(asked).toEqual(['social_posts']);
  });

  it('sin la tabla no hay historias; con otro error, falla', async () => {
    const missing = fakeTables({}, { social_posts: { code: '42P01', message: 'no existe' } });
    expect(await readPostedStories(missing.admin, NOW, KEY)).toEqual([]);
    const broken = fakeTables({}, { social_posts: { code: '500', message: 'se cayó' } });
    await expect(readPostedStories(broken.admin, NOW, KEY)).rejects.toThrow('se cayó');
  });
});
