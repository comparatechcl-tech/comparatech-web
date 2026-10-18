import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types';
import type { PriceStats } from '@/lib/deals';
import { BLACK_FRIDAY, blackFridayPhase, blackFridayPicks, daysUntilBlackFriday, dealsByCategory } from './black-friday';

describe('fechas', () => {
  it('2026: del viernes 27 a las 00:00 al lunes 30 de noviembre, en hora de Chile', () => {
    expect(new Date(BLACK_FRIDAY.start).toISOString()).toBe('2026-11-27T03:00:00.000Z');
    expect(new Date(BLACK_FRIDAY.end).toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });

  it('antes, durante y después', () => {
    expect(blackFridayPhase(Date.parse('2026-10-17T23:00:00Z'))).toBe('antes');
    // Jueves 26 a las 23:59 en Chile: todavía no.
    expect(blackFridayPhase(Date.parse('2026-11-27T02:59:00Z'))).toBe('antes');
    expect(blackFridayPhase(Date.parse('2026-11-27T03:00:00Z'))).toBe('durante');
    // Lunes 30 a las 23:59 en Chile: todavía sí.
    expect(blackFridayPhase(Date.parse('2026-12-01T02:59:00Z'))).toBe('durante');
    expect(blackFridayPhase(Date.parse('2026-12-01T03:00:00Z'))).toBe('despues');
  });

  it('cuenta los días por fecha en Chile, no de a 24 horas', () => {
    // Sábado 17-10 a las 20:00 en Chile.
    expect(daysUntilBlackFriday(Date.parse('2026-10-17T23:00:00Z'))).toBe(41);
    // Jueves 26-11 a las 23:00 en Chile (ya 27 en UTC): falta 1.
    expect(daysUntilBlackFriday(Date.parse('2026-11-27T02:00:00Z'))).toBe(1);
    expect(daysUntilBlackFriday(Date.parse('2026-11-28T15:00:00Z'))).toBe(0);
  });
});

function product(id: string, price: number, original: number | null, category = 'audio'): Product {
  return { id, slug: id, name: id, price, original_price: original, category, created_at: '2026-10-01T00:00:00Z' } as Product;
}

function stats(over: Partial<PriceStats>): PriceStats {
  return {
    min30: 0,
    min30Held: 0,
    median30: 0,
    max30: 0,
    minTracked: 0,
    maxTracked: 0,
    daysTracked: 12,
    lastPrice: 0,
    previousPrice: null,
    lastChangeAt: null,
    firstSeenAt: '2026-10-05T21:00:00Z',
    previousIsFirstRecord: false,
    lastPriceNearRecent: false,
    trackedBeforeChangeMs: null,
    usualPriceBefore: null,
    lastPriceSeenRecently: false,
    changesLast48h: 0,
    ...over,
  };
}

describe('blackFridayPicks', () => {
  const NOW = Date.parse('2026-10-17T23:00:00Z');

  it('separa las bajas comprobadas de las que están en su precio más bajo, sin repetir', () => {
    const deals = [product('a', 80_000, 160_000), product('b', 50_000, 100_000), product('c', 30_000, 40_000)];
    const map = new Map<string, PriceStats>([
      // 'a' bajó de 100.000 a 80.000 hace dos días, después de una semana a 100.000.
      [
        'a',
        stats({
          lastPrice: 80_000,
          previousPrice: 100_000,
          lastChangeAt: '2026-10-15T23:00:00Z',
          trackedBeforeChangeMs: 7 * 86_400_000,
          usualPriceBefore: 100_000,
          minTracked: 80_000,
          maxTracked: 100_000,
          min30: 80_000,
          max30: 100_000,
          min30Held: 80_000,
          median30: 100_000,
        }),
      ],
      // 'b' está en el más bajo desde que lo seguimos, sin baja reciente que destacar.
      ['b', stats({ lastPrice: 50_000, minTracked: 50_000, maxTracked: 60_000, min30: 50_000, max30: 60_000 })],
      // 'c' nunca se movió: no es "el más bajo".
      ['c', stats({ lastPrice: 30_000, minTracked: 30_000, maxTracked: 30_000 })],
    ]);
    const picks = blackFridayPicks(deals, map, NOW);
    expect(picks.dropped.map((p) => p.id)).toEqual(['a']);
    expect(picks.drops.a?.amount).toBe(20_000);
    expect(picks.lowest.map((p) => p.id)).toEqual(['b']);
  });

  it('sin historial no afirma nada', () => {
    const picks = blackFridayPicks([product('a', 80_000, 160_000)], new Map(), NOW);
    expect(picks).toEqual({ dropped: [], lowest: [], drops: {} });
  });
});

describe('dealsByCategory', () => {
  it('cuenta las ofertas de cada categoría, en el orden del sitio, sin las vacías', () => {
    const categories = [
      { slug: 'celulares', name: 'Celulares' },
      { slug: 'audio', name: 'Audio' },
      { slug: 'hogar', name: 'Hogar' },
    ];
    const deals = [product('a', 1, 2, 'audio'), product('b', 1, 2, 'audio'), product('c', 1, 2, 'celulares')];
    expect(dealsByCategory(deals, categories)).toEqual([
      { slug: 'celulares', name: 'Celulares', count: 1 },
      { slug: 'audio', name: 'Audio', count: 2 },
    ]);
  });
});
