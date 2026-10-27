import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { earlierRunInProgress, lastFullRunWithin } from '@/lib/cron-runs';

type Res = { data?: unknown; error?: { code?: string; message: string } | null };

/** Supabase falso: anota los filtros y responde lo que diga el test. */
function fakeAdmin(respond: (filters: string[]) => Res | Promise<Res>) {
  const filters: string[] = [];
  const admin = {
    from(table: string) {
      filters.push(`from:${table}`);
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'lt', 'gte', 'order', 'limit']) {
        builder[m] = (...args: unknown[]) => {
          filters.push(`${m}:${JSON.stringify(args)}`);
          return builder;
        };
      }
      builder.then = (resolve: (r: Res) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => respond(filters))
          .then((r) => ({ data: null, error: null, ...r }))
          .then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { admin, filters };
}

describe('earlierRunInProgress', () => {
  it('busca una corrida anterior del mismo cron, abierta y de hace menos de 70 s', async () => {
    const before = Date.now();
    const { admin, filters } = fakeAdmin(() => ({ data: [{ id: 41 }] }));
    expect(await earlierRunInProgress(admin, 'refresh-prices', 42)).toBe(true);
    expect(filters).toContain('from:cron_runs');
    expect(filters).toContain('eq:["job","refresh-prices"]');
    expect(filters).toContain('is:["finished_at",null]');
    expect(filters).toContain('lt:["id",42]');
    const since = JSON.parse(filters.find((f) => f.startsWith('gte:'))!.slice(4))[1] as string;
    const windowMs = before - new Date(since).getTime();
    expect(windowMs).toBeGreaterThanOrEqual(69_000);
    expect(windowMs).toBeLessThanOrEqual(71_000);
  });

  it('sin corridas anteriores abiertas, sigue', async () => {
    const { admin } = fakeAdmin(() => ({ data: [] }));
    expect(await earlierRunInProgress(admin, 'refresh-prices', 42)).toBe(false);
  });

  it('ante cualquier duda no frena: sin bitácora, con error o si la base lanza', async () => {
    const { admin } = fakeAdmin(() => ({ data: [{ id: 1 }] }));
    expect(await earlierRunInProgress(admin, 'refresh-prices', null)).toBe(false);
    expect(await earlierRunInProgress(admin, 'refresh-prices', undefined)).toBe(false);

    const failing = fakeAdmin(() => ({ error: { code: 'PGRST205', message: 'no existe' } }));
    expect(await earlierRunInProgress(failing.admin, 'refresh-prices', 42)).toBe(false);

    const throwing = fakeAdmin(() => {
      throw new Error('red');
    });
    expect(await earlierRunInProgress(throwing.admin, 'refresh-prices', 42)).toBe(false);
  });
});

describe('lastFullRunWithin', () => {
  it('busca la última corrida completa y exitosa, anterior a esta y dentro de la ventana', async () => {
    const before = Date.now();
    const { admin, filters } = fakeAdmin(() => ({ data: [{ started_at: '2026-10-27T12:00:00Z' }] }));
    expect(await lastFullRunWithin(admin, 'refresh-prices', 42, 115 * 60_000)).toBe('2026-10-27T12:00:00Z');
    expect(filters).toContain('eq:["job","refresh-prices"]');
    expect(filters).toContain('eq:["ok",true]');
    // Las que se retiraron sin trabajar no cuentan.
    expect(filters).toContain('is:["summary->>omitida",null]');
    expect(filters).toContain('lt:["id",42]');
    const since = JSON.parse(filters.find((f) => f.startsWith('gte:'))!.slice(4))[1] as string;
    expect(before - new Date(since).getTime()).toBeGreaterThanOrEqual(115 * 60_000 - 1000);
    expect(before - new Date(since).getTime()).toBeLessThan(115 * 60_000 + 5000);
  });

  it('sin corridas, sin id o si la base falla: null (ante la duda se revisa)', async () => {
    expect(await lastFullRunWithin(fakeAdmin(() => ({ data: [] })).admin, 'refresh-prices', 42, 1000)).toBeNull();
    expect(await lastFullRunWithin(fakeAdmin(() => ({ data: [{ id: 1 }] })).admin, 'refresh-prices', null, 1000)).toBeNull();
    expect(await lastFullRunWithin(fakeAdmin(() => ({ error: { message: 'caída' } })).admin, 'refresh-prices', 42, 1000)).toBeNull();
    expect(
      await lastFullRunWithin(fakeAdmin(() => Promise.reject(new Error('red'))).admin, 'refresh-prices', 42, 1000)
    ).toBeNull();
  });
});
