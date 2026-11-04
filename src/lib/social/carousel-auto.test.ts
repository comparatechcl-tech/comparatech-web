import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCheck } from './live-price';
import type { SocialProduct } from './telegram';

/**
 * El carrusel automático de los jueves (lib/social/carousel-auto), con la
 * selección, Meta y Mercado Libre de mentira. Lo que importa: solo los
 * jueves y los días extra, a lo más uno por semana, sin lo que cambió de
 * precio en Mercado Libre, con 3 bajas o más, y que quede marcado.
 */

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsManyChecked: vi.fn(async () => ({ stats: new Map(), unread: new Set() })) }));
vi.mock('@/lib/social/telegram', async (original) => ({
  ...(await original<typeof import('@/lib/social/telegram')>()),
  readFreshSocialProducts: vi.fn(async () => ({ rows: [], error: null })),
}));
const fake = vi.hoisted(() => ({ picks: [] as unknown[], marks: [] as unknown[], posts: [] as Record<string, unknown>[] }));
vi.mock('@/lib/social/carousel', async (original) => ({
  ...(await original<typeof import('@/lib/social/carousel')>()),
  pickCarouselDrops: () => ({ picks: fake.picks, qualifying: fake.picks.length }),
}));
vi.mock('@/lib/social/carousel-marks', async (original) => ({
  ...(await original<typeof import('@/lib/social/carousel-marks')>()),
  readCarouselMarks: vi.fn(async () => fake.marks),
}));
vi.mock('@/lib/social/meta', async (original) => ({
  ...(await original<typeof import('@/lib/social/meta')>()),
  metaCredentials: () => ({ appId: '1', appSecret: 's' }),
  readMetaConnection: async () => ({ connection: { pageId: '111', pageToken: 'EAA' + 'P'.repeat(40), igUserId: '1784' } }),
}));
const publish = vi.hoisted(() => ({
  ig: vi.fn(async () => ({ mediaId: 'm1', permalink: 'https://www.instagram.com/p/x/' })),
  fb: vi.fn(async () => ({ postId: 'p1', permalink: 'https://www.facebook.com/p1' })),
}));
vi.mock('@/lib/social/meta-publish', async (original) => ({
  ...(await original<typeof import('@/lib/social/meta-publish')>()),
  publishInstagramCarousel: publish.ig,
  publishFacebookPhotos: publish.fb,
}));

import { isCarouselAutoDay, runCarouselAuto } from './carousel-auto';

/** Jueves 5 de noviembre de 2026, 11:45 en Chile. */
const THURSDAY = new Date('2026-11-05T14:45:00Z');
const SITE = 'https://www.comparatech.cl';

function product(n: number): SocialProduct {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `producto-${n}`,
    name: `Producto ${n}`,
    brand: `Marca ${n}`,
    category: 'audio',
    price: 90_000 + n,
    original_price: null,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: `MLC${1000 + n}`,
    ml_family_id: null,
    price_checked_at: '2026-11-05T14:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    seller_reputation: 'verde',
    seller_sales_count: 10_000,
    is_active: true,
    is_hidden: false,
    offer_info: { free_shipping: true, is_full: false },
    ml_root_category: null,
    deleted_at: null,
  } as SocialProduct;
}
const pick = (n: number) => ({ product: product(n), drop: { amount: 10_000, pct: 10, since: '2026-11-03T12:00:00Z' }, score: {} });

function fakeAdmin() {
  return {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        order: () => q,
        limit: async () => ({ data: [], error: null }),
        insert: async (rows: Record<string, unknown>[]) => {
          if (table === 'social_posts') fake.posts.push(...rows);
          return { error: null };
        },
      };
      return q;
    },
  } as never;
}

const same: LiveCheck = { status: 'same', checkedAt: '2026-11-05T14:45:00Z' };
const changed = { status: 'changed', checkedAt: '2026-11-05T14:45:00Z' } as LiveCheck;

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'un-secreto-de-prueba-de-mas-de-32-caracteres');
  fake.picks = [pick(1), pick(2), pick(3), pick(4)];
  fake.marks = [];
  fake.posts = [];
  publish.ig.mockClear();
  publish.fb.mockClear();
});

