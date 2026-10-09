import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types';
import {
  ALL_DEALS,
  DEALS_PAGE,
  appendDealsBatch,
  countHotDeals,
  dealsBatch,
  dealsBatchUrl,
  dealsFilterKey,
  parseDealsBatchQuery,
} from '@/lib/deals-listing';

/** Una oferta con `discount` % sobre un precio de lista de $100.000. */
function deal(id: string, category: string, discount: number): Product {
  return {
    id,
    slug: id,
    name: `Producto ${id}`,
    brand: 'Marca',
    category,
    price: 100000 - discount * 1000,
    original_price: 100000,
    image_url: '',
    affiliate_url: 'https://meli.la/abc',
    description: '',
    specs: {},
    seller_reputation: 'verde',
    seller_sales_count: 0,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: null,
    ml_domain_id: null,
    ml_family_id: null,
    seller_id: null,
    rrss_status: 'sin_usar',
    created_at: '2026-01-01T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: null,
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
  };
}

// Ya ordenadas como las deja rankDeals: 'baja' primero aunque tenga menos descuento.
const ranked = [
  deal('baja', 'audio', 25),
  deal('a', 'computacion', 60),
  deal('b', 'audio', 45),
  deal('c', 'computacion', 40),
  deal('d', 'audio', 39),
  deal('e', 'computacion', 20),
];
const drops = { baja: { amount: 7000, pct: 8.5, since: '2026-10-05T12:00:00Z' } };

const ids = (items: { id: string }[]) => items.map((p) => p.id);

/** `n` ofertas de relleno, para probar los cortes de tanda. */
function many(n: number, prefix = 'm'): Product[] {
  return Array.from({ length: n }, (_, i) => deal(`${prefix}${i}`, 'audio', 30));
}

describe('dealsBatch', () => {
  it('sin filtro conserva el orden y cuenta todas', () => {
    const batch = dealsBatch(ranked, drops, ALL_DEALS, 0);
    expect(ids(batch.items)).toEqual(['baja', 'a', 'b', 'c', 'd', 'e']);
    expect(batch.total).toBe(6);
  });

  it('filtra por categoría sin cambiar el orden', () => {
    const batch = dealsBatch(ranked, drops, { category: 'audio', hot: false }, 0);
    expect(ids(batch.items)).toEqual(['baja', 'b', 'd']);
    expect(batch.total).toBe(3);
  });

  it('"40% o más" deja solo las del distintivo fuerte, incluido el 40 justo', () => {
    expect(ids(dealsBatch(ranked, drops, { category: null, hot: true }, 0).items)).toEqual(['a', 'b', 'c']);
    expect(countHotDeals(ranked)).toBe(3);
  });

  it('combina categoría y "40% o más"', () => {
    const batch = dealsBatch(ranked, drops, { category: 'audio', hot: true }, 0);
    expect(ids(batch.items)).toEqual(['b']);
    expect(batch.total).toBe(1);
  });

  it('una categoría sin ofertas responde vacío', () => {
    expect(dealsBatch(ranked, drops, { category: 'gaming', hot: false }, 0)).toEqual({ items: [], total: 0 });
  });

  it('la baja comprobada va en la tarjeta que corresponde', () => {
    const { items } = dealsBatch(ranked, drops, ALL_DEALS, 0);
    expect(items[0].drop_amount).toBe(7000);
    expect(items[1].drop_amount).toBeUndefined();
  });

  it('corta de a DEALS_PAGE y el total es el del filtro, no el de la tanda', () => {
    const list = many(DEALS_PAGE * 2 + 5);
    const first = dealsBatch(list, {}, ALL_DEALS, 0);
    const last = dealsBatch(list, {}, ALL_DEALS, DEALS_PAGE * 2);
    expect(first.items).toHaveLength(DEALS_PAGE);
    expect(first.total).toBe(DEALS_PAGE * 2 + 5);
    expect(ids(last.items)).toEqual(['m96', 'm97', 'm98', 'm99', 'm100']);
    expect(dealsBatch(list, {}, ALL_DEALS, DEALS_PAGE * 3).items).toEqual([]);
  });
});

