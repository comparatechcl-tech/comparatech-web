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

/**
 * La garantía para una fila que ya se llama "Garantía": "Garantía de
 * fábrica: 12 meses" queda en "De fábrica: 12 meses".
 */
export function warrantyValue(text: string): string {
  const fixed = singularizeUnits(text.trim());
  const rest = fixed.replace(/^garant[ií]a\s*:?\s*/i, '');
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : fixed;
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
 * "04/10", en hora de Chile: es la fecha que vio quien estaba mirando.
 *
 * Los ceros se ponen a mano: para es-CL, Intl entrega "4/10" aunque se pida
 * dos dígitos, y que servidor y navegador escriban lo mismo no puede
 * depender de la versión de sus datos de idioma.
 */
export function formatDayMonth(iso: string): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    day: 'numeric',
    month: 'numeric',
    timeZone: 'America/Santiago',
  }).formatToParts(new Date(iso));
  const get = (type: string) => (parts.find((p) => p.type === type)?.value ?? '').padStart(2, '0');
  return `${get('day')}/${get('month')}`;
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

  // Una revisión "del futuro" por pocos minutos es un reloj atrasado (el del
  // visitante o el del servidor). Por más que eso, la fecha está mala: mejor
  // no decir nada que decir "recién" de un precio que no se sabe cuándo se revisó.
  if (seconds > 5 * 60) return null;
  if (abs < 60 || seconds > 0) return 'recién';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  return rtf.format(Math.round(seconds / 86400), 'day');
}
