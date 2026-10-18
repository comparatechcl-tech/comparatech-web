import { describe, expect, it } from 'vitest';
import { effectiveHistory, lowestSeries, sourceAt, type VersionHistory } from './model-history';
import { summarizeHistory } from './price-chart';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function version(id: string, over: Partial<VersionHistory> = {}): VersionHistory {
  return {
    id,
    history: [],
    price: 100_000,
    createdAt: at(20 * D),
    checkedAt: at(H),
    onSale: true,
    soldOutSince: null,
    ...over,
  };
}

const prices = (s: ReturnType<typeof lowestSeries>) => s?.points.map((p) => [Date.parse(p.observed_at), p.price]);

describe('effectiveHistory', () => {
  it('con registros, los registros', () => {
    const history = [{ price: 90_000, observed_at: at(5 * D) }];
    expect(effectiveHistory(version('a', { history }))).toBe(history);
  });

  it('sin ningún cambio anotado, el precio de hoy desde que entró al sitio', () => {
    expect(effectiveHistory(version('a', { price: 80_000 }))).toEqual([{ price: 80_000, observed_at: at(20 * D) }]);
  });

  it('sin revisión contra Mercado Libre todavía, nada: el precio es el del candidato', () => {
    expect(effectiveHistory(version('a', { checkedAt: null }))).toEqual([]);
  });

  it('si no se pudo leer, no se sabe', () => {
    expect(effectiveHistory(version('a', { history: null }))).toBeNull();
  });
});

describe('lowestSeries', () => {
  it('el más bajo entre dos versiones que se turnan', () => {
    const a = version('a', {
      history: [
        { price: 100_000, observed_at: at(10 * D) },
        { price: 120_000, observed_at: at(4 * D) },
      ],
      price: 120_000,
    });
    const b = version('b', {
      history: [
        { price: 110_000, observed_at: at(10 * D) },
        { price: 95_000, observed_at: at(2 * D) },
      ],
      price: 95_000,
    });
    const s = lowestSeries([a, b], NOW)!;
    expect(prices(s)).toEqual([
      [NOW - 10 * D, 100_000],
      [NOW - 4 * D, 110_000],
      [NOW - 2 * D, 95_000],
    ]);
    expect(s.sources.map((x) => x.id)).toEqual(['a', 'b', 'b']);
    expect(sourceAt(s, NOW - 3 * D)).toBe('b');
    expect(sourceAt(s, NOW - 9 * D)).toBe('a');
    expect(sourceAt(s, NOW - 11 * D)).toBeNull();

    // Sirve tal cual para el gráfico de la ficha.
    const summary = summarizeHistory(s.points, NOW)!;
    expect(summary).toMatchObject({ min: 95_000, max: 110_000, minAt: NOW - 2 * D, trackedSince: NOW - 10 * D });
  });

  it('una versión fuera de venta cuenta solo hasta que salió de venta', () => {
    const paused = version('p', {
      history: [{ price: 50_000, observed_at: at(10 * D) }],
      price: 50_000,
      onSale: false,
      soldOutSince: at(3 * D),
    });
    const onSale = version('a', { history: [{ price: 100_000, observed_at: at(10 * D) }] });
    const s = lowestSeries([onSale, paused], NOW)!;
    expect(prices(s)).toEqual([
      [NOW - 10 * D, 50_000],
      [NOW - 3 * D, 100_000],
    ]);
    expect(sourceAt(s, NOW)).toBe('a');
  });

  it('una versión sin cambios anotados cuenta desde que entró al sitio', () => {
    const fresh = version('n', { price: 90_000, createdAt: at(2 * D) });
    const old = version('a', { history: [{ price: 100_000, observed_at: at(10 * D) }] });
    expect(prices(lowestSeries([old, fresh], NOW))).toEqual([
      [NOW - 10 * D, 100_000],
      [NOW - 2 * D, 90_000],
    ]);
  });

  it('empieza donde empieza la cobertura que llega hasta hoy sin cortes', () => {
    // La que salió de venta hace 8 días y la que entró hace 5 dejan 3 días sin nada anotado.
    const gone = version('g', {
      history: [{ price: 40_000, observed_at: at(15 * D) }],
      onSale: false,
      soldOutSince: at(8 * D),
    });
    const now = version('a', { history: [{ price: 100_000, observed_at: at(5 * D) }] });
    expect(prices(lowestSeries([gone, now], NOW))).toEqual([[NOW - 5 * D, 100_000]]);
  });

  it('ante un empate se queda la versión que ya estaba', () => {
    const a = version('a', { history: [{ price: 100_000, observed_at: at(10 * D) }] });
    const b = version('b', {
      history: [
        { price: 120_000, observed_at: at(10 * D) },
        { price: 100_000, observed_at: at(5 * D) },
      ],
    });
    const s = lowestSeries([b, a], NOW)!;
    expect(prices(s)).toEqual([[NOW - 10 * D, 100_000]]);
    expect(s.sources).toEqual([{ from: NOW - 10 * D, id: 'a' }]);
  });

  it('dos registros a la misma hora (dos corridas que se pisaron) no dejan un tramo vacío', () => {
    const a = version('a', {
      history: [
        { price: 100_000, observed_at: at(5 * D) },
        { price: 90_000, observed_at: at(5 * D) },
      ],
    });
    const s = lowestSeries([a], NOW)!;
    expect(s.points).toHaveLength(1);
    expect(s.points[0].price).toBe(90_000);
  });

  it('si el historial de alguna versión no se pudo leer, nada: el más bajo podría estar ahí', () => {
    const a = version('a', { history: [{ price: 100_000, observed_at: at(5 * D) }] });
    expect(lowestSeries([a, version('b', { history: null })], NOW)).toBeNull();
  });

  it('fuera de venta y sin fecha de salida, no se sabe hasta cuándo contó', () => {
    const a = version('a', { history: [{ price: 100_000, observed_at: at(5 * D) }] });
    expect(lowestSeries([a, version('b', { onSale: false, soldOutSince: null })], NOW)).toBeNull();
  });

  it('sin ninguna versión a la venta con historial, nada', () => {
    expect(lowestSeries([], NOW)).toBeNull();
    expect(lowestSeries([version('a', { checkedAt: null })], NOW)).toBeNull();
    const paused = version('p', {
      history: [{ price: 50_000, observed_at: at(10 * D) }],
      onSale: false,
      soldOutSince: at(D),
    });
    expect(lowestSeries([paused], NOW)).toBeNull();
  });
});
