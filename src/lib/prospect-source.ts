/**
 * ¿Mercado Libre le respondió a la prospección?
 *
 * La prospección recorría las categorías de ML y pedía la lista de más
 * vendidos de cada una. Hasta el 13-10-2026 traía ~1.500 destacados por
 * corrida; desde el 14-10 ML responde 403 a esa lista y la prospección lo
 * tomaba como "no hay destacados": cada corrida quedaba como ok con 0
 * productos y el correo solo decía "0 candidatos nuevos". Así pasaron días
 * sin productos nuevos sin que nada avisara.
 *
 * Esto cuenta cómo respondió ML en cada etapa de la fuente (la de más
 * vendidos o la de lo más buscado, ver lib/prospect-finders) y decide si la
 * corrida hizo su trabajo. Si no, la corrida queda como fallida en cron_runs
 * y el correo lo dice con una frase que se entiende sin saber de la API.
 */

import type { MlFailure } from '@/lib/ml-catalog';

/**
 * De dónde salen los productos nuevos: la lista de más vendidos de ML
 * (bloqueada desde el 14-10-2026) o lo más buscado en cada categoría más el
 * buscador del catálogo.
 */
export type ProspectSourceName = 'destacados' | 'busquedas';

/**
 * Las etapas con consultas a ML. Destacados: categorias → destacados.
 * Búsquedas: categorias → tendencias (lo más buscado) → tipos (a qué tipo de
 * producto corresponde cada búsqueda) → busqueda (fichas del catálogo).
 */
export type SourceStageName = 'categorias' | 'destacados' | 'tendencias' | 'tipos' | 'busqueda';

/** Las consultas de una etapa de la prospección y cuántas fallaron. */
export interface SourceStage {
  consultas: number;
  fallidas: number;
  /** Fallas por código HTTP ({"403": 288}); "red" cuando no hubo respuesta. */
  por_estado: Record<string, number>;
  /** El código de error de ML más repetido, si lo mandó. */
  codigo_ml: string | null;
}

export type SourceStages = Partial<Record<SourceStageName, SourceStage>>;

/**
 * Desde esta proporción de consultas fallidas la corrida cuenta como
 * fallida, como en el refresco de precios: buscó en menos de la mitad de lo
 * que debía. En operación normal falla menos del 2% (refresco, octubre de
 * 2026); un bloqueo es el 100%.
 */
export const MAX_FAILED_RATIO = 0.5;

export interface SourceProblem {
  /** Qué falló. */
  etapa: SourceStageName;
  /**
   * bloqueo: ML respondió 403 (no deja leer); falla: 429, 5xx, red u otro
   * error; vacio: respondió, pero sin ningún producto que analizar.
   */
  tipo: 'bloqueo' | 'falla' | 'vacio';
  consultas: number;
  fallidas: number;
  /** El código HTTP más repetido entre las fallas; null si vino vacía. */
  estado: string | null;
  codigo_ml: string | null;
}

/**
 * En qué orden se mira cada etapa. Primero la que trae los productos (o la
 * primera de la cadena: sin lo más buscado no hay qué clasificar ni buscar);
 * las categorías al final, porque sin ellas se busca igual en las raíces.
 */
const STAGE_ORDER: Record<ProspectSourceName, SourceStageName[]> = {
  destacados: ['destacados', 'categorias'],
  busquedas: ['tendencias', 'tipos', 'busqueda', 'categorias'],
};

/** La etapa que entrega los productos: la que se nombra si no llegó ninguno. */
const PRODUCT_STAGE: Record<ProspectSourceName, SourceStageName> = {
  destacados: 'destacados',
  busquedas: 'busqueda',
};

/** Mayor primero; a igual cantidad, el primero que apareció. */
function mostFrequent(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, n] of counts) {
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  return best;
}

/** Cuenta las consultas de una etapa: null es una consulta que ML respondió. */
export function tallyStage(failures: (MlFailure | null)[]): SourceStage {
  const byStatus = new Map<string, number>();
  const byCode = new Map<string, number>();
  let failed = 0;
  for (const failure of failures) {
    if (!failure) continue;
    failed++;
    const status = failure.status === null ? 'red' : String(failure.status);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (failure.code) byCode.set(failure.code, (byCode.get(failure.code) ?? 0) + 1);
  }
  return {
    consultas: failures.length,
    fallidas: failed,
    por_estado: Object.fromEntries(byStatus),
    codigo_ml: mostFrequent(byCode),
  };
}

function failedTooMuch(stage: SourceStage | undefined): stage is SourceStage {
  return !!stage && stage.consultas > 0 && stage.fallidas / stage.consultas >= MAX_FAILED_RATIO;
}

