import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pricesHealthy, prospectHealthy, siteHealthy, type HealthInput } from '@/lib/health';

/*
 * /api/health: el veredicto (puro) y la ruta con una base de mentira.
 *
 * Desde el 23-11-2026 Mercado Libre no entrega precios. Si el endpoint siguiera
 * respondiendo 503 por los precios viejos, respondería 503 para siempre y un
 * monitor dejaría de servir para lo que sí se puede arreglar.
 */

const base: HealthInput = {
  priceAgeMin: 20,
  oldestAgeMin: 70,
  prospectAgeH: 3,
  pricesClosed: false,
  maxPriceAgeMin: 180,
  maxOldestPriceAgeMin: 300,
  maxProspectAgeH: 26,
};

describe('el veredicto', () => {
  it('con precios y prospección al día, bien', () => {
    expect(siteHealthy(base)).toBe(true);
    // Sin productos visibles revisados no hay "más viejo" que medir.
    expect(siteHealthy({ ...base, oldestAgeMin: null })).toBe(true);
  });

  it('precios viejos, o sin saber cuándo se revisaron: falla', () => {
    expect(pricesHealthy({ ...base, priceAgeMin: 181 })).toBe(false);
    expect(pricesHealthy({ ...base, oldestAgeMin: 301 })).toBe(false);
    expect(pricesHealthy({ ...base, priceAgeMin: null })).toBe(false);
    expect(siteHealthy({ ...base, priceAgeMin: 1400 })).toBe(false);
  });

  it('con la consulta cerrada por Mercado Libre, los precios viejos no cuentan como falla', () => {
    const closed = { ...base, priceAgeMin: 1400, oldestAgeMin: 1500, pricesClosed: true };
    expect(pricesHealthy(closed)).toBe(true);
    expect(siteHealthy(closed)).toBe(true);
    expect(siteHealthy({ ...closed, priceAgeMin: null })).toBe(true);
  });

  it('pero la prospección sigue contando: si deja de correr, falla igual', () => {
    expect(prospectHealthy({ prospectAgeH: 27, maxProspectAgeH: 26 })).toBe(false);
    expect(prospectHealthy({ prospectAgeH: null, maxProspectAgeH: 26 })).toBe(false);
    expect(siteHealthy({ ...base, pricesClosed: true, prospectAgeH: 30 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// La ruta
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => ({
  /** Las filas que responde cada tabla; la consulta de productos distingue el orden. */
  latestPrice: null as string | null,
  oldestPrice: null as string | null,
  refreshRuns: [] as unknown[],
  prospectRuns: [] as unknown[],
  fail: false,
}));

vi.mock('@/lib/supabase/server', () => {
  const from = (table: string) => {
    const state = { job: '', ascending: false };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'not', 'limit']) builder[method] = () => builder;
    builder.eq = (column: string, value: unknown) => {
      if (column === 'job') state.job = String(value);
      return builder;
    };
    builder.order = (_column: string, options?: { ascending?: boolean }) => {
      state.ascending = options?.ascending === true;
      return builder;
    };
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      if (db.fail) return Promise.resolve({ data: null, error: { message: 'caída' } }).then(resolve, reject);
      let data: unknown[] = [];
      if (table === 'products') {
        const at = state.ascending ? db.oldestPrice : db.latestPrice;
        data = at ? [{ price_checked_at: at }] : [];
      } else if (table === 'cron_runs') {
        data = state.job === 'prospect' ? db.prospectRuns : db.refreshRuns;
      }
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return builder;
  };
  return { getSupabaseAdmin: () => ({ from }) };
});

describe('GET /api/health', async () => {
  const { GET } = await import('@/app/api/health/route');
  const NOW = new Date('2026-11-24T16:00:00Z');
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
  const closedRun = (minutesAgo: number) => ({
    started_at: ago(minutesAgo),
    finished_at: ago(minutesAgo),
    ok: true,
    summary: { revisados: 16, errores_transitorios: 16, consulta_de_precios_cerrada: true },
    error: null,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.latestPrice = ago(20);
    db.oldestPrice = ago(70);
    db.refreshRuns = [{ started_at: ago(20), finished_at: ago(19), ok: true, summary: { revisados: 1297 }, error: null }];
    db.prospectRuns = [{ finished_at: ago(180) }];
    db.fail = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('todo al día: 200', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      precios_hace_min: 20,
      precio_mas_viejo_hace_min: 70,
      prospeccion_hace_h: 3,
      consulta_de_precios: 'abierta',
    });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('precios de ayer con la consulta abierta: 503, como siempre', async () => {
    db.latestPrice = ago(1400);
    db.oldestPrice = ago(1500);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, precios_hace_min: 1400, consulta_de_precios: 'abierta' });
  });

  it('precios de ayer porque Mercado Libre cerró la consulta, y el refresco corre: 200 y lo dice', async () => {
    db.latestPrice = ago(1400);
    db.oldestPrice = ago(1500);
    db.refreshRuns = [closedRun(25)];
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      precios_hace_min: 1400,
      precio_mas_viejo_hace_min: 1500,
      prospeccion_hace_h: 3,
      consulta_de_precios: 'cerrada_por_mercado_libre',
    });
  });

  it('si el refresco deja de correr, los precios viejos vuelven a ser una falla', async () => {
    db.latestPrice = ago(1400);
    db.oldestPrice = ago(1500);
    // La última pasada fue hace más de 90 minutos: el programador se detuvo.
    db.refreshRuns = [closedRun(200)];
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, consulta_de_precios: 'abierta' });
  });

  it('con la consulta cerrada, una prospección que no corre sigue siendo una falla', async () => {
    db.latestPrice = ago(1400);
    db.refreshRuns = [closedRun(25)];
    db.prospectRuns = [{ finished_at: ago(30 * 60) }];
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, prospeccion_hace_h: 30, consulta_de_precios: 'cerrada_por_mercado_libre' });
  });

  it('si la base no responde: 503 sin detalles', async () => {
    db.fail = true;
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      ok: false,
      precios_hace_min: null,
      precio_mas_viejo_hace_min: null,
      prospeccion_hace_h: null,
      consulta_de_precios: null,
    });
  });
});
