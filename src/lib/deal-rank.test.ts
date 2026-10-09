import { describe, expect, it } from 'vitest';
import { priceStats, type PriceStats } from '@/lib/deals';
import {
  HOT_DEAL_DISCOUNT,
  MIN_DEAL_DISCOUNT,
  confirmedDrop,
  dealTier,
  discountOf,
  dropsById,
  rankDeals,
} from '@/lib/deal-rank';

const NOW = new Date('2026-10-09T15:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

/** Historial de un producto que pasó de `before` a `after` hace `days` días. */
function dropped(before: number, after: number, days = 2): PriceStats {
  return priceStats(
    [
      { price: before, observed_at: daysAgo(days + 5) },
      { price: after, observed_at: daysAgo(days) },
    ],
    NOW
  )!;
}

const product = (id: string, price: number, original: number | null = null) => ({
  id,
  price,
  original_price: original,
});

describe('discountOf y dealTier', () => {
  it('calcula el descuento sobre el precio de lista', () => {
    expect(discountOf(product('a', 60_000, 100_000))).toBe(40);
    expect(discountOf(product('a', 79_990, 99_990))).toBe(20);
  });

  it('sin precio de lista, o si no es mayor, no hay descuento', () => {
    expect(discountOf(product('a', 50_000))).toBe(0);
    expect(discountOf(product('a', 50_000, 50_000))).toBe(0);
    expect(discountOf(product('a', 50_000, 40_000))).toBe(0);
    expect(discountOf(product('a', 0, 40_000))).toBe(0);
  });

  it('separa la oferta normal de la destacada', () => {
    expect(dealTier(MIN_DEAL_DISCOUNT - 1)).toBeNull();
    expect(dealTier(MIN_DEAL_DISCOUNT)).toBe('deal');
    expect(dealTier(HOT_DEAL_DISCOUNT - 1)).toBe('deal');
    expect(dealTier(HOT_DEAL_DISCOUNT)).toBe('hot');
  });
});

describe('confirmedDrop', () => {
  it('reconoce una baja reciente vista en el historial propio', () => {
    const drop = confirmedDrop(product('a', 80_000, 120_000), dropped(100_000, 80_000), NOW);
    expect(drop).toMatchObject({ amount: 20_000, since: daysAgo(2) });
    expect(drop?.pct).toBeCloseTo(20);
  });

  it('una baja mínima no se destaca', () => {
    // De $19.990 a $19.890: bajó, pero menos de 3%.
    expect(confirmedDrop(product('a', 19_890, 29_990), dropped(19_990, 19_890), NOW)).toBeNull();
  });

  it('sin historial, o si el precio subió, no hay baja', () => {
    expect(confirmedDrop(product('a', 80_000, 120_000), null, NOW)).toBeNull();
    expect(confirmedDrop(product('a', 100_000, 120_000), dropped(80_000, 100_000), NOW)).toBeNull();
  });

  it('una baja de hace más de 30 días ya no cuenta', () => {
    expect(confirmedDrop(product('a', 80_000, 120_000), dropped(100_000, 80_000, 45), NOW)).toBeNull();
  });

  it('si el precio de hoy no es el último registrado, no se afirma nada', () => {
    expect(confirmedDrop(product('a', 75_000, 120_000), dropped(100_000, 80_000), NOW)).toBeNull();
  });
});

describe('rankDeals', () => {
  // Como llegan de getDeals: de mayor a menor descuento de lista.
  const deals = [
    product('lista-60', 40_000, 100_000),
    product('lista-50', 50_000, 100_000),
    product('bajo-10', 90_000, 120_000),
    product('bajo-30', 70_000, 95_000),
    product('lista-20', 80_000, 100_000),
  ];
  const stats = new Map<string, PriceStats>([
    ['bajo-10', dropped(100_000, 90_000)],
    ['bajo-30', dropped(100_000, 70_000)],
    // Bajó $100: no alcanza para ir primero.
    ['lista-50', dropped(50_100, 50_000)],
  ]);

  it('pone primero las bajas comprobadas, de mayor a menor, y conserva el resto', () => {
    expect(rankDeals(deals, stats, NOW).map((p) => p.id)).toEqual([
      'bajo-30',
      'bajo-10',
      'lista-60',
      'lista-50',
      'lista-20',
    ]);
  });

  it('sin historial deja el orden por descuento', () => {
    expect(rankDeals(deals, new Map(), NOW).map((p) => p.id)).toEqual(deals.map((p) => p.id));
  });

  it('no muta la lista recibida', () => {
    const copy = [...deals];
    rankDeals(deals, stats, NOW);
    expect(deals).toEqual(copy);
  });

  it('dropsById entrega solo las bajas que valen la pena', () => {
    const drops = dropsById(deals, stats, NOW);
    expect(Object.keys(drops).sort()).toEqual(['bajo-10', 'bajo-30']);
    expect(drops['bajo-30'].amount).toBe(30_000);
  });
});