describe('appendDealsBatch', () => {
  const list = many(DEALS_PAGE * 2 + 5);

  it('la primera tanda deja lista la siguiente', () => {
    const loaded = appendDealsBatch(undefined, dealsBatch(list, {}, ALL_DEALS, 0), 0);
    expect(loaded.items).toHaveLength(DEALS_PAGE);
    expect(loaded).toMatchObject({ total: 101, next: DEALS_PAGE, more: true });
  });

  it('suma las tandas hasta la última', () => {
    let loaded = appendDealsBatch(undefined, dealsBatch(list, {}, ALL_DEALS, 0), 0);
    loaded = appendDealsBatch(loaded, dealsBatch(list, {}, ALL_DEALS, loaded.next), loaded.next);
    expect(loaded).toMatchObject({ next: DEALS_PAGE * 2, more: true });
    loaded = appendDealsBatch(loaded, dealsBatch(list, {}, ALL_DEALS, loaded.next), loaded.next);
    expect(ids(loaded.items)).toEqual(ids(list));
    expect(loaded.more).toBe(false);
  });

  it('no repite una oferta que ya estaba en pantalla', () => {
    const loaded = appendDealsBatch(undefined, dealsBatch(list, {}, ALL_DEALS, 0), 0);
    // Entre la página y la tanda entró una oferta nueva arriba: todo se
    // corrió un puesto y la tanda parte repitiendo la última tarjeta.
    const shifted = [deal('nueva', 'audio', 70), ...list];
    const next = appendDealsBatch(loaded, dealsBatch(shifted, {}, ALL_DEALS, loaded.next), loaded.next);
    expect(next.items).toHaveLength(DEALS_PAGE * 2 - 1);
    expect(new Set(ids(next.items)).size).toBe(next.items.length);
    expect(next).toMatchObject({ total: 102, next: DEALS_PAGE * 2, more: true });
  });

  it('una lista que cabe en una tanda no ofrece más', () => {
    expect(appendDealsBatch(undefined, dealsBatch(ranked, drops, ALL_DEALS, 0), 0).more).toBe(false);
    // Justo una tanda: tampoco.
    expect(appendDealsBatch(undefined, dealsBatch(many(DEALS_PAGE), {}, ALL_DEALS, 0), 0).more).toBe(false);
  });

  it('una tanda vacía cierra la lista aunque el total diga otra cosa', () => {
    const loaded = appendDealsBatch(undefined, dealsBatch(list, {}, ALL_DEALS, 0), 0);
    const next = appendDealsBatch(loaded, { items: [], total: 500 }, loaded.next);
    expect(next.items).toHaveLength(DEALS_PAGE);
    expect(next.more).toBe(false);
  });
});

describe('dirección de las tandas', () => {
  it('omite los valores por defecto', () => {
    expect(dealsBatchUrl(ALL_DEALS, 0)).toBe('/ofertas/lote');
    expect(dealsBatchUrl(ALL_DEALS, 48)).toBe('/ofertas/lote?desde=48');
    expect(dealsBatchUrl({ category: 'audio', hot: true }, 96)).toBe('/ofertas/lote?cat=audio&hot=1&desde=96');
  });

  it('lo que arma dealsBatchUrl se lee de vuelta igual', () => {
    const cases: [typeof ALL_DEALS, number][] = [
      [ALL_DEALS, 0],
      [{ category: 'computacion', hot: false }, 48],
      [{ category: null, hot: true }, 0],
      [{ category: 'electrodomesticos', hot: true }, 144],
    ];
    for (const [filter, offset] of cases) {
      const query = dealsBatchUrl(filter, offset).split('?')[1] ?? '';
      expect(parseDealsBatchQuery(new URLSearchParams(query))).toEqual({ filter, offset });
    }
  });

  it('rechaza todo lo que la página no pide', () => {
    const bad = [
      'desde=10', // no es un múltiplo de la tanda
      'desde=-48',
      'desde=48.0',
      'desde=1e3',
      'desde=',
      'hot=0',
      'hot=true',
      'cat=',
      'cat=Audio',
      'cat=audio%20x',
      'cat=../admin',
      `cat=${'a'.repeat(41)}`,
      'cat=audio&cat=gaming',
      'cat=audio&otro=1',
      'utm_source=x',
    ];
    for (const query of bad) {
      expect(parseDealsBatchQuery(new URLSearchParams(query)), query).toBeNull();
    }
  });

  it('cada filtro tiene su propia llave', () => {
    const keys = [
      ALL_DEALS,
      { category: null, hot: true },
      { category: 'audio', hot: false },
      { category: 'audio', hot: true },
    ].map(dealsFilterKey);
    expect(new Set(keys).size).toBe(4);
  });
});
