/**
 * Las fechas del sitemap (lastmod).
 *
 * Google usa el lastmod para decidir qué volver a rastrear, pero solo
 * mientras le cree: si la fecha se mueve sin que cambie nada visible, deja
 * de mirarla para todo el sitio. Hasta el 17-10-2026 cada ficha decía la
 * hora de la última revisión de precios, que corre cada media hora aunque el
 * precio no cambie: 1.098 de las 1.102 direcciones tenían la misma fecha.
 *
 * Ahora una ficha dice cuándo cambió su precio por última vez (lo que anota
 * el historial) o, si no hay registro, cuándo entró al sitio. Un listado
 * dice la fecha más nueva de sus productos.
 */

function toDate(iso: string | null | undefined): Date | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** La más nueva de las fechas, o undefined si no hay ninguna. */
export function latestDate(dates: Iterable<Date | undefined>): Date | undefined {
  let latest: Date | undefined;
  for (const date of dates) if (date && (!latest || date > latest)) latest = date;
  return latest;
}

/**
 * El lastmod de una ficha: su último cambio de precio o, sin registro (o si
 * el historial no se pudo leer), su fecha de alta. Nunca price_checked_at.
 */
export function productLastModified(
  product: { id: string; created_at: string | null },
  lastChanges: ReadonlyMap<string, string> | null,
): Date | undefined {
  return latestDate([toDate(product.created_at), toDate(lastChanges?.get(product.id))]);
}
