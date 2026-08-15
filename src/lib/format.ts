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
