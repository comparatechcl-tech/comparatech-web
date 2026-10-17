/**
 * De dónde salen los productos nuevos que analiza la prospección.
 *
 *  - destacados: la lista de más vendidos de cada subcategoría (/highlights).
 *    Fue la fuente hasta el 13-10-2026; desde el 14-10 ML responde 403.
 *  - busquedas: lo más buscado en cada subcategoría (/trends), el tipo de
 *    producto al que corresponde cada búsqueda (domain_discovery) y las fichas
 *    del catálogo que calzan dentro de ese tipo (/products/search). Trae lo
 *    que la gente busca, no lo que más se vende: el ganador de la ficha, el
 *    vendedor verde y la comisión filtran después, igual que antes.
 *
 * Cada una devuelve los productos ordenados, el más interesante primero, y
 * cómo respondió ML en cada etapa, para que lib/prospect-source decida si la
 * corrida hizo su trabajo.
 */

import { categoryFromDomain } from '@/lib/categories';
import {
  ROOT_CATEGORIES,
  discoverDomains,
  getHighlightedProducts,
  getSubcategories,
  getTrendKeywords,
  mapWithConcurrency,
  searchCatalogProducts,
  type MlFailure,
} from '@/lib/ml-catalog';
import { tallyStage, type SourceStages } from '@/lib/prospect-source';

const CONCURRENCY = 8;

const DAY_MS = 86_400_000;

/** En cuántos días se recorre completo el segundo nivel de subcategorías (destacados). */
const LEVEL2_ROTATION = 3;

/** Las primeras búsquedas de cada subcategoría: las más frecuentes. */
export const KEYWORDS_PER_CATEGORY = 3;

/** Tope de búsquedas por corrida: cada una cuesta dos consultas a ML (tipo y catálogo). */
export const MAX_KEYWORDS = 150;

/** Fichas por búsqueda: las primeras del catálogo dentro del tipo. */
export const RESULTS_PER_SEARCH = 10;

/** Búsquedas en paralelo: ML respondió 16 a la vez sin 429 (medido el 17-10-2026). */
const SEARCH_CONCURRENCY = 16;

/** Búsquedas que se muestran en el resumen, para ver de dónde salió lo que entró. */
const REPORT_SAMPLE = 20;

export interface SourceFindings {
  /** Productos encontrados, sin repetir, el más interesante primero. */
  ids: string[];
  /** Puesto en los más vendidos y la categoría donde se vio (solo destacados). */
  highlights: Map<string, { position: number; categoryId: string }>;
  /** Cómo respondió ML en cada etapa. */
  stages: SourceStages;
  /** Detalle para el resumen de cron_runs. */
  report: Record<string, unknown>;
}

/**
 * Los destacados (más vendidos) de las subcategorías de las ramas que sigue
 * el proyecto, en dos niveles, con la mejor posición de cada producto: si
 * aparece en varias categorías, vale la mejor. La posición dice qué se vende
 * más y ordena la cola de revisión.
 *
 * El segundo nivel casi triplica los destacados (en un censo de octubre de
 * 2026: 870 en el primero y 1.754 más en el segundo), pero son unas 600
 * categorías: se reparten en LEVEL2_ROTATION días para que cada corrida
 * entre en el tiempo de la función.
 */
export async function findByHighlights(token: string, now = Date.now()): Promise<SourceFindings> {
  const level1Results = await mapWithConcurrency(ROOT_CATEGORIES, CONCURRENCY, (root) =>
    getSubcategories(root, token)
  );
  const level1 = level1Results.flatMap((r) => r.ids);
  const level1Ids = new Set(level1);
  const level2Results = await mapWithConcurrency(level1, CONCURRENCY, (id) => getSubcategories(id, token));
  const level2All = level2Results.flatMap((r) => r.ids).filter((id) => !level1Ids.has(id));
  const turn = Math.floor(now / DAY_MS) % LEVEL2_ROTATION;
  const level2 = level2All.filter((_, i) => i % LEVEL2_ROTATION === turn);
  const subcategories = [...level1, ...level2];

  const best = new Map<string, { position: number; categoryId: string }>();
  const perCategory = await mapWithConcurrency(subcategories, CONCURRENCY, async (categoryId) => ({
    categoryId,
    result: await getHighlightedProducts(categoryId, token),
  }));
  for (const { categoryId, result } of perCategory) {
    if (result.status !== 'ok') continue;
    for (const { id, position } of result.items) {
      const current = best.get(id);
      if (!current || position < current.position) best.set(id, { position, categoryId });
    }
  }
  // Los mejor rankeados primero: si no alcanza el tope de la corrida, lo
  // que queda para mañana es lo que menos se vende.
  const ids = [...best.entries()].sort((a, b) => a[1].position - b[1].position).map(([id]) => id);

  return {
    ids,
    highlights: best,
    stages: {
      categorias: tallyStage([...level1Results, ...level2Results].map((r) => r.failure)),
      destacados: tallyStage(perCategory.map(({ result }) => (result.status === 'error' ? result.failure : null))),
    },
    report: {
      subcategories: subcategories.length,
      subcategories_level2: `${level2.length} de ${level2All.length} (turno ${turn + 1}/${LEVEL2_ROTATION})`,
      highlighted: ids.length,
    },
  };
}

export interface Keyword {
  keyword: string;
  categoryId: string;
  /** 0 = la más buscada de su categoría. */
  rank: number;
  /** Orden de la categoría en el recorrido, para desempatar siempre igual. */
  categoryOrder: number;
}

/**
 * Las búsquedas a usar: las `perCategory` primeras de cada subcategoría, sin
 * repetir (sin distinguir mayúsculas ni espacios), primero las más buscadas de
 * todas las categorías y después las segundas: si el tope corta, deja fuera
 * las menos buscadas, no categorías enteras.
 */
