import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAGE_SIZE,
  buildCandidateView,
  candidateCommission,
  discountPct,
  facetCounts,
  fetchAllPages,
  groupByFamily,
  isRejectReason,
  matchesFilters,
  paginate,
  parseCandidateQuery,
  rejectReasonLabel,
  sortCandidates,
  startOfTodayChile,
  type CandidateRow,
} from '@/lib/candidate-sort';

// 4 de octubre de 2026, 15:00 en Chile (UTC-3 en horario de verano).
const NOW = new Date('2026-10-04T18:00:00Z');

let seq = 0;
function row(over: Partial<CandidateRow> = {}): CandidateRow {
  seq += 1;
  return {
    id: `c${String(seq).padStart(5, '0')}`,
    ml_product_id: `MLC${1000 + seq}`,
    ml_family_id: null,
    name: `Producto ${seq}`,
    brand: 'Marca',
    category: 'audio',
    price: 50_000,
    original_price: null,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-MLA1_1-F.jpg',
    seller_nickname: 'VENDEDOR',
    seller_reputation: 'verde',
    seller_sales_count: 100,
    prospected_at: '2026-10-01T12:00:00Z',
    ...over,
  };
}

describe('parseCandidateQuery', () => {
  it('lee filtros válidos y descarta los inventados', () => {
    const q = parseCandidateQuery({ cat: 'audio', precio: 'sobre300', desc: '99', ingreso: 'hoy', orden: 'xx', p: '3' });
    expect(q.filters).toEqual({ cat: 'audio', precio: 'sobre300', desc: undefined, ingreso: 'hoy', q: undefined });
    expect(q.sort).toBe('valor');
    expect(q.page).toBe(3);
  });

  it('una página inválida vuelve a la 1', () => {
    expect(parseCandidateQuery({ p: '-2' }).page).toBe(1);
    expect(parseCandidateQuery({ p: 'abc' }).page).toBe(1);
  });
});

describe('discountPct y candidateCommission', () => {
  it('calcula el descuento solo si el precio de antes es mayor', () => {
    expect(discountPct({ price: 68_000, original_price: 100_000 })).toBe(32);
    expect(discountPct({ price: 100_000, original_price: 90_000 })).toBe(0);
    expect(discountPct({ price: 100_000, original_price: null })).toBe(0);
  });

  it('sin raíz asume 4%', () => {
    expect(candidateCommission({ price: 72_500, ml_root_category: null })).toEqual({
      amount: 2900,
      rate: 0.04,
      assumed: true,
    });
    expect(candidateCommission({ price: 50_000, ml_root_category: 'MLC1574' })).toEqual({
      amount: 4000,
      rate: 0.08,
      assumed: false,
    });
  });
});

describe('filtros', () => {
  it('precio, descuento, categoría y búsqueda sin tildes', () => {
    const r = row({ name: 'Audífonos Sony WH-1000', brand: 'Sony', price: 150_000, original_price: 200_000 });
    expect(matchesFilters(r, { precio: '100a300' }, NOW)).toBe(true);
    expect(matchesFilters(r, { precio: 'hasta20' }, NOW)).toBe(false);
    expect(matchesFilters(r, { desc: '20' }, NOW)).toBe(true);
    expect(matchesFilters(r, { desc: '30' }, NOW)).toBe(false);
    expect(matchesFilters(r, { cat: 'gaming' }, NOW)).toBe(false);
    expect(matchesFilters(r, { q: 'audifonos sony' }, NOW)).toBe(true);
    expect(matchesFilters(r, { q: r.ml_product_id.toLowerCase() }, NOW)).toBe(true);
    expect(matchesFilters(r, { q: 'samsung' }, NOW)).toBe(false);
  });

  it('ingreso: hoy usa la medianoche de Chile', () => {
    const today = row({ prospected_at: '2026-10-04T04:00:00Z' }); // 01:00 en Chile
    const yesterdayChile = row({ prospected_at: '2026-10-04T02:00:00Z' }); // 23:00 del 3 en Chile
    const old = row({ prospected_at: '2026-09-20T12:00:00Z' });
    expect(matchesFilters(today, { ingreso: 'hoy' }, NOW)).toBe(true);
    expect(matchesFilters(yesterdayChile, { ingreso: 'hoy' }, NOW)).toBe(false);
    expect(matchesFilters(yesterdayChile, { ingreso: '3d' }, NOW)).toBe(true);
    expect(matchesFilters(old, { ingreso: 'antiguos' }, NOW)).toBe(true);
    expect(matchesFilters(old, { ingreso: '3d' }, NOW)).toBe(false);
  });

  it('startOfTodayChile devuelve las 00:00 de Santiago', () => {
    expect(startOfTodayChile(NOW).toISOString()).toBe('2026-10-04T03:00:00.000Z');
  });
});

