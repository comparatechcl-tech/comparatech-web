import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * ¿Mercado Libre le respondió a la prospección? Desde el 14-10-2026 ML
 * responde 403 a la lista de más vendidos y la prospección pasó días
 * anotándose como ok con 0 productos, con un correo que solo decía "0
 * candidatos nuevos". Primero la decisión (funciones puras) y después la
 * ruta de punta a punta, con ML, la base y el correo de mentira.
 */

const mocks = vi.hoisted(() => {
  // La base: cada consulta responde las filas que un test deja para su tabla.
  const rows: Record<string, unknown[]> = {};
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'not', 'lt', 'or', 'order', 'limit', 'range', 'update', 'upsert']) {
      builder[method] = () => builder;
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null, count: 0 }).then(resolve, reject);
    return builder;
  };
  return {
    admin: { from },
    rows,
    finish: async (_ok: boolean, _summary: unknown, _error?: string) => {},
    ping: async (_url: string | undefined, _ok: boolean) => {},
    sendEmail: async (_params: { to: string | string[]; subject: string; html: string; text?: string }) =>
      ({ ok: true, id: 'correo-1' }) as const,
  };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => mocks.admin }));
vi.mock('@/lib/ml-enrichment', async (original) => ({
  ...(await original<typeof import('@/lib/ml-enrichment')>()),
  getMlToken: async () => 'tok',
}));
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async () => ({ finish: (...args: Parameters<typeof mocks.finish>) => mocks.finish(...args) }),
  pingHealthcheck: (...args: Parameters<typeof mocks.ping>) => mocks.ping(...args),
}));
vi.mock('@/lib/email', async (original) => ({
  ...(await original<typeof import('@/lib/email')>()),
  sendEmail: (...args: Parameters<typeof mocks.sendEmail>) => mocks.sendEmail(...args),
}));
// Los datos del correo se prueban en daily-digest.test.ts; acá, una cola vacía.
vi.mock('@/lib/digest-data', () => ({
  gatherDigestInput: async () => ({
    newCandidates: [],
    topToApprove: [],
    pendingTotal: 0,
    publishedTotal: 1090,
    needsLink: [],
    pausedCount: 0,
    adminUrl: 'https://comparatech-web.vercel.app',
    daysSinceLastApproval: 4,
    linkMode: { directLinks: true, word: 'comparatech' },
    attribution: 'confirmada',
    lastPriceCheckMinutes: 7,
    clicsAyer: null,
    errors: [],
  }),
}));

import { NextRequest } from 'next/server';
import { ROOT_CATEGORIES, type MlFailure } from '@/lib/ml-catalog';
import {
  MAX_FAILED_RATIO,
  assessSource,
  sourceProblemError,
  sourceProblemLine,
  tallyStage,
  type SourceProblem,
  type SourceStage,
} from '@/lib/prospect-source';
import { GET as prospectRoute } from '@/app/api/cron/prospect/route';

const BLOCK_CODE = 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES';
const blocked: MlFailure = { status: 403, code: BLOCK_CODE };
const LINE_BLOCKED = 'Mercado Libre bloqueó la lista de más vendidos: hoy no se pudo buscar productos nuevos.';

/** n consultas: las primeras `failures` con esa falla, el resto respondidas. */
function stage(n: number, failures: MlFailure[] = []): SourceStage {
  return tallyStage([...failures, ...Array<null>(n - failures.length).fill(null)]);
}

const times = (n: number, failure: MlFailure) => Array<MlFailure>(n).fill(failure);

// ---------------------------------------------------------------------------
// La decisión
// ---------------------------------------------------------------------------

describe('tallyStage', () => {
  it('cuenta consultas, fallas por código HTTP y el código de ML más repetido', () => {
    expect(
      tallyStage([blocked, null, blocked, { status: 503, code: null }, { status: null, code: null }, null])
    ).toEqual({ consultas: 6, fallidas: 4, por_estado: { '403': 2, '503': 1, red: 1 }, codigo_ml: BLOCK_CODE });
    expect(tallyStage([])).toEqual({ consultas: 0, fallidas: 0, por_estado: {}, codigo_ml: null });
  });
});

