import { TrendingDown } from 'lucide-react';
import { getPriceStatsCached } from '@/lib/queries/price-history';
import { dropSince, lowestPriceNote } from '@/lib/deals';
import { formatCLP, formatDayMonth } from '@/lib/format';

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

export async function PriceHistoryNote({
  productId,
  price,
  listPrice,
  createdAt,
}: {
  productId: string;
  price: number;
  /** El precio de lista de hoy: la baja no se mide contra algo más alto (ver changeSince). */
  listPrice?: number | null;
  /** Cuándo se agregó el producto: dice si el primer registro del historial es su precio de partida. */
  createdAt?: string | null;
}) {
  const stats = await getPriceStatsCached(productId);
  if (!stats) return null;

  const lines: string[] = [];

  const lowest = lowestPriceNote(stats, price);
  if (lowest) lines.push(lowest);

  const drop = dropSince(stats, price, Date.now(), listPrice, createdAt);
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
