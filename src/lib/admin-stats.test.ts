import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  actionBreakdown,
  actionNeededIds,
  buildCoverage,
  chileDaysSince,
  countPublished,
  countUncheckedLinks,
  digestFromRuns,
  fetchAllRows,
  findDuplicateLinkGroups,
  lacksBackupLink,
  latestIso,
  minutesSince,
  pointsToOtherProduct,
  prospectFromRuns,
  readActionNeededCount,
  readAdminSummary,
  usesStoredLink,
  type CronRunRow,
  type ProductStatRow,
} from '@/lib/admin-stats';

function product(overrides: Partial<ProductStatRow> & { id: string }): ProductStatRow {
  return {
    category: 'audifonos',
    affiliate_url: `https://meli.la/${overrides.id}`,
    is_active: true,
    is_hidden: false,
    inactive_reason: null,
    inactive_since: null,
    ml_product_id: `MLC${overrides.id}`,
    link_target_product_id: null,
    link_checked_at: '2026-10-01T00:00:00Z',
    price_checked_at: '2026-10-04T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Supabase falso: cada tabla responde lo que diga el test. Nunca hay red.
// ---------------------------------------------------------------------------

type Response = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };
type Handler = (q: { table: string; filters: string[]; range?: [number, number]; head: boolean }) => Response;

function fakeAdmin(handlers: Record<string, Handler>): SupabaseClient {
  return {
    from(table: string) {
      const state = { table, filters: [] as string[], range: undefined as [number, number] | undefined, head: false };
      const builder: Record<string, unknown> = {};
      const chain = (name: string) =>
        (...args: unknown[]) => {
          state.filters.push(`${name}:${args.map((a) => JSON.stringify(a)).join(',')}`);
          return builder;
        };
      for (const m of ['eq', 'not', 'gte', 'order', 'limit']) builder[m] = chain(m);
      builder.select = (_cols: string, opts?: { head?: boolean }) => {
        state.head = Boolean(opts?.head);
        return builder;
      };
      builder.range = (from: number, to: number) => {
        state.range = [from, to];
        return builder;
      };
      builder.then = (resolve: (r: Response) => unknown, reject: (e: unknown) => unknown) => {
        try {
          const handler = handlers[table];
          const res = handler ? handler(state) : { data: [], error: null };
          return Promise.resolve({ data: null, error: null, count: null, ...res }).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.x' in the schema cache" };

// 4 de octubre de 2026, 14:00 en Chile (UTC-3).
const NOW = new Date('2026-10-04T17:00:00Z');

describe('cálculos sobre productos', () => {
  it('cuenta publicados solo activos y no ocultos', () => {
    const rows = [
      product({ id: '1' }),
      product({ id: '2', is_active: false, inactive_reason: 'sin_ganador' }),
      product({ id: '3', is_hidden: true }),
    ];
    expect(countPublished(rows)).toBe(1);
  });

  it('agrupa links repetidos ignorando espacios y la barra final', () => {
    const rows = [
      product({ id: 'a', affiliate_url: 'https://meli.la/abc' }),
      product({ id: 'b', affiliate_url: ' https://meli.la/abc/ ' }),
      product({ id: 'c', affiliate_url: 'https://meli.la/xyz' }),
      product({ id: 'd', affiliate_url: '' }),
      product({ id: 'e', affiliate_url: '' }),
    ];
    const groups = findDuplicateLinkGroups(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].url).toBe('https://meli.la/abc');
    expect(groups[0].products.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('sin respaldo: activo cuyo link no es meli.la', () => {
    expect(lacksBackupLink(product({ id: '1', affiliate_url: 'https://www.mercadolibre.cl/p/MLC1' }))).toBe(true);
    expect(lacksBackupLink(product({ id: '1', affiliate_url: 'https://meli.la/abc' }))).toBe(false);
    // El acortador antiguo también es un link generado: cuenta como respaldo.
    expect(lacksBackupLink(product({ id: '1', affiliate_url: 'https://mercadolibre.com/sec/abc' }))).toBe(false);
    // Uno en pausa no se publica: no cuenta.
    expect(lacksBackupLink(product({ id: '1', is_active: false, affiliate_url: '' }))).toBe(false);
  });

  it('link a otra ficha: destino conocido y distinto', () => {
    expect(pointsToOtherProduct({ ml_product_id: 'MLC1', link_target_product_id: 'MLC2' })).toBe(true);
    expect(pointsToOtherProduct({ ml_product_id: 'MLC1', link_target_product_id: 'MLC1' })).toBe(false);
    expect(pointsToOtherProduct({ ml_product_id: 'MLC1', link_target_product_id: null })).toBe(false);
  });

  it('requieren acción NO cuenta los que están en pausa automática', () => {
    const rows = [
      ...Array.from({ length: 18 }, (_, i) =>
        product({ id: `p${i}`, is_active: false, inactive_reason: i % 2 ? 'sin_ganador' : 'ganador_no_verde' })
      ),
      product({ id: 'roto1', is_active: false, inactive_reason: 'link_otro_producto' }),
      product({ id: 'roto2', is_active: false, inactive_reason: 'link_otro_producto' }),
      product({ id: 'ok' }),
    ];
    expect(actionNeededIds(rows).size).toBe(2);
  });

  it('cuenta una vez el producto con dos problemas y salta los ocultos', () => {
    const rows = [
      // Repetido y además sin meli.la.
      product({ id: 'a', affiliate_url: 'https://www.mercadolibre.cl/p/MLC9' }),
      product({ id: 'b', affiliate_url: 'https://www.mercadolibre.cl/p/MLC9' }),
      product({ id: 'c', is_hidden: true, is_active: false, inactive_reason: 'link_otro_producto' }),
    ];
    expect([...actionNeededIds(rows)].sort()).toEqual(['a', 'b']);
    expect(actionBreakdown(rows)).toEqual({ total: 2, linkNuevo: 0, repetidos: 2, sinRespaldo: 2 });
  });

  it('links sin verificar: activos sin link_checked_at', () => {
    expect(
      countUncheckedLinks([
        product({ id: '1', link_checked_at: null }),
        product({ id: '2', link_checked_at: null, is_active: false }),
        product({ id: '3' }),
      ])
    ).toBe(1);
  });
});

describe('con los links directos en uso', () => {
  // Lo que deja una tanda aprobada con link directo: sin meli.la guardado.
  const direct = (id: string) => product({ id, affiliate_url: `https://www.mercadolibre.cl/p/MLC${id}?matt_word=x&matt_tool=1` });

  it('el botón sale de la ficha, salvo en los productos sin ficha asociada', () => {
    expect(usesStoredLink({ ml_product_id: 'MLC1' }, true)).toBe(false);
    expect(usesStoredLink({ ml_product_id: null }, true)).toBe(true);
    expect(usesStoredLink({ ml_product_id: 'MLC1' }, false)).toBe(true);
    expect(usesStoredLink({ ml_product_id: 'MLC1' })).toBe(true);
  });

  it('un link guardado repetido, sin meli.la o a otra ficha no pide acción', () => {
    const rows = [
      direct('1'),
      direct('2'),
      product({ id: '3', affiliate_url: 'https://meli.la/same' }),
      product({ id: '4', affiliate_url: 'https://meli.la/same' }),
      product({ id: '5', is_active: false, inactive_reason: 'link_otro_producto' }),
      product({ id: '6', link_checked_at: null }),
    ];
    // Sin links directos, todo eso sí es un problema.
    expect(actionNeededIds(rows).size).toBe(5);
    expect(countUncheckedLinks(rows)).toBe(1);

    expect(actionNeededIds(rows, true).size).toBe(0);
    expect(actionBreakdown(rows, true)).toEqual({ total: 0, linkNuevo: 0, repetidos: 0, sinRespaldo: 0 });
    expect(countUncheckedLinks(rows, true)).toBe(0);
  });

  it('un producto sin ficha sigue dependiendo de su link guardado', () => {
    const rows = [
      direct('1'),
      // Sin ficha no se puede armar el link directo: se usa el guardado.
      product({ id: 'a', ml_product_id: null, affiliate_url: 'https://www.mercadolibre.cl/algo' }),
      product({ id: 'b', ml_product_id: null, affiliate_url: 'https://meli.la/dup' }),
      product({ id: 'c', affiliate_url: 'https://meli.la/dup' }),
    ];
    expect([...actionNeededIds(rows, true)].sort()).toEqual(['a', 'b']);
    expect(actionBreakdown(rows, true)).toEqual({ total: 2, linkNuevo: 0, repetidos: 1, sinRespaldo: 1 });
  });
});

describe('fechas', () => {
  it('latestIso toma el instante más reciente e ignora vacíos', () => {
    expect(latestIso([null, '2026-10-01T00:00:00Z', 'basura', '2026-10-03T00:00:00Z', undefined])).toBe(
      '2026-10-03T00:00:00Z'
    );
    expect(latestIso([null, undefined])).toBeNull();
  });

  it('minutesSince', () => {
    expect(minutesSince('2026-10-04T16:15:00Z', NOW)).toBe(45);
    expect(minutesSince(null, NOW)).toBeNull();
  });

  it('chileDaysSince cuenta días de calendario en Chile', () => {
    // 15 sep 16:41 en Chile → 19 días al 4 de octubre.
    expect(chileDaysSince('2026-09-15T19:41:51Z', NOW)).toBe(19);
    // 3 oct 23:50 en Chile (4 oct 02:50 UTC) fue "ayer".
    expect(chileDaysSince('2026-10-04T02:50:00Z', NOW)).toBe(1);
    expect(chileDaysSince(null, NOW)).toBeNull();
  });
});

describe('cobertura por categoría', () => {
  it('cuenta publicados y pendientes, de la más grande a la más chica', () => {
    const coverage = buildCoverage(
      [
        product({ id: '1', category: 'audifonos' }),
        product({ id: '2', category: 'audifonos', is_active: false }),
        product({ id: '3', category: 'notebooks' }),
      ],
      [{ category: 'notebooks' }, { category: 'notebooks' }, { category: 'monitores' }, { category: null }]
    );
    expect(coverage).toEqual([
      { category: 'notebooks', publicados: 1, pendientes: 2 },
      { category: 'audifonos', publicados: 1, pendientes: 0 },
      { category: 'monitores', publicados: 0, pendientes: 1 },
    ]);
  });
});

describe('bitácora de crons', () => {
  const run = (overrides: Partial<CronRunRow>): CronRunRow => ({
    started_at: '2026-10-04T12:00:00Z',
    finished_at: '2026-10-04T12:01:00Z',
    ok: true,
    summary: {},
    ...overrides,
  });

  it('correo: enviado, falló o sin datos; salta las corridas de prueba', () => {
    expect(digestFromRuns([run({ summary: { digest: { ok: true } } })]).status).toBe('enviado');
    expect(digestFromRuns([run({ summary: { digest: { ok: false, error: 'x' } } })]).status).toBe('fallo');
    expect(
      digestFromRuns([
        run({ summary: { digest: { ok: true, skipped: 'dry_run' } } }),
        run({ summary: { digest: { ok: false } }, finished_at: '2026-10-03T12:01:00Z' }),
      ])
    ).toEqual({ status: 'fallo', at: '2026-10-03T12:01:00Z' });
    expect(digestFromRuns([run({ summary: null })]).status).toBe('sin_datos');
    expect(digestFromRuns([]).status).toBe('sin_datos');
  });

  it('prospección: la última corrida que terminó bien', () => {
    expect(
      prospectFromRuns([
        run({ ok: false, summary: { inserted: 9 } }),
        run({ ok: true, summary: { inserted: 4 }, finished_at: '2026-10-03T12:01:00Z' }),
      ])
    ).toEqual({ at: '2026-10-03T12:01:00Z', nuevos: 4, source: 'cron_runs' });
    expect(prospectFromRuns([run({ ok: null })])).toBeNull();
  });
});

describe('fetchAllRows', () => {
  it('pide páginas de 1000 hasta que una viene incompleta', async () => {
    const calls: [number, number][] = [];
    const { rows, error } = await fetchAllRows<number>(async (from, to) => {
      calls.push([from, to]);
      const size = from === 0 ? 1000 : 3;
      return { data: Array.from({ length: size }, (_, i) => from + i), error: null };
    });
    expect(error).toBeNull();
    expect(rows).toHaveLength(1003);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe('readAdminSummary', () => {
  const healthy = () =>
    fakeAdmin({
      products: () => ({
        data: [
          product({ id: '1', price_checked_at: '2026-10-04T16:30:00Z' }),
          product({ id: '2', is_active: false, inactive_reason: 'link_otro_producto' }),
          product({ id: '3', is_active: false, inactive_reason: 'sin_ganador' }),
          product({ id: '4', link_checked_at: null }),
        ],
      }),
      product_candidates: (q) => {
        if (q.filters.some((f) => f.startsWith('eq:"status","pending_review"'))) {
          return {
            data: [
              { category: 'audifonos', prospected_at: '2026-10-04T12:15:00Z' },
              { category: 'notebooks', prospected_at: '2026-10-02T12:15:00Z' },
            ],
          };
        }
        if (q.filters.some((f) => f.startsWith('eq:"status","approved"'))) {
          return { data: [{ reviewed_at: '2026-09-15T19:41:51Z' }] };
        }
        if (q.head) return { count: 7 };
        return { data: [{ prospected_at: '2026-10-04T12:15:00Z' }] };
      },
      cron_runs: () => ({ error: MISSING_TABLE }),
      outbound_clicks: () => ({ error: MISSING_TABLE }),
    });

  it('arma los KPIs y degrada las tablas opcionales sin marcar error', async () => {
    const s = await readAdminSummary(healthy(), NOW);
    expect(s.errors).toEqual([]);
    expect(s.publicados.data).toBe(2);
    expect(s.porRevisar.data).toBe(2);
    expect(s.nuevosHoy.data).toBe(1);
    expect(s.diasSinPublicar.data?.days).toBe(19);
    expect(s.requierenAccion.data?.total).toBe(1);
    expect(s.linksSinVerificar.data).toBe(1);
    expect(s.ultimoPrecioMin.data).toBe(30);
    expect(s.ultimaProspeccion.data).toEqual({ at: '2026-10-04T12:15:00Z', nuevos: 7, source: 'candidatos' });
    expect(s.correoAyer).toMatchObject({ missing: true, data: { status: 'sin_datos' } });
    expect(s.clics).toMatchObject({ missing: true, data: null, error: null });
  });

  it('con los links directos en uso no cuenta los links guardados', async () => {
    const s = await readAdminSummary(healthy(), NOW, { directLinks: true });
    expect(s.requierenAccion.data).toEqual({ total: 0, linkNuevo: 0, repetidos: 0, sinRespaldo: 0 });
    expect(s.linksSinVerificar.data).toBe(0);
    // Lo demás no cambia.
    expect(s.publicados.data).toBe(2);
  });

  it('con la bitácora usa la corrida y el correo anotados', async () => {
    const admin = fakeAdmin({
      cron_runs: () => ({
        data: [
          {
            started_at: '2026-10-04T12:00:00Z',
            finished_at: '2026-10-04T12:00:40Z',
            ok: true,
            summary: { inserted: 12, digest: { ok: true } },
          },
        ],
      }),
      outbound_clicks: (q) => ({ count: q.filters.some((f) => f.includes('2026-10-04')) ? 5 : 40 }),
    });
    const s = await readAdminSummary(admin, NOW);
    expect(s.ultimaProspeccion.data).toEqual({ at: '2026-10-04T12:00:40Z', nuevos: 12, source: 'cron_runs' });
    expect(s.correoAyer.data).toEqual({ status: 'enviado', at: '2026-10-04T12:00:40Z' });
    expect(s.clics.data).toEqual({ hoy: 5, ultimos7: 40 });
  });

  it('clics: reconoce la tabla faltante aunque el conteo head:true "funcione"', async () => {
    const admin = fakeAdmin({
      // Así responde supabase-js a un HEAD contra una tabla que no existe:
      // éxito, sin error y con count null (medido contra la base real).
      outbound_clicks: (q) => (q.head ? { count: null } : { error: MISSING_TABLE }),
    });
    const s = await readAdminSummary(admin, NOW);
    expect(s.clics).toMatchObject({ missing: true, error: null });
    expect(s.errors).toEqual([]);
  });

  it('si la base falla: error y data null (nunca 0)', async () => {
    const admin = fakeAdmin({
      products: () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } }),
    });
    const s = await readAdminSummary(admin, NOW);
    expect(s.publicados).toEqual({ data: null, error: 'canceling statement due to statement timeout', missing: undefined });
    expect(s.requierenAccion.data).toBeNull();
    expect(s.ultimoPrecioMin.data).toBeNull();
    expect(s.coberturaPorCategoria.data).toBeNull();
    expect(s.errors).toContain('canceling statement due to statement timeout');
  });

  it('sin cliente admin: todo en error', async () => {
    const s = await readAdminSummary(null, NOW);
    expect(s.publicados.data).toBeNull();
    expect(s.errors).toEqual(['Supabase admin no configurado']);
  });
});

describe('readActionNeededCount', () => {
  it('cuenta solo lo que pide acción', async () => {
    const admin = fakeAdmin({
      products: () => ({
        data: [
          product({ id: '1', is_active: false, inactive_reason: 'sin_ganador' }),
          product({ id: '2', is_active: false, inactive_reason: 'link_otro_producto' }),
          product({ id: '3', affiliate_url: 'https://meli.la/same' }),
          product({ id: '4', affiliate_url: 'https://meli.la/same' }),
        ],
      }),
    });
    expect(await readActionNeededCount(admin)).toBe(3);
  });

  it('con los links directos en uso, los links guardados no cuentan', async () => {
    const admin = fakeAdmin({
      products: () => ({
        data: [
          product({ id: '1', affiliate_url: 'https://www.mercadolibre.cl/p/MLC1?matt_word=x&matt_tool=1' }),
          product({ id: '3', affiliate_url: 'https://meli.la/same' }),
          product({ id: '4', affiliate_url: 'https://meli.la/same' }),
        ],
      }),
    });
    expect(await readActionNeededCount(admin)).toBe(3);
    expect(await readActionNeededCount(admin, true)).toBe(0);
  });

  it('null si la base falla, para no mostrar un 0 engañoso', async () => {
    const admin = fakeAdmin({ products: () => ({ error: { message: 'boom' } }) });
    expect(await readActionNeededCount(admin)).toBeNull();
    expect(await readActionNeededCount(null)).toBeNull();
  });
});
