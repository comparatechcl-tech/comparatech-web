export function formatCLP(value: number): string {
  return '$' + Math.round(value).toLocaleString('es-CL');
}

export function formatDiscountPct(
  price: number,
  originalPrice: number | null
): number | null {
  if (!originalPrice || originalPrice <= price) return null;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

export function reputationLabel(rep: string): string {
  const map: Record<string, string> = {
    verde: 'Reputación verde',
    amarillo: 'Reputación amarilla',
    naranja: 'Reputación naranja',
    rojo: 'Reputación roja',
  };
  return map[rep] ?? rep;
}

// Mercado Libre escribe los plazos siempre en plural: "1 años", "1 meses". El
// "1" tiene que ser la cifra entera: "21 años" y "1,5 años" quedan como están.
// Sin lookbehind, que los Safari anteriores a 16.4 no entienden.
const ONE_UNIT_RE = /(^|[^\d.,])1(\s+)(años|meses|semanas|d[ií]as|horas|minutos)(?![a-záéíóúüñ\d])/gi;
const SINGULAR_UNIT: Record<string, string> = {
  años: 'año',
  meses: 'mes',
  semanas: 'semana',
  días: 'día',
  dias: 'día',
  horas: 'hora',
  minutos: 'minuto',
};

/**
 * "1 años" pasa a "1 año". Para los textos que llegan de Mercado Libre y se
 * muestran tal cual: garantía, especificaciones y descripción. Se corrige al
 * mostrar; el dato guardado sigue siendo lo que informó Mercado Libre.
 */
export function singularizeUnits(text: string): string {
  return text.replace(
    ONE_UNIT_RE,
    (_match, before: string, gap: string, unit: string) => `${before}1${gap}${SINGULAR_UNIT[unit.toLowerCase()]}`
  );
}

/** "Garantía de fábrica: 2 años" queda igual; "12 meses" pasa a "Garantía: 12 meses". */
export function warrantyLabel(text: string): string {
  const fixed = singularizeUnits(text);
  return /^garant[ií]a/i.test(fixed) ? fixed : `Garantía: ${fixed}`;
}

/** Valor de una especificación tal como se muestra en la ficha y el comparador. */
export function specLabel(value: string | number): string {
  return singularizeUnits(String(value));
}

/** Total de ventas del vendedor: "1 venta", "1.306 ventas". */
export function salesLabel(count: number): string {
  return count === 1 ? '1 venta' : `${count.toLocaleString('es-CL')} ventas`;
}

/**
 * "hace 12 minutos", "hace 3 horas", "hace 2 días".
 *
 * Se usa para mostrar cuándo se verificó un precio contra Mercado Libre:
 * para quien compra, un precio sin fecha no dice si está vigente.
 */
export function formatTimeAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const seconds = Math.round((then - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('es-CL', { numeric: 'auto' });
  const abs = Math.abs(seconds);

  if (abs < 60) return 'recién';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}
