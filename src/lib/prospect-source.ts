/**
 * ¿Mercado Libre le respondió a la prospección?
 *
 * La prospección recorre las categorías de ML y pide la lista de más
 * vendidos de cada una. Hasta el 13-10-2026 traía ~1.500 destacados por
 * corrida; desde el 14-10 ML responde 403 a esa lista y la prospección lo
 * tomaba como "no hay destacados": cada corrida quedaba como ok con 0
 * productos y el correo solo decía "0 candidatos nuevos". Así pasaron días
 * sin productos nuevos sin que nada avisara.
 *
 * Esto cuenta cómo respondió ML en cada etapa y decide si la corrida hizo su
 * trabajo. Si no, la corrida queda como fallida en cron_runs y el correo lo
 * dice con una frase que se entiende sin saber de la API.
 */

import type { MlFailure } from '@/lib/ml-catalog';

/** Las consultas de una etapa de la prospección y cuántas fallaron. */
export interface SourceStage {
  consultas: number;
  fallidas: number;
  /** Fallas por código HTTP ({"403": 288}); "red" cuando no hubo respuesta. */
  por_estado: Record<string, number>;
  /** El código de error de ML más repetido, si lo mandó. */
  codigo_ml: string | null;
}

/**
 * Desde esta proporción de consultas fallidas la corrida cuenta como
 * fallida, como en el refresco de precios: buscó en menos de la mitad de lo
 * que debía. En operación normal falla menos del 2% (refresco, octubre de
 * 2026); un bloqueo es el 100%.
 */
export const MAX_FAILED_RATIO = 0.5;

export interface SourceProblem {
  /** Qué falló: el árbol de categorías que se recorre o su lista de más vendidos. */
  etapa: 'categorias' | 'destacados';
  /**
   * bloqueo: ML respondió 403 (no deja leer); falla: 429, 5xx, red u otro
   * error; vacio: respondió, pero sin ningún producto en ninguna categoría.
   */
  tipo: 'bloqueo' | 'falla' | 'vacio';
  consultas: number;
  fallidas: number;
  /** El código HTTP más repetido entre las fallas; null si la lista vino vacía. */
  estado: string | null;
  codigo_ml: string | null;
}

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

function failedTooMuch(stage: SourceStage): boolean {
  return stage.consultas > 0 && stage.fallidas / stage.consultas >= MAX_FAILED_RATIO;
}

function problemFrom(etapa: SourceProblem['etapa'], stage: SourceStage): SourceProblem {
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
 * El problema de la corrida, o null si ML respondió. Primero la lista de
 * más vendidos (sin ella no entra nada), después las categorías (sin ellas
 * se busca solo en las raíces) y por último una lista que respondió vacía
 * en todas las categorías, que en la práctica es la fuente apagada: en un día
 * normal trae más de mil productos.
 */
export function assessSource(
  stages: { categorias: SourceStage; destacados: SourceStage },
  productosDestacados: number
): SourceProblem | null {
  if (failedTooMuch(stages.destacados)) return problemFrom('destacados', stages.destacados);
  if (failedTooMuch(stages.categorias)) return problemFrom('categorias', stages.categorias);
  if (productosDestacados === 0) {
    return {
      etapa: 'destacados',
      tipo: 'vacio',
      consultas: stages.destacados.consultas,
      fallidas: stages.destacados.fallidas,
      estado: null,
      codigo_ml: null,
    };
  }
  return null;
}

/**
 * La frase para el correo, sin jerga:
 * "Mercado Libre bloqueó la lista de más vendidos: hoy no se pudo buscar productos nuevos."
 */
export function sourceProblemLine(problem: SourceProblem): string {
  if (problem.tipo === 'vacio') {
    return 'Mercado Libre entregó vacía la lista de más vendidos: hoy no hubo de dónde sacar productos nuevos.';
  }
  const verb = problem.tipo === 'bloqueo' ? 'bloqueó' : 'no entregó';
  const halfDone = 'hoy la búsqueda de productos nuevos quedó a medias.';
  if (problem.etapa === 'categorias') {
    return `Mercado Libre ${verb} su lista de categorías (${problem.fallidas} de ${problem.consultas} consultas): ${halfDone}`;
  }
  return problem.fallidas < problem.consultas
    ? `Mercado Libre ${verb} la lista de más vendidos en ${problem.fallidas} de ${problem.consultas} categorías: ${halfDone}`
    : `Mercado Libre ${verb} la lista de más vendidos: hoy no se pudo buscar productos nuevos.`;
}

/**
 * Para la columna error de cron_runs: la frase y el detalle técnico.
 * "… (HTTP 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES en 288 de 288 consultas)"
 */
export function sourceProblemError(problem: SourceProblem): string {
  if (problem.tipo === 'vacio') {
    return `${sourceProblemLine(problem)} (0 productos en ${problem.consultas} categorías)`;
  }
  const status = problem.estado === 'red' ? 'sin respuesta' : problem.estado ? `HTTP ${problem.estado}` : null;
  const detail = [status, problem.codigo_ml].filter(Boolean).join(' ');
  return `${sourceProblemLine(problem)} (${detail ? `${detail} en ` : ''}${problem.fallidas} de ${problem.consultas} consultas)`;
}
