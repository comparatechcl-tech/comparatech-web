import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// La lectura del historial va a Supabase: acá solo se prueba lo puro.
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
  // La lectura que avisa lo que no pudo leer se arma sobre la misma de mentira: acá se lee todo.
  const getPriceStatsManyChecked = async (ids: string[]) => ({ stats: await getPriceStatsMany(ids), unread: new Set<string>() });
  return { getPriceStatsMany, getPriceStatsManyChecked };
});
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// El catálogo se entrega ya leído; la selección es la de verdad.
vi.mock('@/lib/social/telegram', async (original) => ({
  ...(await original<typeof import('@/lib/social/telegram')>()),
  readFreshSocialProducts: vi.fn(),
}));

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PriceStats } from '@/lib/deals';
import { getPriceStatsMany } from '@/lib/queries/price-history';
import { readAffiliateSettings } from '@/lib/settings';
import { MIN_INTEREST_POINTS, type InterestEvidence, type InterestScore } from '@/lib/social/interest';
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

/**
 * Una oferta que cualquier canal publicaría: audífonos de marca conocida, de
 * tienda oficial y con 40% de lista. Queda muy por encima del piso de interés.
 */
function strong(over: Partial<SocialProduct> = {}): SocialProduct {
  return product({
    name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
    brand: 'JBL',
    price: 60_000,
    original_price: 100_000,
    seller_sales_count: 50_000,
    ml_root_category: 'MLC1000',
    offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true } as SocialProduct['offer_info'],
    ...over,
  });
}

/** La selección de un producto solo, sin piso de interés ni avisos: para probar cómo se arma la historia. */
function pickOne(p: SocialProduct, evidence?: Map<string, InterestEvidence>) {
  const [pick] = pickByRules([p], { now: NOW, recentlyPosted: new Set(), evidence }, { ...STORY_RULES, anyScore: true });
  return pick;
}

/** Lo que el historial dice de un producto cuyo precio de hoy rige desde hace dos días. */
function stats(price: number, over: Partial<PriceStats> = {}): PriceStats {
  return {
    min30: price,
    median30: price,
    max30: price,
    minTracked: price,
    maxTracked: price,
    daysTracked: 20,
    lastPrice: price,
    previousPrice: null,
    lastChangeAt: null,
    lastPriceSeenRecently: false,
    changesLast48h: 0,
    previousIsFirstRecord: false,
    lastPriceNearRecent: false,
    ...over,
    // Salvo que el test diga otra cosa: el mínimo se sostuvo y el precio anterior era el habitual.
    min30Held: over.min30Held ?? over.min30 ?? price,
    usualPriceBefore: 'usualPriceBefore' in over ? over.usualPriceBefore ?? null : over.previousPrice ?? null,
    firstSeenAt: over.firstSeenAt ?? new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
    trackedBeforeChangeMs:
      'trackedBeforeChangeMs' in over ? over.trackedBeforeChangeMs ?? null : (over.previousPrice ?? null) === null ? null : 18 * 86_400_000,
  };
}

/** El mismo historial, con una baja desde `previous` hace dos días. */
function droppedFrom(price: number, previous: number): PriceStats {
  return stats(price, {
    max30: previous,
    maxTracked: previous,
    previousPrice: previous,
    lastChangeAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
  });
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
  vi.mocked(getPriceStatsMany).mockReset();
  vi.mocked(getPriceStatsMany).mockResolvedValue(new Map());
});

