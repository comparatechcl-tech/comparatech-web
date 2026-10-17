import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La marca "Ya la publiqué" de /admin/historias (app/admin/historias/actions)
 * contra una base de mentira que filtra: se anota con el precio de la
 * tarjeta, y si el de la base ya es otro, se anota igual y la respuesta lo
 * avisa (priceNow y warning). Lo mismo que markVideoPosted, en
 * video-actions.test.ts.
 */

type Row = Record<string, unknown>;
type Filter = { op: 'eq' | 'in' | 'gte'; column: string; value: unknown };
interface Op {
  table: string;
  kind: 'select' | 'insert' | 'update';
  filters: Filter[];
  values: Row | null;
  single: boolean;
  limit: number | null;
}

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  ops: [] as unknown[],
  nextId: 1000,
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

function run(op: Op): { data: unknown; error: null } {
  const rows = (db.tables[op.table] ??= []);
  if (op.kind === 'insert') {
    const row = { id: db.nextId++, posted_at: new Date().toISOString(), ...(op.values ?? {}) };
    rows.push(row);
    return { data: op.single ? row : [row], error: null };
  }
  let hit = rows.filter((row) => matches(row, op.filters));
  if (op.kind === 'update') {
    for (const row of hit) Object.assign(row, op.values);
    return { data: hit, error: null };
  }
  if (op.limit !== null) hit = hit.slice(0, op.limit);
  return { data: hit.map((row) => ({ ...row })), error: null };
}

const fakeAdmin = {
  from(table: string) {
    const op: Op = { table, kind: 'select', filters: [], values: null, single: false, limit: null };
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
    builder.limit = (n: number) => {
      op.limit = n;
      return builder;
    };
    builder.single = () => {
      op.single = true;
      return builder;
    };
    builder.insert = (values: Row) => {
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
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(), getPriceStatsManyChecked: vi.fn() }));
// De las historias, la acción solo usa el plazo de 14 días.
vi.mock('@/lib/social/stories', () => ({ STORY_RULES: { repeatAfterDays: 14 } }));

import { revalidatePath, revalidateTag } from 'next/cache';
import { logAdminEvent } from '@/lib/admin-audit';
import { markStoryPublished, undoStoryPublished } from '@/app/admin/historias/actions';

const PRODUCT = '00000000-0000-4000-8000-000000000001';

function product(over: Row = {}): Row {
  return { id: PRODUCT, slug: 'parlante-jbl', name: 'Parlante JBL Go 4', price: 49_990, is_active: true, is_hidden: false, deleted_at: null, ...over };
}

const posts = () => db.tables.social_posts ?? [];
const writes = () => (db.ops as Op[]).filter((op) => op.kind !== 'select');

beforeEach(() => {
  db.tables = { products: [product()], social_posts: [] };
  db.ops = [];
  db.nextId = 1000;
  auth.requireAdmin.mockReset();
  auth.requireAdmin.mockResolvedValue('cristopher');
  vi.mocked(logAdminEvent).mockClear();
});

