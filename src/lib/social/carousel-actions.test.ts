import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La marca "Ya lo publiqué" del carrusel semanal (app/admin/historias/carrusel/actions)
 * y su lectura (lib/social/carousel-marks), contra una base de mentira que
 * filtra: una fila por producto con la misma hora, el precio de cada lámina,
 * sin repetir con un doble toque, y "deshacer" que solo toca marcas de
 * carrusel.
 */

type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'in' | 'gte'; column: string; value: unknown };
interface Op {
  table: string;
  kind: 'select' | 'insert' | 'update';
  filters: Filter[];
  values: Row | Row[] | null;
  limit: number | null;
}

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  ops: [] as unknown[],
  nextId: 1000,
  failSelect: null as string | null,
}));
const auth = vi.hoisted(() => ({ requireAdmin: vi.fn(async () => 'cristopher') }));

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const value = row[f.column];
    if (f.op === 'eq') return value === f.value;
    if (f.op === 'in') return (f.value as unknown[]).includes(value);
    return typeof value === 'string' && value >= String(f.value);
  });
}

function run(op: Op): { data: unknown; error: { message: string } | null } {
  const rows = (db.tables[op.table] ??= []);
  if (op.kind === 'insert') {
    const list = (Array.isArray(op.values) ? op.values : [op.values ?? {}]).map((values) => ({
      id: db.nextId++,
      posted_at: new Date().toISOString(),
      ...values,
    }));
    rows.push(...list);
    return { data: list.map((row) => ({ ...row })), error: null };
  }
  if (op.kind === 'select' && db.failSelect === op.table) return { data: null, error: { message: 'se cayó' } };
  let hit = rows.filter((row) => matches(row, op.filters));
  if (op.kind === 'update') {
    for (const row of hit) Object.assign(row, op.values);
    return { data: hit.map((row) => ({ ...row })), error: null };
  }
  if (op.limit !== null) hit = hit.slice(0, op.limit);
  return { data: hit.map((row) => ({ ...row })), error: null };
}

const fakeAdmin = {
  from(table: string) {
    const op: Op = { table, kind: 'select', filters: [], values: null, limit: null };
    db.ops.push(op);
    const builder: Record<string, unknown> = {};
    const filter = (kind: Filter['op']) => (column: string, value: unknown) => {
      op.filters.push({ op: kind, column, value });
      return builder;
    };
    builder.select = () => builder;
    builder.order = () => builder;
    builder.eq = filter('eq');
    builder.in = filter('in');
    builder.gte = filter('gte');
    builder.is = () => builder;
    builder.limit = (n: number) => {
      op.limit = n;
      return builder;
    };
    builder.insert = (values: Row | Row[]) => {
      op.kind = 'insert';
      op.values = values;
      return builder;
    };
    builder.update = (values: Row) => {
      op.kind = 'update';
      op.values = values;
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve()
        .then(() => run(op))
        .then(resolve, reject);
    return builder;
  },
};

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => fakeAdmin }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: auth.requireAdmin }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));

import { revalidatePath, revalidateTag } from 'next/cache';
import { logAdminEvent } from '@/lib/admin-audit';
import { markCarouselPublished, undoCarouselPublished } from '@/app/admin/historias/carrusel/actions';
import { CAROUSEL_MARK, readCarouselMarks } from '@/lib/social/carousel-marks';
import type { SupabaseClient } from '@supabase/supabase-js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

function product(id: string, over: Row = {}): Row {
  return { id, slug: `p-${id.slice(-1)}`, name: `Producto ${id.slice(-1)}`, price: 10_000, is_active: true, is_hidden: false, deleted_at: null, ...over };
}

const posts = () => db.tables.social_posts ?? [];
const writes = () => (db.ops as Op[]).filter((op) => op.kind !== 'select');
const items = (prices: Record<string, number>) => Object.keys(prices).map((productId) => ({ productId, price: prices[productId] }));

beforeEach(() => {
  db.tables = { products: [product(A), product(B, { price: 20_000 }), product(C, { price: 30_000 })], social_posts: [] };
  db.ops = [];
  db.nextId = 1000;
  db.failSelect = null;
  vi.mocked(logAdminEvent).mockClear();
  auth.requireAdmin.mockClear();
});

