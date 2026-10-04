import { describe, expect, it } from 'vitest';
import { dropSince, isLowestIn30Days, isLowestSinceTracked, priceStats, type PricePoint } from '@/lib/deals';

const NOW = new Date('2026-10-04T12:00:00.000Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const point = (price: number, days: number): PricePoint => ({ price, observed_at: daysAgo(days) });

describe('priceStats', () => {
  it('devuelve null sin historial', () => {
    expect(priceStats([], NOW)).toBeNull();
    expect(priceStats([{ price: 0, observed_at: daysAgo(1) }], NOW)).toBeNull();
  });

  it('cuenta el precio vigente al inicio de la ventana aunque se haya registrado antes', () => {
    // 100 desde hace 60 días, bajó a 80 hace 10.
    const stats = priceStats([point(80, 10), point(100, 60)], NOW)!;
    expect(stats.min30).toBe(80);
    expect(stats.max30).toBe(100);
    expect(stats.median30).toBe(90);
    expect(stats.daysTracked).toBe(60);
    expect(stats.previousPrice).toBe(100);
    expect(stats.lastChangeAt).toBe(daysAgo(10));
    expect(stats.lastPrice).toBe(80);
  });

  it('ignora los registros que repiten el precio (solo cambió el precio de lista)', () => {
    const stats = priceStats([point(100, 40), point(90, 20), point(90, 5)], NOW)!;
    expect(stats.previousPrice).toBe(100);
    expect(stats.lastChangeAt).toBe(daysAgo(20));
  });

  it('sin cambios no hay precio anterior', () => {
    const stats = priceStats([point(100, 40), point(100, 5)], NOW)!;
    expect(stats.previousPrice).toBeNull();
    expect(stats.lastChangeAt).toBeNull();
  });
});

describe('isLowestIn30Days', () => {
  it('exige 30 días de historial', () => {
    const short = priceStats([point(100, 20), point(80, 2)], NOW);
    expect(isLowestIn30Days(short, 80)).toBe(false);

    const long = priceStats([point(100, 35), point(80, 2)], NOW);
    expect(isLowestIn30Days(long, 80)).toBe(true);
  });

  it('no aplica si el precio no se movió en el mes', () => {
    const flat = priceStats([point(80, 45)], NOW);
    expect(isLowestIn30Days(flat, 80)).toBe(false);
  });

  it('no aplica si hubo un precio más bajo', () => {
    const stats = priceStats([point(100, 40), point(70, 15), point(80, 2)], NOW);
    expect(isLowestIn30Days(stats, 80)).toBe(false);
  });

  it('acepta null', () => {
    expect(isLowestIn30Days(null, 80)).toBe(false);
  });
});

describe('isLowestSinceTracked', () => {
  it('exige 7 días de historial', () => {
    expect(isLowestSinceTracked(priceStats([point(100, 5), point(80, 1)], NOW), 80)).toBe(false);
    expect(isLowestSinceTracked(priceStats([point(100, 8), point(80, 1)], NOW), 80)).toBe(true);
  });

  it('no aplica si nunca hubo un precio más alto', () => {
    expect(isLowestSinceTracked(priceStats([point(80, 10)], NOW), 80)).toBe(false);
  });

  it('no aplica si antes estuvo más barato', () => {
    expect(isLowestSinceTracked(priceStats([point(70, 10), point(80, 1)], NOW), 80)).toBe(false);
  });
});

describe('dropSince', () => {
  it('informa cuánto bajó y desde cuándo', () => {
    const stats = priceStats([point(100_000, 40), point(89_990, 3)], NOW);
    expect(dropSince(stats, 89_990, NOW)).toEqual({ amount: 10_010, since: daysAgo(3) });
  });

  it('nada si subió', () => {
    const stats = priceStats([point(80, 40), point(100, 3)], NOW);
    expect(dropSince(stats, 100, NOW)).toBeNull();
  });

  it('nada si la baja tiene más de 30 días', () => {
    const stats = priceStats([point(100, 90), point(80, 45)], NOW);
    expect(dropSince(stats, 80, NOW)).toBeNull();
  });

  it('nada si el precio de hoy no es el último registrado', () => {
    const stats = priceStats([point(100, 40), point(80, 3)], NOW);
    expect(dropSince(stats, 75, NOW)).toBeNull();
  });

  it('nada sin historial', () => {
    expect(dropSince(null, 80, NOW)).toBeNull();
  });
});
