import { describe, expect, it } from 'vitest';
import { chartPaths, heldLabel, priceStatement, summarizeHistory, vsAverage } from './price-chart';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('summarizeHistory', () => {
  it('sin registros, nada', () => {
    expect(summarizeHistory([], NOW)).toBeNull();
    expect(summarizeHistory([{ price: 0, observed_at: at(D) }], NOW)).toBeNull();
  });

  it('un precio que nunca cambió: rango y promedio iguales, sin cambios', () => {
    const s = summarizeHistory([{ price: 10_000, observed_at: at(5 * D) }], NOW)!;
    expect(s).toMatchObject({ min: 10_000, max: 10_000, average: 10_000, changes: 0, trackedSince: NOW - 5 * D });
    expect(s.recent).toEqual([{ at: NOW - 5 * D, price: 10_000, diff: null }]);
  });

  it('pondera el promedio por lo que duró cada precio', () => {
    // 9 días a $10.000 y 1 día a $20.000: el promedio está cerca de 10.000, no en 15.000.
    const s = summarizeHistory(
      [
        { price: 10_000, observed_at: at(10 * D) },
        { price: 20_000, observed_at: at(D) },
      ],
      NOW,
    )!;
    expect(s.average).toBe(11_000);
    expect(s.changes).toBe(1);
    expect(s.recent).toEqual([
      { at: NOW - D, price: 20_000, diff: 10_000 },
      { at: NOW - 10 * D, price: 10_000, diff: null },
    ]);
  });

  it('el promedio mira 30 días aunque haya más historia, y cuenta el precio que regía al empezar la ventana', () => {
    const s = summarizeHistory(
      [
        { price: 50_000, observed_at: at(60 * D) },
        { price: 40_000, observed_at: at(15 * D) },
      ],
      NOW,
    )!;
    // 15 de los 30 días a 50.000 y 15 a 40.000.
    expect(s.average).toBe(45_000);
    expect(s.averageFrom).toBe(NOW - 30 * D);
    expect(s.changes).toBe(1);
    expect(s.trackedSince).toBe(NOW - 60 * D);
  });

  it('un registro que repite el precio (cambió el de lista) no es un cambio', () => {
    const s = summarizeHistory(
      [
        { price: 10_000, observed_at: at(5 * D) },
        { price: 10_000, observed_at: at(3 * D) },
        { price: 9_000, observed_at: at(D) },
      ],
      NOW,
    )!;
    expect(s.changes).toBe(1);
    expect(s.stretches).toHaveLength(2);
  });

  it('el mínimo dice cuándo rigió por última vez y cuánto duró en total', () => {
    const s = summarizeHistory(
      [
        { price: 10_000, observed_at: at(5 * D) },
        { price: 8_000, observed_at: at(4 * D) },
        { price: 10_000, observed_at: at(4 * D - 2 * H) },
        { price: 8_000, observed_at: at(D) },
        { price: 10_000, observed_at: at(D - H) },
      ],
      NOW,
    )!;
    expect(s.min).toBe(8_000);
    expect(s.max).toBe(10_000);
    expect(s.minAt).toBe(NOW - D);
    expect(s.minHeldMs).toBe(3 * H);
  });

  it('el gráfico cubre 90 días como mucho', () => {
    const s = summarizeHistory(
      [
        { price: 30_000, observed_at: at(200 * D) },
        { price: 20_000, observed_at: at(100 * D) },
        { price: 25_000, observed_at: at(10 * D) },
      ],
      NOW,
    )!;
    expect(s.start).toBe(NOW - 90 * D);
    expect(s.stretches.map((x) => x.price)).toEqual([20_000, 25_000]);
    expect(s.max).toBe(25_000);
  });
});

