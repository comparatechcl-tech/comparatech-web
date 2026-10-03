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