describe('STORY_RULES', () => {
  it('usa las reglas del plan de publicaciones, con más productos', () => {
    expect(STORY_RULES.minDiscount).toBe(NETWORK_RULES.minDiscount);
    expect(STORY_RULES.maxPriceAgeMs).toBe(NETWORK_RULES.maxPriceAgeMs);
    expect(STORY_RULES.repeatAfterDays).toBe(NETWORK_RULES.repeatAfterDays);
    expect(STORY_RULES.maxPosts).toBeGreaterThan(NETWORK_RULES.maxPosts);
  });

  it('no esconde lo que trae un aviso: el dueño lo ve en la tarjeta y decide', () => {
    expect(NETWORK_RULES.cleanOnly).toBe(true);
    expect(STORY_RULES.cleanOnly).toBe(false);
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
    const evidence = new Map([[p.id, { drop: { pct: 7.6, amount: 6_600 }, min30: 80_000, daysTracked: 12 }]]);
    const byDrop = buildStoryItem(pickOne(p, evidence), { now: NOW, settings: DIRECT, key: KEY })!;
    expect(byDrop).toMatchObject({ discount: 0, listPrice: null, drop: 8 });
    expect(byDrop.image).toContain('/story-80000-0-');
  });

  it('lleva el motivo, el aviso y los puntos del puntaje de interés', () => {
    const pick = pickOne(strong());
    const item = buildStoryItem(pick, { now: NOW, settings: DIRECT, key: KEY })!;
    expect(item.reason).toBe(pick.score.reason);
    expect(item.reason.length).toBeGreaterThan(10);
    expect(item.warning).toBeNull();
    expect(item.points).toBe(pick.score.points);

    const score: InterestScore = {
      ...pick.score,
      points: 58.5,
      reason: 'Audífonos JBL, 40% por debajo del precio de lista',
      warning: 'hace poco estuvo a $55.000',
    };
    expect(buildStoryItem({ ...pick, score }, { now: NOW, settings: DIRECT, key: KEY })).toMatchObject({
      points: 58.5,
      reason: 'Audífonos JBL, 40% por debajo del precio de lista',
      warning: 'hace poco estuvo a $55.000',
    });
  });

  it('una historia ya publicada no lleva motivo ni aviso', () => {
    const p = product();
    const item = buildStoryItem({ product: p, discount: 20, drop: null, score: null }, { now: NOW, settings: DIRECT, key: KEY })!;
    expect(item).toMatchObject({ id: p.id, discount: 20, reason: '', warning: null, points: 0 });
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
    const rows = categories.flatMap((category) => Array.from({ length: 5 }, () => strong({ category })));
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
    const posted = strong({ category: 'audio' }); // 60.000, subida a 60.000: no vuelve
    const cheaper = strong({ category: 'gaming' }); // 60.000, subida a 70.000: vuelve
    const backToUsual = strong({ category: 'hogar' }); // subida a 60.000 y a 75.000: sigue en su precio más bajo
    const fresh = strong({ category: 'celulares' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [fresh, posted, cheaper, backToUsual], error: null });
    const { admin } = fakeAdmin([
      story(posted.id, 60_000, 2),
      story(cheaper.id, 70_000, 3),
      story(backToUsual.id, 75_000, 1),
      story(backToUsual.id, 60_000, 4),
    ]);

    const items = await readStoryPicks(admin, NOW, KEY);
    expect(items.map((item) => item.id)).toEqual([cheaper.id, fresh.id]);
    expect(items[0].again).toMatchObject({ price: 70_000 });
    expect(items[1].again).toBeNull();
  });

  it('lee el historial de todo lo que puede salir, también de lo que ya trae descuento de lista', async () => {
    const posted = strong({ category: 'audio' });
    const deal = strong({ category: 'gaming' });
    const flat = strong({ category: 'hogar', original_price: null });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [posted, deal, flat], error: null });

    await readStoryPicks(fakeAdmin([story(posted.id, 60_000, 2)]).admin, NOW, KEY);
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenCalledTimes(1);
    // Lo que ya se subió y no bajó no puede salir: su historial no se lee.
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([deal.id, flat.id]);
  });

  it('después de las que bajaron, van en orden de interés y no de comisión', async () => {
    // Tres veces la misma oferta. Lo único que cambia es lo que el sitio vio:
    // una bajó $20.000 hace dos días y las otras no se movieron.
    const steady = strong({ category: 'audio' });
    const dropped = strong({ category: 'gaming' });
    const again = strong({ category: 'hogar' });
    // Lo que más comisión deja de la lista, con una oferta chica y un precio que pocos pagan.
    const fridge = strong({
      name: 'Refrigerador Side by Side 578 lt Samsung',
      brand: 'Samsung',
      category: 'electrodomesticos',
      price: 899_990,
      original_price: 1_124_990,
    });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [fridge, steady, dropped, again], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [fridge.id, stats(899_990)],
        [steady.id, stats(60_000)],
        [dropped.id, droppedFrom(60_000, 80_000)],
        [again.id, stats(60_000)],
      ])
    );

    const items = await readStoryPicks(fakeAdmin([story(again.id, 70_000, 3)]).admin, NOW, KEY);
    const order = items.map((item) => item.id);
    expect(order.filter((id) => id !== fridge.id)).toEqual([again.id, dropped.id, steady.id]);
    // Por comisión el refrigerador iba primero. Ahora va al final, si es que llega al piso de interés.
    expect([-1, order.length - 1]).toContain(order.indexOf(fridge.id));

    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(dropped.id)?.drop).toBe(25);
    expect(byId.get(dropped.id)!.points).toBeGreaterThan(byId.get(steady.id)!.points);
    for (const item of items) {
      expect(item.points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
      expect(item.reason.length).toBeGreaterThan(10);
    }
  });

  it('lo que el sitio vio mucho más barato hace poco no se muestra, aunque traiga descuento de lista', async () => {
    const honest = strong({ category: 'audio' });
    const inflated = strong({ category: 'gaming' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [inflated, honest], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [honest.id, stats(60_000)],
        // Hace diez días estuvo a $40.000: hoy cuesta la mitad más.
        [inflated.id, stats(60_000, { min30: 40_000, minTracked: 40_000 })],
      ])
    );

    const items = await readStoryPicks(fakeAdmin([]).admin, NOW, KEY);
    expect(items.map((item) => item.id)).toEqual([honest.id]);
  });

  it('lo que interesa poco no se muestra, aunque sobren cupos', async () => {
    const cable = product({
      name: 'Cable Usb Tipo C 2 Metros Carga Rápida',
      brand: 'Genérica',
      category: 'electronica',
      price: 3_990,
      original_price: 9_990,
      seller_sales_count: 800,
      offer_info: { free_shipping: false, is_full: false },
    });
    const fine = strong();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [cable, fine], error: null });
    const items = await readStoryPicks(fakeAdmin([]).admin, NOW, KEY);
    expect(items.map((item) => item.id)).toEqual([fine.id]);
  });

  it('una oferta con algo que mirar se muestra igual, con su aviso', async () => {
    // Una consola que bajó de verdad, pero de un vendedor casi sin ventas.
    const doubtful = strong({
      name: 'Consola PlayStation 5 Slim Digital 1TB Blanco',
      brand: 'Sony',
      category: 'gaming',
      price: 449_990,
      original_price: null,
      seller_sales_count: 4,
      offer_info: { free_shipping: true, is_full: true, official_store: false, is_lowest: true } as SocialProduct['offer_info'],
    });
    const fine = strong();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [doubtful, fine], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[doubtful.id, droppedFrom(449_990, 599_990)]]));

    const items = await readStoryPicks(fakeAdmin([]).admin, NOW, KEY);
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get(doubtful.id)?.warning).toEqual(expect.any(String));
    expect(byId.get(fine.id)?.warning).toBeNull();
  });

  it('si el historial no se pudo leer, igual muestra las ofertas de lista', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fine = strong();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [fine], error: null });
    vi.mocked(getPriceStatsMany).mockRejectedValue(new Error('sin conexión'));
    const items = await readStoryPicks(fakeAdmin([]).admin, NOW, KEY);
    expect(items.map((item) => item.id)).toEqual([fine.id]);
    warn.mockRestore();
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
    // Ya se decidió subirlas: no llevan motivo ni aviso, y no leen el historial de precios.
    expect(stories[1]).toMatchObject({ reason: '', warning: null });
    expect(vi.mocked(getPriceStatsMany)).not.toHaveBeenCalled();
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
