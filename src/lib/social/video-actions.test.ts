import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Las marcas de "video subido" de /admin/videos contra una base de mentira
 * que sí filtra: lo que importa es qué filas se leen, cuáles se escriben y
 * cuáles no se tocan nunca (las del feed, las historias y Telegram viven en
 * la misma tabla).
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
  /** Tablas cuya lectura falla (para probar que la marca se anota igual). */
  failSelect: new Set<string>(),
  failUpdate: false,
  /** Corre justo después de cada lectura: lo que otra pestaña alcanza a hacer entre una lectura y la escritura que sigue. */
  afterSelect: null as (() => void) | null,
  ops: [] as unknown[],
  nextId: 1000,
  present: true,
}));

const auth = vi.hoisted(() => ({ requireAdmin: vi.fn(async () => 'cristopher') }));

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const value = row[f.column];
    if (f.op === 'eq') return value === f.value;
    if (f.op === 'in') return (f.value as unknown[]).includes(value);
    // Fechas ISO: se comparan como texto.
    return typeof value === 'string' && value >= String(f.value);
  });
}

function run(op: Op): { data: unknown; error: { code?: string; message: string } | null } {
  const rows = (db.tables[op.table] ??= []);
  if (op.kind === 'insert') {
    const row = { id: db.nextId++, posted_at: new Date().toISOString(), error: null, ...(op.values ?? {}) };
    rows.push(row);
    return { data: op.single ? row : [row], error: null };
  }
  if (op.kind === 'select' && db.failSelect.has(op.table)) return { data: null, error: { code: '500', message: 'se cayó' } };
  if (op.kind === 'update' && db.failUpdate) return { data: null, error: { code: '500', message: 'se cayó' } };
  let hit = rows.filter((row) => matches(row, op.filters));
  if (op.kind === 'update') {
    for (const row of hit) Object.assign(row, op.values);
    return { data: hit, error: null };
  }
  if (op.limit !== null) hit = hit.slice(0, op.limit);
  // Una copia: lo que cambie después en la base no cambia lo ya leído.
  const read = hit.map((row) => ({ ...row }));
  db.afterSelect?.();
  return { data: read, error: null };
}

/** Lo justo del cliente de Supabase que usan las acciones. */
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

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => (db.present ? fakeAdmin : null) }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: auth.requireAdmin }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(), getPriceStatsManyChecked: vi.fn() }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// El módulo de videos lo arma el contrato: acá solo hacen falta sus constantes.
vi.mock('@/lib/social/videos', () => ({
  VIDEO_MARK: 'video',
  VIDEO_NETWORKS: ['instagram', 'tiktok', 'youtube', 'facebook'],
  VIDEO_RULES: { maxPosts: 4, perCategory: 2, minDiscount: 20, minDrop: 5, maxPriceAgeMs: 6 * 3600_000, cleanOnly: true, repeatAfterDays: 14 },
  readVideoBoard: vi.fn(),
}));

import { revalidatePath, revalidateTag } from 'next/cache';
import { logAdminEvent } from '@/lib/admin-audit';
import { markVideoPosted, undoVideoPosted } from '@/app/admin/videos/actions';

const PRODUCT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

function product(over: Row = {}): Row {
  return { id: PRODUCT, slug: 'parlante-jbl', name: 'Parlante JBL Go 4', price: 49_990, is_active: true, is_hidden: false, deleted_at: null, ...over };
}

function post(over: Row = {}): Row {
  return {
    id: db.nextId++,
    product_id: PRODUCT,
    channel: 'instagram',
    caption: 'video',
    status: 'publicado',
    posted_price: 49_990,
    posted_at: new Date(Date.now() - 3_600_000).toISOString(),
    error: null,
    ...over,
  };
}

const posts = () => db.tables.social_posts ?? [];
const writes = () => (db.ops as Op[]).filter((op) => op.kind !== 'select');
type Network = Parameters<typeof markVideoPosted>[1];

beforeEach(() => {
  db.tables = { products: [product()], social_posts: [] };
  db.failSelect = new Set();
  db.failUpdate = false;
  db.afterSelect = null;
  db.ops = [];
  db.nextId = 1000;
  db.present = true;
  auth.requireAdmin.mockReset();
  auth.requireAdmin.mockResolvedValue('cristopher');
  vi.mocked(logAdminEvent).mockClear();
});

