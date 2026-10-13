import { describe, expect, it } from 'vitest';
import {
  changeSince,
  dropSince,
  firstRecordIsStart,
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

  it('cuenta los cambios de precio de las últimas 48 horas', () => {
    // Cambió hace 3 días (fuera), hace 1 día y hace medio día. El registro que repite el precio no cuenta.
    const stats = priceStats([point(100, 10), point(90, 3), point(95, 1), point(95, 0.75), point(90, 0.5)], NOW)!;
    expect(stats.changesLast48h).toBe(2);
    expect(priceStats([point(100, 30), point(90, 10)], NOW)!.changesLast48h).toBe(0);
  });

  it('el primer registro no se cuenta como cambio, pero se dice de cuándo es', () => {
    // Puede ser el precio de partida o el primer cambio: lo decide quien sabe cuándo se agregó el producto.
    const single = priceStats([point(100, 1)], NOW)!;
    expect(single.changesLast48h).toBe(0);
    expect(single.firstSeenAt).toBe(daysAgo(1));
    const two = priceStats([point(90, 0.2), point(100, 1.5)], NOW)!;
    expect(two.changesLast48h).toBe(1);
    expect(two.firstSeenAt).toBe(daysAgo(1.5));
  });

  it('dice cuánto historial hay antes del último cambio', () => {
    expect(priceStats([point(100, 9)], NOW)!.trackedBeforeChangeMs).toBeNull();
    expect(priceStats([point(100, 9), point(90, 2)], NOW)!.trackedBeforeChangeMs).toBe(7 * 86_400_000);
    // Media hora de registro antes del cambio.
    expect(priceStats([point(100, 1), point(90, 1 - 0.5 / 24)], NOW)!.trackedBeforeChangeMs).toBe(30 * 60_000);
  });

  it('el mínimo sostenido no baja por un precio que duró horas', () => {
    // 100 durante 20 días, 70 por tres horas, y de vuelta a 100.
    const blip = priceStats([point(100, 20), point(70, 2), point(100, 2 - 3 / 24)], NOW)!;
    expect(blip.min30).toBe(70);
    expect(blip.min30Held).toBe(100);
    // Si los 70 duraron dos días, sí se sostuvo.
    const held = priceStats([point(100, 20), point(70, 5), point(100, 3)], NOW)!;
    expect(held.min30Held).toBe(70);
    // Dos precios bajos que juntos suman seis horas: vale el más alto de los dos.
    const two = priceStats([point(100, 20), point(70, 3), point(80, 3 - 2 / 24), point(100, 3 - 7 / 24)], NOW)!;
    expect(two.min30Held).toBe(80);
    // Seis horas justas ya cuentan.
    const six = priceStats([point(100, 20), point(70, 3), point(100, 3 - 6 / 24)], NOW)!;
    expect(six.min30Held).toBe(70);
  });

  it('el primer registro cuenta como sostenido aunque haya durado poco', () => {
    // Es el precio que el producto ya tenía cuando empezamos a anotar: no se sabe desde cuándo.
    const young = priceStats([point(80, 10 / 24), point(100, 7 / 24)], NOW)!;
    expect(young.min30Held).toBe(80);
    expect(priceStats([point(100, 1 / 24)], NOW)!.min30Held).toBe(100);
    // El mismo precio bajo, por tres horas y sin ser el primero, no se sostuvo.
    const later = priceStats([point(100, 3), point(80, 10 / 24), point(100, 7 / 24)], NOW)!;
    expect(later.min30Held).toBe(100);
  });

  it('el precio habitual antes del cambio es el que más rigió, no el último registro', () => {
    // 329.990 por cinco días, unas horas a 499.990 y después 316.131.
    const spike = priceStats([point(329_990, 6), point(499_990, 1.2), point(316_131, 1)], NOW)!;
    expect(spike.previousPrice).toBe(499_990);
    expect(spike.usualPriceBefore).toBe(329_990);
    // Sin cambios no hay precio habitual anterior.
    expect(priceStats([point(100, 9)], NOW)!.usualPriceBefore).toBeNull();
    // Mitad y mitad: se queda con el más bajo, que es el lado prudente.
    expect(priceStats([point(100, 30), point(120, 20), point(90, 10)], NOW)!.usualPriceBefore).toBe(100);
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

describe('la baja se mide contra lo que costaba de verdad', () => {
  it('un paso de horas por un precio más alto no agranda la baja', () => {
    const stats = priceStats([point(329_990, 6), point(499_990, 1.2), point(316_131, 1)], NOW);
    expect(dropSince(stats, 316_131, NOW)).toEqual({ amount: 13_859, since: daysAgo(1) });
  });

  it('volver al precio de siempre después de un alza breve no es una baja', () => {
    // 100.000 por 25 días, 215.000 por medio día (otro vendedor mientras no había stock), de vuelta a 100.000 hace 10 días.
    const stats = priceStats([point(100_000, 40), point(215_000, 10.5), point(100_000, 10)], NOW);
    expect(changeSince(stats, 100_000, NOW)).toBeNull();
    // Tampoco si vuelve un poco más caro de lo que costaba.
    const dearer = priceStats([point(100_000, 40), point(215_000, 10.5), point(104_000, 10)], NOW);
    expect(dropSince(dearer, 104_000, NOW)).toBeNull();
  });

  it('una baja desde un precio que rigió semanas se informa entera', () => {
    const stats = priceStats([point(120_000, 40), point(99_990, 3)], NOW);
    expect(dropSince(stats, 99_990, NOW)).toEqual({ amount: 20_010, since: daysAgo(3) });
  });

  it('un alza se mide contra el mayor entre el registro anterior y el precio habitual', () => {
    const stats = priceStats([point(100_000, 40), point(90_000, 20), point(110_000, 2)], NOW);
    expect(changeSince(stats, 110_000, NOW)).toEqual({ direction: 'up', amount: 20_000, since: daysAgo(2) });
    // Costó 819.990 casi toda la semana, pasó un rato a 719.990 y quedó en 799.990: no "subió".
    const back = priceStats([point(819_990, 8), point(719_990, 1.5), point(799_990, 1)], NOW);
    expect(changeSince(back, 799_990, NOW)).toBeNull();
  });

  it('con menos de un día de historial antes del cambio no se afirma nada', () => {
    // Sin fila de partida: lo anotado antes del cambio son 30 minutos, y el producto pudo solo volver a su precio.
    const short = priceStats([point(13_592, 1), point(13_252, 1 - 0.5 / 24)], NOW);
    expect(changeSince(short, 13_252, NOW)).toBeNull();
    const up = priceStats([point(90_000, 1), point(110_000, 0.5)], NOW);
    expect(changeSince(up, 110_000, NOW)).toBeNull();
    // Con un día justo, sí.
    const enough = priceStats([point(100_000, 2), point(90_000, 1)], NOW);
    expect(dropSince(enough, 90_000, NOW)).toEqual({ amount: 10_000, since: daysAgo(1) });
    // Un resumen guardado antes de que existiera el dato tampoco afirma.
    expect(dropSince({ ...enough!, trackedBeforeChangeMs: undefined as unknown as number }, 90_000, NOW)).toBeNull();
  });

  it('volver a casi lo que costaba (1%) tampoco es una baja, aunque no sea el mismo precio al peso', () => {
    // 51.166 → 53.004 → 51.162: está $4 bajo lo que costaba hace dos días.
    const back = priceStats([point(51_166, 6), point(53_004, 5), point(51_162, 3)], NOW)!;
    expect(back.lastPriceSeenRecently).toBe(false);
    expect(back.lastPriceNearRecent).toBe(true);
    expect(dropSince(back, 51_162, NOW)).toBeNull();
    // Y lo mismo hacia arriba.
    const up = priceStats([point(53_000, 6), point(51_000, 5), point(53_010, 3)], NOW)!;
    expect(changeSince(up, 53_010, NOW)).toBeNull();
    // Una baja de verdad no se parece a nada de la semana anterior.
    const real = priceStats([point(100_000, 9), point(90_000, 3)], NOW)!;
    expect(real.lastPriceNearRecent).toBe(false);
    expect(dropSince(real, 90_000, NOW)).toEqual({ amount: 10_000, since: daysAgo(3) });
  });

  it('si el precio anterior es el primer registro y ese registro no es el de partida, no se afirma nada', () => {
    // Fechas posteriores a la creación de la tabla: antes de eso todo primer registro es de partida.
    const later = new Date('2026-11-10T12:00:00.000Z').getTime();
    const ago = (days: number) => new Date(later - days * 86_400_000).toISOString();
    const at = (price: number, days: number): PricePoint => ({ price, observed_at: ago(days) });

    // Agregado hace 5 días; el historial parte hace 3 (su primer cambio, desde no se sabe cuánto) y hace 1 bajó.
    const stats = priceStats([at(94_245, 3), at(59_990, 1)], later)!;
    expect(stats.previousIsFirstRecord).toBe(true);
    expect(dropSince(stats, 59_990, later, null, ago(5))).toBeNull();
    // Si el primer registro es de cuando se agregó, es su precio de partida y la baja se informa.
    expect(dropSince(stats, 59_990, later, null, ago(3))).toEqual({ amount: 34_255, since: ago(1) });
    // Quien no sabe cuándo se agregó no pasa la fecha, y vale lo anotado.
    expect(dropSince(stats, 59_990, later)).toEqual({ amount: 34_255, since: ago(1) });
    // Con un precio anterior que no es el primer registro, lo de antes sí quedó anotado.
    const longer = priceStats([at(90_000, 6), at(94_245, 3), at(59_990, 1)], later)!;
    expect(longer.previousIsFirstRecord).toBe(false);
    expect(dropSince(longer, 59_990, later, null, ago(9))).toEqual({ amount: 30_010, since: ago(1) });
  });

  it('firstRecordIsStart: el primer registro es el precio de partida si es del alta o de cuando se creó la tabla', () => {
    const created = '2026-10-20T12:00:00.000Z';
    expect(firstRecordIsStart('2026-10-20T12:00:04.000Z', created)).toBe(true);
    expect(firstRecordIsStart('2026-10-20T12:04:59.000Z', created)).toBe(true);
    expect(firstRecordIsStart('2026-10-20T12:06:00.000Z', created)).toBe(false);
    expect(firstRecordIsStart('2026-10-22T03:00:00.000Z', created)).toBe(false);
    // Sin fecha de alta se supone que es un cambio.
    expect(firstRecordIsStart('2026-10-22T03:00:00.000Z', null)).toBe(false);
    expect(firstRecordIsStart('2026-10-22T03:00:00.000Z', undefined)).toBe(false);
    // Los registros del día en que se creó la tabla son precios de partida, aunque el producto sea anterior.
    expect(firstRecordIsStart('2026-10-05T20:30:06.000Z', '2026-10-04T21:03:00.000Z')).toBe(true);
    expect(firstRecordIsStart('2026-10-05T20:30:06.000Z', null)).toBe(true);
    // Un resumen sin fecha no dice nada.
    expect(firstRecordIsStart(undefined, created)).toBe(false);
    expect(firstRecordIsStart('no es fecha', created)).toBe(false);
  });

  it('dos registros de partida a la misma hora cuentan los dos como el primero', () => {
    // Dos corridas que se pisan anotan la partida dos veces; el precio subió una hora después.
    const twice = priceStats([point(100_000, 9 / 24), point(100_000, 9 / 24), point(120_000, 8 / 24)], NOW)!;
    expect(twice.min30Held).toBe(100_000);
  });

  it('la baja no se mide contra algo más alto que el precio de lista de hoy', () => {
    // Otro vendedor lo tuvo a 209.510 una semana; hoy vuelve a 109.990 con lista 119.990.
    const stats = priceStats([point(209_510, 8), point(109_990, 1)], NOW);
    expect(dropSince(stats, 109_990, NOW)).toEqual({ amount: 99_520, since: daysAgo(1) });
    expect(dropSince(stats, 109_990, NOW, 119_990)).toEqual({ amount: 10_000, since: daysAgo(1) });
    // Una lista más alta que el precio anterior no cambia nada, ni una que no es mayor que el precio.
    expect(dropSince(stats, 109_990, NOW, 250_000)).toEqual({ amount: 99_520, since: daysAgo(1) });
    expect(dropSince(stats, 109_990, NOW, 109_990)).toEqual({ amount: 99_520, since: daysAgo(1) });
    expect(dropSince(stats, 109_990, NOW, null)).toEqual({ amount: 99_520, since: daysAgo(1) });
    // Si contra la lista queda bajo 1%, no hay baja que contar.
    expect(dropSince(stats, 109_990, NOW, 110_500)).toBeNull();
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