describe('assessSource', () => {
  const okCategories = stage(150);

  it('el bloqueo medido desde el 14-10: 403 en todas las categorías', () => {
    expect(assessSource({ categorias: okCategories, destacados: stage(288, times(288, blocked)) }, 0)).toEqual({
      etapa: 'destacados',
      tipo: 'bloqueo',
      consultas: 288,
      fallidas: 288,
      estado: '403',
      codigo_ml: BLOCK_CODE,
    });
  });

  it('un día normal, con algún tropiezo de ML, no es problema', () => {
    const tropiezos = times(5, { status: 503, code: null });
    expect(assessSource({ categorias: okCategories, destacados: stage(288, tropiezos) }, 1557)).toBeNull();
  });

  it('desde la mitad de las consultas con error, la corrida no hizo su trabajo', () => {
    expect(MAX_FAILED_RATIO).toBe(0.5);
    const half = times(144, { status: 429, code: 'too_many_requests' });
    expect(assessSource({ categorias: okCategories, destacados: stage(288, half) }, 700)).toMatchObject({
      etapa: 'destacados',
      tipo: 'falla',
      fallidas: 144,
      estado: '429',
    });
    const lessThanHalf = times(143, { status: 429, code: 'too_many_requests' });
    expect(assessSource({ categorias: okCategories, destacados: stage(288, lessThanHalf) }, 700)).toBeNull();
  });

  it('es bloqueo si la mayoría de las fallas son 403; si no, falla', () => {
    const mostlyBlocked = [...times(200, blocked), ...times(60, { status: 500, code: null })];
    expect(assessSource({ categorias: okCategories, destacados: stage(288, mostlyBlocked) }, 10)?.tipo).toBe('bloqueo');
    const mostlyDown = [...times(60, blocked), ...times(200, { status: null, code: null })];
    expect(assessSource({ categorias: okCategories, destacados: stage(288, mostlyDown) }, 10)).toMatchObject({
      tipo: 'falla',
      estado: 'red',
    });
  });

  it('sin categorías busca solo en las raíces: también cuenta como problema', () => {
    expect(assessSource({ categorias: stage(14, times(14, blocked)), destacados: stage(7) }, 120)).toMatchObject({
      etapa: 'categorias',
      tipo: 'bloqueo',
      fallidas: 14,
    });
  });

  it('una lista vacía en todas las categorías es la fuente apagada, aunque no haya errores', () => {
    expect(assessSource({ categorias: okCategories, destacados: stage(288) }, 0)).toEqual({
      etapa: 'destacados',
      tipo: 'vacio',
      consultas: 288,
      fallidas: 0,
      estado: null,
      codigo_ml: null,
    });
  });
});

describe('sourceProblemLine y sourceProblemError', () => {
  const problem = (over: Partial<SourceProblem>): SourceProblem => ({
    etapa: 'destacados',
    tipo: 'bloqueo',
    consultas: 288,
    fallidas: 288,
    estado: '403',
    codigo_ml: BLOCK_CODE,
    ...over,
  });

  it('dice en simple qué pasó y qué significa para hoy', () => {
    expect(sourceProblemLine(problem({}))).toBe(LINE_BLOCKED);
    expect(sourceProblemLine(problem({ fallidas: 200 }))).toBe(
      'Mercado Libre bloqueó la lista de más vendidos en 200 de 288 categorías: hoy la búsqueda de productos nuevos quedó a medias.'
    );
    expect(sourceProblemLine(problem({ tipo: 'falla', estado: '503', codigo_ml: null }))).toBe(
      'Mercado Libre no entregó la lista de más vendidos: hoy no se pudo buscar productos nuevos.'
    );
    expect(sourceProblemLine(problem({ etapa: 'categorias', consultas: 14, fallidas: 14 }))).toBe(
      'Mercado Libre bloqueó su lista de categorías (14 de 14 consultas): hoy la búsqueda de productos nuevos quedó a medias.'
    );
    expect(sourceProblemLine(problem({ tipo: 'vacio', fallidas: 0, estado: null, codigo_ml: null }))).toBe(
      'Mercado Libre entregó vacía la lista de más vendidos: hoy no hubo de dónde sacar productos nuevos.'
    );
  });

  it('para la bitácora agrega el detalle técnico', () => {
    expect(sourceProblemError(problem({}))).toBe(`${LINE_BLOCKED} (HTTP 403 ${BLOCK_CODE} en 288 de 288 consultas)`);
    expect(sourceProblemError(problem({ tipo: 'falla', estado: 'red', codigo_ml: null, fallidas: 150 }))).toContain(
      '(sin respuesta en 150 de 288 consultas)'
    );
    expect(sourceProblemError(problem({ tipo: 'vacio', fallidas: 0, estado: null, codigo_ml: null }))).toContain(
      '(0 productos en 288 categorías)'
    );
  });
});

// ---------------------------------------------------------------------------
// La ruta de punta a punta
// ---------------------------------------------------------------------------