describe('markVideoPosted', () => {
  it('anota una fila por red, con el precio de la tarjeta y la marca de video', async () => {
    // El producto ya cuesta otra cosa: el video subido llevaba 49.990 y eso es lo que se anota.
    db.tables.products = [product({ price: 45_990 })];

    const result = await markVideoPosted(PRODUCT, 'tiktok', 49_990);
    expect(result).toEqual({ ok: true, postId: 1000 });
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({
      id: 1000,
      product_id: PRODUCT,
      channel: 'tiktok',
      caption: 'video',
      posted_price: 49_990,
      status: 'publicado',
    });
    // Sin id de Metricool: no pasó por ahí y no gasta su cuota.
    expect(posts()[0]).not.toHaveProperty('external_id');
  });

  it('acepta las cuatro redes y las anota por separado', async () => {
    const ids: number[] = [];
    for (const network of ['instagram', 'tiktok', 'youtube', 'facebook'] as const) {
      const result = await markVideoPosted(PRODUCT, network, 49_990);
      expect(result.ok).toBe(true);
      if (result.ok) ids.push(result.postId);
    }
    expect(new Set(ids).size).toBe(4);
    expect(posts().map((row) => row.channel)).toEqual(['instagram', 'tiktok', 'youtube', 'facebook']);
  });

  it('deja registro de quién marcó, qué red y a qué precio', async () => {
    await markVideoPosted(PRODUCT, 'youtube', 49_990);
    expect(vi.mocked(logAdminEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toEqual({
      actor: 'cristopher',
      action: 'marcar_rrss',
      target: PRODUCT,
      after: { video: 'subido', red: 'youtube', precio: 49_990 },
    });
  });

  it('no toca el producto ni regenera páginas: la lista no se rearma bajo el dedo', async () => {
    await markVideoPosted(PRODUCT, 'instagram', 49_990);
    expect(writes().map((op) => [op.table, op.kind])).toEqual([['social_posts', 'insert']]);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('rechaza una red que no conoce, sin leer ni escribir nada', async () => {
    for (const network of ['telegram', 'whatsapp', 'INSTAGRAM', '', 'instagram ', null, undefined, 7, ['instagram']]) {
      expect(await markVideoPosted(PRODUCT, network as unknown as Network, 49_990)).toEqual({ ok: false, error: 'Red no válida' });
    }
    expect(db.ops).toHaveLength(0);
  });

  it('rechaza un producto que no es un id', async () => {
    for (const id of ['', 'abc', `${PRODUCT} `, `${PRODUCT}' or 1=1`, null, 12]) {
      expect(await markVideoPosted(id as unknown as string, 'instagram', 49_990)).toEqual({ ok: false, error: 'Producto no válido' });
    }
    expect(db.ops).toHaveLength(0);
  });

  it('rechaza un precio que no sirve: una marca con otro precio hablaría de un video que no existe', async () => {
    for (const price of [0, -1, 0.2, Number.NaN, Number.POSITIVE_INFINITY, 3_000_000_000, '49990', null, undefined]) {
      expect(await markVideoPosted(PRODUCT, 'instagram', price as unknown as number)).toEqual({ ok: false, error: 'Precio no válido' });
    }
    expect(db.ops).toHaveLength(0);
  });

  it('no anota un producto que ya no está a la venta', async () => {
    const gone = { ok: false, error: 'Ese producto ya no está a la venta en el sitio.' };
    for (const state of [{ is_active: false }, { is_hidden: true }, { deleted_at: '2026-10-12T10:00:00.000Z' }]) {
      db.tables.products = [product(state)];
      expect(await markVideoPosted(PRODUCT, 'instagram', 49_990)).toEqual(gone);
    }
    // Ni uno que no existe.
    expect(await markVideoPosted(OTHER, 'instagram', 49_990)).toEqual(gone);
    expect(posts()).toHaveLength(0);
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
  });

  it('un segundo toque sobre la misma red y precio no la anota dos veces', async () => {
    const first = await markVideoPosted(PRODUCT, 'instagram', 49_990);
    const second = await markVideoPosted(PRODUCT, 'instagram', 49_990);
    expect(second).toEqual(first);
    expect(posts()).toHaveLength(1);
    // Una sola línea en la bitácora: el segundo toque no hizo nada.
    expect(vi.mocked(logAdminEvent)).toHaveBeenCalledTimes(1);
  });

  it('otra red, otro precio u otro producto sí son marcas nuevas', async () => {
    db.tables.products = [product(), product({ id: OTHER })];
    await markVideoPosted(PRODUCT, 'instagram', 49_990);
    await markVideoPosted(PRODUCT, 'tiktok', 49_990);
    await markVideoPosted(PRODUCT, 'instagram', 45_990);
    await markVideoPosted(OTHER, 'instagram', 49_990);
    expect(posts()).toHaveLength(4);
  });

  it('lo que no es una marca vigente de video no cuenta como ya anotado', async () => {
    db.tables.social_posts = [
      // Una historia del mismo producto, en el mismo canal y al mismo precio.
      post({ caption: 'historia' }),
      // Una publicación del feed, programada por Metricool.
      post({ caption: 'Parlante JBL a $49.990', external_id: 'abc-123' }),
      // Una marca de video deshecha.
      post({ status: 'error', error: 'Marcada por error' }),
      // Una marca de video de hace más de 14 días: ya se puede subir de nuevo.
      post({ posted_at: new Date(Date.now() - 15 * 86_400_000).toISOString() }),
    ];
    const before = posts().map((row) => ({ ...row }));

    const result = await markVideoPosted(PRODUCT, 'instagram', 49_990);
    expect(result).toEqual({ ok: true, postId: 1004 });
    expect(posts()).toHaveLength(5);
    // Las otras cuatro filas quedan como estaban.
    expect(posts().slice(0, 4)).toEqual(before);
  });

  it('una marca de hace 13 días sigue vigente: no se repite', async () => {
    db.tables.social_posts = [post({ id: 55, posted_at: new Date(Date.now() - 13 * 86_400_000).toISOString() })];
    expect(await markVideoPosted(PRODUCT, 'instagram', 49_990)).toEqual({ ok: true, postId: 55 });
    expect(posts()).toHaveLength(1);
  });

  it('si no se puede leer lo ya anotado, anota igual: es peor perder la marca que repetirla', async () => {
    db.failSelect.add('social_posts');
    const result = await markVideoPosted(PRODUCT, 'facebook', 49_990);
    expect(result.ok).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it('redondea el precio a pesos enteros, como lo guarda la base', async () => {
    await markVideoPosted(PRODUCT, 'instagram', 49_989.6);
    expect(posts()[0].posted_price).toBe(49_990);
  });

  it('sin sesión de admin no lee ni escribe nada', async () => {
    auth.requireAdmin.mockRejectedValue(new Error('No autorizado'));
    await expect(markVideoPosted(PRODUCT, 'instagram', 49_990)).rejects.toThrow('No autorizado');
    expect(db.ops).toHaveLength(0);
  });

  it('sin Supabase lo dice', async () => {
    db.present = false;
    expect(await markVideoPosted(PRODUCT, 'instagram', 49_990)).toEqual({ ok: false, error: 'Supabase admin no configurado' });
  });
});

describe('undoVideoPosted', () => {
  it('anula la marca: deja de contar como subido, pero la fila queda', async () => {
    db.tables.social_posts = [post({ id: 7, channel: 'tiktok' })];
    expect(await undoVideoPosted(7)).toEqual({ ok: true });
    expect(posts()[0]).toMatchObject({ id: 7, status: 'error', error: 'Marcada por error', caption: 'video', channel: 'tiktok' });
    expect(posts()[0].updated_at).toEqual(expect.any(String));
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toEqual({
      actor: 'cristopher',
      action: 'marcar_rrss',
      target: PRODUCT,
      after: { video: 'deshecho', red: 'tiktok' },
    });
    // Tampoco regenera páginas: /hoy toma las marcas sola, cada minuto, y la lista no se rearma bajo el dedo.
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('solo deshace marcas de video: nunca una historia, una publicación del feed ni un mensaje de Telegram', async () => {
    db.tables.social_posts = [
      post({ id: 1, caption: 'historia' }),
      post({ id: 2, caption: 'Parlante JBL a $49.990', external_id: 'abc-123' }),
      post({ id: 3, caption: null }),
      // Aunque llevara el mismo texto, Telegram no es una de las cuatro redes.
      post({ id: 4, channel: 'telegram' }),
      // Una marca de video ya deshecha.
      post({ id: 5, status: 'error', error: 'Marcada por error' }),
      // Y una vigente del mismo producto y la misma red: con el id de cualquiera de las de arriba tampoco se anula esta.
      post({ id: 6 }),
    ];
    const before = posts().map((row) => ({ ...row }));

    for (const id of [1, 2, 3, 4, 5, 999]) {
      // `gone` le dice a la página que no es una falla: ahí no hay una marca de video vigente.
      expect(await undoVideoPosted(id)).toEqual({ ok: false, error: 'Esa marca ya no existe.', gone: true });
    }
    expect(posts()).toEqual(before);
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
  });

  it('una falla de la base no se confunde con una marca que ya no existe', async () => {
    db.tables.social_posts = [post({ id: 7 })];
    db.failUpdate = true;
    expect(await undoVideoPosted(7)).toEqual({ ok: false, error: 'se cayó' });
    expect(posts()[0].status).toBe('publicado');

    // Tampoco si lo que falla es la lectura de la marca: no se escribe nada.
    db.failUpdate = false;
    db.failSelect.add('social_posts');
    db.ops = [];
    expect(await undoVideoPosted(7)).toEqual({ ok: false, error: 'se cayó' });
    expect(writes()).toHaveLength(0);
    expect(posts()[0].status).toBe('publicado');
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
  });

  it('dos marcas hechas en el mismo instante se anulan juntas: al recargar la red no vuelve a figurar subida', async () => {
    // Dos pestañas (o dos teléfonos) marcan la misma red a la vez: ninguna ve la marca de la otra.
    const [a, b] = await Promise.all([markVideoPosted(PRODUCT, 'instagram', 49_990), markVideoPosted(PRODUCT, 'instagram', 49_990)]);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.postId).not.toBe(b.postId);
    expect(posts().filter((row) => row.status === 'publicado')).toHaveLength(2);
    db.ops = [];
    vi.mocked(logAdminEvent).mockClear();

    // La página muestra una sola de las dos, y esa es la que se deshace.
    expect(await undoVideoPosted(a.postId)).toEqual({ ok: true });
    expect(posts().map((row) => [row.id, row.status, row.error])).toEqual([
      [a.postId, 'error', 'Marcada por error'],
      [b.postId, 'error', 'Marcada por error'],
    ]);
    // De una sola escritura: o se anulan las dos o ninguna.
    expect(writes().map((op) => [op.table, op.kind])).toEqual([['social_posts', 'update']]);
    // Una línea en la bitácora, que dice que eran dos.
    expect(vi.mocked(logAdminEvent)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toEqual({
      actor: 'cristopher',
      action: 'marcar_rrss',
      target: PRODUCT,
      after: { video: 'deshecho', red: 'instagram', marcas: 2 },
    });

    // La otra ya no existe como marca vigente: deshacerla no hace nada más.
    expect(await undoVideoPosted(b.postId)).toEqual({ ok: false, error: 'Esa marca ya no existe.', gone: true });
    // Y volver a marcar deja una sola.
    expect((await markVideoPosted(PRODUCT, 'instagram', 49_990)).ok).toBe(true);
    expect(posts().filter((row) => row.status === 'publicado')).toHaveLength(1);
  });

  it('también anula la marca que una pestaña vieja dejó con otro precio', async () => {
    db.tables.social_posts = [
      post({ id: 1, posted_price: 49_990, posted_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }),
      post({ id: 2, posted_price: 45_990 }),
    ];
    expect(await undoVideoPosted(2)).toEqual({ ok: true });
    expect(posts().map((row) => row.status)).toEqual(['error', 'error']);
  });

  it('no toca nada más: otra red, otro producto, lo que no es video ni las marcas que ya no cuentan', async () => {
    db.tables.social_posts = [
      post({ id: 1 }),
      post({ id: 2 }),
      // Las demás redes del mismo producto.
      post({ id: 3, channel: 'tiktok' }),
      post({ id: 4, channel: 'youtube' }),
      post({ id: 5, channel: 'facebook' }),
      // La misma red en otro producto.
      post({ id: 6, product_id: OTHER }),
      // Del mismo producto y la misma red, pero no son marcas de video.
      post({ id: 7, caption: 'historia' }),
      post({ id: 8, caption: 'Parlante JBL a $49.990', external_id: 'abc-123' }),
      post({ id: 9, caption: null }),
      // Una marca de hace más de 14 días ya no cuenta para nada: queda como registro de lo que se subió.
      post({ id: 10, posted_at: new Date(Date.now() - 15 * 86_400_000).toISOString() }),
      // Una ya deshecha conserva su fecha de anulación.
      post({ id: 11, status: 'error', error: 'Marcada por error', updated_at: '2026-10-01T00:00:00.000Z' }),
    ];
    const before = posts().map((row) => ({ ...row }));

    expect(await undoVideoPosted(1)).toEqual({ ok: true });
    expect(posts().slice(0, 2).map((row) => row.status)).toEqual(['error', 'error']);
    expect(posts().slice(2)).toEqual(before.slice(2));
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({ after: { video: 'deshecho', red: 'instagram', marcas: 2 } });
  });

  it('la marca que se pide deshacer se anula siempre, aunque ya haya pasado el plazo', async () => {
    // Una pestaña que quedó abierta muestra una marca que acaba de cumplir los 14 días.
    db.tables.social_posts = [
      post({ id: 1, posted_at: new Date(Date.now() - 20 * 86_400_000).toISOString() }),
      post({ id: 2, posted_at: new Date(Date.now() - 14 * 86_400_000 - 60_000).toISOString() }),
      post({ id: 3, posted_at: new Date(Date.now() - 86_400_000).toISOString() }),
    ];
    expect(await undoVideoPosted(2)).toEqual({ ok: true });
    // La suya y las más nuevas; la anterior a ella queda como estaba.
    expect(posts().map((row) => row.status)).toEqual(['publicado', 'error', 'error']);
  });

  it('si otra pestaña la deshace justo antes, queda como ya deshecha y no se anota dos veces', async () => {
    db.tables.social_posts = [post({ id: 7 })];
    // Entre que esta acción lee la marca y la anula, la otra pestaña ya la anuló.
    db.afterSelect = () => {
      posts()[0].status = 'error';
    };
    expect(await undoVideoPosted(7)).toEqual({ ok: false, error: 'Esa marca ya no existe.', gone: true });
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
  });

  it('una marca sin producto se anula sola, por su id', async () => {
    db.tables.social_posts = [post({ id: 1, product_id: null }), post({ id: 2, product_id: null })];
    expect(await undoVideoPosted(1)).toEqual({ ok: true });
    expect(posts().map((row) => row.status)).toEqual(['error', 'publicado']);
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toEqual({
      actor: 'cristopher',
      action: 'marcar_rrss',
      target: undefined,
      after: { video: 'deshecho', red: 'instagram' },
    });
  });

  it('una marca sin fecha también se anula, sola: sin fecha no se puede buscar a las demás', async () => {
    db.tables.social_posts = [post({ id: 1, posted_at: null }), post({ id: 2 })];
    expect(await undoVideoPosted(1)).toEqual({ ok: true });
    expect(posts().map((row) => row.status)).toEqual(['error', 'publicado']);
  });

  it('rechaza lo que no es el id de una marca, sin tocar la base', async () => {
    for (const id of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '7', null, undefined]) {
      expect(await undoVideoPosted(id as unknown as number)).toEqual({ ok: false, error: 'Marca no válida' });
    }
    expect(db.ops).toHaveLength(0);
  });

  it('después de deshacer, volver a marcar crea una marca nueva', async () => {
    const first = await markVideoPosted(PRODUCT, 'instagram', 49_990);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await undoVideoPosted(first.postId)).toEqual({ ok: true });

    const again = await markVideoPosted(PRODUCT, 'instagram', 49_990);
    expect(again).toEqual({ ok: true, postId: first.postId + 1 });
    expect(posts().map((row) => row.status)).toEqual(['error', 'publicado']);
    // Deshacer dos veces la misma no anula la nueva.
    expect(await undoVideoPosted(first.postId)).toEqual({ ok: false, error: 'Esa marca ya no existe.', gone: true });
    expect(posts()[1].status).toBe('publicado');
  });

  it('sin sesión de admin no escribe nada', async () => {
    db.tables.social_posts = [post({ id: 7 })];
    auth.requireAdmin.mockRejectedValue(new Error('No autorizado'));
    await expect(undoVideoPosted(7)).rejects.toThrow('No autorizado');
    expect(db.ops).toHaveLength(0);
    expect(posts()[0].status).toBe('publicado');
  });
});
