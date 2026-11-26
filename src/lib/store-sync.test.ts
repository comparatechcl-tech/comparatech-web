import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStore } from './stores';
import type { StoreRead } from './store-reader';
import { MAX_FAILS, type StoreOfferRow } from './store-offers';
import { slugsOf, syncStoreOffers, type SyncDeps } from './store-sync';

/*
 * Una pasada completa con todo falso: las tiendas y la base. Nunca hay red.
 * Lo que se revisa es a quién se le pide, cuánto, qué se guarda y cuándo se
 * deja de pedir.
 */

const NOW = new Date('2026-11-26T20:17:00Z');
const OLD = '2026-11-26T08:00:00Z'; // hace más de 11 horas: toca leer
const PARIS = getStore('paris')!;

function offer(id: number, over: Partial<StoreOfferRow> = {}): StoreOfferRow {
  return {
    id,
    product_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    store: 'paris',
    url: `https://www.paris.cl/producto-${id}-MK${id}.html`,
    external_id: `MK${id}`,
    title: `Producto ${id}`,
    seller: 'Paris',
    price: 100_000,
    checked_at: OLD,
    tried_at: OLD,
    status: 'activo',
    fail_count: 0,
    last_error: null,
    created_at: OLD,
    ...over,
  };
}

function fakeAdmin(rows: StoreOfferRow[], opts: { readError?: { code?: string; message: string }; writeError?: string } = {}) {
  const updates: Array<{ id: number; patch: Record<string, unknown> }> = [];
  const admin = {
    from(table: string) {
      if (table !== 'store_offers') throw new Error(`tabla inesperada: ${table}`);
      return {
        select: () => ({
          order: () => ({
            range: async (from: number, to: number) =>
              opts.readError ? { data: null, error: opts.readError } : { data: rows.slice(from, to + 1), error: null },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_column: string, id: number) => {
            if (opts.writeError) return { error: { message: opts.writeError } };
            updates.push({ id, patch });
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient;
  return { admin, updates };
}

function ok(price: number, available = true): StoreRead {
  return { ok: true, store: PARIS, url: 'x', value: { title: 'Producto', price, sku: 'MK1', seller: 'Paris', available } };
}

function fakeDeps(reads: (url: string, sku: string | null | undefined) => StoreRead, robotsOk = true) {
  let time = 1_000_000;
  const waits: number[] = [];
  const deps: SyncDeps & { readRobots: ReturnType<typeof vi.fn>; readStorePrice: ReturnType<typeof vi.fn> } = {
    readRobots: vi.fn(async () => (robotsOk ? { ok: true as const, txt: 'User-agent: *\nDisallow:' } : { ok: false as const, detail: 'respondió 403' })),
    readStorePrice: vi.fn(async (url: string, _robots: string, options: { sku?: string | null }) => {
      time += 900; // cada pedido tarda un poco menos que la pausa
      return reads(url, options.sku);
    }),
    wait: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    clock: () => time,
  };
  return { deps, waits, advance: (ms: number) => (time += ms) };
}

describe('syncStoreOffers', () => {
  it('lee lo que toca, guarda el precio nuevo y avisa qué fichas del sitio cambiaron', async () => {
    const rows = [offer(1), offer(2), offer(3, { tried_at: NOW.toISOString() })];
    const { admin, updates } = fakeAdmin(rows);
    const { deps } = fakeDeps((url) => ok(url.includes('producto-1-') ? 89_990 : 100_000));
    const { summary, changedProductIds } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);

    expect(summary).toMatchObject({ ok: true, prueba: false, enlazadas: 3, tocaba: 2, leidas: 2, cambiaron: 1, fallaron: 0, pendientes: 0, detenidas: {} });
    expect(summary.detalle).toEqual([
      { id: 1, tienda: 'paris', resultado: 'cambio', antes: 100_000, precio: 89_990 },
      { id: 2, tienda: 'paris', resultado: 'igual', antes: 100_000, precio: 100_000 },
    ]);
    expect(changedProductIds).toEqual([rows[0].product_id]);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ id: 1, patch: { price: 89_990, checked_at: NOW.toISOString(), status: 'activo', fail_count: 0 } });
    // El robots.txt se pide una vez por tienda, y la versión guardada viaja con cada lectura.
    expect(deps.readRobots).toHaveBeenCalledTimes(1);
    expect(deps.readStorePrice.mock.calls[0]).toEqual([rows[0].url, 'User-agent: *\nDisallow:', { sku: 'MK1' }]);
  });

  it('espera entre dos pedidos a la misma tienda', async () => {
    const { admin } = fakeAdmin([offer(1), offer(2), offer(3)]);
    const { deps, waits } = fakeDeps(() => ok(100_000));
    await syncStoreOffers(admin, { now: NOW, write: true }, deps);
    // Antes de cada lectura: lo que falte para completar la pausa desde el pedido anterior.
    expect(waits.length).toBe(3);
    for (const ms of waits) expect(ms).toBeGreaterThan(0);
  });

  it('en modo prueba lee y decide, pero no guarda ni manda a rearmar nada', async () => {
    const { admin, updates } = fakeAdmin([offer(1)]);
    const { deps } = fakeDeps(() => ok(50_000));
    const { summary, changedProductIds } = await syncStoreOffers(admin, { now: NOW, write: false }, deps);
    expect(summary).toMatchObject({ prueba: true, leidas: 1, cambiaron: 1 });
    expect(updates).toEqual([]);
    expect(changedProductIds).toEqual([]);
  });

  it('un bloqueo corta la pasada para esa tienda: no se prueba con sus otras fichas', async () => {
    const rows = [offer(1), offer(2), offer(3), offer(4, { store: 'maconline', url: 'https://www.maconline.com/products/airpods-pro-3' })];
    const { admin, updates } = fakeAdmin(rows);
    const { deps } = fakeDeps((url) =>
      url.includes('paris.cl') ? { ok: false, reason: 'bloqueada', detail: 'la tienda respondió 403' } : ok(249_990)
    );
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);

    const parisCalls = deps.readStorePrice.mock.calls.filter((c) => String(c[0]).includes('paris.cl'));
    expect(parisCalls).toHaveLength(1);
    expect(summary.leidas).toBe(2);
    expect(summary.fallaron).toBe(1);
    expect(summary.detenidas.paris).toContain('bloqueo');
    expect(summary.detenidas.maconline).toBeUndefined();
    // La falla quedó anotada en esa ficha; las otras dos de Paris no se tocaron.
    expect(updates.map((u) => u.id).sort()).toEqual([1, 4]);
    expect(updates.find((u) => u.id === 1)?.patch).toMatchObject({ fail_count: 1, status: 'activo' });
  });

  it('a una tienda que viene bloqueando no se le pide nada, ni el robots.txt', async () => {
    const blocked = { status: 'error' as const, fail_count: MAX_FAILS, last_error: 'bloqueada: la tienda respondió 403', tried_at: '2026-11-24T08:00:00Z' };
    const { admin, updates } = fakeAdmin([offer(1, blocked), offer(2, blocked)]);
    const { deps } = fakeDeps(() => ok(1));
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);
    expect(deps.readRobots).not.toHaveBeenCalled();
    expect(deps.readStorePrice).not.toHaveBeenCalled();
    expect(summary.leidas).toBe(0);
    expect(summary.detenidas.paris).toContain('bloqueando');
    expect(updates).toEqual([]);
  });

  it('si no se pudo leer el robots.txt de una tienda, no se le pide ninguna ficha', async () => {
    const { admin } = fakeAdmin([offer(1), offer(2)]);
    const { deps } = fakeDeps(() => ok(1), false);
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);
    expect(deps.readRobots).toHaveBeenCalledTimes(1);
    expect(deps.readStorePrice).not.toHaveBeenCalled();
    expect(summary.detenidas.paris).toContain('robots.txt');
  });

  it('respeta el tope de la pasada y deja el resto para la siguiente, partiendo por lo más atrasado', async () => {
    const rows = [offer(1, { tried_at: '2026-11-26T07:00:00Z' }), offer(2, { tried_at: null }), offer(3, { tried_at: '2026-11-26T06:00:00Z' })];
    const { admin } = fakeAdmin(rows);
    const { deps } = fakeDeps(() => ok(100_000));
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true, limit: 2 }, deps);
    expect(summary).toMatchObject({ tocaba: 3, leidas: 2, pendientes: 1 });
    expect(summary.detalle.map((d) => d.id)).toEqual([2, 3]);
  });

  it('respeta el tope de tiempo', async () => {
    const { admin } = fakeAdmin([offer(1), offer(2), offer(3)]);
    const { deps } = fakeDeps(() => ok(100_000));
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true, budgetMs: 1000 }, deps);
    expect(summary.leidas).toBeLessThan(3);
    expect(summary.leidas + summary.pendientes).toBe(3);
  });

  it('no lee las fichas en pausa ni las de tiendas cuyo precio no se lee de la ficha', async () => {
    const rows = [
      offer(1, { status: 'pausado' }),
      offer(2, { store: 'samsung', url: 'https://www.samsung.com/cl/smartphones/galaxy-s26/buy/' }),
      offer(3, { store: 'tienda-que-ya-no-esta' }),
    ];
    const { admin } = fakeAdmin(rows);
    const { deps } = fakeDeps(() => ok(1));
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);
    expect(deps.readStorePrice).not.toHaveBeenCalled();
    expect(summary.leidas).toBe(0);
  });

  it('una ficha que deja de tener stock o que vuelve cambia la ficha del sitio aunque el precio sea el mismo', async () => {
    const rows = [offer(1), offer(2, { status: 'sin_stock' }), offer(3)];
    const { admin } = fakeAdmin(rows);
    const { deps } = fakeDeps((url) => ok(100_000, !url.includes('producto-1-')));
    const { summary, changedProductIds } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);
    expect(changedProductIds.sort()).toEqual([rows[0].product_id, rows[1].product_id].sort());
    expect(summary.detalle.find((d) => d.id === 1)?.resultado).toBe('sin_stock');
    expect(summary.cambiaron).toBe(0);
  });

  it('sin la migración aplicada no hace nada y lo dice; si la base falla, también', async () => {
    const missing = fakeAdmin([], { readError: { code: '42P01', message: 'relation "store_offers" does not exist' } });
    const { deps } = fakeDeps(() => ok(1));
    await expect(syncStoreOffers(missing.admin, { now: NOW, write: true }, deps)).resolves.toMatchObject({
      summary: { ok: true, falta_tabla: true, leidas: 0 },
      changedProductIds: [],
    });
    const broken = fakeAdmin([], { readError: { message: 'caída' } });
    await expect(syncStoreOffers(broken.admin, { now: NOW, write: true }, deps)).resolves.toMatchObject({ summary: { ok: false, error: 'caída' } });
    expect(deps.readStorePrice).not.toHaveBeenCalled();
  });

  it('si no puede guardar, corta la pasada en vez de seguir leyendo', async () => {
    const { admin } = fakeAdmin([offer(1), offer(2)], { writeError: 'sin permiso' });
    const { deps } = fakeDeps(() => ok(1));
    const { summary } = await syncStoreOffers(admin, { now: NOW, write: true }, deps);
    expect(summary).toMatchObject({ ok: false, error: 'sin permiso', leidas: 1 });
  });
});

describe('slugsOf', () => {
  it('entrega las direcciones de los productos, y nada si la base falla', async () => {
    const admin = {
      from: () => ({ select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((id) => ({ slug: `ficha-${id}` })), error: null }) }) }),
    } as unknown as SupabaseClient;
    await expect(slugsOf(admin, ['a', 'b'])).resolves.toEqual(['ficha-a', 'ficha-b']);
    const broken = {
      from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'x' } }) }) }),
    } as unknown as SupabaseClient;
    await expect(slugsOf(broken, ['a'])).resolves.toEqual([]);
    await expect(slugsOf(admin, [])).resolves.toEqual([]);
  });
});
