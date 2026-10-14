import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { interestScore } from '@/lib/social/interest';
import { CLICK_WINDOW_DAYS, POSITION_MAX_AGE_DAYS, readInterestSignals } from '@/lib/social/signals';

const NOW = new Date('2026-10-13T15:00:00Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };

interface Asked {
  table: string;
  columns: string;
  /** Los ids pedidos con .in(), si los hubo, y por qué columna. */
  ids: unknown[] | null;
  inColumn: string | null;
  gte: [string, unknown] | null;
  range: [number, number] | null;
}

/**
 * Una base de mentira con las dos tablas de las señales. Entiende lo que usa
 * el código (gte, in, not … is null, order, range) y anota cada consulta.
 * `fail` decide, consulta por consulta, si responde con un error.
 */
function fakeDb(seed: { clicks?: Row[]; candidates?: Row[]; fail?: (asked: Asked) => DbError | null }) {
  const tables: Record<string, Row[]> = { outbound_clicks: seed.clicks ?? [], product_candidates: seed.candidates ?? [] };
  const asked: Asked[] = [];

  const admin = {
    from(table: string) {
      const query: Asked = { table, columns: '', ids: null, inColumn: null, gte: null, range: null };
      const filters: ((row: Row) => boolean)[] = [];
      const run = () => {
        asked.push(query);
        const error = seed.fail?.(query) ?? null;
        if (error) return { data: null, error };
        let rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1);
        // Como la base: solo vuelven las columnas pedidas.
        const columns = query.columns.split(',').map((column) => column.trim());
        const data = rows.map((row) => {
          const out: Row = {};
          for (const column of columns) out[column] = row[column];
          return out;
        });
        return { data, error: null };
      };
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        gte(column: string, value: unknown) {
          query.gte = [column, value];
          filters.push((row) => String(row[column]) >= String(value));
          return builder;
        },
        in(column: string, values: unknown[]) {
          query.ids = values;
          query.inColumn = column;
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        not(column: string, _op: string, _value: null) {
          filters.push((row) => row[column] !== null && row[column] !== undefined);
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          query.range = [from, to];
          return builder;
        },
        then<T>(resolve: (value: { data: Row[] | null; error: DbError | null }) => T) {
          return Promise.resolve(run()).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as unknown as SupabaseClient, asked };
}

let seq = 0;
function product(mlProductId: string | null = `MLC${1000 + seq}`) {
  seq++;
  return { id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, ml_product_id: mlProductId };
}

const click = (productId: string | null, days: number, clientKey: string | null = null): Row => ({
  product_id: productId,
  client_key: clientKey,
  created_at: daysAgo(days),
});

const candidate = (mlProductId: string, position: number | null, over: Row = {}): Row => ({
  ml_product_id: mlProductId,
  highlight_position: position,
  prospected_at: daysAgo(3),
  checked_at: daysAgo(1),
  ...over,
});

const MISSING_TABLE: DbError = { code: 'PGRST205', message: 'no existe la tabla' };
const MISSING_COLUMN: DbError = { code: '42703', message: 'no existe la columna' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readInterestSignals: clics recientes en el sitio', () => {
  it('cuenta los clics de la última semana de cada producto pedido', async () => {
    const a = product();
    const b = product();
    const other = product();
    const { admin, asked } = fakeDb({
      clicks: [
        click(a.id, 0.1),
        click(a.id, 2),
        click(a.id, 6.9),
        click(a.id, 8), // Hace más de una semana.
        click(b.id, 1),
        click(other.id, 1),
        click(null, 1), // El producto se borró: el clic queda sin producto.
      ],
    });

    const signals = await readInterestSignals(admin, [a, b], NOW);
    expect(signals.get(a.id)).toEqual({ mlPosition: null, recentClicks: 3 });
    expect(signals.get(b.id)).toEqual({ mlPosition: null, recentClicks: 1 });
    // Lo que no se pidió no aparece, aunque tenga clics.
    expect([...signals.keys()]).toEqual([a.id, b.id]);

    const read = asked.find((q) => q.table === 'outbound_clicks')!;
    expect(CLICK_WINDOW_DAYS).toBe(7);
    expect(read.gte).toEqual(['created_at', daysAgo(7)]);
    // Si no se pide otra cosa, lee la semana entera de una vez: es lo que necesita la selección completa.
    expect(read.ids).toBeNull();
    expect(asked.filter((q) => q.table === 'outbound_clicks')).toHaveLength(1);
  });

  it('con onlyTheirClicks le pide a la base solo los clics de esos productos, y cuenta lo mismo', async () => {
    const a = product();
    const b = product();
    const quiet = product();
    const clicks = [
      click(a.id, 0.2, 'llave-1'),
      click(a.id, 0.2, 'llave-1'), // La misma persona el mismo día: uno solo.
      click(a.id, 1, 'llave-2'),
      click(a.id, 8), // Hace más de una semana.
      click(b.id, 2),
      // Una semana de clics de otros productos: sin el filtro serían tres páginas más.
      ...Array.from({ length: 2_600 }, (_, i) => click(`00000000-0000-4000-9000-${String(i % 40).padStart(12, '0')}`, 1)),
    ];

    const whole = fakeDb({ clicks });
    const everything = await readInterestSignals(whole.admin, [a, b, quiet], NOW);
    expect(whole.asked.filter((q) => q.table === 'outbound_clicks').map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);

    const narrow = fakeDb({ clicks });
    const theirs = await readInterestSignals(narrow.admin, [a, b, quiet], NOW, { onlyTheirClicks: true });
    const asked = narrow.asked.filter((q) => q.table === 'outbound_clicks');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ inColumn: 'product_id', ids: [a.id, b.id, quiet.id], range: [0, 999], gte: ['created_at', daysAgo(7)] });

    expect(theirs.get(a.id)).toEqual({ mlPosition: null, recentClicks: 2 });
    expect(theirs.get(b.id)).toEqual({ mlPosition: null, recentClicks: 1 });
    expect(theirs.has(quiet.id)).toBe(false);
    expect([...theirs]).toEqual([...everything]);
  });

  it('con onlyTheirClicks los ids van por tandas de 40, y lo que no es un id de producto no viaja', async () => {
    const rows = Array.from({ length: 90 }, () => product());
    const weird = [{ id: 'no-es-un-id', ml_product_id: null }, { id: `${rows[0].id}),or=(id.gt.0`, ml_product_id: null }, { id: '', ml_product_id: null }];
    const { admin, asked } = fakeDb({ clicks: [click(rows[0].id, 1), click(rows[45].id, 1), click(rows[89].id, 1), click('no-es-un-id', 1)] });

    const signals = await readInterestSignals(admin, [...rows, ...weird], NOW, { onlyTheirClicks: true });
    const read = asked.filter((q) => q.table === 'outbound_clicks');
    expect(read.map((q) => q.ids?.length)).toEqual([40, 40, 10]);
    const sent = read.reduce<unknown[]>((all, q) => all.concat(q.ids ?? []), []);
    expect(sent).toEqual(rows.map((p) => p.id));
    expect([...signals.keys()]).toEqual([rows[0].id, rows[45].id, rows[89].id]);

    // Sin ningún id que valga no hay nada que preguntar.
    const none = fakeDb({ clicks: [click('no-es-un-id', 1)] });
    expect((await readInterestSignals(none.admin, weird, NOW, { onlyTheirClicks: true })).size).toBe(0);
    expect(none.asked.filter((q) => q.table === 'outbound_clicks')).toEqual([]);
  });

  it('con onlyTheirClicks, sin la columna de la llave se da cuenta una vez y sigue sin ella', async () => {
    const rows = Array.from({ length: 50 }, () => product());
    const { admin, asked } = fakeDb({
      clicks: [click(rows[0].id, 1, 'x'), click(rows[0].id, 1, 'x'), click(rows[49].id, 2, 'x')],
      fail: (q) => (q.table === 'outbound_clicks' && q.columns.includes('client_key') ? MISSING_COLUMN : null),
    });

    const signals = await readInterestSignals(admin, rows, NOW, { onlyTheirClicks: true });
    expect(signals.get(rows[0].id)?.recentClicks).toBe(2);
    expect(signals.get(rows[49].id)?.recentClicks).toBe(1);
    expect(asked.filter((q) => q.table === 'outbound_clicks').map((q) => [q.columns, q.ids?.length])).toEqual([
      ['product_id, client_key', 40],
      ['product_id', 40],
      ['product_id', 10],
    ]);
  });

  it('con onlyTheirClicks tampoco afirma nada si la lectura llega al tope, o si una tanda falla', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = product();
    const flooded = fakeDb({ clicks: Array.from({ length: 20_000 }, () => click(a.id, 1)) });
    expect((await readInterestSignals(flooded.admin, [a], NOW, { onlyTheirClicks: true })).has(a.id)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // Si la segunda tanda falla, lo leído en la primera no se entrega a medias.
    const rows = Array.from({ length: 50 }, () => product());
    const broken = fakeDb({
      clicks: [click(rows[0].id, 1), click(rows[0].id, 1), click(rows[0].id, 1)],
      fail: (q) => (q.table === 'outbound_clicks' && q.ids?.includes(rows[49].id) ? { code: '500', message: 'se cayó' } : null),
    });
    expect((await readInterestSignals(broken.admin, rows, NOW, { onlyTheirClicks: true })).size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('la misma persona cuenta una vez por producto y por día', async () => {
    const a = product();
    const b = product();
    const { admin } = fakeDb({
      clicks: [
        // El dueño probando su botón diez veces en un día: un clic.
        ...Array.from({ length: 10 }, () => click(a.id, 0.2, 'llave-de-hoy')),
        // Al día siguiente su llave es otra: cuenta de nuevo.
        click(a.id, 1.2, 'llave-de-ayer'),
        click(a.id, 0.3, 'otra-persona'),
        // La misma llave en otro producto es otro clic.
        click(b.id, 0.2, 'llave-de-hoy'),
        // Sin llave (no se pudo calcular) cada fila cuenta.
        click(b.id, 0.4),
        click(b.id, 0.5),
      ],
    });

    const signals = await readInterestSignals(admin, [a, b], NOW);
    expect(signals.get(a.id)?.recentClicks).toBe(3);
    expect(signals.get(b.id)?.recentClicks).toBe(3);
  });

  it('sin la columna de la llave cuenta cada fila', async () => {
    const a = product();
    const { admin, asked } = fakeDb({
      clicks: [click(a.id, 1, 'x'), click(a.id, 1, 'x'), click(a.id, 2, 'x')],
      fail: (q) => (q.table === 'outbound_clicks' && q.columns.includes('client_key') ? MISSING_COLUMN : null),
    });

    expect((await readInterestSignals(admin, [a], NOW)).get(a.id)?.recentClicks).toBe(3);
    expect(asked.filter((q) => q.table === 'outbound_clicks').map((q) => q.columns)).toEqual([
      'product_id, client_key',
      'product_id',
    ]);
  });

  it('lee por páginas: más de mil clics no quedan cortados', async () => {
    const a = product();
    const { admin, asked } = fakeDb({ clicks: Array.from({ length: 2300 }, () => click(a.id, 1)) });

    expect((await readInterestSignals(admin, [a], NOW)).get(a.id)?.recentClicks).toBe(2300);
    expect(asked.filter((q) => q.table === 'outbound_clicks').map((q) => q.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('si la lectura llega al tope no afirma nada: está cortada o alguien infló la tabla', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = product();
    const { admin } = fakeDb({ clicks: Array.from({ length: 20_000 }, () => click(a.id, 1)) });

    expect((await readInterestSignals(admin, [a], NOW)).has(a.id)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('sin la tabla no hay señal ni aviso; con otro error, sin señal y queda en el registro', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = product('MLC77');
    const clicks = [click(a.id, 1), click(a.id, 1), click(a.id, 1)];
    const candidates = [candidate('MLC77', 4)];

    const missing = fakeDb({ clicks, candidates, fail: (q) => (q.table === 'outbound_clicks' ? MISSING_TABLE : null) });
    // La otra señal no depende de esta: se lee igual.
    expect((await readInterestSignals(missing.admin, [a], NOW)).get(a.id)).toEqual({ mlPosition: 4, recentClicks: null });
    expect(warn).not.toHaveBeenCalled();

    const broken = fakeDb({
      clicks,
      candidates,
      fail: (q) => (q.table === 'outbound_clicks' ? { code: '500', message: 'se cayó' } : null),
    });
    expect((await readInterestSignals(broken.admin, [a], NOW)).get(a.id)).toEqual({ mlPosition: 4, recentClicks: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('readInterestSignals: puesto entre los más vendidos de Mercado Libre', () => {
  it('trae el puesto del candidato con la misma ficha', async () => {
    const top = product('MLC100');
    const none = product('MLC200');
    const unlinked = product(null);
    const { admin, asked } = fakeDb({
      candidates: [candidate('MLC100', 3), candidate('MLC200', null), candidate('MLC999', 1)],
    });

    const signals = await readInterestSignals(admin, [top, none, unlinked], NOW);
    expect(signals.get(top.id)).toEqual({ mlPosition: 3, recentClicks: null });
    // Sin puesto anotado, o sin ficha asociada, no hay señal: ni siquiera una entrada.
    expect(signals.has(none.id)).toBe(false);
    expect(signals.has(unlinked.id)).toBe(false);

    const read = asked.filter((q) => q.table === 'product_candidates');
    expect(read).toHaveLength(1);
    expect(read[0].ids).toEqual(['MLC100', 'MLC200']);
  });

  it('solo vale un puesto anotado en los últimos 30 días', async () => {
    const fresh = product('MLC1');
    const edge = product('MLC2');
    const old = product('MLC3');
    const recovered = product('MLC4');
    const undated = product('MLC5');
    const { admin } = fakeDb({
      candidates: [
        candidate('MLC1', 5, { prospected_at: daysAgo(2) }),
        candidate('MLC2', 6, { prospected_at: daysAgo(29.9) }),
        candidate('MLC3', 7, { prospected_at: daysAgo(31), checked_at: daysAgo(31) }),
        // Un candidato viejo que el cron volvió a mirar ayer: se renovó la
        // revisión del precio, no el puesto, que sigue siendo de hace meses.
        candidate('MLC4', 1, { prospected_at: daysAgo(120), checked_at: daysAgo(1) }),
        candidate('MLC5', 2, { prospected_at: null, checked_at: null }),
      ],
    });

    const signals = await readInterestSignals(admin, [fresh, edge, old, recovered, undated], NOW);
    expect(POSITION_MAX_AGE_DAYS).toBe(30);
    expect(signals.get(fresh.id)?.mlPosition).toBe(5);
    expect(signals.get(edge.id)?.mlPosition).toBe(6);
    expect(signals.has(old.id)).toBe(false);
    expect(signals.has(recovered.id)).toBe(false);
    expect(signals.has(undated.id)).toBe(false);
  });

  it('sin la fecha en que se encontró, vale la de la última revisión', async () => {
    const p = product('MLC8');
    const { admin } = fakeDb({ candidates: [candidate('MLC8', 9, { prospected_at: null, checked_at: daysAgo(4) })] });
    expect((await readInterestSignals(admin, [p], NOW)).get(p.id)?.mlPosition).toBe(9);
  });

  it('si hay varios candidatos de la ficha queda el mejor puesto, y un puesto imposible no cuenta', async () => {
    const p = product('MLC10');
    const broken = product('MLC11');
    const { admin } = fakeDb({
      candidates: [
        candidate('MLC10', 12),
        candidate('MLC10', 4),
        candidate('MLC10', 9),
        // Un puesto mejor, pero viejo: no gana.
        candidate('MLC10', 1, { prospected_at: daysAgo(90) }),
        candidate('MLC11', 0),
        candidate('MLC11', -3),
        candidate('MLC11', 2.5),
      ],
    });

    const signals = await readInterestSignals(admin, [p, broken], NOW);
    expect(signals.get(p.id)?.mlPosition).toBe(4);
    expect(signals.has(broken.id)).toBe(false);
  });

  it('consulta por tandas: los ids van en la dirección y no pueden ser cientos de una vez', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => product(`MLC${5000 + i}`));
    const weird = [product('MLC1,MLC2'), product('mlc55'), product('MLC-9'), product('')];
    const { admin, asked } = fakeDb({ candidates: [candidate('MLC5000', 2), candidate('MLC5249', 8)] });

    const signals = await readInterestSignals(admin, [...rows, ...weird, rows[0]], NOW);
    expect(signals.get(rows[0].id)?.mlPosition).toBe(2);
    expect(signals.get(rows[249].id)?.mlPosition).toBe(8);

    const read = asked.filter((q) => q.table === 'product_candidates');
    expect(read.map((q) => q.ids?.length)).toEqual([100, 100, 50]);
    const sent = read.reduce<unknown[]>((all, q) => all.concat(q.ids ?? []), []);
    // Cada ficha una sola vez, y nada que no parezca un id de Mercado Libre.
    expect(new Set(sent).size).toBe(250);
    for (const id of sent) expect(id).toMatch(/^MLC\d+$/);
  });

  it('sin la columna del puesto (migración 0018) no hay señal ni aviso, y deja de preguntar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = Array.from({ length: 900 }, (_, i) => product(`MLC${7000 + i}`));
    const { admin, asked } = fakeDb({
      clicks: [click(rows[0].id, 1), click(rows[0].id, 2), click(rows[0].id, 3)],
      candidates: [candidate('MLC7000', 2)],
      fail: (q) => (q.table === 'product_candidates' ? MISSING_COLUMN : null),
    });

    const signals = await readInterestSignals(admin, rows, NOW);
    // Los clics no dependen de esa tabla.
    expect(signals.get(rows[0].id)).toEqual({ mlPosition: null, recentClicks: 3 });
    expect(signals.size).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    // Nueve tandas; las que no habían partido cuando llegó el primer "no existe" ya no se piden.
    expect(asked.filter((q) => q.table === 'product_candidates').length).toBeLessThan(9);
  });

  it('si una tanda falla, las demás siguen valiendo', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = Array.from({ length: 150 }, (_, i) => product(`MLC${9000 + i}`));
    const { admin } = fakeDb({
      candidates: [candidate('MLC9000', 2), candidate('MLC9149', 8)],
      fail: (q) => (q.table === 'product_candidates' && q.ids?.includes('MLC9000') ? { code: '500', message: 'se cayó' } : null),
    });

    const signals = await readInterestSignals(admin, rows, NOW);
    expect(signals.has(rows[0].id)).toBe(false);
    expect(signals.get(rows[149].id)?.mlPosition).toBe(8);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('readInterestSignals', () => {
  it('junta las dos señales de cada producto', async () => {
    const both = product('MLC1');
    const onlyClicks = product('MLC2');
    const quiet = product('MLC3');
    const { admin } = fakeDb({
      clicks: [...Array.from({ length: 14 }, () => click(both.id, 1)), click(onlyClicks.id, 2)],
      candidates: [candidate('MLC1', 3)],
    });

    const signals = await readInterestSignals(admin, [both, onlyClicks, quiet], NOW);
    expect(signals.get(both.id)).toEqual({ mlPosition: 3, recentClicks: 14 });
    expect(signals.get(onlyClicks.id)).toEqual({ mlPosition: null, recentClicks: 1 });
    expect(signals.has(quiet.id)).toBe(false);
  });

  it('sin productos no consulta nada', async () => {
    const { admin, asked } = fakeDb({});
    expect((await readInterestSignals(admin, [], NOW)).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('nunca lanza: si la base revienta, queda sin señales', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const admin = {
      from() {
        throw new Error('sin conexión');
      },
    } as unknown as SupabaseClient;

    const signals = await readInterestSignals(admin, [product('MLC1')], NOW);
    expect(signals.size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('con las señales, el motivo del puntaje dice de dónde sale el interés', () => {
    const headphones = {
      id: '00000000-0000-4000-8000-0000000000aa',
      name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
      brand: 'JBL',
      category: 'audio',
      price: 60_000,
      original_price: 100_000,
      seller_sales_count: 50_000,
      offer_info: { official_store: true, is_lowest: true },
    };
    const history = { drop: null, min30: 60_000, daysTracked: 20 };

    const plain = interestScore(headphones, history);
    const ranked = interestScore(headphones, { ...history, mlPosition: 3, recentClicks: null });
    const clicked = interestScore(headphones, { ...history, mlPosition: null, recentClicks: 14 });

    expect(ranked.reason).toContain('figuró 3.º entre los más vendidos de su categoría');
    expect(clicked.reason).toContain('lleva 14 clics recientes en el sitio');
    expect(plain.reason).not.toMatch(/figuró|clics/);
    // Suman, pero poco: que el orden no lo decida el ruido.
    expect(ranked.points).toBeGreaterThan(plain.points);
    expect(clicked.points).toBeGreaterThan(plain.points);
    expect(ranked.points - plain.points).toBeLessThanOrEqual(6);
    // Una señal que no llegó (null) vale lo mismo que no tenerla.
    expect(interestScore(headphones, { ...history, mlPosition: null, recentClicks: null }).points).toBe(plain.points);
  });
});
