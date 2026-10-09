import type { Metadata } from 'next';
import { Flame, TrendingDown } from 'lucide-react';
import { discountPercent, MIN_DEAL_DISCOUNT } from '@/lib/queries/products';
import { getRankedDeals } from '@/lib/queries/deals';
import { getSiteCategories } from '@/lib/queries/site-categories';
import { ALL_DEALS, countHotDeals, dealsBatch } from '@/lib/deals-listing';
import { DealsBrowser } from '@/components/product/DealsBrowser';

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
 * consta es el historial de precios propio (ver lib/deal-rank), así que los
 * productos que bajaron de verdad van primero y con su propio distintivo.
 *
 * La página lleva solo la primera tanda de tarjetas, para que su peso no
 * crezca con el catálogo. Las demás las pide DealsBrowser a /ofertas/lote.
 */
export default async function OfertasPage() {
  const [{ ranked: deals, drops, best }, siteCategories] = await Promise.all([
    getRankedDeals(),
    getSiteCategories(),
  ]);
  const confirmed = Object.keys(drops).length;

  // Solo las categorías que hoy tienen ofertas, en el orden del menú.
  const counts = new Map<string, number>();
  for (const p of deals) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = siteCategories
    .filter((c) => counts.has(c.slug))
    .map((c) => ({ slug: c.slug, name: c.name, count: counts.get(c.slug) ?? 0 }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
          <Flame size={13} /> Descuentos informados por Mercado Libre
        </span>
        <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Ofertas del día</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {deals.length > 0 ? (
            <>
              {deals.length} {deals.length === 1 ? 'producto rebajado' : 'productos rebajados'} un{' '}
              {MIN_DEAL_DISCOUNT}% o más respecto a su precio de lista
              {best && <> — el mayor descuento llega a {discountPercent(best)}%</>}.
            </>
          ) : (
            <>
              Hoy no hay rebajas sobre el {MIN_DEAL_DISCOUNT}% en el catálogo. Los precios se actualizan
              varias veces al día, así que vuelve pronto.
            </>
          )}
        </p>
        {confirmed > 0 && (
          <p className="mt-3 inline-flex max-w-2xl items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
            <TrendingDown size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Primero van {confirmed === 1 ? 'el que bajó' : `los ${confirmed} que bajaron`} de precio según
              nuestro propio registro: {confirmed === 1 ? 'lleva' : 'llevan'} la marca &quot;Bajó&quot; con el monto.
            </span>
          </p>
        )}
        <p className="mt-2 max-w-2xl text-xs text-muted">
          El descuento se calcula sobre el precio de lista que informa el vendedor.
        </p>
      </div>

      {deals.length > 0 && (
        <DealsBrowser
          initial={dealsBatch(deals, drops, ALL_DEALS, 0)}
          categories={categories}
          hotCount={countHotDeals(deals)}
          placement="ofertas"
        />
      )}
    </div>
  );
}
