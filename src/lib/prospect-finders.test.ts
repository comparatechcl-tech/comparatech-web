import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROOT_CATEGORIES } from '@/lib/ml-catalog';
import {
  KEYWORDS_PER_CATEGORY,
  findBySearches,
  pickKeywords,
  pickSiteDomain,
  rankSearchResults,
  type Keyword,
} from '@/lib/prospect-finders';

/*
 * La fuente nueva de la prospección: lo más buscado en cada subcategoría,
 * llevado al catálogo de Mercado Libre (la lista de más vendidos está
 * bloqueada desde el 14-10-2026). Nunca hay red: fetch es falso.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

const keyword = (over: Partial<Keyword>): Keyword => ({ keyword: 'x', categoryId: 'MLC1', rank: 0, categoryOrder: 0, ...over });

describe('pickKeywords', () => {
  it('toma primero la más buscada de cada categoría, después las segundas, sin repetir', () => {
    const picked = pickKeywords(
      [
        { categoryId: 'MLC1055', keywords: ['motorola', 's26', 'smartphone', 'iphone 16e'] },
        { categoryId: 'MLC3813', keywords: ['magsafe', 'Motorola', 'belkin'] },
        { categoryId: 'MLC439912', keywords: [] },
      ],
      3
    );
    expect(picked.map((k) => `${k.rank}:${k.keyword}`)).toEqual([
      '0:motorola',
      '0:magsafe',
      '1:s26',
      // "Motorola" ya estaba (sin distinguir mayúsculas).
      '2:smartphone',
      '2:belkin',
    ]);
    expect(picked[1]).toEqual({ keyword: 'magsafe', categoryId: 'MLC3813', rank: 0, categoryOrder: 1 });
  });

  it('con tope, quedan fuera las menos buscadas y no categorías enteras', () => {
    const trends = ['A', 'B', 'C'].map((c) => ({ categoryId: c, keywords: [`${c}1`, `${c}2`, `${c}3`] }));
    expect(pickKeywords(trends, KEYWORDS_PER_CATEGORY, 4).map((k) => k.keyword)).toEqual(['A1', 'B1', 'C1', 'A2']);
  });
});

describe('pickSiteDomain', () => {
  it('elige el primer tipo de producto que el sitio publica', () => {
    expect(pickSiteDomain(['MLC-CELLPHONE_CASES_AND_COVERS', 'MLC-CELLPHONES', 'MLC-HEADPHONES'])).toBe('MLC-CELLPHONES');
    expect(pickSiteDomain(['MLC-BOOKS'])).toBeNull();
    expect(pickSiteDomain([])).toBeNull();
  });
});

describe('rankSearchResults', () => {
  it('primero la primera ficha de cada búsqueda (de la más buscada a la menos), después las segundas', () => {
    const ranked = rankSearchResults([
      { keyword: keyword({ keyword: 'segunda', rank: 1, categoryOrder: 0 }), ids: ['B1', 'B2'] },
      { keyword: keyword({ keyword: 'primera', rank: 0, categoryOrder: 0 }), ids: ['A1', 'A2', 'A3'] },
      { keyword: keyword({ keyword: 'otra categoría', rank: 0, categoryOrder: 1 }), ids: ['C1'] },
    ]);
    expect(ranked).toEqual(['A1', 'C1', 'B1', 'A2', 'B2', 'A3']);
  });

  it('un producto que sale en varias búsquedas queda una vez, en su mejor puesto', () => {
    const ranked = rankSearchResults([
      { keyword: keyword({ rank: 0 }), ids: ['X', 'Y'] },
      { keyword: keyword({ rank: 1, categoryOrder: 1 }), ids: ['Y'] },
    ]);
    expect(ranked).toEqual(['X', 'Y']);
  });
});

describe('findBySearches', () => {
  /**
   * ML de mentira: cada raíz tiene una hija; cada hija, tres búsquedas;
   * "hello kitty" no es de ningún tipo que el sitio publique; el catálogo
   * devuelve dos fichas por búsqueda.
   */
  function stubMl({ trendsStatus = 200 }: { trendsStatus?: number } = {}) {
    const fetchMock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const path = url.pathname;
      const category = /^\/categories\/(MLC\d+)$/.exec(path);
      if (category) {
        const id = category[1];
        return json(200, { id, children_categories: ROOT_CATEGORIES.includes(id) ? [{ id: `${id}9` }] : [] });
      }
      const trend = /^\/trends\/MLC\/(MLC\d+)$/.exec(path);
      if (trend) {
        if (trendsStatus !== 200) return json(trendsStatus, { status: trendsStatus, code: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES' });
        const id = trend[1];
        const first = id === `${ROOT_CATEGORIES[0]}9` ? 'hello kitty' : `${id} uno`;
        return json(200, [{ keyword: first }, { keyword: `${id} dos` }, { keyword: `${id} tres` }, { keyword: `${id} cuatro` }]);
      }
      if (path === '/sites/MLC/domain_discovery/search') {
        const q = url.searchParams.get('q') ?? '';
        return json(200, q === 'hello kitty' ? [] : [{ domain_id: 'MLC-CELLPHONE_CASES_AND_COVERS' }, { domain_id: 'MLC-CELLPHONES' }]);
      }
      if (path === '/products/search') {
        const q = (url.searchParams.get('q') ?? '').replace(/\s+/g, '-');
        return json(200, {
          results: [
            { id: `MLC-${q}-1`, domain_id: url.searchParams.get('domain_id') },
            { id: `MLC-${q}-2`, domain_id: url.searchParams.get('domain_id') },
          ],
        });
      }
      throw new Error(`Consulta inesperada a ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('busca lo más buscado dentro del tipo que el sitio publica y ordena lo encontrado', async () => {
    const fetchMock = stubMl();
    const findings = await findBySearches('tok', () => false);

    // 7 subcategorías × 3 búsquedas; "hello kitty" no tiene un tipo del sitio.
    expect(findings.report).toMatchObject({
      subcategorias: 7,
      busquedas_elegidas: 21,
      busquedas_sin_tipo_del_sitio: 1,
      busquedas_en_catalogo: 20,
      busquedas_cortadas_por_tiempo: 0,
    });
    expect(findings.ids).toHaveLength(40);
    // Primero la primera ficha de las búsquedas más frecuentes.
    expect(findings.ids[0]).toBe(`MLC-${ROOT_CATEGORIES[1]}9-uno-1`);
    expect(findings.highlights.size).toBe(0);

    // Cada búsqueda en el catálogo va dentro del primer tipo que el sitio publica.
    const searches = fetchMock.mock.calls
      .map(([input]) => new URL(input))
      .filter((url) => url.pathname === '/products/search');
    expect(new Set(searches.map((url) => url.searchParams.get('domain_id')))).toEqual(new Set(['MLC-CELLPHONES']));

    expect(findings.stages).toEqual({
      categorias: { consultas: 7, fallidas: 0, por_estado: {}, codigo_ml: null },
      tendencias: { consultas: 7, fallidas: 0, por_estado: {}, codigo_ml: null },
      tipos: { consultas: 21, fallidas: 0, por_estado: {}, codigo_ml: null },
      busqueda: { consultas: 20, fallidas: 0, por_estado: {}, codigo_ml: null },
    });
  });

  it('sin tiempo, deja de empezar búsquedas y analiza lo que alcanzó a encontrar', async () => {
    const fetchMock = stubMl();
    // Se acaba el tiempo después de las primeras búsquedas en el catálogo.
    const searchesMade = () =>
      fetchMock.mock.calls.filter(([input]) => new URL(input).pathname === '/products/search').length;
    const findings = await findBySearches('tok', () => searchesMade() >= 5);

    expect(findings.report).toMatchObject({ busquedas_elegidas: 21 });
    expect(findings.report.busquedas_cortadas_por_tiempo as number).toBeGreaterThan(0);
    expect(findings.ids.length).toBeGreaterThan(0);
    expect(findings.ids.length).toBeLessThan(40);
  });

  it('si ML bloquea lo más buscado, no hay búsquedas y la etapa queda con sus fallas', async () => {
    stubMl({ trendsStatus: 403 });
    const findings = await findBySearches('tok', () => false);
    expect(findings.ids).toEqual([]);
    expect(findings.stages.tendencias).toEqual({
      consultas: 7,
      fallidas: 7,
      por_estado: { '403': 7 },
      codigo_ml: 'PA_UNAUTHORIZED_RESULT_FROM_POLICIES',
    });
    expect(findings.stages.busqueda).toEqual({ consultas: 0, fallidas: 0, por_estado: {}, codigo_ml: null });
  });
});
