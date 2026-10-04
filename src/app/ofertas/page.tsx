import type { Metadata } from 'next';
import { Flame } from 'lucide-react';
import { getDeals, discountPercent, MIN_DEAL_DISCOUNT } from '@/lib/queries/products';
import { getPriceStatsMany } from '@/lib/queries/price-history';
import { dropSince, isLowestIn30Days, type PriceStats } from '@/lib/deals';
import { ProductGrid } from '@/components/product/ProductGrid';
import type { Product } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Ofertas del día',
  alternates: { canonical: '/ofertas' },
  description:
    'Los mayores descuentos del catálogo según el precio de lista que informa Mercado Libre, con los precios revisados varias veces al día.',
};

export const revalidate = 300;

/**
 * Ofertas ordenadas por descuento.
 *
 * Es la página a la que apuntan las publicaciones en redes: en vez de
 * mandar a la home, el link lleva directo a lo que está rebajado hoy.
 *
 * El "% de descuento" se calcula sobre el precio de lista que informa el
 * vendedor en Mercado Libre, y hay vendedores con el mismo 55% todo el año.
 * Por eso no se presenta como verificado: se dice de dónde sale. Lo que sí
 * consta es el historial de precios propio (ver lib/deals), así que los
 * productos que bajaron de verdad van primero.
 */

/**
 * ¿El historial confirma una baja? Cuenta la baja respecto del precio
 * anterior (en %) o, si no hay una reciente, ser el más bajo del mes.
 * null si el historial no confirma nada.
 */
function confirmedDrop(product: Product, stats: PriceStats | null): number | null {
  const drop = dropSince(stats, product.price);
  if (drop) return (drop.amount / (product.price + drop.amount)) * 100;
  return isLowestIn30Days(stats, product.price) ? 0 : null;
}

export default async function OfertasPage() {
  const deals = await getDeals();
  const stats = await getPriceStatsMany(deals.map((p) => p.id));

  const drops = new Map(deals.map((p) => [p.id, confirmedDrop(p, stats.get(p.id) ?? null)]));
  const isConfirmed = (p: Product) => drops.get(p.id) != null;
  // Las bajas confirmadas primero, de mayor a menor; entre iguales y en el
  // resto se respeta el orden por descuento con que viene getDeals.
  const confirmed = deals
    .filter(isConfirmed)
    .sort((a, b) => (drops.get(b.id) ?? 0) - (drops.get(a.id) ?? 0));
  const ordered = [...confirmed, ...deals.filter((p) => !isConfirmed(p))];

  const best = deals[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
          <Flame size={13} /> Descuentos informados por Mercado Libre
        </span>
        <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Ofertas del día</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {deals.length > 0 ? (
            <>
              {deals.length} {deals.length === 1 ? 'producto rebajado' : 'productos rebajados'} un{' '}
              {MIN_DEAL_DISCOUNT}% o más respecto a su precio de lista
              {best && <> — el mayor descuento llega a {discountPercent(best)}%</>}.
              {confirmed.length > 0 && (
                <>
                  {' '}
                  Primero van {confirmed.length === 1 ? 'el que bajó' : `los ${confirmed.length} que bajaron`}{' '}
                  de precio según nuestro propio registro.
                </>
              )}
            </>
          ) : (
            <>
              Hoy no hay rebajas sobre el {MIN_DEAL_DISCOUNT}% en el catálogo. Revisamos los precios
              varias veces al día, así que vuelve pronto.
            </>
          )}
        </p>
        <p className="mt-2 max-w-2xl text-xs text-muted">
          El descuento se calcula sobre el precio de lista que informa el vendedor.
        </p>
      </div>

      <ProductGrid products={ordered} placement="ofertas" />
    </div>
  );
}
