import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * "Agregar desde Mercado Libre": el dueño pega el link de un producto que vio
 * en ML y el sitio lo revisa como la prospección (ganador, vendedor verde,
 * categoría, comisión), arma el link de afiliado y lo deja en la cola o lo
 * publica. Primero la revisión (lib/manual-add) y después las acciones del
 * admin. Nunca hay red: ML, la base y la aprobación son de mentira.
 */

const mocks = vi.hoisted(() => ({
  admin: null as unknown,
  approveCandidate: async (_id: string, _url: string) =>
    ({ ok: true, outcome: 'publicado', slug: 'parlante-jbl-charge-5-negro' }) as
      | { ok: true; outcome: 'publicado' | 'en_pausa'; reason?: string; slug: string }
      | { ok: false; error: string },
  logAdminEvent: async (_admin: unknown, _event: Record<string, unknown>) => {},
  directLinksUsable: async () => true,
}));

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => mocks.admin }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: async () => 'cristopher' }));
vi.mock('@/lib/admin-audit', () => ({
  logAdminEvent: (...args: Parameters<typeof mocks.logAdminEvent>) => mocks.logAdminEvent(...args),
}));
vi.mock('@/lib/admin-settings', () => ({ directLinksUsable: () => mocks.directLinksUsable() }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({
  readAffiliateSettings: async () => ({ word: 'comparatech', tool: '15629069', directLinks: true }),
}));
vi.mock('@/lib/ml-enrichment', async (original) => ({
  ...(await original<typeof import('@/lib/ml-enrichment')>()),
  getMlToken: async () => 'tok',
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/app/admin/candidatos/actions', () => ({
  approveCandidate: (...args: Parameters<typeof mocks.approveCandidate>) => mocks.approveCandidate(...args),
}));

import {
  NOT_ML_MESSAGE,
  SHORT_LINK_MESSAGE,
  inspectCatalogProduct,
  reviewInput,
  saveManualCandidate,
  type ReviewContext,
} from '@/lib/manual-add';
import { addFromMl, reviewMlLinks } from '@/app/admin/candidatos/agregar/actions';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ID = 'MLC45203390';
const PRODUCT = {
  id: ID,
  name: 'Parlante JBL Charge 5 Negro',
  domain_id: 'MLC-SPEAKERS',
  parent_id: 'MLC-FAMILIA-JBL',
  pictures: [{ url: 'https://http2.mlstatic.com/D_jbl.jpg' }],
  attributes: [{ id: 'BRAND', name: 'Marca', value_name: 'JBL' }],
};

interface MlWorld {
  product?: unknown;
  productStatus?: number;
  winners?: unknown[] | null;
  sellerLevel?: string;
  domains?: string[];
  searchResults?: unknown[];
  searchStatus?: number;
}

/** ML de mentira: una ficha, su ganador, la raíz de su categoría y su vendedor. */
function stubMl(world: MlWorld = {}) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input);
    const path = url.pathname;
    if (path === '/sites/MLC/domain_discovery/search') return json(200, (world.domains ?? []).map((d) => ({ domain_id: d })));
    if (path === '/products/search') {
      const status = world.searchStatus ?? 200;
      return status === 200 ? json(200, { results: world.searchResults ?? [] }) : json(status, { error: 'forbidden' });
    }
    if (/^\/products\/[^/]+\/items$/.test(path)) {
      if (world.winners === null) return json(404, { message: 'No winners found' });
      return json(200, {
        paging: { total: 1 },
        results: world.winners ?? [
          {
            item_id: 'MLC1618906261',
            seller_id: 42,
            price: 129_990,
            original_price: 169_990,
            category_id: 'MLC3697',
            shipping: { free_shipping: true, logistic_type: 'fulfillment' },
            official_store_id: 77,
          },
        ],
      });
    }
    if (/^\/products\/[^/]+$/.test(path)) {
      const status = world.productStatus ?? 200;
      return status === 200 ? json(200, world.product ?? PRODUCT) : json(status, { code: 'x', message: 'x' });
    }
    if (/^\/categories\//.test(path)) return json(200, { path_from_root: [{ id: 'MLC1000' }, { id: 'MLC3697' }] });
    if (path === '/users') {
      return json(200, [
        {
          code: 200,
          body: { id: 42, nickname: 'JBL_TIENDA', seller_reputation: { level_id: world.sellerLevel ?? '5_green', transactions: { total: 9000 } } },
        },
      ]);
    }
    throw new Error(`Consulta inesperada a ${path}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

type Res = { data?: unknown; error?: { code?: string; message: string } | null };
interface Query {
  table: string;
  op: 'select' | 'upsert';
  columns: string;
  filters: string[];
  payload?: Record<string, unknown>;
}

/** La base de mentira: cada consulta la responde `handler`; lo que se guarda queda anotado. */
function fakeAdmin(handler: (q: Query) => Res = () => ({ data: null })) {
  const saved: Query[] = [];
  const client = {
    from(table: string) {
      const q: Query = { table, op: 'select', columns: '', filters: [] };
      const builder: Record<string, unknown> = {};
      for (const m of ['eq', 'neq', 'is', 'in', 'limit', 'order']) {
        builder[m] = (...args: unknown[]) => {
          q.filters.push(`${m}:${JSON.stringify(args)}`);
          return builder;
        };
      }
      builder.select = (columns: string) => {
        if (q.op === 'select') q.columns = columns;
        return builder;
      };
      builder.upsert = (payload: Record<string, unknown>) => {
        q.op = 'upsert';
        q.payload = payload;
        saved.push(q);
        return builder;
      };
      const run = () => Promise.resolve({ data: null, error: null, ...handler(q) });
      builder.maybeSingle = run;
      builder.single = run;
      builder.then = (resolve: (r: Res) => unknown, reject: (e: unknown) => unknown) => run().then(resolve, reject);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, saved };
}

function context(over: Partial<ReviewContext> = {}): ReviewContext {
  return {
    admin: fakeAdmin().client,
    token: 'tok',
    affiliate: { word: 'comparatech', tool: '15629069' },
    minCommission: 700,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// La revisión
// ---------------------------------------------------------------------------

describe('inspectCatalogProduct', () => {
  it('un producto que se puede agregar: precio del ganador, vendedor verde, comisión y link directo', async () => {
    stubMl();
    const result = await inspectCatalogProduct(ID, `https://www.mercadolibre.cl/p/${ID}`, context());
    if ('notFound' in result) throw new Error('no debía faltar');

    expect(result.preview).toMatchObject({
      kind: 'ficha',
      id: ID,
      name: 'Parlante JBL Charge 5 Negro',
      imageUrl: 'https://http2.mlstatic.com/D_jbl.jpg',
      price: 129_990,
      originalPrice: 169_990,
      discountPct: 24,
      category: 'audio',
      sellerNickname: 'JBL_TIENDA',
      commissionAssumed: false,
      affiliateUrl: `https://www.mercadolibre.cl/p/${ID}?matt_word=comparatech&matt_tool=15629069`,
      state: 'listo',
      warnings: [],
    });
    expect(result.preview.commission).toBeGreaterThan(700);
    expect(result.candidate).toMatchObject({
      ml_product_id: ID,
      ml_family_id: 'MLC-FAMILIA-JBL',
      ml_domain_id: 'MLC-SPEAKERS',
      ml_item_id: 'MLC1618906261',
      brand: 'JBL',
      category: 'audio',
      price: 129_990,
      original_price: 169_990,
      seller_id: 42,
      seller_reputation: 'verde',
      source: 'manual',
      status: 'pending_review',
      reviewed_at: null,
      reject_reason: null,
      highlight_position: null,
      ml_root_category: 'MLC1000',
      is_full: true,
      official_store: true,
    });
  });

  it('si ya está en el sitio lo dice y no ofrece agregarlo', async () => {
    stubMl();
    const { client } = fakeAdmin((q) =>
      q.table === 'products' && q.columns.includes('slug')
        ? { data: { slug: 'parlante-jbl', name: 'Parlante JBL', is_active: true, is_hidden: true, deleted_at: null } }
        : { data: null }
    );
    const result = await inspectCatalogProduct(ID, ID, context({ admin: client }));
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview).toMatchObject({ state: 'en_sitio', siteSlug: 'parlante-jbl', warnings: ['Está oculto: revísalo en Productos.'] });
    expect(result.candidate).toBeNull();
  });

  it('avisa lo que conviene saber sin impedirlo: otro color publicado, descartado antes, comisión baja, sin link directo', async () => {
    stubMl({
      winners: [{ item_id: 'MLC1', seller_id: 42, price: 5_000, original_price: null, category_id: 'MLC3697' }],
    });
    const { client } = fakeAdmin((q) => {
      if (q.table === 'products' && q.columns === 'name') return { data: [{ name: 'Parlante JBL Charge 5 Azul' }] };
      if (q.table === 'product_candidates') return { data: { id: 'c1', status: 'rejected' } };
      return { data: null };
    });
    const result = await inspectCatalogProduct(ID, ID, context({ admin: client, affiliate: null }));
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview.state).toBe('listo');
    expect(result.preview.affiliateUrl).toBeNull();
    expect(result.preview.warnings).toEqual([
      'Deja poca comisión: ~$350 por venta.',
      'Ya publicas otro color de este modelo (Parlante JBL Charge 5 Azul).',
      'Lo habías descartado antes: agregarlo lo vuelve a la cola.',
      'Los links directos no están confirmados: para publicarlo hay que pegar su link meli.la en Candidatos.',
    ]);
  });

  it('si ya espera en la cola, lo dice (y se puede publicar igual)', async () => {
    stubMl();
    const { client } = fakeAdmin((q) =>
      q.table === 'product_candidates' ? { data: { id: 'c1', status: 'pending_review' } } : { data: null }
    );
    const result = await inspectCatalogProduct(ID, ID, context({ admin: client }));
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview.state).toBe('en_cola');
    expect(result.candidate).not.toBeNull();
  });

  it('no se puede si nadie lo vende, si el vendedor no es verde o si el sitio no tiene su categoría', async () => {
    stubMl({ winners: null });
    let result = await inspectCatalogProduct(ID, ID, context());
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview).toMatchObject({ state: 'no_se_puede' });
    expect(result.preview.reason).toContain('sin ganador');
    expect(result.candidate).toBeNull();

    stubMl({ sellerLevel: '3_yellow' });
    result = await inspectCatalogProduct(ID, ID, context());
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview.reason).toContain('reputación verde');
    expect(result.preview.price).toBe(129_990);

    stubMl({ product: { ...PRODUCT, domain_id: 'MLC-BOOKS' } });
    result = await inspectCatalogProduct(ID, ID, context());
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview.reason).toBe('El sitio no tiene una categoría para este tipo de producto (MLC-BOOKS).');
  });

  it('distingue "esa ficha no existe" de "ML no respondió"', async () => {
    stubMl({ productStatus: 404 });
    expect(await inspectCatalogProduct(ID, ID, context())).toEqual({ notFound: true });

    stubMl({ productStatus: 403 });
    const result = await inspectCatalogProduct(ID, ID, context());
    if ('notFound' in result) throw new Error('no debía faltar');
    expect(result.preview).toMatchObject({ state: 'no_se_puede', reason: 'Mercado Libre no respondió. Intenta de nuevo en un rato.' });
  });
});