function problemFrom(etapa: SourceStageName, stage: SourceStage): SourceProblem {
  const estado = mostFrequent(new Map(Object.entries(stage.por_estado)));
  // Un 403 es ML diciendo que no deja leer esa lista. Lo demás (429, 5xx,
  // red, un 401 por token) es una falla, que puede pasar sola.
  const blocked = stage.por_estado['403'] ?? 0;
  return {
    etapa,
    tipo: blocked * 2 >= stage.fallidas ? 'bloqueo' : 'falla',
    consultas: stage.consultas,
    fallidas: stage.fallidas,
    estado,
    codigo_ml: stage.codigo_ml,
  };
}

/**
 * El problema de la corrida, o null si ML respondió. Una etapa con la mitad
 * o más de sus consultas fallidas (en el orden de STAGE_ORDER), o ningún
 * producto encontrado: en un día normal la lista de más vendidos traía más
 * de mil, así que cero es la fuente apagada.
 */
export function assessSource(
  stages: SourceStages,
  productosEncontrados: number,
  fuente: ProspectSourceName = 'destacados'
): SourceProblem | null {
  for (const etapa of STAGE_ORDER[fuente]) {
    const stage = stages[etapa];
    if (failedTooMuch(stage)) return problemFrom(etapa, stage);
  }
  if (productosEncontrados === 0) {
    const etapa = PRODUCT_STAGE[fuente];
    return {
      etapa,
      tipo: 'vacio',
      consultas: stages[etapa]?.consultas ?? 0,
      fallidas: stages[etapa]?.fallidas ?? 0,
      estado: null,
      codigo_ml: null,
    };
  }
  return null;
}

/** Qué hizo ML con cada etapa, dicho en simple, y en qué se cuentan sus consultas. */
const STAGE_TEXT: Record<SourceStageName, { bloqueo: string; falla: string; unidad: string }> = {
  categorias: { bloqueo: 'bloqueó su lista de categorías', falla: 'no entregó su lista de categorías', unidad: 'consultas' },
  destacados: { bloqueo: 'bloqueó la lista de más vendidos', falla: 'no entregó la lista de más vendidos', unidad: 'categorías' },
  tendencias: {
    bloqueo: 'bloqueó la lista de lo más buscado',
    falla: 'no entregó la lista de lo más buscado',
    unidad: 'categorías',
  },
  tipos: {
    bloqueo: 'bloqueó la clasificación de lo más buscado',
    falla: 'no entregó la clasificación de lo más buscado',
    unidad: 'búsquedas',
  },
  busqueda: { bloqueo: 'bloqueó su buscador de productos', falla: 'falló en su buscador de productos', unidad: 'búsquedas' },
};

const EMPTY_LINE: Partial<Record<SourceStageName, string>> = {
  destacados: 'Mercado Libre entregó vacía la lista de más vendidos: hoy no hubo de dónde sacar productos nuevos.',
  busqueda: 'Las búsquedas en Mercado Libre no trajeron productos del sitio: hoy no hubo de dónde sacar productos nuevos.',
};

/**
 * La frase para el correo, sin jerga:
 * "Mercado Libre bloqueó la lista de más vendidos: hoy no se pudo buscar productos nuevos."
 */
export function sourceProblemLine(problem: SourceProblem): string {
  if (problem.tipo === 'vacio') {
    return EMPTY_LINE[problem.etapa] ?? 'Mercado Libre no entregó productos: hoy no hubo de dónde sacar productos nuevos.';
  }
  const text = STAGE_TEXT[problem.etapa];
  const what = problem.tipo === 'bloqueo' ? text.bloqueo : text.falla;
  const halfDone = 'hoy la búsqueda de productos nuevos quedó a medias.';
  if (problem.etapa === 'categorias') {
    return `Mercado Libre ${what} (${problem.fallidas} de ${problem.consultas} consultas): ${halfDone}`;
  }
  return problem.fallidas < problem.consultas
    ? `Mercado Libre ${what} en ${problem.fallidas} de ${problem.consultas} ${text.unidad}: ${halfDone}`
    : `Mercado Libre ${what}: hoy no se pudo buscar productos nuevos.`;
}

/**
 * Para la columna error de cron_runs: la frase y el detalle técnico.
 * "… (HTTP 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES en 288 de 288 consultas)"
 */
export function sourceProblemError(problem: SourceProblem): string {
  if (problem.tipo === 'vacio') {
    return `${sourceProblemLine(problem)} (0 productos en ${problem.consultas} ${STAGE_TEXT[problem.etapa].unidad})`;
  }
  const status = problem.estado === 'red' ? 'sin respuesta' : problem.estado ? `HTTP ${problem.estado}` : null;
  const detail = [status, problem.codigo_ml].filter(Boolean).join(' ');
  return `${sourceProblemLine(problem)} (${detail ? `${detail} en ` : ''}${problem.fallidas} de ${problem.consultas} consultas)`;
}
