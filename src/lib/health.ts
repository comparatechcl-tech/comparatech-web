/**
 * El veredicto de /api/health, aparte de la ruta para poder probarlo sin base.
 *
 * El monitor externo necesita una sola respuesta: ¿hay algo que arreglar? Los
 * precios viejos lo eran hasta el 23-11-2026, cuando Mercado Libre cerró la
 * consulta de precios a las aplicaciones no certificadas (ver winnersGate en
 * lib/ml-catalog). Desde entonces ningún precio se revisa y eso no se arregla
 * desde acá: si el endpoint siguiera respondiendo 503 por eso, respondería 503
 * para siempre y dejaría de avisar lo que sí importa (que el refresco o la
 * prospección dejen de correr, o que la base no responda).
 *
 * Por eso, mientras el refresco corra y anote que la consulta está cerrada
 * (`pricesClosed`), la antigüedad de los precios no cuenta. Si el refresco deja
 * de correr, `pricesClosed` deja de ser cierto (lo decide refreshStatusFromRuns:
 * sin pasadas en 90 minutos es "detenido") y los precios viejos vuelven a
 * alarmar. Si Mercado Libre reabre, vuelve la regla de siempre.
 */

export interface HealthInput {
  /** Minutos desde la revisión de precios más reciente; null si no se sabe. */
  priceAgeMin: number | null;
  /** Minutos desde la revisión más vieja de lo que está a la venta; null si no hay nada revisado a la venta. */
  oldestAgeMin: number | null;
  /** Horas desde la última prospección que terminó bien; null si no se sabe. */
  prospectAgeH: number | null;
  /** El refresco corre y su última revisión anotó que Mercado Libre tiene cerrada la consulta de precios. */
  pricesClosed: boolean;
  maxPriceAgeMin: number;
  maxOldestPriceAgeMin: number;
  maxProspectAgeH: number;
}

/** ¿Los precios están al día, o no lo están por algo que no se arregla desde acá? */
export function pricesHealthy(input: HealthInput): boolean {
  if (input.pricesClosed) return true;
  return (
    input.priceAgeMin !== null &&
    input.priceAgeMin <= input.maxPriceAgeMin &&
    // Sin productos visibles revisados no hay "más viejo" que medir: lo cubre la última revisión.
    (input.oldestAgeMin === null || input.oldestAgeMin <= input.maxOldestPriceAgeMin)
  );
}

/** ¿La prospección diaria corrió y terminó bien hace poco? (En pausa por los precios también termina bien.) */
export function prospectHealthy(input: Pick<HealthInput, 'prospectAgeH' | 'maxProspectAgeH'>): boolean {
  return input.prospectAgeH !== null && input.prospectAgeH <= input.maxProspectAgeH;
}

export function siteHealthy(input: HealthInput): boolean {
  return pricesHealthy(input) && prospectHealthy(input);
}
