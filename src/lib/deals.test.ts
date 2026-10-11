import { describe, expect, it } from 'vitest';
import {
  changeSince,
  dropSince,
  isLowestIn30Days,
  isLowestSinceTracked,
  lowestPriceNote,
  priceStats,
  type PricePoint,
} from '@/lib/deals';

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

describe('changeSince', () => {
  it('informa una baja con su monto y su fecha', () => {
    const stats = priceStats([point(100_000, 40), point(89_990, 3)], NOW);
    expect(changeSince(stats, 89_990, NOW)).toEqual({ direction: 'down', amount: 10_010, since: daysAgo(3) });
  });

  it('informa también una subida', () => {
    const stats = priceStats([point(679_990, 10), point(689_990, 1)], NOW);
    expect(changeSince(stats, 689_990, NOW)).toEqual({ direction: 'up', amount: 10_000, since: daysAgo(1) });
  });

  it('nada si el precio nunca cambió, aunque haya varios registros', () => {
    const stats = priceStats([point(100, 20), point(100, 5)], NOW);
    expect(changeSince(stats, 100, NOW)).toBeNull();
  });

  it('nada si el cambio tiene más de 30 días o el precio de hoy no es el último registrado', () => {
    expect(changeSince(priceStats([point(80, 90), point(100, 45)], NOW), 100, NOW)).toBeNull();
    expect(changeSince(priceStats([point(80, 40), point(100, 3)], NOW), 110, NOW)).toBeNull();
    expect(changeSince(null, 100, NOW)).toBeNull();
  });
});

describe('lowestPriceNote', () => {
  it('con 30 días de historial usa la frase de los 30 días', () => {
    const stats = priceStats([point(120_000, 45), point(99_990, 3)], NOW);
    expect(lowestPriceNote(stats, 99_990)).toBe('El precio más bajo que registramos en los últimos 30 días');
  });

  it('con menos historial dice desde cuándo lo seguimos', () => {
    const stats = priceStats([point(120_000, 10), point(99_990, 3)], NOW);
    expect(lowestPriceNote(stats, 99_990)).toBe('Precio más bajo desde que lo seguimos (10 días)');
  });

  it('nada si no es el más bajo, si nunca se movió o si falta historial', () => {
    expect(lowestPriceNote(priceStats([point(90_000, 10), point(99_990, 3)], NOW), 99_990)).toBeNull();
    expect(lowestPriceNote(priceStats([point(99_990, 10)], NOW), 99_990)).toBeNull();
    expect(lowestPriceNote(priceStats([point(120_000, 5), point(99_990, 3)], NOW), 99_990)).toBeNull();
    expect(lowestPriceNote(null, 99_990)).toBeNull();
  });
});

describe('un precio que va y vuelve no es una baja', () => {
  it('no informa cambio cuando el precio alterna entre los mismos dos valores', () => {
    // Dos vendedores turnándose la caja de compra: 58.384 y 55.260 cada pocas horas.
    const stats = priceStats([point(58_384, 6), point(55_260, 5), point(58_384, 4), point(55_260, 1)], NOW);
    expect(stats?.lastPriceSeenRecently).toBe(true);
    expect(changeSince(stats, 55_260, NOW)).toBeNull();
    expect(dropSince(stats, 55_260, NOW)).toBeNull();
  });

  it('tampoco cuando vuelve a subir al precio que tenía hace unos días', () => {
    const stats = priceStats([point(100_000, 5), point(90_000, 3), point(100_000, 1)], NOW);
    expect(changeSince(stats, 100_000, NOW)).toBeNull();
  });

  it('sí informa la baja a un precio que no regía desde hace más de una semana', () => {
    // Estuvo a 90.000 hasta hace 20 días, después a 100.000, y ahora vuelve a bajar.
    const stats = priceStats([point(90_000, 40), point(100_000, 20), point(90_000, 2)], NOW);
    expect(stats?.lastPriceSeenRecently).toBe(false);
    expect(dropSince(stats, 90_000, NOW)).toEqual({ amount: 10_000, since: daysAgo(2) });
  });

  it('y la baja a un precio nuevo, aunque antes haya habido vaivén', () => {
    const stats = priceStats([point(100, 6), point(90, 5), point(100, 4), point(80, 1)], NOW);
    expect(dropSince(stats, 80, NOW)).toEqual({ amount: 20, since: daysAgo(1) });
  });
});

describe('un cambio mínimo no se informa', () => {
  it('ni "bajó $1" ni "subió $1"', () => {
    expect(changeSince(priceStats([point(19_990, 5), point(19_989, 1)], NOW), 19_989, NOW)).toBeNull();
    expect(changeSince(priceStats([point(19_989, 5), point(19_990, 1)], NOW), 19_990, NOW)).toBeNull();
  });

  it('desde 1% sí', () => {
    expect(changeSince(priceStats([point(10_000, 5), point(9_900, 1)], NOW), 9_900, NOW)).toMatchObject({
      direction: 'down',
      amount: 100,
    });
    expect(changeSince(priceStats([point(10_000, 5), point(9_901, 1)], NOW), 9_901, NOW)).toBeNull();
  });
});
