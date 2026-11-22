import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverDomains,
  getHighlightedProducts,
  getSellers,
  getSubcategories,
  getTrendKeywords,
  mlErrorsSince,
  searchCatalogProducts,
} from '@/lib/ml-catalog';

/*
 * Consultas de catálogo a Mercado Libre que alimentan la prospección. Lo que
 * importa: que una falla de ML no se confunda con "no hay nada". Desde el
 * 14-10-2026 ML responde 403 a la lista de más vendidos y la prospección lo
 * tomó por días como categorías sin destacados. Nunca hay red: fetch es falso.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Lo que responde ML a /highlights desde el 14-10-2026 (medido el 17-10). */
const BLOCKED = {
  blocked_by: 'PolicyAgent',
  message: 'At least one policy returned UNAUTHORIZED.',
  status: 403,
  code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('getHighlightedProducts', () => {
  it('un 403 de ML es un error con su motivo, no una lista vacía', async () => {
    const fetchMock = vi.fn(async () => json(403, BLOCKED));
    vi.stubGlobal('fetch', fetchMock);

    expect(await getHighlightedProducts('MLC1055', 'tok')).toEqual({
      status: 'error',
      failure: { status: 403, code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' },
    });
    // Un bloqueo no se arregla insistiendo: una sola llamada.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un 404 es una categoría sin destacados', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { message: 'not found' })));
    expect(await getHighlightedProducts('MLC1055', 'tok')).toEqual({ status: 'ok', items: [] });
  });

  it('devuelve los productos con su posición y deja fuera lo que no es producto', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, {
        content: [
          { id: 'MLC1', type: 'PRODUCT', position: 1 },
          { id: 'MLC2', type: 'ITEM', position: 2 },
          { id: 'MLC3', type: 'PRODUCT' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await getHighlightedProducts('MLC1055', 'tok')).toEqual({
      status: 'ok',
      // Sin posición, vale el orden de la lista.
      items: [
        { id: 'MLC1', position: 1 },
        { id: 'MLC3', position: 3 },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadolibre.com/highlights/MLC/category/MLC1055');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('un error sin cuerpo legible queda con su código HTTP y sin código de ML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad request</html>', { status: 400 })));
    expect(await getHighlightedProducts('MLC1055', 'tok')).toEqual({
      status: 'error',
      failure: { status: 400, code: null },
    });
  });

  it('un 429 se reintenta una vez y, si pasa, cuenta como respuesta', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: 'too_many_requests' }))
      .mockResolvedValueOnce(json(200, { content: [{ id: 'MLC1', type: 'PRODUCT', position: 1 }] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = getHighlightedProducts('MLC1055', 'tok');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ status: 'ok', items: [{ id: 'MLC1', position: 1 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si la red falla dos veces, el error dice que no hubo respuesta', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = getHighlightedProducts('MLC1055', 'tok');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toEqual({ status: 'error', failure: { status: null, code: null } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getSubcategories', () => {
  it('devuelve las hijas, sin falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, { id: 'MLC1051', children_categories: [{ id: 'MLC1055' }, { id: 'MLC3813' }] }))
    );
    expect(await getSubcategories('MLC1051', 'tok')).toEqual({ ids: ['MLC1055', 'MLC3813'], failure: null });
  });

  it('una categoría sin hijas sirve de fuente por sí misma', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { id: 'MLC1055', children_categories: [] })));
    expect(await getSubcategories('MLC1055', 'tok')).toEqual({ ids: ['MLC1055'], failure: null });
  });

  it('si ML no responde, sigue con la misma categoría pero deja la falla a la vista', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, BLOCKED)));
    expect(await getSubcategories('MLC1051', 'tok')).toEqual({
      ids: ['MLC1051'],
      failure: { status: 403, code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' },
    });
  });
});

// ---------------------------------------------------------------------------
// Lo más buscado y el buscador del catálogo (la fuente desde el bloqueo)
// ---------------------------------------------------------------------------

describe('getTrendKeywords', () => {
  it('devuelve las búsquedas en el orden de ML, sin vacías', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, [
        { keyword: 'motorola', url: 'https://listado.mercadolibre.cl/motorola' },
        { keyword: ' s26 ', url: 'x' },
        { keyword: '' },
        { url: 'sin palabra' },
      ])
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await getTrendKeywords('MLC1055', 'tok')).toEqual({ status: 'ok', items: ['motorola', 's26'] });
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.mercadolibre.com/trends/MLC/MLC1055');
  });

  it('una categoría sin tendencias (404) es una lista vacía; un 403 es un error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(404, { message: 'not found' })));
    expect(await getTrendKeywords('MLC439912', 'tok')).toEqual({ status: 'ok', items: [] });
    vi.stubGlobal('fetch', vi.fn(async () => json(403, BLOCKED)));
    expect(await getTrendKeywords('MLC1055', 'tok')).toEqual({
      status: 'error',
      failure: { status: 403, code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' },
    });
  });
});