describe('groupByFamily', () => {
  it('el más barato representa a la familia y lleva a los demás', () => {
    const negro = row({ ml_family_id: 'F1', price: 30_000, name: 'Negro' });
    const blanco = row({ ml_family_id: 'F1', price: 25_000, name: 'Blanco' });
    const azul = row({ ml_family_id: 'F1', price: 28_000, name: 'Azul' });
    const solo = row();
    const groups = groupByFamily([negro, blanco, azul, solo]);
    expect(groups).toHaveLength(2);
    const fam = groups.find((g) => g.ml_family_id === 'F1')!;
    expect(fam.name).toBe('Blanco');
    expect(fam.siblings.map((s) => s.name)).toEqual(['Azul', 'Negro']);
  });
});

describe('sortCandidates', () => {
  it("'valor' pone primero la mayor comisión estimada", () => {
    const barato = row({ price: 20_000 });
    const caro = row({ price: 400_000 });
    const hogar = row({ price: 150_000, ml_root_category: 'MLC1574' }); // 8% = 12.000
    const tecno = row({ price: 250_000, ml_root_category: 'MLC1000' }); // 4% = 10.000
    const sorted = sortCandidates([barato, tecno, hogar, caro], 'valor');
    expect(sorted.map((r) => r.id)).toEqual([caro.id, hogar.id, tecno.id, barato.id]);
  });

  it("'valor' desempata por posición en destacados (sin posición al final) y luego por descuento", () => {
    const sinPos = row({ price: 100_000, original_price: 200_000 });
    const top3 = row({ price: 100_000, highlight_position: 3 });
    const top1 = row({ price: 100_000, highlight_position: 1 });
    const conDesc = row({ price: 100_000, original_price: 120_000 });
    const sorted = sortCandidates([sinPos, conDesc, top3, top1], 'valor');
    expect(sorted.map((r) => r.id)).toEqual([top1.id, top3.id, sinPos.id, conDesc.id]);
  });

  it('los demás órdenes', () => {
    const a = row({ price: 10_000, original_price: 20_000, prospected_at: '2026-09-01T00:00:00Z', highlight_position: 5 });
    const b = row({ price: 90_000, original_price: 100_000, prospected_at: '2026-10-03T00:00:00Z', highlight_position: 2 });
    const c = row({ price: 50_000, prospected_at: '2026-10-02T00:00:00Z' });
    expect(sortCandidates([a, b, c], 'descuento').map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(sortCandidates([a, b, c], 'vendidos').map((r) => r.id)).toEqual([b.id, a.id, c.id]);
    expect(sortCandidates([a, b, c], 'nuevos').map((r) => r.id)).toEqual([b.id, c.id, a.id]);
    expect(sortCandidates([a, b, c], 'precio_asc').map((r) => r.id)).toEqual([a.id, c.id, b.id]);
  });
});

describe('paginate', () => {
  it('corta de a 30 y acota la página pedida', () => {
    const items = Array.from({ length: 209 }, (_, i) => i);
    const first = paginate(items, 1);
    expect(first.items).toHaveLength(PAGE_SIZE);
    expect(first.pages).toBe(7);
    const last = paginate(items, 99);
    expect(last.page).toBe(7);
    expect(last.items).toHaveLength(209 - 6 * 30);
    expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
});

describe('cola de 2.500 candidatos', () => {
  const rows: CandidateRow[] = Array.from({ length: 2500 }, (_, i) =>
    row({
      id: `s${String(i).padStart(5, '0')}`,
      // 500 familias de 2 colores (las primeras 1000 filas) y 1500 sueltos.
      ml_family_id: i < 1000 ? `FAM${Math.floor(i / 2)}` : null,
      price: 5_000 + ((i * 7919) % 600_000),
      original_price: i % 3 === 0 ? 5_000 + ((i * 7919) % 600_000) + 20_000 : null,
      // Los colores de un modelo comparten categoría, como en ML.
      category: ['audio', 'gaming', 'computacion'][(i < 1000 ? Math.floor(i / 2) : i) % 3],
      ml_root_category: i % 5 === 0 ? 'MLC1574' : null,
      prospected_at: new Date(NOW.getTime() - (i % 10) * 24 * 3600 * 1000).toISOString(),
    })
  );

  it('fetchAllPages trae todo aunque Supabase corte en 1000', async () => {
    const calls: [number, number][] = [];
    const { rows: fetched, error } = await fetchAllPages<CandidateRow>(async (from, to) => {
      calls.push([from, to]);
      return { data: rows.slice(from, to + 1), error: null };
    });
    expect(error).toBeNull();
    expect(fetched).toHaveLength(2500);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('fetchAllPages devuelve el error del bloque que falló', async () => {
    const res = await fetchAllPages<CandidateRow>(async (from) =>
      from === 0 ? { data: rows.slice(0, 1000), error: null } : { data: null, error: { message: 'boom' } }
    );
    expect(res.error?.message).toBe('boom');
    expect(res.rows).toHaveLength(1000);
  });

  it('pagina de a 30 con conteos correctos y orden por comisión', () => {
    const view = buildCandidateView(rows, { filters: {}, sort: 'valor', page: 1 }, NOW);
    expect(view.totalAll).toBe(2000); // 500 familias + 1500 sueltos
    expect(view.total).toBe(2000);
    expect(view.pages).toBe(Math.ceil(2000 / 30));
    expect(view.items).toHaveLength(30);

    const values = view.items.map((g) => candidateCommission(g).amount);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const best = Math.max(...groupByFamily(rows).map((g) => candidateCommission(g).amount));
    expect(values[0]).toBe(best);

    const last = buildCandidateView(rows, { filters: {}, sort: 'valor', page: view.pages }, NOW);
    expect(last.items).toHaveLength(2000 - (view.pages - 1) * 30);

    // Ninguna fila se repite ni se pierde al recorrer todas las páginas.
    const seen = new Set<string>();
    for (let p = 1; p <= view.pages; p++) {
      for (const g of buildCandidateView(rows, { filters: {}, sort: 'valor', page: p }, NOW).items) seen.add(g.id);
    }
    expect(seen.size).toBe(2000);
  });

  it('los conteos de los chips cuadran con lo que muestra cada filtro', () => {
    const facets = facetCounts(rows, {}, NOW);
    for (const option of facets.cat) {
      const view = buildCandidateView(rows, { filters: { cat: option.value }, sort: 'valor', page: 1 }, NOW);
      expect(view.total).toBe(option.count);
    }
    expect(facets.cat.reduce((s, o) => s + o.count, 0)).toBe(2000);
    for (const option of facets.precio) {
      const view = buildCandidateView(
        rows,
        { filters: { precio: option.value as 'hasta20' }, sort: 'valor', page: 1 },
        NOW
      );
      expect(view.total).toBe(option.count);
    }
  });
});

describe('motivos de rechazo', () => {
  it('reconoce los códigos y rotula los antiguos', () => {
    expect(isRejectReason('muy_barato')).toBe(true);
    expect(isRejectReason('cualquiera')).toBe(false);
    expect(rejectReasonLabel('accesorio')).toBe('Accesorio o repuesto');
    expect(rejectReasonLabel(null)).toBe('Motivo no registrado');
  });
});

// ─── Acciones de la cola (app/admin/candidatos/actions) ────────────────────
//
// Viven acá porque este paquete es dueño de un solo archivo de tests. Se
// simulan la base, la sesión del admin y la apertura de links: nunca se abre
// un meli.la de verdad (cada apertura cuenta como un clic de afiliado).

type Op = {
  table: string;
  method: 'select' | 'update' | 'insert' | 'rpc';
  patch?: Record<string, unknown>;
  cols?: string;
  filters: [string, string, unknown][];
  single?: boolean;
};
type Reply = { data: unknown; error: { code?: string; message: string } | null };

const db = vi.hoisted(() => ({
  ops: [] as Op[],
  handler: (() => ({ data: null, error: null })) as (op: Op) => Reply,
}));

vi.mock('@/lib/supabase/server', () => {
  function from(table: string) {
    const op: Op = { table, method: 'select', filters: [] };
    const run = () => {
      db.ops.push(op);
      return Promise.resolve(db.handler(op));
    };
    const b: Record<string, unknown> = {
      select(cols: string) {
        if (op.method === 'select') op.cols = cols;
        return b;
      },
      update(patch: Record<string, unknown>) {
        op.method = 'update';
        op.patch = patch;
        return b;
      },
      insert(patch: Record<string, unknown>) {
        op.method = 'insert';
        op.patch = patch;
        return b;
      },
      maybeSingle() {
        op.single = true;
        return run();
      },
      then(ok: (r: Reply) => unknown, fail: (e: unknown) => unknown) {
        return run().then(ok, fail);
      },
    };
    for (const f of ['eq', 'in', 'is', 'not', 'gte', 'order', 'range', 'or']) {
      b[f] = (col: string, value: unknown) => {
        op.filters.push([f, col, value]);
        return b;
      };
    }
    return b;
  }
  const client = {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      const op: Op = { table: fn, method: 'rpc', patch: args, filters: [] };
      db.ops.push(op);
      return Promise.resolve(db.handler(op));
    },
  };
  return { getSupabaseAdmin: () => client };
});
// cache() de React solo existe en el runtime de servidor de Next.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: async () => 'cristopher' }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async () => {}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-settings', () => ({ directLinksUsable: vi.fn(async () => false) }));
vi.mock('@/lib/ml-enrichment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ml-enrichment')>()),
  getMlToken: async () => null,
}));
vi.mock('@/lib/affiliate-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/affiliate-link')>()),
  inspectAffiliateLink: vi.fn(),
}));

