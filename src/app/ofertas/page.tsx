import type { Metadata } from 'next';
import { Flame } from 'lucide-react';
import { getDeals, discountPercent, savingsAmount, MIN_DEAL_DISCOUNT } from '@/lib/queries/products';
import { ProductGrid } from '@/components/product/ProductGrid';
import { formatCLP } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Ofertas del día',
  description:
    'Los mayores descuentos del catálogo, verificados contra el precio de lista de Mercado Libre y actualizados todos los días.',
};

export const revalidate = 300;

/**
 * Ofertas ordenadas por descuento.
 *
 * Es la página a la que apuntan las publicaciones en redes: en vez de
 * mandar a la home, el link lleva directo a lo que está rebajado hoy.
 *
 * El descuento sale de comparar el precio actual contra el precio de lista
 * que informa Mercado Libre, no de una etiqueta puesta a mano — así no se
 * anuncia una rebaja que no existe, que es justo lo que las reglas del
 * Programa de Afiliados prohíben.
 */
export default async function OfertasPage() {
  const deals = await getDeals();
  const totalSavings = deals.reduce((sum, p) => sum + savingsAmount(p), 0);
  const best = deals[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          <Flame size={13} /> Rebajas verificadas
        </span>
        <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Ofertas del día</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {deals.length > 0 ? (
            <>
              {deals.length} {deals.length === 1 ? 'producto rebajado' : 'productos rebajados'} un{' '}
              {MIN_DEAL_DISCOUNT}% o más respecto a su precio de lista
              {best && <> — el mayor descuento llega a {discountPercent(best)}%</>}. Comparamos
              contra el precio que informa Mercado Libre y lo revisamos todos los días.
            </>
          ) : (
            <>
              Hoy no hay rebajas sobre el {MIN_DEAL_DISCOUNT}% en el catálogo. Revisamos los precios
              a diario, así que vuelve pronto.
            </>
          )}
        </p>

        {deals.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Ahorro total disponible:{' '}
            <span className="font-semibold text-fg">{formatCLP(totalSavings)}</span>
          </p>
        )}
      </div>

      <ProductGrid products={deals} />
    </div>
  );
}
