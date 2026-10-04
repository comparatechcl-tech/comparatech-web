import type { Metadata } from 'next';
import Link from 'next/link';
import { Flame, Search } from 'lucide-react';
import { getDeals } from '@/lib/queries/products';
import { getSiteCategories } from '@/lib/queries/site-categories';
import { ProductGrid } from '@/components/product/ProductGrid';
import type { CategoryInfo, Product } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Página no encontrada',
  robots: { index: false, follow: true },
};

/**
 * 404 en español y con salida.
 *
 * Llegan acá links viejos de redes, productos que ya no existen y URLs mal
 * escritas. La página por defecto de Next (en inglés y sin nada) era un
 * callejón sin salida: esta ofrece buscar, las categorías y las ofertas del
 * día con su botón de compra.
 */
export default async function NotFound() {
  // La 404 nunca puede caerse: si el catálogo no responde, se muestra sin
  // ofertas ni categorías.
  let deals: Product[] = [];
  let categories: CategoryInfo[] = [];
  try {
    [deals, categories] = await Promise.all([getDeals(), getSiteCategories()]);
  } catch {
    // Solo el buscador y el link a ofertas.
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="mx-auto max-w-xl text-center">
        <p className="font-heading text-sm font-semibold uppercase tracking-wide text-accent">Error 404</p>
        <h1 className="mt-2 font-heading text-2xl font-bold sm:text-3xl">No encontramos esta página</h1>
        <p className="mt-3 text-muted">
          Puede que el producto ya no esté en el catálogo o que el link tenga un error. Busca lo
          que necesitas o revisa las ofertas de hoy.
        </p>

        <form action="/buscar" method="get" role="search" className="mx-auto mt-6 flex max-w-md gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              aria-label="Buscar"
              placeholder="Buscar productos"
              required
              className="w-full rounded-xl border border-border bg-surface2 py-2.5 pl-9 pr-3 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            Buscar
          </button>
        </form>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            href="/ofertas"
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/15"
          >
            <Flame size={14} aria-hidden />
            Ofertas de hoy
          </Link>
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/categoria/${c.slug}`}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-muted transition hover:border-accent/40 hover:text-fg"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </div>

      {deals.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 font-heading text-lg font-semibold">Ofertas de hoy</h2>
          <ProductGrid products={deals.slice(0, 6)} placement="otro" />
        </section>
      )}
    </div>
  );
}
