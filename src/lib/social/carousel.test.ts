import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterestEvidence, InterestProduct, InterestScore } from '@/lib/social/interest';

// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// El historial y el catálogo se entregan ya leídos (readCarouselPage); la selección es la de verdad.
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(), getPriceStatsManyChecked: vi.fn() }));
vi.mock('@/lib/social/telegram', async (original) => ({
  ...(await original<typeof import('@/lib/social/telegram')>()),
  readFreshSocialProducts: vi.fn(),
  selectSocialProducts: vi.fn(),
}));
vi.mock('@/lib/social/carousel-marks', async (original) => ({
  ...(await original<typeof import('@/lib/social/carousel-marks')>()),
  readCarouselMarks: vi.fn(),
}));

/**
 * El puntaje de verdad, salvo lo que cada test fija a mano por producto: así
 * las reglas del carrusel (piso, avisos, variedad) se prueban con números
 * puestos acá y no con los pesos de las tablas, que se afinan seguido.
 */
const fixed = vi.hoisted(() => ({ scores: new Map<string, Partial<InterestScore>>() }));
vi.mock('@/lib/social/interest', async (original) => {
  const real = await original<typeof import('@/lib/social/interest')>();
  return {
    ...real,
    interestScore: (product: InterestProduct, evidence: InterestEvidence): InterestScore => ({
      ...real.interestScore(product, evidence),
      ...fixed.scores.get(product.id),
    }),
  };
});

