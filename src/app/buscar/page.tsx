import type { Metadata } from 'next';
import Link from 'next/link';
import { getCatalogProducts, getDeals } from '@/lib/queries/products';
import { getPopulatedCategories } from '@/lib/categories';
import { ProductGrid } from '@/components/product/ProductGrid';
import { FilterPanel } from '@/components/search/FilterPanel';
import { formatDiscountPct } from '@/lib/format';
import { searchProducts } from '@/lib/search';
import { stripDiacritics } from '@/lib/text';

export const metadata: Metadata = {
  title: 'Buscar productos',
  robots: { index: false, follow: true },
};

interface SearchParams {
  q?: string;
  brand?: string;
  maxPrice?: string;
  minDiscount?: string;
}

/** Ofertas que se sugieren cuando la búsqueda no encuentra nada. */
const FALLBACK_DEALS = 8;

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const all = await getCatalogProducts();

  const q = params.q?.trim() ?? '';
  const brand = params.brand ? stripDiacritics(params.brand.toLowerCase().trim()) : undefined;
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;
  const minDiscount = params.minDiscount ? Number(params.minDiscount) : undefined;

  // Con texto, cada palabra se busca por separado y en orden de relevancia
  // (ver lib/search). Sin texto, el catálogo completo para filtrar.
  const matches = q ? searchProducts(all, q) : all;

  const results = matches.filter((p) => {
    if (brand && !stripDiacritics(p.brand.toLowerCase()).includes(brand)) return false;
    if (maxPrice && p.price > maxPrice) return false;
    if (minDiscount) {
      const discount = formatDiscountPct(p.price, p.original_price) ?? 0;
      if (discount < minDiscount) return false;
    }
    return true;
  });

  // Una búsqueda sin resultados no puede ser un callejón sin salida: quien
  // busca ya quiere comprar algo, así que se le ofrece lo mejor de hoy y el
  // camino a las categorías.
  const noResults = q !== '' && results.length === 0;
  const [deals, categories] = noResults
    ? [(await getDeals()).slice(0, FALLBACK_DEALS), getPopulatedCategories(all)]
    : [[], []];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 font-heading text-2xl font-bold sm:text-3xl">Buscar</h1>
      <div className="mb-8">
        <FilterPanel
          defaultValues={{
            q: params.q,
            brand: params.brand,
            maxPrice: params.maxPrice,
            minDiscount: params.minDiscount,
          }}
        />
      </div>

      {noResults ? (
        <div>
          <p className="mb-2 font-heading text-lg font-semibold text-fg">
            No encontramos “{q}”.{' '}
            <Link href="/ofertas" className="text-accent hover:underline">
              Mira las ofertas de hoy
            </Link>
          </p>
          {categories.length > 0 && (
            <nav aria-label="Categorías" className="mb-8 flex flex-wrap gap-2">
              {categories.map((c) => (
                <Link
                  key={c.slug}
                  href={`/categoria/${c.slug}`}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-muted transition hover:border-accent/40 hover:text-fg"
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          )}
          {deals.length > 0 && <ProductGrid products={deals} placement="buscar" />}
        </div>
      ) : (
        <>
          {q && (
            <p className="mb-4 text-sm text-muted">
              {results.length === 1 ? '1 resultado' : `${results.length} resultados`} para “{q}”
            </p>
          )}
          <ProductGrid products={results} placement="buscar" />
        </>
      )}
    </div>
  );
}