describe('acciones de candidatos', async () => {
  const actions = await import('@/app/admin/candidatos/actions');
  const { directLinksUsable } = await import('@/lib/admin-settings');
  const { inspectAffiliateLink } = await import('@/lib/affiliate-link');
  const { logAdminEvent } = await import('@/lib/admin-audit');

  const pendingCandidate = {
    id: 'cand-1',
    name: 'Audífonos X',
    ml_product_id: 'MLC111',
    category: 'audio',
    status: 'pending_review',
  };

  beforeEach(() => {
    db.ops = [];
    db.handler = (op) =>
      op.table === 'product_candidates' && op.method === 'select' && op.single
        ? { data: pendingCandidate, error: null }
        : { data: null, error: null };
    vi.mocked(directLinksUsable).mockResolvedValue(false);
    vi.mocked(inspectAffiliateLink).mockReset();
    vi.mocked(logAdminEvent).mockClear();
    process.env.AFFILIATE_WORD = 'comparatech';
    process.env.AFFILIATE_TOOL = '12345';
  });

  const rpcCalls = () => db.ops.filter((o) => o.method === 'rpc');

  it('sin link y con la atribución sin confirmar no aprueba ni guarda un link directo', async () => {
    const res = await actions.approveCandidate('cand-1', '');
    expect(res).toEqual({
      ok: false,
      error: 'Pega el link meli.la: la atribución de los links directos aún no está comprobada.',
    });
    expect(rpcCalls()).toHaveLength(0);
    expect(db.ops.some((o) => o.method === 'update')).toBe(false);
  });

  it('un link directo pegado a mano tampoco pasa mientras la atribución no esté confirmada', async () => {
    const res = await actions.approveCandidate(
      'cand-1',
      'https://www.mercadolibre.cl/p/MLC111?matt_word=comparatech&matt_tool=12345'
    );
    expect(res.ok).toBe(false);
    expect(rpcCalls()).toHaveLength(0);
    expect(inspectAffiliateLink).not.toHaveBeenCalled();
  });

  it('un meli.la de otra cuenta se rechaza', async () => {
    vi.mocked(inspectAffiliateLink).mockResolvedValue({
      ok: true,
      info: { itemId: null, featuredProductId: 'MLC111', mattWord: 'otra_cuenta', mattTool: '999' },
    });
    const res = await actions.approveCandidate('cand-1', 'https://meli.la/abc123');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/otra cuenta de afiliado/);
    expect(rpcCalls()).toHaveLength(0);
  });

  it('un meli.la de la cuenta publica y devuelve el resultado', async () => {
    vi.mocked(inspectAffiliateLink).mockResolvedValue({
      ok: true,
      info: { itemId: 'MLC999', featuredProductId: 'MLC111', mattWord: 'comparatech', mattTool: '12345' },
    });
    const base = db.handler;
    db.handler = (op) => (op.method === 'rpc' ? { data: 'prod-1', error: null } : base(op));
    const res = await actions.approveCandidate('cand-1', 'https://meli.la/abc123');
    // Sin token de ML no hay revisión de precio: queda a la vista y se confirma en la próxima pasada.
    expect(res).toEqual({ ok: true, outcome: 'publicado', reason: 'pendiente', slug: 'audifonos-x' });
    expect(rpcCalls()[0].patch).toMatchObject({ p_affiliate_url: 'https://meli.la/abc123' });
    const reviewed = db.ops.find((o) => o.method === 'update' && o.patch && 'reviewed_by' in o.patch);
    expect(reviewed?.patch).toEqual({ reviewed_by: 'cristopher' });
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({ action: 'aprobar' });
  });

  it('en bloque, sin pegar links y sin atribución confirmada, no aprueba', async () => {
    db.handler = (op) =>
      op.table === 'product_candidates' && op.method === 'select'
        ? { data: [{ ...pendingCandidate, ml_family_id: null, price: 1000 }], error: null }
        : { data: null, error: null };
    const res = await actions.approveBatch(['cand-1'], '');
    expect(res).toEqual({
      ok: false,
      error: 'Pega el link meli.la: la atribución de los links directos aún no está comprobada.',
    });
    expect(rpcCalls()).toHaveLength(0);
  });

  it('en bloque deja solo el color más barato de cada modelo', async () => {
    vi.mocked(directLinksUsable).mockResolvedValue(true);
    const rows = [
      { id: 'a', name: 'Parlante Negro', ml_product_id: 'MLC1', ml_family_id: 'F', category: 'audio', price: 30000, status: 'pending_review' },
      { id: 'b', name: 'Parlante Rojo', ml_product_id: 'MLC2', ml_family_id: 'F', category: 'audio', price: 25000, status: 'pending_review' },
    ];
    db.handler = (op) => {
      if (op.table === 'product_candidates' && op.method === 'select') return { data: rows, error: null };
      if (op.table === 'site_settings') {
        return { data: { value: { word: 'comparatech', tool: '12345', directLinks: true } }, error: null };
      }
      if (op.method === 'rpc') return { data: `prod-${String(op.patch?.candidate_id)}`, error: null };
      return { data: null, error: null };
    };
    const res = await actions.approveBatch(['a', 'b'], '');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items.find((i) => i.id === 'a')).toMatchObject({
      outcome: 'omitido_variante',
      detail: 'Se omitió otro color del mismo modelo',
    });
    expect(res.items.find((i) => i.id === 'b')?.outcome).toBe('pendiente');
    expect(rpcCalls().map((o) => o.patch?.candidate_id)).toEqual(['b']);
  });

  it('rechazar y deshacer devuelve el candidato a la cola', async () => {
    db.handler = (op) =>
      op.method === 'update' ? { data: [{ id: 'cand-1' }], error: null } : { data: null, error: null };

    const rejected = await actions.rejectCandidates(['cand-1'], 'muy_barato');
    expect(rejected).toEqual({ ok: true, ids: ['cand-1'] });
    const rejectOp = db.ops.find((o) => o.method === 'update')!;
    expect(rejectOp.patch).toMatchObject({ status: 'rejected', reject_reason: 'muy_barato', reviewed_by: 'cristopher' });
    expect(rejectOp.filters).toContainEqual(['eq', 'status', 'pending_review']);

    db.ops = [];
    const restored = await actions.restoreCandidates(['cand-1']);
    expect(restored).toEqual({ ok: true, ids: ['cand-1'] });
    const restoreOp = db.ops.find((o) => o.method === 'update')!;
    expect(restoreOp.patch).toEqual({
      status: 'pending_review',
      reviewed_at: null,
      reject_reason: null,
      reviewed_by: null,
    });
    expect(restoreOp.filters).toContainEqual(['in', 'status', ['rejected', 'expired']]);
    const logged = vi.mocked(logAdminEvent).mock.calls.map((c) => c[1].action);
    expect(logged).toEqual(['rechazar', 'recuperar']);
  });

  it('sin la migración 0014, rechazar y recuperar funcionan sin motivo ni autor', async () => {
    db.handler = (op) => {
      if (op.method !== 'update') return { data: null, error: null };
      if (op.patch && ('reject_reason' in op.patch || 'reviewed_by' in op.patch)) {
        return { data: null, error: { code: 'PGRST204', message: "Could not find the 'reject_reason' column" } };
      }
      return { data: [{ id: 'cand-1' }], error: null };
    };
    expect(await actions.rejectCandidates(['cand-1'], 'otro')).toEqual({ ok: true, ids: ['cand-1'] });
    const updates = db.ops.filter((o) => o.method === 'update');
    expect(updates).toHaveLength(2);
    expect(Object.keys(updates[1].patch!).sort()).toEqual(['reviewed_at', 'status']);

    expect(await actions.restoreCandidates(['cand-1'])).toEqual({ ok: true, ids: ['cand-1'] });
  });

  it('un motivo inventado no se guarda', async () => {
    db.handler = (op) =>
      op.method === 'update' ? { data: [{ id: 'cand-1' }], error: null } : { data: null, error: null };
    await actions.rejectCandidates(['cand-1'], 'cualquier cosa');
    expect(db.ops.find((o) => o.method === 'update')?.patch).toMatchObject({ reject_reason: null });
  });
});
