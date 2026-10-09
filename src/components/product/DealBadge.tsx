import { Flame, TrendingDown } from 'lucide-react';
import { dealTier } from '@/lib/deal-rank';
import { formatCLP } from '@/lib/format';

/**
 * Distintivo de oferta sobre la foto del producto.
 *
 * Antes el descuento era un texto chico al lado del precio: en una grilla de
 * veinte tarjetas no se distinguía cuáles estaban rebajadas. Ahora va en la
 * esquina de la foto, con dos niveles: verde (el color con que Mercado Libre
 * muestra sus descuentos) y, desde 40%, rojo con llama.
 *
 * El porcentaje es sobre el precio de lista que informa el vendedor, y el
 * `title` lo dice. Lo que nosotros comprobamos va aparte, en DropChip.
 *
 * Sin estado ni efectos: se usa igual desde servidor y desde cliente.
 */
export function DealBadge({ discount, className = '' }: { discount: number; className?: string }) {
  const tier = dealTier(discount);
  if (!tier) return null;

  return (
    <span
      title="Descuento sobre el precio de lista informado en Mercado Libre"
      className={`inline-flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-extrabold leading-none text-white shadow-md ${
        tier === 'hot' ? 'bg-gradient-to-r from-red-600 to-orange-600' : 'bg-emerald-700'
      } ${className}`}
    >
      {tier === 'hot' && <Flame size={12} strokeWidth={2.6} aria-hidden />}
      -{discount}%
    </span>
  );
}

/**
 * "Bajó $12.000": la baja que vimos en nuestro propio registro de precios.
 * Es la única afirmación de la tarjeta que no depende de lo que diga el
 * vendedor, por eso tiene su propio color y su propio texto.
 */
export function DropChip({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span
      title="Baja registrada por ComparaTech al revisar el precio"
      className={`inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 ${className}`}
    >
      <TrendingDown size={12} strokeWidth={2.4} aria-hidden />
      Bajó {formatCLP(amount)}
    </span>
  );
}