describe('markStoryPublished', () => {
  it('con el precio de la base igual al de la tarjeta, anota la historia y no avisa nada', async () => {
    expect(await markStoryPublished(PRODUCT, 49_990)).toEqual({ ok: true, postId: 1000 });
    expect(posts()[0]).toMatchObject({ product_id: PRODUCT, channel: 'instagram', caption: 'historia', posted_price: 49_990, status: 'publicado' });
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toEqual({
      actor: 'cristopher',
      action: 'marcar_rrss',
      target: PRODUCT,
      after: { historia: 'publicada', precio: 49_990 },
    });
    // No regenera páginas: la lista no se rearma bajo el dedo.
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('si el precio cambió, anota la de la tarjeta (es la que se subió) y la respuesta trae el de ahora y el aviso', async () => {
    db.tables.products = [product({ price: 45_990 })];
    expect(await markStoryPublished(PRODUCT, 49_990)).toEqual({
      ok: true,
      postId: 1000,
      priceNow: 45_990,
      warning: 'Ojo: el precio cambió a $45.990 desde que cargaste la lista. Si ya la subiste, revisa la publicación.',
    });
    expect(posts()[0].posted_price).toBe(49_990);
  });

  it('un segundo toque no la anota dos veces, y repite el aviso', async () => {
    db.tables.products = [product({ price: 52_990 })];
    const first = await markStoryPublished(PRODUCT, 49_990);
    const second = await markStoryPublished(PRODUCT, 49_990);
    expect(second).toEqual(first);
    expect(second).toMatchObject({ priceNow: 52_990, warning: expect.stringContaining('$52.990') });
    expect(posts()).toHaveLength(1);
    expect(vi.mocked(logAdminEvent)).toHaveBeenCalledTimes(1);
  });

  it('sin el precio de la tarjeta (una pestaña de antes) anota el de la base, sin aviso', async () => {
    for (const shown of [undefined, 0, -5, Number.NaN, 3_000_000_000, '49990']) {
      db.tables.social_posts = [];
      const result = await markStoryPublished(PRODUCT, shown as unknown as number);
      expect(result, String(shown)).toEqual({ ok: true, postId: expect.any(Number) });
      expect(posts()[0].posted_price).toBe(49_990);
    }
  });

  it('un producto que ya no está a la venta no se marca, y dice qué hacer con la historia ya subida', async () => {
    const gone = {
      ok: false,
      error: 'Ese producto ya no está a la venta en el sitio, así que no hace falta marcarla. Si ya la subiste, bórrala de Instagram.',
    };
    for (const state of [{ is_active: false }, { is_hidden: true }, { deleted_at: '2026-10-12T10:00:00.000Z' }]) {
      db.tables.products = [product(state)];
      expect(await markStoryPublished(PRODUCT, 49_990)).toEqual(gone);
    }
    db.tables.products = [];
    expect(await markStoryPublished(PRODUCT, 49_990)).toEqual(gone);
    expect(posts()).toHaveLength(0);
    expect(writes()).toHaveLength(0);
  });

  it('rechaza lo que no es un id de producto sin leer nada', async () => {
    for (const id of ['', 'abc', `${PRODUCT} `, null, 7]) {
      expect(await markStoryPublished(id as unknown as string, 49_990)).toEqual({ ok: false, error: 'Producto no válido' });
    }
    expect(db.ops).toHaveLength(0);
  });

  it('sin sesión de admin no lee ni escribe', async () => {
    auth.requireAdmin.mockRejectedValue(new Error('No autorizado'));
    await expect(markStoryPublished(PRODUCT, 49_990)).rejects.toThrow('No autorizado');
    expect(db.ops).toHaveLength(0);
  });
});

describe('undoStoryPublished', () => {
  it('anula solo una marca de historia vigente', async () => {
    db.tables.social_posts = [
      { id: 1, product_id: PRODUCT, channel: 'instagram', caption: 'historia', status: 'publicado', posted_price: 49_990 },
      { id: 2, product_id: PRODUCT, channel: 'instagram', caption: 'video', status: 'publicado', posted_price: 49_990 },
    ];
    expect(await undoStoryPublished(1)).toEqual({ ok: true });
    expect(posts().map((row) => row.status)).toEqual(['error', 'publicado']);
    // Un video, no.
    expect(await undoStoryPublished(2)).toEqual({ ok: false, error: 'Esa marca ya no existe.' });
    expect(posts()[1].status).toBe('publicado');
  });

  it('rechaza lo que no es el id de una marca, sin tocar la base', async () => {
    for (const id of [0, -1, 1.5, Number.NaN, '1', null]) {
      expect(await undoStoryPublished(id as unknown as number)).toEqual({ ok: false, error: 'Marca no válida' });
    }
    expect(db.ops).toHaveLength(0);
  });
});
