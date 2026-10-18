import { describe, expect, it } from 'vitest';
import {
  BASELINE_WINDOWS,
  EVENT_WINDOWS,
  HISTORY_CLEAN_FROM,
  PRELIMINARY_FROM,
  PRE_LIVE_FROM,
  WATCH_FROM,
  asOfLabel,
  averageChange,
  baselineWindows,
  perHundred,
  buildThermometer,
  habitualPrice,
  highestHeld,
  lowestHeld,
  measurePre,
  measureProduct,
  onePerProduct,
  rangeLabel,
  shareLabel,
  showWatchList,
  summarizeOutcomes,
  thermometerLastModified,
  thermometerPhase,
  thermometerSlot,
  timelineOf,
  watchNote,
  type ProductOutcome,
  type Stretch,
  type ThermometerProduct,
  type ThermometerRow,
} from './black-friday-thermometer';

const H = 3_600_000;
const D = 24 * H;
/** Una hora en Chile (noviembre: UTC-3). "2026-11-27 08:00" → 11:00 UTC. */
const cl = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00-03:00`);
const iso = (t: number) => new Date(t).toISOString();

let seq = 0;
function product(over: Partial<ThermometerProduct> = {}): ThermometerProduct {
  seq++;
  return {
    id: `p${String(seq).padStart(4, '0')}`,
    slug: `producto-${seq}`,
    name: `Producto ${seq}`,
    category: 'audio',
    familyId: null,
    createdAt: cl('2026-10-10 12:00'),
    price: 100_000,
    listPrice: null,
    active: true,
    inactiveSince: null,
    ...over,
  };
}

/** Registros de un producto: [hora en Chile, precio, precio de lista?]. */
function rows(p: ThermometerProduct, points: [string, number, number?][]): ThermometerRow[] {
  return points.map(([at, price, list]) => ({ productId: p.id, price, listPrice: list ?? null, t: cl(at) }));
}

const AFTER = cl('2026-12-05 12:00');

describe('ventanas', () => {
  it('Black Friday 2026: referencia del 1 al 20, semana previa del 21 al 26 y evento del 27 al 30, en hora de Chile', () => {
    expect(iso(EVENT_WINDOWS.refStart)).toBe('2026-11-01T03:00:00.000Z');
    expect(iso(EVENT_WINDOWS.refEnd)).toBe('2026-11-21T03:00:00.000Z');
    expect(iso(EVENT_WINDOWS.eventStart)).toBe('2026-11-27T03:00:00.000Z');
    expect(iso(EVENT_WINDOWS.eventEnd)).toBe('2026-12-01T03:00:00.000Z');
  });

  it('el fin de semana de comparación es el mismo de dos semanas antes, con su referencia y su semana previa', () => {
    expect(iso(BASELINE_WINDOWS.refStart)).toBe('2026-10-18T03:00:00.000Z');
    expect(iso(BASELINE_WINDOWS.refEnd)).toBe('2026-11-07T03:00:00.000Z');
    expect(iso(BASELINE_WINDOWS.eventStart)).toBe('2026-11-13T03:00:00.000Z');
    expect(iso(BASELINE_WINDOWS.eventEnd)).toBe('2026-11-17T03:00:00.000Z');
  });

  it('antes del evento compara con el último viernes a lunes terminado, sin mirar el CyberMonday', () => {
    // Hasta el lunes 26 de octubre no hay ninguno con 7 días de referencia limpia.
    expect(baselineWindows(cl('2026-10-26 23:59'))).toBeNull();
    const first = baselineWindows(cl('2026-10-27 00:00'));
    expect(first && iso(first.eventStart)).toBe('2026-10-23T03:00:00.000Z');
    // La referencia empieza después del CyberMonday (5 al 7 de octubre).
    expect(first?.refStart).toBe(HISTORY_CLEAN_FROM);
    expect(first && iso(first.refEnd)).toBe('2026-10-17T03:00:00.000Z');

    expect(iso(baselineWindows(cl('2026-11-10 09:00'))!.eventStart)).toBe('2026-11-06T03:00:00.000Z');
    expect(baselineWindows(cl('2026-11-17 00:00'))).toEqual(BASELINE_WINDOWS);
    // Después queda fijo: el del 20 al 23 ya está tocado por la semana previa.
    expect(baselineWindows(cl('2026-11-25 12:00'))).toEqual(BASELINE_WINDOWS);
    expect(baselineWindows(AFTER)).toEqual(BASELINE_WINDOWS);
  });

  it('el dato preliminar sale el viernes 27 a las 8:00 y el balance el martes 1 de diciembre', () => {
    expect(thermometerPhase(cl('2026-11-27 07:59'))).toBe('antes');
    expect(iso(PRELIMINARY_FROM)).toBe('2026-11-27T11:00:00.000Z');
    expect(thermometerPhase(cl('2026-11-27 08:00'))).toBe('preliminar');
    expect(thermometerPhase(cl('2026-11-30 23:59'))).toBe('preliminar');
    expect(thermometerPhase(cl('2026-12-01 00:00'))).toBe('balance');
  });
});

describe('timelineOf', () => {
  it('sin registros, el precio de hoy rige desde que se agregó', () => {
    const p = product({ price: 50_000, listPrice: 80_000, createdAt: cl('2026-10-20 10:00') });
    expect(timelineOf(p, [], cl('2026-11-01 00:00'))).toEqual([
      { price: 50_000, list: 80_000, from: cl('2026-10-20 10:00'), to: cl('2026-11-01 00:00') },
    ]);
  });

  it('con registros, desde el primero y hasta asOf; lo posterior no cuenta', () => {
    const p = product();
    const r = rows(p, [
      ['2026-10-12 10:00', 100_000],
      ['2026-10-20 10:00', 90_000, 150_000],
      ['2026-11-28 10:00', 70_000],
    ]);
    expect(timelineOf(p, r, cl('2026-11-01 00:00'))).toEqual([
      { price: 100_000, list: null, from: cl('2026-10-12 10:00'), to: cl('2026-10-20 10:00') },
      { price: 90_000, list: 150_000, from: cl('2026-10-20 10:00'), to: cl('2026-11-01 00:00') },
    ]);
  });

  it('si los registros empiezan después de asOf, no se sabe qué precio regía', () => {
    const p = product();
    expect(timelineOf(p, rows(p, [['2026-11-28 10:00', 70_000]]), cl('2026-11-20 00:00'))).toBeNull();
  });

  it('sin vendedor hoy, la línea termina cuando salió; sin esa fecha no se mide', () => {
    const p = product({ active: false, inactiveSince: cl('2026-11-28 09:00') });
    const st = timelineOf(p, rows(p, [['2026-10-12 10:00', 100_000]]), AFTER);
    expect(st?.at(-1)?.to).toBe(cl('2026-11-28 09:00'));
    expect(timelineOf({ ...p, inactiveSince: null }, rows(p, [['2026-10-12 10:00', 100_000]]), AFTER)).toBeNull();
  });

  it('el precio de lista solo cuenta si es mayor que el precio; dos registros a la misma hora: rige el segundo', () => {
    const p = product();
    const st = timelineOf(
      p,
      rows(p, [
        ['2026-10-12 10:00', 100_000, 90_000],
        ['2026-10-13 10:00', 95_000],
        ['2026-10-13 10:00', 97_000],
      ]),
      cl('2026-10-14 10:00')
    );
    expect(st).toEqual([
      { price: 100_000, list: null, from: cl('2026-10-12 10:00'), to: cl('2026-10-13 10:00') },
      { price: 97_000, list: null, from: cl('2026-10-13 10:00'), to: cl('2026-10-14 10:00') },
    ]);
  });
});

describe('precio habitual y precios sostenidos', () => {
  const st = (spec: [number, number][]): Stretch[] => {
    let t = 0;
    return spec.map(([price, hours]) => {
      const s = { price, list: null, from: t, to: t + hours * H };
      t += hours * H;
      return s;
    });
  };

  it('el habitual es el que más rigió: un alza de horas no lo mueve', () => {
    expect(habitualPrice(st([[100, 300], [150, 5], [100, 100]]))).toBe(100);
    expect(habitualPrice(st([[100, 100], [120, 300]]))).toBe(120);
  });

  it('el más bajo sostenido necesita 6 horas en total, sumando tramos', () => {
    expect(lowestHeld(st([[100, 50], [60, 3], [100, 20]]), 6 * H)).toBe(100);
    expect(lowestHeld(st([[100, 50], [60, 3], [100, 20], [60, 3]]), 6 * H)).toBe(60);
    expect(lowestHeld(st([[60, 5]]), 6 * H)).toBeNull();
  });

  it('el más alto sostenido necesita un día en total', () => {
    expect(highestHeld(st([[100, 100], [130, 20]]), D)).toBe(100);
    expect(highestHeld(st([[100, 100], [130, 30]]), D)).toBe(130);
  });
});

describe('measureProduct', () => {
  const asOf = AFTER;
  const measure = (p: ThermometerProduct, r: ThermometerRow[], at = asOf) => {
    const st = timelineOf(p, r, Math.min(at, EVENT_WINDOWS.eventEnd));
    return st ? measureProduct(p, st, EVENT_WINDOWS, Math.min(at, EVENT_WINDOWS.eventEnd)) : null;
  };

  it('bajó de verdad: 20% bajo el precio que rigió del 1 al 20', () => {
    const p = product();
    const o = measure(p, rows(p, [['2026-10-12 10:00', 100_000], ['2026-11-27 00:05', 80_000, 160_000]]));
    expect(o).toMatchObject({ habitual: 100_000, eventPrice: 80_000, verdict: 'bajo', announcedPct: 50, roseBefore: false });
    expect(o?.realPct).toBeCloseTo(20);
  });

  it('un precio que duró 3 horas en el evento no es el precio del Black Friday', () => {
    const p = product();
    const o = measure(
      p,
      rows(p, [
        ['2026-10-12 10:00', 100_000],
        ['2026-11-28 10:00', 50_000],
        ['2026-11-28 13:00', 100_000],
      ])
    );
    expect(o).toMatchObject({ eventPrice: 100_000, verdict: 'igual' });
  });

  it('un precio que va y vuelve no cuenta como baja aunque quede 10% bajo el habitual', () => {
    const p = product();
    // Del 1 al 20, cada día 14 horas a $100.000 y 10 a $90.000 (dos vendedores turnándose).
    const points: [string, number][] = [['2026-10-25 00:00', 100_000]];
    for (let d = 1; d <= 26; d++) {
      const day = `2026-11-${String(d).padStart(2, '0')}`;
      points.push([`${day} 00:00`, 100_000], [`${day} 14:00`, 90_000]);
    }
    points.push(['2026-11-27 00:00', 90_000]);
    const o = measure(p, rows(p, points));
    expect(o?.habitual).toBe(100_000);
    expect(o?.eventPrice).toBe(90_000);
    expect(o?.verdict).toBe('igual');
  });

  it('más caro: hasta su precio más bajo del evento quedó 5% o más sobre el habitual', () => {
    const p = product();
    expect(measure(p, rows(p, [['2026-10-12 10:00', 100_000], ['2026-11-26 10:00', 110_000]]))?.verdict).toBe('caro');
  });

  it('subió antes y en el evento "bajó" al precio de siempre', () => {
    const p = product();
    const o = measure(
      p,
      rows(p, [
        ['2026-10-12 10:00', 100_000],
        ['2026-11-22 10:00', 130_000, 130_000],
        ['2026-11-27 00:00', 100_000, 200_000],
      ])
    );
    expect(o).toMatchObject({ verdict: 'igual', prePrice: 130_000, roseBefore: true, roseThenDropped: true, announcedPct: 50 });
  });

  it('subió antes, pero en el evento bajó de verdad: no es un "subió y bajó"', () => {
    const p = product();
    const o = measure(
      p,
      rows(p, [
        ['2026-10-12 10:00', 100_000],
        ['2026-11-22 10:00', 130_000],
        ['2026-11-27 00:00', 80_000],
      ])
    );
    expect(o).toMatchObject({ verdict: 'bajo', roseBefore: true, roseThenDropped: false });
  });

  it('un alza de menos de un día en la semana previa no es "subió antes"', () => {
    const p = product();
    const o = measure(
      p,
      rows(p, [
        ['2026-10-12 10:00', 100_000],
        ['2026-11-24 10:00', 130_000],
        ['2026-11-25 06:00', 100_000],
      ])
    );
    expect(o).toMatchObject({ prePrice: 100_000, roseBefore: false, verdict: 'igual' });
  });

  it('sin registros: el precio quieto cuenta, como "igual"', () => {
    const p = product({ createdAt: cl('2026-10-15 10:00') });
    expect(measure(p, [])).toMatchObject({ habitual: 100_000, eventPrice: 100_000, realPct: 0, verdict: 'igual' });
  });

  it('con menos de 7 días de referencia no se mide', () => {
    const late = product({ createdAt: cl('2026-11-15 10:00') });
    expect(measure(late, [])).toBeNull();
    const enough = product({ createdAt: cl('2026-11-13 23:00') });
    expect(measure(enough, [])).not.toBeNull();
  });

  it('sin vendedor desde antes del evento no se mide; si salió en medio, cuenta lo que estuvo a la venta', () => {
    const before = product({ active: false, inactiveSince: cl('2026-11-25 10:00') });
    expect(measure(before, rows(before, [['2026-10-12 10:00', 100_000]]))).toBeNull();
    const during = product({ active: false, inactiveSince: cl('2026-11-28 10:00') });
    const o = measure(during, rows(during, [['2026-10-12 10:00', 100_000], ['2026-11-27 00:00', 85_000]]));
    expect(o).toMatchObject({ eventPrice: 85_000, verdict: 'bajo' });
  });

  it('dato preliminar a las 8:00 del viernes: la baja de la medianoche ya cuenta, la de las 6:00 todavía no', () => {
    const at = cl('2026-11-27 08:00');
    const midnight = product();
    expect(measure(midnight, rows(midnight, [['2026-10-12 10:00', 100_000], ['2026-11-27 00:00', 80_000]]), at)?.verdict).toBe('bajo');
    const six = product();
    expect(measure(six, rows(six, [['2026-10-12 10:00', 100_000], ['2026-11-27 06:00', 80_000]]), at)?.verdict).toBe('igual');
  });
});

describe('measurePre', () => {
  it('cuenta en vivo lo que lleva un día o más sobre el habitual', () => {
    const p = product();
    const r = rows(p, [['2026-10-12 10:00', 100_000], ['2026-11-21 08:00', 120_000]]);
    const at = cl('2026-11-23 10:00');
    const st = timelineOf(p, r, at)!;
    expect(measurePre(p, st, EVENT_WINDOWS, at)).toMatchObject({ habitual: 100_000, prePrice: 120_000, roseBefore: true });
    // El sábado 21 a las 20:00 todavía no lleva un día en la semana previa.
    const early = cl('2026-11-21 20:00');
    expect(measurePre(p, timelineOf(p, r, early)!, EVENT_WINDOWS, early)).toBeNull();
  });
});

describe('onePerProduct', () => {
  it('de cada familia y de cada nombre repetido queda el de historial más largo', () => {
    const a = product({ familyId: 'F1', name: 'Parlante X Negro' });
    const b = product({ familyId: 'F1', name: 'Parlante X Azul' });
    const c = product({ familyId: 'F2', name: 'Audífono Y' });
    const d = product({ familyId: 'F3', name: 'Audífono  Y' });
    const e = product({ familyId: null, name: 'Otro' });
    const st = (from: number): Stretch[] => [{ price: 1, list: null, from, to: from + D }];
    const items = [
      { product: a, stretches: st(cl('2026-10-12 00:00')) },
      { product: b, stretches: st(cl('2026-10-10 00:00')) },
      { product: c, stretches: st(cl('2026-10-15 00:00')) },
      { product: d, stretches: st(cl('2026-10-11 00:00')) },
      { product: e, stretches: st(cl('2026-10-11 00:00')) },
    ];
    expect(onePerProduct(items).map((i) => i.product.id)).toEqual([b.id, d.id, e.id]);
  });
});

function outcome(over: Partial<ProductOutcome> = {}): ProductOutcome {
  seq++;
  return {
    id: `o${seq}`,
    slug: `o-${seq}`,
    name: `O ${seq}`,
    category: 'audio',
    habitual: 100_000,
    eventPrice: 100_000,
    realPct: 0,
    announcedPct: 0,
    verdict: 'igual',
    prePrice: null,
    roseBefore: false,
    roseThenDropped: false,
    ...over,
  };
}

describe('summarizeOutcomes', () => {
  it('cuenta cada resultado y promedia las ofertas (20% o más anunciado)', () => {
    const outcomes = [
      outcome({ verdict: 'bajo', realPct: 20, announcedPct: 40, eventPrice: 80_000 }),
      outcome({ verdict: 'igual', realPct: 0, announcedPct: 30 }),
      outcome({ verdict: 'caro', realPct: -10, announcedPct: 10 }),
      outcome({ verdict: 'igual', realPct: 2, roseBefore: true, roseThenDropped: true, prePrice: 120_000 }),
    ];
    const s = summarizeOutcomes(outcomes, EVENT_WINDOWS)!;
    expect(s).toMatchObject({ measured: 4, dropped: 1, flat: 2, pricier: 1, roseBefore: 1, roseThenDropped: 1, offers: 2 });
    expect(s.offersAnnouncedAvg).toBeCloseTo(35);
    expect(s.offersRealAvg).toBeCloseTo(10);
    expect(s.realAvg).toBeCloseTo(3);
    expect(summarizeOutcomes([], EVENT_WINDOWS)).toBeNull();
  });

  it('la tabla lleva las categorías con 10 o más productos, en el orden del sitio', () => {
    const outcomes = [
      ...Array.from({ length: 12 }, (_, i) => outcome({ category: 'audio', verdict: i < 3 ? 'bajo' : 'igual' })),
      ...Array.from({ length: 10 }, () => outcome({ category: 'celulares', announcedPct: 25, realPct: 4 })),
      ...Array.from({ length: 9 }, () => outcome({ category: 'gaming' })),
    ];
    const s = summarizeOutcomes(outcomes, EVENT_WINDOWS)!;
    expect(s.byCategory.map((c) => [c.slug, c.measured, c.dropped, c.offers])).toEqual([
      ['celulares', 10, 0, 10],
      ['audio', 12, 3, 0],
    ]);
    expect(s.byCategory[0].offersRealAvg).toBeCloseTo(4);
    expect(s.byCategory[1].offersAnnouncedAvg).toBeNull();
  });

  it('las listas dejan fuera lo de menos de $10.000 y van de mayor a menor', () => {
    const s = summarizeOutcomes(
      [
        outcome({ verdict: 'bajo', realPct: 10, slug: 'diez' }),
        outcome({ verdict: 'bajo', realPct: 50, habitual: 5_000, slug: 'barato' }),
        outcome({ verdict: 'bajo', realPct: 30, slug: 'treinta' }),
        outcome({ roseThenDropped: true, roseBefore: true, prePrice: 110_000, slug: 'diez-mas' }),
        outcome({ roseThenDropped: true, roseBefore: true, prePrice: 140_000, slug: 'cuarenta-mas' }),
      ],
      EVENT_WINDOWS
    )!;
    expect(s.topDrops.map((i) => i.slug)).toEqual(['treinta', 'diez']);
    expect(s.roseThenDroppedItems.map((i) => i.slug)).toEqual(['cuarenta-mas', 'diez-mas']);
  });
});

describe('buildThermometer', () => {
  function catalog() {
    const out: { products: ThermometerProduct[]; rows: ThermometerRow[] } = { products: [], rows: [] };
    // Bajó en el Black Friday.
    const a = product({ familyId: 'A' });
    out.products.push(a);
    out.rows.push(...rows(a, [['2026-10-12 10:00', 100_000], ['2026-11-27 00:00', 80_000]]));
    // Otro color del mismo: cuenta una vez.
    const a2 = product({ familyId: 'A', createdAt: cl('2026-10-20 10:00') });
    out.products.push(a2);
    out.rows.push(...rows(a2, [['2026-10-20 10:00', 100_000], ['2026-11-27 00:00', 80_000]]));
    // Subió en la semana previa y "bajó" en el evento.
    const b = product();
    out.products.push(b);
    out.rows.push(...rows(b, [['2026-10-12 10:00', 50_000], ['2026-11-22 10:00', 60_000], ['2026-11-27 00:00', 50_000]]));
    // Quieto.
    out.products.push(product({ createdAt: cl('2026-10-09 10:00') }));
    return out;
  }

  it('antes del 21 de noviembre: solo la prueba del método con un fin de semana normal', () => {
    const { products, rows: r } = catalog();
    const s = buildThermometer(products, r, cl('2026-11-10 10:00'));
    expect(s.phase).toBe('antes');
    expect(s.event).toBeNull();
    expect(s.preLive).toBeNull();
    expect(iso(s.baseline!.windows.eventStart)).toBe('2026-11-06T03:00:00.000Z');
    expect(s.baseline!.measured).toBe(3);
  });

  it('en la semana previa cuenta en vivo lo que ya subió', () => {
    const { products, rows: r } = catalog();
    const s = buildThermometer(products, r, cl('2026-11-24 10:00'));
    expect(s.event).toBeNull();
    expect(s.preLive).toMatchObject({ measured: 3, roseBefore: 1 });
    expect(s.preLive!.items.map((i) => i.prePrice)).toEqual([60_000]);
    expect(buildThermometer(products, r, PRE_LIVE_FROM - 1).preLive).toBeNull();
  });

  it('balance: un producto por familia, con el fin de semana del 13 al 16 para comparar', () => {
    const { products, rows: r } = catalog();
    const s = buildThermometer(products, r, AFTER);
    expect(s.phase).toBe('balance');
    expect(s.asOf).toBe(EVENT_WINDOWS.eventEnd);
    expect(s.preLive).toBeNull();
    expect(s.event).toMatchObject({ measured: 3, dropped: 1, roseBefore: 1, roseThenDropped: 1 });
    expect(s.baseline?.windows).toEqual(BASELINE_WINDOWS);
    expect(s.baseline).toMatchObject({ measured: 3, dropped: 0 });
  });

  it('el resumen es chico: va entero al caché', () => {
    const products: ThermometerProduct[] = [];
    const r: ThermometerRow[] = [];
    for (let i = 0; i < 3000; i++) {
      const p = product({ name: `Producto con un nombre largo de Mercado Libre número ${i}`, category: i % 2 ? 'audio' : 'hogar' });
      products.push(p);
      r.push(...rows(p, [['2026-10-12 10:00', 100_000 + i], ['2026-11-22 10:00', 120_000 + i], ['2026-11-27 00:00', 80_000 + i]]));
    }
    const size = JSON.stringify(buildThermometer(products, r, AFTER)).length;
    expect(size).toBeLessThan(50_000);
  });
});

describe('caché y sitemap', () => {
  it('la llave cambia cada día antes de la semana previa, cada hora desde el 21 y queda fija en el balance', () => {
    expect(thermometerSlot(cl('2026-11-10 10:00'))).toBe('dia:2026-11-10');
    expect(thermometerSlot(cl('2026-11-10 23:30'))).toBe('dia:2026-11-10');
    expect(thermometerSlot(cl('2026-11-21 00:30'))).toMatch(/^hora:/);
    expect(thermometerSlot(cl('2026-11-28 10:10'))).not.toBe(thermometerSlot(cl('2026-11-28 11:10')));
    expect(thermometerSlot(cl('2026-12-01 00:00'))).toBe('balance');
    expect(thermometerSlot(AFTER)).toBe('balance');
  });

  it('el sitemap dice cuándo cambió lo que se ve', () => {
    expect(thermometerLastModified(cl('2026-10-20 10:00'))).toBeUndefined();
    expect(thermometerLastModified(cl('2026-11-04 10:00'))?.toISOString()).toBe('2026-11-03T03:00:00.000Z');
    expect(thermometerLastModified(cl('2026-11-28 10:40'))?.toISOString()).toBe('2026-11-28T13:00:00.000Z');
    expect(thermometerLastModified(AFTER)?.toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });
});

describe('textos', () => {
  it('fechas en hora de Chile, con o sin día de la semana', () => {
    expect(rangeLabel(EVENT_WINDOWS.refStart, EVENT_WINDOWS.refEnd)).toBe('del 1 al 20 de noviembre');
    expect(rangeLabel(EVENT_WINDOWS.refEnd, EVENT_WINDOWS.eventStart, true)).toBe('del sábado 21 al jueves 26 de noviembre');
    expect(rangeLabel(BASELINE_WINDOWS.eventStart, BASELINE_WINDOWS.eventEnd, true)).toBe('del viernes 13 al lunes 16 de noviembre');
    expect(rangeLabel(cl('2026-10-30 00:00'), cl('2026-11-03 00:00'), true)).toBe('del viernes 30 de octubre al lunes 2 de noviembre');
    expect(asOfLabel(cl('2026-11-27 09:30'))).toBe('las 09:30 del viernes 27 de noviembre');
  });

  it('porcentajes enteros, sin decir 0% de algo que pasó', () => {
    expect(shareLabel(23, 100)).toBe('23%');
    expect(shareLabel(1, 300)).toBe('menos de 1%');
    expect(shareLabel(0, 300)).toBe('0%');
    expect(shareLabel(0, 0)).toBe('0%');
  });

  it('"de cada 100" siempre suma 100', () => {
    expect(perHundred([1, 1, 1])).toEqual([34, 33, 33]);
    expect(perHundred([16, 100, 38])).toEqual([10, 65, 25]);
    expect(perHundred([0, 5, 0])).toEqual([0, 100, 0]);
    expect(perHundred([0, 0, 0])).toEqual([0, 0, 0]);
    for (const parts of [[7, 13, 29], [1, 2, 997], [333, 333, 334]]) {
      expect(perHundred(parts).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it('el cambio promedio en palabras: menos de 1% es "igual"', () => {
    expect(averageChange(6.4)).toEqual({ direction: 'bajo', pct: 6 });
    expect(averageChange(-2.6)).toEqual({ direction: 'subio', pct: 3 });
    expect(averageChange(0.4)).toEqual({ direction: 'igual', pct: 0 });
    expect(averageChange(-0.49)).toEqual({ direction: 'igual', pct: 0 });
  });
});

describe('Lo que vamos a vigilar', () => {
  it('se muestra del lunes 23 hasta que termina el evento', () => {
    expect(iso(WATCH_FROM)).toBe('2026-11-23T03:00:00.000Z');
    expect(showWatchList(cl('2026-11-22 23:59'))).toBe(false);
    expect(showWatchList(cl('2026-11-23 00:00'))).toBe(true);
    expect(showWatchList(cl('2026-11-30 23:59'))).toBe(true);
    expect(showWatchList(cl('2026-12-01 00:00'))).toBe(false);
  });

  it('"subió antes" solo si el historial lo confirma y hoy no está bajo el habitual', () => {
    const p = product({ price: 120_000 });
    const r = rows(p, [['2026-10-12 10:00', 100_000], ['2026-11-21 08:00', 120_000]]);
    expect(watchNote(p, r, cl('2026-11-24 10:00'))).toEqual({ habitual: 100_000, roseBefore: true, belowPct: null });
    // Un día después de subir todavía no.
    const fresh = rows(p, [['2026-10-12 10:00', 100_000], ['2026-11-23 20:00', 120_000]]);
    expect(watchNote(p, fresh, cl('2026-11-24 10:00'))?.roseBefore).toBe(false);
  });

  it('en el evento dice cuánto bajo el habitual está hoy, solo si bajó de verdad', () => {
    const p = product({ price: 80_000 });
    const r = rows(p, [['2026-10-12 10:00', 100_000], ['2026-11-22 10:00', 130_000], ['2026-11-27 00:00', 80_000]]);
    expect(watchNote(p, r, cl('2026-11-28 10:00'))).toEqual({ habitual: 100_000, roseBefore: false, belowPct: 20 });
    // Antes del evento no se dice "bajo el habitual".
    const q = product({ price: 80_000 });
    expect(watchNote(q, rows(q, [['2026-10-12 10:00', 100_000], ['2026-11-24 10:00', 80_000]]), cl('2026-11-25 10:00'))).toEqual({
      habitual: 100_000,
      roseBefore: false,
      belowPct: null,
    });
  });

  it('sin referencia suficiente no dice nada', () => {
    const p = product({ createdAt: cl('2026-11-18 10:00') });
    expect(watchNote(p, [], cl('2026-11-24 10:00'))).toBeNull();
  });
});