describe('discoverDomains', () => {
  it('devuelve los tipos de producto de la búsqueda, sin repetir', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, [
        { domain_id: 'MLC-AIR_FRYERS', category_id: 'MLC456045' },
        { domain_id: 'MLC-AIR_FRYERS', category_id: 'MLC1' },
        { domain_id: 'MLC-OIL_DEEP_FRYERS', category_id: 'MLC162500' },
      ])
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await discoverDomains('freidora de aire', 'tok')).toEqual({
      status: 'ok',
      items: ['MLC-AIR_FRYERS', 'MLC-OIL_DEEP_FRYERS'],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.mercadolibre.com/sites/MLC/domain_discovery/search?limit=3&q=freidora%20de%20aire'
    );
  });
});

describe('searchCatalogProducts', () => {
  it('busca fichas activas dentro del tipo y dice cuáles pueden tener ganador', async () => {
    const catalog = { listing_strategy: 'catalog_required' };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, {
        paging: { total: 496 },
        results: [
          {
            id: 'MLC1',
            domain_id: 'MLC-CELLPHONES',
            name: 'Samsung S26 Ultra',
            pictures: [{ url: 'https://http2.mlstatic.com/D_s26.jpg' }],
            quality_type: 'COMPLETE',
            settings: catalog,
          },
          { id: '', domain_id: 'MLC-CELLPHONES' },
          { id: 'MLC2', name: 'sin tipo ni datos de caja de compra' },
          // Las dos que nunca tienen ganador: a medio armar, o fuera del catálogo obligatorio.
          { id: 'MLC3', domain_id: 'MLC-CELLPHONES', quality_type: 'PRIMITIVE', settings: catalog },
          { id: 'MLC4', domain_id: 'MLC-CELLPHONES', quality_type: 'COMPLETE', settings: { listing_strategy: 'open' } },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await searchCatalogProducts('samsung s26 ultra', 'MLC-CELLPHONES', 'tok', 5)).toEqual({
      status: 'ok',
      items: [
        {
          id: 'MLC1',
          domainId: 'MLC-CELLPHONES',
          name: 'Samsung S26 Ultra',
          picture: 'https://http2.mlstatic.com/D_s26.jpg',
          buyBox: true,
        },
        { id: 'MLC2', domainId: null, name: 'sin tipo ni datos de caja de compra', picture: null, buyBox: true },
        { id: 'MLC3', domainId: 'MLC-CELLPHONES', name: null, picture: null, buyBox: false },
        { id: 'MLC4', domainId: 'MLC-CELLPHONES', name: null, picture: null, buyBox: false },
      ],
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/products/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'active',
      site_id: 'MLC',
      q: 'samsung s26 ultra',
      domain_id: 'MLC-CELLPHONES',
      limit: '5',
    });
  });
});

describe('getSellers', () => {
  /** Lo que responde ML al azar en /users?ids= (medido el 22-11-2026). */
  const DEPRECATED = {
    message: 'Resource deprecated - client no longer allowed to consume this resource',
    error: 'ResourceDeprecated',
    status: 403,
  };
  const user = (id: number, level = '5_green') => ({
    id,
    nickname: `VENDEDOR${id}`,
    seller_reputation: { level_id: level, transactions: { total: id * 10 } },
  });
  const idsOf = (url: string) => (new URL(url).searchParams.get('ids') ?? '').split(',').map(Number);

  it('pide los vendedores en lotes de 20, sin repetir', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      json(200, idsOf(url).map((id) => ({ code: 200, body: user(id) })))
    );
    vi.stubGlobal('fetch', fetchMock);
    const ids = Array.from({ length: 45 }, (_, i) => i + 1);
    const sellers = await getSellers([...ids, 1, 2, 3], 'tok');

    expect(sellers.size).toBe(45);
    expect(sellers.get(7)).toEqual({ id: 7, nickname: 'VENDEDOR7', levelId: '5_green', salesCount: 70 });
    expect(fetchMock.mock.calls.map(([url]) => idsOf(url).length).sort((a, b) => a - b)).toEqual([5, 20, 20]);
  });

  it('si un lote responde 403, consulta sus vendedores de a uno', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      const { pathname } = new URL(url);
      const single = /^\/users\/(\d+)$/.exec(pathname);
      if (single) return json(200, user(Number(single[1]), Number(single[1]) === 3 ? '2_orange' : '5_green'));
      // El lote que trae al vendedor 1 es el que falla.
      if (idsOf(url).includes(1)) return json(403, DEPRECATED);
      return json(200, idsOf(url).map((id) => ({ code: 200, body: user(id) })));
    });
    vi.stubGlobal('fetch', fetchMock);
    const thisRun = mlErrorsSince();
    const sellers = await getSellers(Array.from({ length: 25 }, (_, i) => i + 1), 'tok');

    // Los 20 del lote caído salieron de a uno; los otros 5, de su lote.
    expect(sellers.size).toBe(25);
    expect(sellers.get(1)?.levelId).toBe('5_green');
    expect(sellers.get(3)?.levelId).toBe('2_orange');
    expect(sellers.get(25)?.salesCount).toBe(250);
    const paths = fetchMock.mock.calls.map(([url]) => new URL(url).pathname);
    expect(paths.filter((p) => p === '/users')).toHaveLength(2);
    expect(paths.filter((p) => /^\/users\/\d+$/.test(p))).toHaveLength(20);
    // El 403 no se reintenta (no es pasajero) y queda contado.
    expect(thisRun()).toEqual({ '/users': 1 });
  });

  it('un vendedor que tampoco responde de a uno queda fuera, sin botar a los demás', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, _init?: RequestInit) => {
        const single = /^\/users\/(\d+)$/.exec(new URL(url).pathname);
        if (!single) return json(403, DEPRECATED);
        return single[1] === '2' ? json(404, { message: 'not found' }) : json(200, user(Number(single[1])));
      })
    );
    const sellers = await getSellers([1, 2, 3], 'tok');
    expect([...sellers.keys()].sort()).toEqual([1, 3]);
  });

  it('en un lote que responde, una entrada sin datos se salta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(200, [{ code: 200, body: user(1) }, { code: 404, body: { message: 'no existe' } }]))
    );
    const sellers = await getSellers([1, 2], 'tok');
    expect([...sellers.keys()]).toEqual([1]);
  });
});

describe('mlErrorsSince', () => {
  it('cuenta por endpoint solo los errores desde que se llamó', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(403, BLOCKED)));
    await getHighlightedProducts('MLC1', 'tok'); // antes: no cuenta

    const thisRun = mlErrorsSince();
    expect(thisRun()).toEqual({});
    await getHighlightedProducts('MLC2', 'tok');
    await getHighlightedProducts('MLC3', 'tok');
    await getSubcategories('MLC4', 'tok');

    expect(thisRun()).toEqual({ '/highlights/MLC/category/:id': 2, '/categories/:id': 1 });
  });
});