describe('isCarouselAutoDay', () => {
  it('los jueves y el 28 y 30-11', () => {
    expect(isCarouselAutoDay(20261105)).toBe(true);
    expect(isCarouselAutoDay(20261104)).toBe(false);
    expect(isCarouselAutoDay(20261128)).toBe(true);
    expect(isCarouselAutoDay(20261130)).toBe(true);
    expect(isCarouselAutoDay(20261129)).toBe(false);
  });
});

describe('runCarouselAuto', () => {
  it('el jueves publica en las dos redes, sin lo que cambió en Mercado Libre, y lo marca', async () => {
    const liveCheck = vi.fn(async () => ({ [product(1).id]: same, [product(2).id]: changed, [product(3).id]: same, [product(4).id]: same }));
    const summary = await runCarouselAuto(fakeAdmin(), THURSDAY, { siteUrl: SITE, liveCheck });
    expect(summary).toMatchObject({ ok: true, products: 3, removed: 1, marked: true });
    expect(publish.ig).toHaveBeenCalledTimes(1);
    expect(publish.fb).toHaveBeenCalledTimes(1);
    const { imageUrls, caption } = (publish.ig.mock.calls[0] as unknown as [unknown, unknown, { imageUrls: string[]; caption: string }])[2];
    // Portada, 3 productos y cierre, todas del propio sitio.
    expect(imageUrls).toHaveLength(5);
    for (const url of imageUrls) expect(url.startsWith(`${SITE}/social/carrusel/`)).toBe(true);
    expect(caption).toContain('Top 3 bajas de la semana');
    expect(caption).not.toContain('Producto 2');
    expect(fake.posts.map((p) => p.product_id)).toEqual([product(1).id, product(3).id, product(4).id]);
    expect(new Set(fake.posts.map((p) => p.posted_at)).size).toBe(1);
    expect(fake.posts.every((p) => p.caption === 'carrusel' && p.channel === 'instagram')).toBe(true);
  });

  it('otro día no hace nada', async () => {
    const liveCheck = vi.fn();
    const summary = await runCarouselAuto(fakeAdmin(), new Date('2026-11-04T14:45:00Z'), { siteUrl: SITE, liveCheck });
    expect(summary.skipped).toMatch(/jueves/);
    expect(liveCheck).not.toHaveBeenCalled();
    expect(publish.ig).not.toHaveBeenCalled();
  });

  it('si ya salió uno en los últimos 7 días, o hoy, no publica otro', async () => {
    const liveCheck = vi.fn();
    fake.marks = [{ postedAt: '2026-11-01T15:00:00Z', posts: [] }];
    expect((await runCarouselAuto(fakeAdmin(), THURSDAY, { siteUrl: SITE, liveCheck })).skipped).toMatch(/7 días/);
    fake.marks = [{ postedAt: '2026-11-05T14:46:00Z', posts: [] }];
    expect((await runCarouselAuto(fakeAdmin(), THURSDAY, { siteUrl: SITE, liveCheck })).skipped).toMatch(/hoy ya salió/);
    expect(publish.ig).not.toHaveBeenCalled();
  });

  it('el 28-11 sale aunque el jueves ya haya salido uno', async () => {
    fake.marks = [{ postedAt: '2026-11-26T15:00:00Z', posts: [] }];
    const liveCheck = vi.fn(async () => Object.fromEntries(fake.picks.map((p) => [(p as ReturnType<typeof pick>).product.id, same])));
    const summary = await runCarouselAuto(fakeAdmin(), new Date('2026-11-28T14:45:00Z'), { siteUrl: SITE, liveCheck });
    expect(summary).toMatchObject({ ok: true, products: 4 });
  });

  it('con menos de 3 bajas, antes o después de revisar en Mercado Libre, no sale', async () => {
    fake.picks = [pick(1), pick(2)];
    const liveCheck = vi.fn();
    expect((await runCarouselAuto(fakeAdmin(), THURSDAY, { siteUrl: SITE, liveCheck })).skipped).toMatch(/con menos de 3/);
    expect(liveCheck).not.toHaveBeenCalled();

    fake.picks = [pick(1), pick(2), pick(3)];
    const someChanged = vi.fn(async () => ({ [product(1).id]: same, [product(2).id]: changed, [product(3).id]: same }));
    expect((await runCarouselAuto(fakeAdmin(), THURSDAY, { siteUrl: SITE, liveCheck: someChanged })).skipped).toMatch(/quedaron 2/);
    expect(publish.ig).not.toHaveBeenCalled();
    expect(fake.posts).toHaveLength(0);
  });
});
