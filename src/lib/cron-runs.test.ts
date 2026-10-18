import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { earlierRunInProgress } from '@/lib/cron-runs';

type Res = { data?: unknown; error?: { code?: string; message: string } | null };

/** Supabase falso: anota los filtros y responde lo que diga el test. */
function fakeAdmin(respond: (filters: string[]) => Res | Promise<Res>) {
  const filters: string[] = [];
  const admin = {
    from(table: string) {
      filters.push(`from:${table}`);
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'lt', 'gte', 'limit']) {
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
