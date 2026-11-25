import type { Metadata } from 'next';
import Link from 'next/link';
import { Flame, TrendingDown, TrendingUp } from 'lucide-react';
import { discountPercent, MIN_DEAL_DISCOUNT } from '@/lib/queries/products';
import { getRankedDeals } from '@/lib/queries/deals';
import { getSiteCategories } from '@/lib/queries/site-categories';
import { ALL_DEALS, countHotDeals, dealsBatch } from '@/lib/deals-listing';
import { DealsBrowser } from '@/components/product/DealsBrowser';
import { AffiliateButton } from '@/components/product/AffiliateButton';
import { ProductGrid } from '@/components/product/ProductGrid';
import { getPopularProducts } from '@/lib/queries/popular';
import { POPULAR_MIN } from '@/lib/popular';
import { getAffiliateSettings } from '@/lib/settings';
import { mlOffersUrl } from '@/lib/outbound';

export const metadata: Metadata = {
  title: 'Ofertas del día',
  alternates: { canonical: '/ofertas' },
  description:
    'Los descuentos del catálogo, tal como los informa el vendedor en Mercado Libre, y el historial de precios de cada producto.',
};

// Cada hora (antes cada 5 minutos), como los datos que lee: el catálogo se
// guarda 1 hora y la revisión de precios purga todo el sitio cuando algo
// visible cambia. El 05-11-2026 el sitio iba en 155% de la CPU gratis de
// Vercel y 140% de las escrituras de páginas: armar cada 5 minutos lo mismo
// era la mayor parte.
export const revalidate = 3600;

/** Cuántos de los más populares se muestran cuando no hay ofertas de hoy: tres filas en escritorio. */
const POPULAR_LIMIT = 12;

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
  const [{ ranked: deals, drops, best }, siteCategories, affiliate] = await Promise.all([
    getRankedDeals(),
    getSiteCategories(),
    getAffiliateSettings(),
  ]);
  const confirmed = Object.keys(drops).length;

  // Sin ofertas de hoy (no hay precios revisados hoy, ver lib/price-freshness)
  // la página no queda en un texto y un botón: muestra los productos que más
  // se abren en Mercado Libre desde el sitio (lib/popular), como la portada.
  // Con menos de POPULAR_MIN, nada.
  // Lo mismo con unas pocas ofertas (las de los precios revisados a mano,
  // lib/manual-price): la página no queda en dos tarjetas.
  const fewDeals = deals.length < POPULAR_MIN;
  const inDeals = new Set(deals.map((p) => p.id));
  const popularFound = fewDeals
    ? (await getPopularProducts(POPULAR_LIMIT + deals.length)).filter((p) => !inDeals.has(p.id)).slice(0, POPULAR_LIMIT)
    : [];
  const popular = popularFound.length >= POPULAR_MIN ? popularFound : [];

  // Solo las categorías que hoy tienen ofertas, en el orden del menú.
  const counts = new Map<string, number>();
  for (const p of deals) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = siteCategories
    .filter((c) => counts.has(c.slug))
    .map((c) => ({ slug: c.slug, name: c.name, count: counts.get(c.slug) ?? 0 }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        {/* Sin ofertas a la vista no hay descuentos de los que hablar. */}
        {deals.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-600 dark:text-orange-400">
            <Flame size={13} /> Descuentos que informa cada vendedor en Mercado Libre
          </span>
        )}
        <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Ofertas del día</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          {deals.length > 0 ? (
            <>
              {deals.length} {deals.length === 1 ? 'producto' : 'productos'} con {MIN_DEAL_DISCOUNT}% o más de descuento
              {best && <> — {deals.length === 1 ? 'llega a' : 'el mayor llega a'} {discountPercent(best)}%</>}.
            </>
          ) : (
            // Una oferta se muestra solo con el precio revisado hoy (lib/price-freshness).
            <>
              Las ofertas de hoy están en Mercado Libre. Acá puedes ver cuánto costaba cada producto en nuestra última
              revisión y cómo se movió su precio, para saber si una oferta es real.
            </>
          )}
        </p>
        {deals.length === 0 && (
          <div className="mt-5">
            <AffiliateButton
              href={mlOffersUrl(affiliate)}
              placement="ofertas-ml"
              label="Ver las ofertas de hoy en Mercado Libre"
              className="w-full sm:w-auto"
            />
          </div>
        )}
        {deals.length === 0 && (
          <p className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/historial-de-precios" className="font-medium text-accent hover:underline">
              Ver el historial de precios →
            </Link>
            <Link href="/" className="font-medium text-accent hover:underline">
              Ver las categorías →
            </Link>
          </p>
        )}
        {confirmed > 0 && (
          <p className="mt-3 inline-flex max-w-2xl items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs leading-relaxed text-emerald-700 dark:text-emerald-400">
            <TrendingDown size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Primero van {confirmed === 1 ? 'el que bajó' : `los ${confirmed} que bajaron`} de precio según
              nuestro propio registro: {confirmed === 1 ? 'lleva' : 'llevan'} la marca &quot;Bajó&quot; con el monto.
            </span>
          </p>
        )}
        {deals.length > 0 && (
          <p className="mt-2 max-w-2xl text-xs text-muted">
            El descuento y la cifra tachada los informa el vendedor en Mercado Libre.
          </p>
        )}
      </div>

      {deals.length > 0 && (
        <DealsBrowser
          initial={dealsBatch(deals, drops, ALL_DEALS, 0)}
          categories={categories}
          hotCount={countHotDeals(deals)}
          placement="ofertas"
        />
      )}

      {/* Con unas pocas ofertas (las de precios revisados a mano), el resto está en Mercado Libre. */}
      {deals.length > 0 && fewDeals && (
        <div className="mt-8">
          <p className="text-sm text-muted">Las demás ofertas de hoy están en Mercado Libre.</p>
          <div className="mt-3">
            <AffiliateButton
              href={mlOffersUrl(affiliate)}
              placement="ofertas-ml"
              label="Ver las ofertas de hoy en Mercado Libre"
              className="w-full sm:w-auto"
            />
          </div>
        </div>
      )}

      {popular.length > 0 && (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 font-heading text-xl font-bold sm:text-2xl">
            <TrendingUp size={22} className="text-accent" aria-hidden />
            Los más populares
          </h2>
          <p className="mb-4 mt-1 max-w-2xl text-sm text-muted">
            Los productos que más personas fueron a ver a Mercado Libre desde ComparaTech en los últimos 30 días.
          </p>
          <ProductGrid products={popular} eagerImages={deals.length > 0 ? 0 : 4} />
        </section>
      )}
    </div>
  );
}