export function pickKeywords(
  trends: { categoryId: string; keywords: string[] }[],
  perCategory = KEYWORDS_PER_CATEGORY,
  max = MAX_KEYWORDS
): Keyword[] {
  const picked: Keyword[] = [];
  const seen = new Set<string>();
  for (let rank = 0; rank < perCategory; rank++) {
    trends.forEach(({ categoryId, keywords }, categoryOrder) => {
      const keyword = keywords[rank]?.replace(/\s+/g, ' ').trim();
      if (!keyword) return;
      const key = keyword.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      picked.push({ keyword, categoryId, rank, categoryOrder });
    });
  }
  return picked.slice(0, max);
}

/** El primer tipo de producto de la lista que el sitio publica (lib/categories), o null. */
export function pickSiteDomain(domains: string[]): string | null {
  return domains.find((domain) => categoryFromDomain(domain) !== null) ?? null;
}

type RankKey = [index: number, rank: number, categoryOrder: number];

function compareKeys(a: RankKey, b: RankKey): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/**
 * Ordena lo encontrado: primero la primera ficha de cada búsqueda (de la más
 * buscada a la menos), después las segundas, y así. Si el tope de fichas por
 * corrida corta, cada búsqueda alcanzó a aportar sus mejores. Un producto que
 * sale en varias búsquedas queda en su mejor puesto.
 */
export function rankSearchResults(found: { keyword: Keyword; ids: string[] }[]): string[] {
  const best = new Map<string, RankKey>();
  for (const { keyword, ids } of found) {
    ids.forEach((id, index) => {
      const key: RankKey = [index, keyword.rank, keyword.categoryOrder];
      const current = best.get(id);
      if (!current || compareKeys(key, current) < 0) best.set(id, key);
    });
  }
  return [...best.entries()].sort((a, b) => compareKeys(a[1], b[1])).map(([id]) => id);
}

/**
 * Lo más buscado en las subcategorías de primer nivel de cada rama, llevado
 * al catálogo: para cada búsqueda, su tipo de producto y, si el sitio lo
 * publica, las primeras fichas de ese tipo que calzan con la búsqueda.
 *
 * Buscar dentro del tipo importa: "samsung s26 ultra" a secas trae fundas,
 * láminas y hasta libros; dentro de MLC-CELLPHONES trae los teléfonos. Y las
 * búsquedas sin un tipo que el sitio publique ("hello kitty", "radio
 * baofeng") se descartan antes de gastar la consulta más lenta.
 *
 * `outOfTime` corta las búsquedas que faltan (lo encontrado hasta ahí se
 * analiza igual): la búsqueda en el catálogo puede tardar 2 s y la corrida
 * entera tiene que caber en el minuto de la función.
 */
export async function findBySearches(token: string, outOfTime: () => boolean): Promise<SourceFindings> {
  const level1Results = await mapWithConcurrency(ROOT_CATEGORIES, CONCURRENCY, (root) =>
    getSubcategories(root, token)
  );
  const level1 = [...new Set(level1Results.flatMap((r) => r.ids))];

  const trendResults = await mapWithConcurrency(level1, CONCURRENCY, async (categoryId) => ({
    categoryId,
    result: await getTrendKeywords(categoryId, token),
  }));
  const keywords = pickKeywords(
    trendResults.map(({ categoryId, result }) => ({
      categoryId,
      keywords: result.status === 'ok' ? result.items : [],
    }))
  );

  const typeFailures: (MlFailure | null)[] = [];
  const searchFailures: (MlFailure | null)[] = [];
  const found: { keyword: Keyword; domain: string; ids: string[] }[] = [];
  let withoutSiteType = 0;
  let cutForTime = 0;

  await mapWithConcurrency(keywords, SEARCH_CONCURRENCY, async (keyword) => {
    if (outOfTime()) {
      cutForTime++;
      return;
    }
    const domains = await discoverDomains(keyword.keyword, token);
    typeFailures.push(domains.status === 'error' ? domains.failure : null);
    if (domains.status !== 'ok') return;
    const domain = pickSiteDomain(domains.items);
    if (!domain) {
      withoutSiteType++;
      return;
    }
    if (outOfTime()) {
      cutForTime++;
      return;
    }
    const results = await searchCatalogProducts(keyword.keyword, domain, token, RESULTS_PER_SEARCH);
    searchFailures.push(results.status === 'error' ? results.failure : null);
    if (results.status !== 'ok') return;
    found.push({
      keyword,
      domain,
      // Se buscó dentro del tipo; igual queda fuera lo que el sitio no publica.
      ids: results.items.filter((r) => categoryFromDomain(r.domainId ?? domain) !== null).map((r) => r.id),
    });
  });

  const ids = rankSearchResults(found);
  const sample = [...found]
    .sort((a, b) => a.keyword.rank - b.keyword.rank || a.keyword.categoryOrder - b.keyword.categoryOrder)
    .slice(0, REPORT_SAMPLE)
    .map((f) => `${f.keyword.keyword} → ${f.domain} (${f.ids.length})`);

  return {
    ids,
    highlights: new Map(),
    stages: {
      categorias: tallyStage(level1Results.map((r) => r.failure)),
      tendencias: tallyStage(trendResults.map(({ result }) => (result.status === 'error' ? result.failure : null))),
      tipos: tallyStage(typeFailures),
      busqueda: tallyStage(searchFailures),
    },
    report: {
      subcategorias: level1.length,
      busquedas_elegidas: keywords.length,
      busquedas_sin_tipo_del_sitio: withoutSiteType,
      busquedas_en_catalogo: searchFailures.length,
      busquedas_cortadas_por_tiempo: cutForTime,
      muestra_busquedas: sample,
    },
  };
}