describe('reviewInput', () => {
  it('no abre los links cortos y explica qué pegar', async () => {
    const fetchMock = stubMl();
    expect(await reviewInput({ kind: 'corto', raw: 'https://meli.la/abc' }, context())).toEqual({
      kind: 'aviso',
      raw: 'https://meli.la/abc',
      message: SHORT_LINK_MESSAGE,
    });
    expect(await reviewInput({ kind: 'otro', raw: 'https://otro.cl' }, context())).toMatchObject({ message: NOT_ML_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a una publicación le sugiere fichas del catálogo parecidas a su título', async () => {
    stubMl({
      domains: ['MLC-SPEAKERS'],
      searchResults: [
        { id: 'MLC1', name: 'Parlante JBL Charge 5', pictures: [{ url: 'https://http2.mlstatic.com/D_1.jpg' }] },
        { id: 'MLC2', name: 'A medio armar', quality_type: 'PRIMITIVE' },
        { id: 'MLC3', name: 'Parlante JBL Charge 5 Azul' },
      ],
    });
    const item = await reviewInput(
      { kind: 'publicacion', id: 'MLC1618906261', words: 'parlante jbl charge 5', raw: 'x' },
      context()
    );
    expect(item).toMatchObject({
      kind: 'publicacion',
      suggestions: [
        { id: 'MLC1', name: 'Parlante JBL Charge 5', imageUrl: 'https://http2.mlstatic.com/D_1.jpg' },
        { id: 'MLC3', name: 'Parlante JBL Charge 5 Azul', imageUrl: null },
      ],
    });
    expect((item as { message: string }).message).toContain('¿Es alguna de estas fichas?');
  });

  it('si ML no responde la búsqueda, lo dice en vez de dar a entender que no hay parecidas', async () => {
    stubMl({ domains: ['MLC-SPEAKERS'], searchStatus: 403 });
    const item = await reviewInput({ kind: 'publicacion', id: 'MLC1', words: 'parlante jbl', raw: 'x' }, context());
    expect(item).toMatchObject({ kind: 'publicacion', suggestions: [] });
    expect((item as { message: string }).message).toContain('No pude buscar fichas parecidas (Mercado Libre no respondió).');

    // Un tipo que el sitio no publica: no hay qué sugerir, y no es una falla.
    stubMl({ domains: ['MLC-BOOKS'] });
    const books = await reviewInput({ kind: 'publicacion', id: 'MLC2', words: 'libro jbl', raw: 'y' }, context());
    expect((books as { message: string }).message).not.toContain('no respondió');
  });

  it('un código que no es de una ficha se trata como publicación', async () => {
    stubMl({ productStatus: 404 });
    const item = await reviewInput({ kind: 'codigo', id: 'MLC1618906261', raw: 'MLC1618906261' }, context());
    expect(item).toMatchObject({ kind: 'publicacion', suggestions: [] });
    expect((item as { message: string }).message).toContain('no es el código de una ficha');
  });
});

describe('saveManualCandidate', () => {
  it('guarda y devuelve el id; sin las migraciones nuevas, guarda sin esas columnas', async () => {
    let attempts = 0;
    const { client, saved } = fakeAdmin((q) => {
      if (q.op !== 'upsert') return { data: null };
      attempts++;
      return attempts === 1 ? { error: { code: 'PGRST204', message: "column 'checked_at' does not exist" } } : { data: { id: 'c9' } };
    });
    const result = await saveManualCandidate(client, { ml_product_id: ID, name: 'x', checked_at: 'hoy', price: 1 });
    expect(result).toEqual({ ok: true, id: 'c9' });
    expect(saved).toHaveLength(2);
    expect(saved[1].payload).toEqual({ ml_product_id: ID, name: 'x', price: 1 });
  });
});

// ---------------------------------------------------------------------------
// Las acciones del admin
// ---------------------------------------------------------------------------

describe('acciones de /admin/candidatos/agregar', () => {
  let logged: Record<string, unknown>[];
  let approvals: [string, string][];

  beforeEach(() => {
    logged = [];
    approvals = [];
    mocks.logAdminEvent = async (_admin, event) => {
      logged.push(event);
    };
    mocks.approveCandidate = async (id, url) => {
      approvals.push([id, url]);
      return { ok: true, outcome: 'publicado', slug: 'parlante-jbl-charge-5-negro' };
    };
    mocks.directLinksUsable = async () => true;
  });

  it('revisar no guarda nada y revisa hasta 10 por tanda', async () => {
    stubMl();
    const { client, saved } = fakeAdmin();
    mocks.admin = client;
    const codes = Array.from({ length: 12 }, (_, i) => `MLC4520339${i}`).join(' ');
    const result = await reviewMlLinks(codes);
    if (!result.ok) throw new Error(result.error);
    expect(result.items).toHaveLength(10);
    expect(result.omitted).toBe(2);
    expect(saved).toEqual([]);

    expect(await reviewMlLinks('nada que ver')).toEqual({
      ok: false,
      error: 'No encontré links ni códigos de Mercado Libre en lo que pegaste.',
    });
  });

  it('agregar a la cola guarda el candidato revisado en el servidor y lo anota en Actividad', async () => {
    stubMl();
    const { client, saved } = fakeAdmin((q) => (q.op === 'upsert' ? { data: { id: 'cand-1' } } : { data: null }));
    mocks.admin = client;

    expect(await addFromMl(` ${ID.toLowerCase()} `, false)).toEqual({ ok: true, outcome: 'en_cola' });
    expect(saved).toHaveLength(1);
    expect(saved[0].payload).toMatchObject({ ml_product_id: ID, source: 'manual', status: 'pending_review', price: 129_990 });
    expect(logged).toEqual([
      {
        actor: 'cristopher',
        action: 'agregar_desde_ml',
        target: 'cand-1',
        after: { ml_product_id: ID, name: 'Parlante JBL Charge 5 Negro', price: 129_990, seller: 'JBL_TIENDA', publish: false },
      },
    ]);
    expect(approvals).toEqual([]);
  });

  it('publicar ahora aprueba el candidato con el link directo (la misma aprobación de la cola)', async () => {
    stubMl();
    const { client } = fakeAdmin((q) => (q.op === 'upsert' ? { data: { id: 'cand-1' } } : { data: null }));
    mocks.admin = client;

    expect(await addFromMl(ID, true)).toEqual({ ok: true, outcome: 'publicado', slug: 'parlante-jbl-charge-5-negro' });
    expect(approvals).toEqual([['cand-1', '']]);
  });

  it('si no se puede publicar, queda en la cola y dice por qué', async () => {
    stubMl();
    const { client } = fakeAdmin((q) => (q.op === 'upsert' ? { data: { id: 'cand-1' } } : { data: null }));
    mocks.admin = client;
    mocks.approveCandidate = async () => ({ ok: false, error: 'Pega el link meli.la' });

    expect(await addFromMl(ID, true)).toEqual({ ok: true, outcome: 'en_cola', notPublished: 'Pega el link meli.la' });
  });

  it('no guarda lo que no pasa la revisión, ni lo que ya está en el sitio, ni un código raro', async () => {
    stubMl({ sellerLevel: '2_orange' });
    const { client, saved } = fakeAdmin();
    mocks.admin = client;
    const notGreen = await addFromMl(ID, false);
    expect(notGreen.ok).toBe(false);
    expect(saved).toEqual([]);

    stubMl();
    mocks.admin = fakeAdmin((q) =>
      q.table === 'products' && q.columns.includes('slug')
        ? { data: { slug: 'x', name: 'x', is_active: true, is_hidden: false, deleted_at: null } }
        : { data: null }
    ).client;
    expect(await addFromMl(ID, true)).toEqual({ ok: false, error: 'Este producto ya está en el sitio.' });

    expect(await addFromMl('https://meli.la/abc', false)).toEqual({
      ok: false,
      error: 'Ese no es un código de ficha de Mercado Libre (MLC…).',
    });
    expect(logged).toEqual([]);
  });
});