describe('markCarouselPublished', () => {
  it('anota una fila por producto, con el precio de cada lámina y la misma hora, en el orden del carrusel', async () => {
    const result = await markCarouselPublished(items({ [C]: 30_000, [A]: 10_000, [B]: 20_000 }));
    expect(result).toEqual({ ok: true, postIds: [1000, 1001, 1002], postedAt: expect.any(String) });
    expect(posts().map((row) => [row.product_id, row.posted_price, row.channel, row.caption, row.status])).toEqual([
      [C, 30_000, 'instagram', CAROUSEL_MARK, 'publicado'],
      [A, 10_000, 'instagram', CAROUSEL_MARK, 'publicado'],
      [B, 20_000, 'instagram', CAROUSEL_MARK, 'publicado'],
    ]);
    expect(new Set(posts().map((row) => row.posted_at)).size).toBe(1);
    // Una sola escritura para las tres filas, y queda en Actividad. No regenera páginas.
    expect(writes()).toHaveLength(1);
    expect(vi.mocked(logAdminEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({
      action: 'marcar_rrss',
      target: `${C},${A},${B}`,
      after: { carrusel: 'publicado', precios: [30_000, 10_000, 20_000] },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('un segundo toque con el mismo carrusel devuelve la marca que ya existe, sin anotar otra', async () => {
    const first = await markCarouselPublished(items({ [A]: 10_000, [B]: 20_000, [C]: 30_000 }));
    const second = await markCarouselPublished(items({ [A]: 10_000, [B]: 20_000, [C]: 30_000 }));
    expect(second).toEqual(first);
    expect(posts()).toHaveLength(3);
  });

  it('otro carrusel (otros productos u otros precios) sí se anota aparte', async () => {
    await markCarouselPublished(items({ [A]: 10_000, [B]: 20_000, [C]: 30_000 }));
    await markCarouselPublished(items({ [A]: 9_000, [B]: 20_000, [C]: 30_000 }));
    expect(posts()).toHaveLength(6);
  });

  it('si el precio cambió desde que se cargó la página, anota el de la lámina y lo avisa', async () => {
    db.tables.products = [product(A, { price: 12_990 }), product(B, { price: 20_000 }), product(C, { price: 30_000, is_active: false })];
    const result = await markCarouselPublished(items({ [A]: 10_000, [B]: 20_000, [C]: 30_000 }));
    expect(result.ok).toBe(true);
    expect(posts().map((row) => row.posted_price)).toEqual([10_000, 20_000, 30_000]);
    expect(result.ok && result.warning).toBe(
      'Quedó marcado, pero desde que cargaste la página el #1 (Producto a) cambió a $12.990 y el #3 (Producto c) ya no está a la venta. Si ya lo subiste, revisa la publicación.'
    );
  });

  it('no anota nada con datos que no sirven', async () => {
    const bad: unknown[] = [
      [],
      null,
      'abc',
      [{ productId: 'no-es-un-id', price: 10_000 }],
      [{ productId: A, price: 0 }],
      [{ productId: A, price: Number.NaN }],
      [{ productId: A, price: 3_000_000_000 }],
      [
        { productId: A, price: 10_000 },
        { productId: A, price: 10_000 },
      ],
      Array.from({ length: 9 }, (_, i) => ({ productId: `00000000-0000-4000-8000-00000000010${i}`, price: 1 })),
    ];
    for (const value of bad) {
      const result = await markCarouselPublished(value as never);
      expect(result, JSON.stringify(value)).toEqual({ ok: false, error: 'El carrusel no es válido. Toca Actualizar.' });
    }
    expect(posts()).toHaveLength(0);
  });

  it('si un producto ya no está en la base, no anota nada', async () => {
    db.tables.products = [product(A), product(B)];
    const result = await markCarouselPublished(items({ [A]: 10_000, [B]: 20_000, [C]: 30_000 }));
    expect(result).toEqual({ ok: false, error: 'Un producto del carrusel ya no está en el sitio. Toca Actualizar.' });
    expect(posts()).toHaveLength(0);
  });

  it('pide la clave del admin antes de todo', async () => {
    auth.requireAdmin.mockRejectedValueOnce(new Error('No autorizado'));
    await expect(markCarouselPublished(items({ [A]: 10_000 }))).rejects.toThrow('No autorizado');
    expect(db.ops).toHaveLength(0);
  });
});

describe('undoCarouselPublished', () => {
  it('deshace las filas del carrusel y el carrusel deja de contar como publicado', async () => {
    const mark = await markCarouselPublished(items({ [A]: 10_000, [B]: 20_000, [C]: 30_000 }));
    if (!mark.ok) throw new Error('no se marcó');
    expect(await undoCarouselPublished(mark.postIds)).toEqual({ ok: true });
    expect(posts().map((row) => [row.status, row.error])).toEqual([
      ['error', 'Marcada por error'],
      ['error', 'Marcada por error'],
      ['error', 'Marcada por error'],
    ]);
    expect(await readCarouselMarks(fakeAdmin as unknown as SupabaseClient, new Date(Date.now() - 86_400_000))).toEqual([]);
    // Deshacer dos veces: la marca ya no existe.
    expect(await undoCarouselPublished(mark.postIds)).toEqual({ ok: false, error: 'Esa marca ya no existe.' });
  });

  it('nunca toca una historia, un video ni una publicación del feed', async () => {
    db.tables.social_posts = [
      { id: 1, product_id: A, channel: 'instagram', caption: 'historia', status: 'publicado', posted_at: new Date().toISOString() },
      { id: 2, product_id: A, channel: 'instagram', caption: 'video', status: 'publicado', posted_at: new Date().toISOString() },
      { id: 3, product_id: A, channel: 'instagram', caption: null, status: 'publicado', posted_at: new Date().toISOString() },
      { id: 4, product_id: A, channel: 'telegram', caption: CAROUSEL_MARK, status: 'publicado', posted_at: new Date().toISOString() },
    ];
    expect(await undoCarouselPublished([1, 2, 3, 4])).toEqual({ ok: false, error: 'Esa marca ya no existe.' });
    expect(posts().every((row) => row.status === 'publicado')).toBe(true);
  });

  it('no acepta ids que no sirven', async () => {
    for (const value of [[], [0], [-1], [1.5], ['1'], null, Array.from({ length: 9 }, (_, i) => i + 1)]) {
      expect(await undoCarouselPublished(value as never), JSON.stringify(value)).toEqual({ ok: false, error: 'Marca no válida' });
    }
  });
});

describe('readCarouselMarks', () => {
  it('junta las filas de cada carrusel por su hora, del más nuevo al más viejo, sin las deshechas', async () => {
    const at1 = '2026-10-11T23:00:00.000Z';
    const at2 = '2026-10-18T20:00:00.000Z';
    const row = (id: number, productId: string, postedAt: string, over: Row = {}) => ({
      id,
      product_id: productId,
      channel: 'instagram',
      caption: CAROUSEL_MARK,
      status: 'publicado',
      posted_price: 1_000 * id,
      posted_at: postedAt,
      ...over,
    });
    // La base de mentira no ordena: vienen ya en el orden de la consulta (hora descendente, id ascendente).
    db.tables.social_posts = [
      row(4, A, at2),
      row(5, B, at2),
      row(6, C, at2, { status: 'error' }),
      row(1, A, at1),
      row(2, C, at1),
      row(3, B, at1, { caption: 'historia' }),
    ];
    const batches = await readCarouselMarks(fakeAdmin as unknown as SupabaseClient, new Date('2026-10-01T00:00:00Z'));
    expect(batches).toEqual([
      { postedAt: at2, posts: [{ postId: 4, productId: A, postedPrice: 4_000 }, { postId: 5, productId: B, postedPrice: 5_000 }] },
      { postedAt: at1, posts: [{ postId: 1, productId: A, postedPrice: 1_000 }, { postId: 2, productId: C, postedPrice: 2_000 }] },
    ]);
  });

  it('si la lectura falla, lo dice', async () => {
    db.failSelect = 'social_posts';
    await expect(readCarouselMarks(fakeAdmin as unknown as SupabaseClient, new Date())).rejects.toThrow(
      'No se pudo leer los carruseles publicados: se cayó'
    );
  });
});