describe('GET /api/cron/prospect', () => {
  const SECRET = 'un-secreto-de-prueba-largo';
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  let finish: ReturnType<typeof vi.fn<typeof mocks.finish>>;
  let ping: ReturnType<typeof vi.fn<typeof mocks.ping>>;
  let sendEmail: ReturnType<typeof vi.fn<typeof mocks.sendEmail>>;

  /**
   * ML de mentira: cada raíz tiene una hija y las hijas no tienen hijas (7 +
   * 7 consultas de categorías, 7 listas de más vendidos). La lista la decide
   * cada test.
   */
  function stubMl(highlights: (categoryId: string) => Response) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(input);
        const highlight = /^\/highlights\/MLC\/category\/(MLC\d+)$/.exec(url.pathname);
        if (highlight) return highlights(highlight[1]);
        const category = /^\/categories\/(MLC\d+)$/.exec(url.pathname);
        if (category) {
          const id = category[1];
          return json(200, { id, children_categories: ROOT_CATEGORIES.includes(id) ? [{ id: `${id}9` }] : [] });
        }
        throw new Error(`Consulta inesperada a ${url.pathname}`);
      })
    );
  }

  const request = (query = '') =>
    new NextRequest(`https://comparatech-web.vercel.app/api/cron/prospect${query}`, {
      headers: { authorization: `Bearer ${SECRET}` },
    });

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.stubEnv('DIGEST_TO', 'dueno@example.com');
    vi.stubEnv('HEALTHCHECK_PROSPECT_URL', 'https://hc.example.com/abc');
    for (const table of Object.keys(mocks.rows)) delete mocks.rows[table];
    finish = vi.fn<typeof mocks.finish>(async () => {});
    ping = vi.fn<typeof mocks.ping>(async () => {});
    sendEmail = vi.fn<typeof mocks.sendEmail>(async () => ({ ok: true, id: 'correo-1' }) as const);
    mocks.finish = finish;
    mocks.ping = ping;
    mocks.sendEmail = sendEmail;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('si ML bloquea los destacados: corrida fallida con el motivo, correo con la línea arriba y aviso al healthcheck', async () => {
    stubMl(() => json(403, { blocked_by: 'PolicyAgent', status: 403, code: BLOCK_CODE }));

    const res = await prospectRoute(request());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, highlighted: 0, inserted: 0 });
    expect(body.fuente_ml).toEqual({
      problema: { etapa: 'destacados', tipo: 'bloqueo', consultas: 7, fallidas: 7, estado: '403', codigo_ml: BLOCK_CODE },
      categorias: { consultas: 14, fallidas: 0, por_estado: {}, codigo_ml: null },
      destacados: { consultas: 7, fallidas: 7, por_estado: { '403': 7 }, codigo_ml: BLOCK_CODE },
    });
    expect(body.errores_ml).toEqual({ '/highlights/MLC/category/:id': 7 });

    // cron_runs: fallida, con la frase y el detalle.
    expect(finish).toHaveBeenCalledTimes(1);
    const [ok, summary, error] = finish.mock.calls[0];
    expect(ok).toBe(false);
    expect(summary).toEqual(body);
    expect(error).toBe(`${LINE_BLOCKED} (HTTP 403 ${BLOCK_CODE} en 7 de 7 consultas)`);

    // El correo sale igual, y lo primero que dice es el motivo.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.to).toEqual(['dueno@example.com']);
    expect(mail.subject).toBe('ComparaTech · Falló la búsqueda de productos nuevos');
    expect(mail.text?.split('\n')[2]).toBe(`⚠ ${LINE_BLOCKED}`);
    expect(mail.html).toContain(LINE_BLOCKED);
    expect(mail.html).not.toContain('hay días sin novedades');

    expect(ping).toHaveBeenCalledWith('https://hc.example.com/abc', false);
  });

  it('con destacados de ML, la corrida queda ok y el correo no trae el aviso', async () => {
    // El único destacado ya está publicado: no hace falta mirar fichas ni ganadores.
    mocks.rows.products = [{ ml_product_id: 'MLC777', ml_family_id: null, price: 50_000 }];
    stubMl(() => json(200, { content: [{ id: 'MLC777', type: 'PRODUCT', position: 1 }] }));

    const res = await prospectRoute(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, highlighted: 1, already_known: 1, inspected: 0 });
    expect(body.fuente_ml.problema).toBeNull();
    expect(body.errores_ml).toEqual({});

    expect(finish).toHaveBeenCalledWith(true, body, undefined);
    const mail = sendEmail.mock.calls[0][0];
    expect(mail.subject).toBe('ComparaTech · 4 días sin publicar · 0 listos para aprobar');
    expect(mail.text).not.toContain('⚠');
    expect(ping).toHaveBeenCalledWith('https://hc.example.com/abc', true);
  });

  it('una categoría con error entre varias que responden no tumba la corrida, pero queda anotada', async () => {
    mocks.rows.products = [{ ml_product_id: 'MLC777', ml_family_id: null, price: 50_000 }];
    const failing = `${ROOT_CATEGORIES[0]}9`;
    stubMl((id) =>
      id === failing
        ? json(400, { error: 'bad_request' })
        : json(200, { content: [{ id: 'MLC777', type: 'PRODUCT', position: 1 }] })
    );

    const res = await prospectRoute(request());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.fuente_ml.destacados).toEqual({ consultas: 7, fallidas: 1, por_estado: { '400': 1 }, codigo_ml: 'bad_request' });
    expect(body.errores_ml).toEqual({ '/highlights/MLC/category/:id': 1 });
  });

  it('una corrida de prueba (?dry=1) dice lo mismo, sin bitácora, correo ni healthcheck', async () => {
    stubMl(() => json(403, { status: 403, code: BLOCK_CODE }));

    const res = await prospectRoute(request('?dry=1'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, dry_run: true, digest: { ok: true, skipped: 'dry_run' } });
    expect(body.fuente_ml.problema.tipo).toBe('bloqueo');
    expect(finish).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(ping).toHaveBeenCalledWith(undefined, false);
  });
});