describe('priceStatement: el precio de hoy en una frase con fechas completas', () => {
  // 22-11-2026 a las 19:00 en Chile; el precio se revisó a las 18:42.
  const now = Date.parse('2026-11-22T22:00:00Z');
  const checked = '2026-11-22T21:42:00Z';
  const HEAD = 'Hoy $544.221 en Mercado Libre. Precio revisado el 22-11-2026 a las 18:42 (hora de Chile).';
  const history = [
    { price: 560_000, observed_at: '2026-10-05T15:00:00Z' },
    { price: 496_150, observed_at: '2026-11-04T15:00:00Z' },
    { price: 544_221, observed_at: '2026-11-04T19:00:00Z' },
  ];

  it('el texto que aprobó el dueño: precio, fecha de la revisión y el más bajo registrado', () => {
    const s = summarizeHistory(history, now)!;
    expect(priceStatement(544_221, checked, s, now)).toBe(
      `${HEAD} El más bajo que registramos desde el 05-10-2026 fue $496.150, el 04-11-2026.`
    );
  });

  it('si el más bajo es el de hoy, dice desde cuándo sigue', () => {
    const s = summarizeHistory(
      [
        { price: 560_000, observed_at: '2026-10-05T15:00:00Z' },
        { price: 544_221, observed_at: '2026-11-20T15:00:00Z' },
      ],
      now
    )!;
    expect(priceStatement(544_221, checked, s, now)).toBe(
      `${HEAD} Es el más bajo que registramos desde el 05-10-2026 y sigue así desde el 20-11-2026.`
    );
  });

  it('un precio que nunca cambió lleva solo el precio y la fecha (lo demás lo dice la ficha)', () => {
    const s = summarizeHistory([{ price: 544_221, observed_at: '2026-10-05T15:00:00Z' }], now)!;
    expect(priceStatement(544_221, checked, s, now)).toBe(HEAD);
  });

  it('si el historial todavía no trae el precio de la ficha, no se comparan', () => {
    const s = summarizeHistory(history, now)!;
    expect(priceStatement(480_000, checked, s, now)).toBe(
      'Hoy $480.000 en Mercado Libre. Precio revisado el 22-11-2026 a las 18:42 (hora de Chile).'
    );
  });

  it('con más de 90 días de historia, el más bajo es el del gráfico y lo dice desde ahí', () => {
    const later = Date.parse('2027-02-01T15:00:00Z');
    const s = summarizeHistory(history, later)!;
    // El gráfico parte el 03-11-2026: el más bajo sigue siendo el del 04-11.
    expect(priceStatement(544_221, '2027-02-01T14:30:00Z', s, later)).toBe(
      'Hoy $544.221 en Mercado Libre. Precio revisado el 01-02-2027 a las 11:30 (hora de Chile). El más bajo que registramos desde el 03-11-2026 fue $496.150, el 04-11-2026.'
    );
  });

  it('sin fecha de revisión, con una de hace más de un día o del futuro, no dice "hoy"', () => {
    const s = summarizeHistory(history, now)!;
    expect(priceStatement(544_221, null, s, now)).toBeNull();
    expect(priceStatement(544_221, 'no es fecha', s, now)).toBeNull();
    // Como en la caída del 19 al 22-11-2026: la última revisión era de hace 3 días.
    expect(priceStatement(544_221, '2026-11-19T22:00:00Z', s, now)).toBeNull();
    expect(priceStatement(544_221, '2026-11-22T23:00:00Z', s, now)).toBeNull();
    expect(priceStatement(0, checked, s, now)).toBeNull();
  });
});

describe('vsAverage y heldLabel', () => {
  it('porcentaje contra el promedio, sin decir 1% por centavos', () => {
    expect(vsAverage(9_000, 10_000)).toBe(-10);
    expect(vsAverage(11_500, 10_000)).toBe(15);
    expect(vsAverage(10_050, 10_000)).toBe(0);
    expect(vsAverage(10_000, 0)).toBe(0);
  });

  it('aclara solo los mínimos que duraron menos de un día', () => {
    expect(heldLabel(20 * 60_000)).toBe('por menos de una hora');
    expect(heldLabel(H)).toBe('por cerca de una hora');
    expect(heldLabel(5 * H)).toBe('por unas 5 horas');
    expect(heldLabel(D)).toBeNull();
  });
});

describe('chartPaths', () => {
  it('dibuja escalones de izquierda a derecha, el precio alto arriba', () => {
    const s = summarizeHistory(
      [
        { price: 10_000, observed_at: at(10 * D) },
        { price: 20_000, observed_at: at(5 * D) },
      ],
      NOW,
    )!;
    const { line, area, averageY } = chartPaths(s, 100, 50);
    // Empieza abajo (10.000), sube a la mitad del ancho y sigue hasta el final arriba (20.000).
    expect(line).toBe('M0 44 H50 V6 H100');
    expect(area).toBe('M0 44 H50 V6 H100 V50 H0 Z');
    expect(averageY).toBe(25);
  });

  it('un precio que nunca cambió es una línea al medio', () => {
    const s = summarizeHistory([{ price: 10_000, observed_at: at(3 * D) }], NOW)!;
    expect(chartPaths(s, 100, 50).line).toBe('M0 25 H100');
  });
});

describe('cambios seguidos', () => {
  it('cuenta los cambios de las últimas 48 horas para avisar que el precio va y viene', () => {
    const flips = Array.from({ length: 6 }, (_, i) => ({ price: i % 2 === 0 ? 14_481 : 16_393, observed_at: at((6 - i) * 4 * H) }));
    const s = summarizeHistory([{ price: 16_393, observed_at: at(5 * D) }, ...flips], NOW)!;
    expect(s.changes48h).toBe(6);
    expect(s.changes).toBe(6);
  });
});