import { priceStats, type PriceStats } from '@/lib/deals';
import { getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { lastShownAt, readCarouselMarks, type CarouselBatch } from '@/lib/social/carousel-marks';
import { CAROUSEL_RULES, buildWeeklyCarousel, pickCarouselDrops, readCarouselPage } from '@/lib/social/carousel';
import { carouselKey, checkCarouselPath } from '@/lib/social/carousel-url';
import { MIN_INTEREST_POINTS } from '@/lib/social/interest';
import { readFreshSocialProducts, selectSocialProducts, type SocialProduct } from '@/lib/social/telegram';

/** Domingo 18 de octubre, 18:00 en Chile. */
const NOW = new Date('2026-10-18T21:00:00Z');
const DAY = 86_400_000;
const HOUR = 3_600_000;
const KEY = carouselKey({ CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv)!;
const SITE = 'https://www.comparatech.cl';

let seq = 0;
/** Un producto a la venta, con el precio revisado hace 20 minutos y sin descuento de lista. */
function product(over: Partial<SocialProduct> = {}): SocialProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: `Producto de prueba ${seq}`,
    brand: `Marca ${seq}`,
    category: `categoria-${seq}`,
    price: 90_000,
    original_price: null,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: `MLC${1000 + seq}`,
    ml_family_id: null,
    price_checked_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    created_at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
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

/** Bien arriba del piso, sin aviso, con tipo y marca propios (la variedad no lo frena). */
function scored(p: SocialProduct, score: Partial<InterestScore> = {}): SocialProduct {
  fixed.scores.set(p.id, {
    points: MIN_INTEREST_POINTS + 40,
    warning: null,
    excluded: null,
    typeKey: `tipo-${p.slug}`,
    brandKey: `marca-${p.slug}`,
    breakdown: { signals: 0 },
    ...score,
  });
  return p;
}

/** El historial de un producto que costó `before` desde hace 30 días y bajó a su precio de hoy en `since`. */
function dropped(before: number, price: number, since: Date): PriceStats {
  return priceStats(
    [
      { price: before, observed_at: new Date(NOW.getTime() - 30 * DAY).toISOString() },
      { price, observed_at: since.toISOString() },
    ],
    NOW.getTime()
  ) as PriceStats;
}

/** Un producto que bajó de `before` a `price` hace `days` días, con su historial. */
function drop(before: number, price: number, days: number, over: Partial<SocialProduct> = {}, score: Partial<InterestScore> = {}) {
  const p = scored(product({ price, ...over }), score);
  return { p, stats: dropped(before, price, new Date(NOW.getTime() - days * DAY)) };
}

function pick(entries: { p: SocialProduct; stats: PriceStats }[], shownAt?: Map<string, number>) {
  const stats = new Map(entries.map((e) => [e.p.id, e.stats]));
  return pickCarouselDrops(entries.map((e) => e.p), stats, { now: NOW, shownAt });
}
const ids = (selection: ReturnType<typeof pick>) => selection.picks.map((x) => x.product.id);

beforeEach(() => {
  fixed.scores.clear();
});

describe('pickCarouselDrops: qué baja entra', () => {
  it('ordena por cuánto bajó en pesos, no por el porcentaje', () => {
    const tv = drop(1_000_000, 900_000, 2); // $100.000 (10%)
    const audifonos = drop(100_000, 60_000, 2); // $40.000 (40%)
    const notebook = drop(500_000, 450_000, 2); // $50.000 (10%)
    const selection = pick([audifonos, notebook, tv]);
    expect(ids(selection)).toEqual([tv.p.id, notebook.p.id, audifonos.p.id]);
    expect(selection.picks.map((x) => x.drop.amount)).toEqual([100_000, 50_000, 40_000]);
  });

  it('solo bajas de algún día de esta semana en Chile: del lunes 12 al domingo 18', () => {
    // Lunes 12 a las 00:30 en Chile: entra. Domingo 11 a las 23:30 en Chile: no.
    const monday = { ...drop(100_000, 80_000, 0), stats: dropped(100_000, 80_000, new Date('2026-10-12T03:30:00Z')) };
    const sunday = { ...drop(100_000, 80_000, 0), stats: dropped(100_000, 80_000, new Date('2026-10-12T02:30:00Z')) };
    expect(ids(pick([monday, sunday]))).toEqual([monday.p.id]);
  });

  it('una baja menor que 5% no entra, aunque el historial la confirme', () => {
    const small = drop(100_000, 96_000, 2); // 4%
    const enough = drop(100_000, 95_000, 2); // 5%
    expect(ids(pick([small, enough]))).toEqual([enough.p.id]);
  });

  it('sin una baja que el historial confirme no entra: un precio que va y vuelve, o que subió', () => {
    const p = scored(product({ price: 80_000 }));
    const seesaw = priceStats(
      [
        { price: 80_000, observed_at: new Date(NOW.getTime() - 20 * DAY).toISOString() },
        { price: 100_000, observed_at: new Date(NOW.getTime() - 5 * DAY).toISOString() },
        { price: 80_000, observed_at: new Date(NOW.getTime() - 2 * DAY).toISOString() },
      ],
      NOW.getTime()
    ) as PriceStats;
    const up = drop(80_000, 100_000, 2);
    const noHistory = scored(product());
    const stats = new Map([
      [p.id, seesaw],
      [up.p.id, up.stats],
    ]);
    expect(pickCarouselDrops([p, up.p, noHistory], stats, { now: NOW }).picks).toEqual([]);
  });

  it('el precio tiene que estar revisado hace 6 horas o menos, y no en el futuro', () => {
    const fresh = drop(100_000, 80_000, 2, { price_checked_at: new Date(NOW.getTime() - 6 * HOUR + 60_000).toISOString() });
    const stale = drop(100_000, 80_000, 2, { price_checked_at: new Date(NOW.getTime() - 6 * HOUR - 60_000).toISOString() });
    const future = drop(100_000, 80_000, 2, { price_checked_at: new Date(NOW.getTime() + 5 * 60_000).toISOString() });
    const never = drop(100_000, 80_000, 2, { price_checked_at: null });
    expect(ids(pick([fresh, stale, future, never]))).toEqual([fresh.p.id]);
  });

  it('lo que no está a la venta o se sacó del sitio no entra', () => {
    const ok = drop(100_000, 80_000, 2);
    const paused = drop(100_000, 80_000, 2, { is_active: false });
    const hidden = drop(100_000, 80_000, 2, { is_hidden: true });
    const deleted = drop(100_000, 80_000, 2, { deleted_at: NOW.toISOString() });
    expect(ids(pick([ok, paused, hidden, deleted]))).toEqual([ok.p.id]);
  });

  it('no entra si otra versión del mismo modelo está 5% o más barata', () => {
    const pricey = drop(120_000, 100_000, 2, { ml_family_id: 'MLC-F1' });
    const cheaperColor = scored(product({ price: 90_000, ml_family_id: 'MLC-F1' })); // no bajó, pero es la referencia
    const stats = new Map([[pricey.p.id, pricey.stats]]);
    expect(pickCarouselDrops([pricey.p, cheaperColor], stats, { now: NOW }).picks).toEqual([]);
  });

  it('lo que trae un aviso, lo excluido y lo que no llega al piso de interés no entra', () => {
    const ok = drop(100_000, 80_000, 2);
    const warned = drop(100_000, 80_000, 2, {}, { warning: 'el precio cambió 4 veces en dos días' });
    const excluded = drop(100_000, 80_000, 2, {}, { excluded: 'vendedor con pocas ventas y otro vendedor lo ofrece a menos' });
    const weak = drop(100_000, 80_000, 2, {}, { points: MIN_INTEREST_POINTS - 1 });
    expect(ids(pick([ok, warned, excluded, weak]))).toEqual([ok.p.id]);
  });

  it('la misma baja no vuelve si ya salió en un carrusel; si bajó otra vez después, sí', () => {
    const again = drop(100_000, 80_000, 2);
    const repeated = drop(100_000, 80_000, 3);
    const shownAt = new Map([
      // Salió en el carrusel del domingo pasado y bajó hace dos días: es otra baja.
      [again.p.id, NOW.getTime() - 7 * DAY],
      // Salió ayer, con esta misma baja de hace tres días.
      [repeated.p.id, NOW.getTime() - 1 * DAY],
    ]);
    expect(ids(pick([again, repeated], shownAt))).toEqual([again.p.id]);
  });
});

describe('pickCarouselDrops: variedad y cupo', () => {
  it('cinco como mucho, de la baja más grande a la más chica', () => {
    const all = Array.from({ length: 8 }, (_, i) => drop(200_000, 200_000 - (i + 1) * 10_000, 2));
    const selection = pick(all);
    expect(ids(selection)).toEqual(all.slice(3).reverse().map((x) => x.p.id));
    expect(selection.qualifying).toBe(8);
  });

  it('dos por categoría como mucho, también si no se llega a cinco', () => {
    const audio = [1, 2, 3].map((i) => drop(200_000, 200_000 - i * 10_000, 2, { category: 'audio' }));
    const other = drop(100_000, 95_000, 2, { category: 'hogar' });
    const selection = pick([...audio, other]);
    expect(ids(selection)).toEqual([audio[2].p.id, audio[1].p.id, other.p.id]);
    // Las tres de audio cumplen las reglas: el tope de la categoría las deja fuera, no las reglas.
    expect(selection.qualifying).toBe(4);
  });

  it('un color por modelo: queda el que más bajó', () => {
    const black = drop(300_000, 250_000, 2, { ml_family_id: 'MLC-F9', price: 250_000 });
    const white = drop(300_000, 255_000, 2, { ml_family_id: 'MLC-F9', price: 255_000 });
    const selection = pick([black, white]);
    expect(ids(selection)).toEqual([black.p.id]);
    expect(selection.qualifying).toBe(1);
  });

  it('primero uno por tipo y dos por marca; si así no llega a cinco, los repite', () => {
    const tvs = [1, 2, 3].map((i) =>
      drop(500_000, 500_000 - i * 30_000, 2, { category: `tv-${i}` }, { typeKey: 'televisor', brandKey: `marca-tv-${i}` })
    );
    const others = [25, 24, 23, 22].map((k) => drop(200_000, 200_000 - k * 1_000, 2));
    // Con cinco de tipos distintos, entra el televisor que más bajó y los otros cuatro, aunque bajaron menos.
    expect(ids(pick([...tvs, ...others]))).toEqual([tvs[2].p.id, ...others.map((x) => x.p.id)]);
    // Con pocos, los televisores se repiten en la segunda vuelta; el orden sigue siendo por cuánto bajó.
    const phone = drop(300_000, 250_000, 2, {}, { typeKey: 'celular', brandKey: 'samsung' });
    expect(ids(pick([...tvs, phone]))).toEqual([tvs[2].p.id, tvs[1].p.id, phone.p.id, tvs[0].p.id]);
  });

  it('si hay menos de cinco, no rellena: devuelve los que hay', () => {
    const two = [drop(100_000, 80_000, 2), drop(100_000, 90_000, 2)];
    const weak = drop(100_000, 80_000, 2, {}, { points: 0 });
    const selection = pick([...two, weak]);
    expect(selection.picks).toHaveLength(2);
    expect(selection.qualifying).toBe(2);
  });
});

describe('buildWeeklyCarousel', () => {
  const picks = () =>
    pick([
      drop(1_000_000, 879_990, 3, { name: 'Notebook HP 15 Intel Core i7 16GB 512GB', brand: 'HP', slug: 'notebook-hp-15', original_price: 1_099_990, offer_info: { free_shipping: true, is_full: true } }),
      drop(129_990, 99_990, 5, { name: 'Campana de cocina Electrolux 90cm', brand: 'Electrolux', slug: 'campana-electrolux', ml_product_id: null }),
      drop(119_990, 95_990, 4, { name: 'Parlante JBL Flip 6', brand: 'JBL', slug: 'parlante-jbl-flip-6', original_price: 80_000 }),
    ]).picks;

  it('con menos de tres no se arma', () => {
    expect(buildWeeklyCarousel(picks().slice(0, 2), { now: NOW, key: KEY, siteUrl: SITE })).toBeNull();
    expect(buildWeeklyCarousel([], { now: NOW, key: KEY, siteUrl: SITE })).toBeNull();
  });

  it('arma la portada, una lámina por producto en orden y el cierre, todas firmadas', () => {
    const carousel = buildWeeklyCarousel(picks(), { now: NOW, key: KEY, siteUrl: SITE })!;
    expect(carousel.day).toBe(20261018);
    expect(carousel.rangeLabel).toBe('del 12 al 18 de octubre');
    expect(carousel.entries.map((e) => e.rank)).toEqual([1, 2, 3]);
    const now = Math.floor(NOW.getTime() / 1000);
    for (const image of [carousel.cover.image, ...carousel.entries.map((e) => e.image), carousel.closing.image]) {
      const [, , , idsSegment, file] = image.split('/');
      expect(checkCarouselPath(idsSegment, file, KEY, now).ok, image).toBe(true);
    }
    const first = carousel.entries[0];
    const [, , , idsSegment, file] = first.image.split('/');
    const check = checkCarouselPath(idsSegment, file, KEY, now);
    expect(check.ok && check.slide.type === 'producto' && check.slide.item).toEqual({
      rank: 1,
      price: 879_990,
      dropAmount: 120_010,
      dropSince: Math.floor((NOW.getTime() - 3 * DAY) / 1000),
      checkedAt: Math.floor((NOW.getTime() - 20 * 60_000) / 1000),
      freeShipping: true,
      full: true,
    });
  });

  it('los archivos se llaman en el orden en que se publican', () => {
    const carousel = buildWeeklyCarousel(picks(), { now: NOW, key: KEY, siteUrl: SITE })!;
    expect([carousel.cover.fileName, ...carousel.entries.map((e) => e.fileName), carousel.closing.fileName]).toEqual([
      'comparatech-top3-2026-10-18-0-portada.jpg',
      'comparatech-top3-2026-10-18-1-notebook-hp-15.jpg',
      'comparatech-top3-2026-10-18-2-campana-electrolux.jpg',
      'comparatech-top3-2026-10-18-3-parlante-jbl-flip-6.jpg',
      'comparatech-top3-2026-10-18-4-cierre.jpg',
    ]);
  });

  it('cada producto trae lo que revisa la tarjeta: precio, baja, fecha y la ficha sin afiliado', () => {
    const [notebook, campana, parlante] = buildWeeklyCarousel(picks(), { now: NOW, key: KEY, siteUrl: SITE })!.entries;
    expect(notebook).toMatchObject({ price: 879_990, dropAmount: 120_010, dropPct: 12, listPrice: 1_099_990, freeShipping: true, full: true });
    expect(notebook.mlUrl).toMatch(/^https:\/\/www\.mercadolibre\.cl\/p\/MLC\d+$/);
    expect(notebook.since).toBe(new Date(NOW.getTime() - 3 * DAY).toISOString());
    // Sin ficha de Mercado Libre, no hay botón.
    expect(campana.mlUrl).toBeNull();
    // Un "precio sin descuento" menor que el precio no es una rebaja: no se manda.
    expect(parlante.listPrice).toBeNull();
  });

  it('los textos dicen el puesto, el precio y cuánto bajó, y dónde comprar en cada red', () => {
    const { captions } = buildWeeklyCarousel(picks(), { now: NOW, key: KEY, siteUrl: SITE })!;
    expect(captions.instagram).toContain('📉 Top 3 bajas de la semana (del 12 al 18 de octubre), según nuestro historial de precios:');
    expect(captions.instagram).toContain('1️⃣ Notebook HP 15 Intel Core i7 16GB 512GB: $879.990, bajó $120.010');
    expect(captions.instagram).toContain('🛒 Link de compra en nuestra bio, o búscalo en comparatech.cl');
    expect(captions.facebook).toContain('🛒 Links de compra: https://www.comparatech.cl/hoy?src=facebook-carrusel');
    expect(captions.facebook).not.toContain('bio');
  });
});

describe('readCarouselPage', () => {
  const admin = {} as never;

  function catalog(entries: { p: SocialProduct; stats: PriceStats }[]) {
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: entries.map((e) => e.p), error: null });
    vi.mocked(getPriceStatsManyChecked).mockResolvedValue({
      stats: new Map(entries.map((e) => [e.p.id, e.stats])),
      unread: new Set(['00000000-0000-4000-8000-999999999999']),
    });
    vi.mocked(selectSocialProducts).mockImplementation(async () => ({ rows: entries.map((e) => e.p), has0017: true, error: null }));
  }
  function batch(postedAt: Date, entries: { p: SocialProduct }[]): CarouselBatch {
    return { postedAt: postedAt.toISOString(), posts: entries.map((e, i) => ({ postId: 50 + i, productId: e.p.id, postedPrice: e.p.price })) };
  }

  beforeEach(() => {
    vi.mocked(readCarouselMarks).mockReset();
    vi.mocked(readCarouselMarks).mockResolvedValue([]);
    vi.mocked(readFreshSocialProducts).mockReset();
    vi.mocked(getPriceStatsManyChecked).mockReset();
    vi.mocked(selectSocialProducts).mockReset();
  });

  it('sin carrusel publicado esta semana, arma el de ahora con el catálogo fresco', async () => {
    const entries = [drop(100_000, 70_000, 1), drop(100_000, 80_000, 1), drop(100_000, 90_000, 1)];
    catalog(entries);
    const page = await readCarouselPage(admin, NOW, KEY, { siteUrl: SITE });
    expect(page.carousel?.entries.map((e) => e.id)).toEqual(entries.map((e) => e.p.id));
    expect(page).toMatchObject({ found: 3, qualifying: 3, unread: 1, published: null, nextDay: null });
    // El catálogo, con el precio revisado en las últimas 6 horas.
    expect(vi.mocked(readFreshSocialProducts).mock.calls[0][1]).toBe(new Date(NOW.getTime() - CAROUSEL_RULES.maxPriceAgeMs).toISOString());
  });

  it('con el de esta semana ya publicado, lo muestra y no arma otro, salvo que se pida', async () => {
    const entries = [drop(100_000, 70_000, 1), drop(100_000, 80_000, 1), drop(100_000, 90_000, 1), drop(100_000, 60_000, 1)];
    catalog(entries);
    // Publicado el miércoles 14 a las 13:00 en Chile: el próximo, el miércoles 21.
    vi.mocked(readCarouselMarks).mockResolvedValue([batch(new Date('2026-10-14T16:00:00Z'), entries.slice(0, 3))]);
    const page = await readCarouselPage(admin, NOW, KEY, { siteUrl: SITE });
    expect(page.carousel).toBeNull();
    expect(page.nextDay).toBe(20261021);
    expect(page.published?.items.map((item) => item.productId)).toEqual(entries.slice(0, 3).map((e) => e.p.id));
    expect(page.published?.postIds).toEqual([50, 51, 52]);
    expect(vi.mocked(readFreshSocialProducts)).not.toHaveBeenCalled();
  });

  it('pedido igual, el nuevo no repite las bajas que ya salieron', async () => {
    const entries = [drop(100_000, 70_000, 1), drop(100_000, 80_000, 1), drop(100_000, 90_000, 1), drop(100_000, 60_000, 1)];
    catalog(entries);
    vi.mocked(readCarouselMarks).mockResolvedValue([batch(new Date(NOW.getTime() - 2 * HOUR), entries.slice(0, 2))]);
    const page = await readCarouselPage(admin, NOW, KEY, { siteUrl: SITE, force: true });
    expect(page.found).toBe(2);
    expect(page.carousel).toBeNull();
    expect(page.published).not.toBeNull();
  });

  it('a los siete días del último, arma el siguiente', async () => {
    const entries = [drop(100_000, 70_000, 1), drop(100_000, 80_000, 1), drop(100_000, 90_000, 1)];
    catalog(entries);
    // El domingo pasado, 11 de octubre, a las 20:00 en Chile.
    vi.mocked(readCarouselMarks).mockResolvedValue([batch(new Date('2026-10-11T23:00:00Z'), entries)]);
    const page = await readCarouselPage(admin, NOW, KEY, { siteUrl: SITE });
    expect(page.published).toBeNull();
    expect(page.nextDay).toBeNull();
    // Esas bajas (de ayer) son nuevas respecto del carrusel pasado: vuelven.
    expect(page.carousel?.entries).toHaveLength(3);
  });

  it('si no se puede leer el catálogo, lo dice', async () => {
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [], error: 'se cayó' });
    await expect(readCarouselPage(admin, NOW, KEY, { siteUrl: SITE })).rejects.toThrow('No se pudo leer el catálogo: se cayó');
  });
});

describe('lastShownAt', () => {
  it('de cada producto, su carrusel más nuevo', () => {
    const batches: CarouselBatch[] = [
      { postedAt: '2026-10-18T12:00:00.000Z', posts: [{ postId: 3, productId: 'a', postedPrice: 1 }] },
      { postedAt: '2026-10-11T12:00:00.000Z', posts: [{ postId: 1, productId: 'a', postedPrice: 1 }, { postId: 2, productId: 'b', postedPrice: 1 }] },
      { postedAt: 'no es una fecha', posts: [{ postId: 4, productId: 'c', postedPrice: 1 }] },
    ];
    expect(lastShownAt(batches)).toEqual(
      new Map([
        ['a', Date.parse('2026-10-18T12:00:00.000Z')],
        ['b', Date.parse('2026-10-11T12:00:00.000Z')],
      ])
    );
  });
});
