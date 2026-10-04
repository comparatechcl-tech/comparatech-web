import { TrendingDown } from 'lucide-react';
import { getPriceStatsCached } from '@/lib/queries/price-history';
import { dropSince, isLowestIn30Days, isLowestSinceTracked } from '@/lib/deals';
import { formatCLP } from '@/lib/format';

/**
 * Lo que el historial de precios permite afirmar del precio de hoy.
 *
 * A diferencia del "% de descuento" (que se calcula sobre el precio de
 * lista que informa el vendedor), esto sale de lo que registramos nosotros
 * cada media hora (ver lib/pricing). Si no hay datos suficientes para
 * afirmar algo, no se muestra nada: mejor callar que exagerar.
 *
 * Componente de servidor: se calcula al regenerar la página, junto con el
 * precio que acompaña.
 */

/** "04/10", en hora de Chile: es la fecha que vio quien estaba mirando. */
function formatDayMonth(iso: string): string {
  const parts = new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Santiago',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}`;
}

export async function PriceHistoryNote({ productId, price }: { productId: string; price: number }) {
  const stats = await getPriceStatsCached(productId);
  if (!stats) return null;

  const lines: string[] = [];

  if (isLowestIn30Days(stats, price)) {
    lines.push('Precio más bajo de los últimos 30 días');
  } else if (isLowestSinceTracked(stats, price)) {
    lines.push(`Precio más bajo desde que lo seguimos (${stats.daysTracked} días)`);
  }

  const drop = dropSince(stats, price);
  if (drop) lines.push(`Bajó ${formatCLP(drop.amount)} desde el ${formatDayMonth(drop.since)}`);

  if (lines.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {lines.map((line) => (
        <li key={line} className="flex items-center gap-1.5 text-xs font-medium text-accent">
          <TrendingDown size={13} className="shrink-0" aria-hidden />
          {line}
        </li>
      ))}
    </ul>
  );
}
