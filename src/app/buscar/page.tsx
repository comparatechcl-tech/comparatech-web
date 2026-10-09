import type { Metadata } from 'next';
import Link from 'next/link';
import { getCatalogProducts, getDeals } from '@/lib/queries/products';
import { getPopulatedCategories } from '@/lib/categories';
import { CATEGORY_PAGE, parsePageCount } from '@/lib/category-listing';
import { ProductGrid } from '@/components/product/ProductGrid';
import { PendingLabel } from '@/components/layout/PendingLabel';
import { FilterPanel } from '@/components/search/FilterPanel';
import { formatDiscountPct } from '@/lib/format';
import { readSearchQuery, searchHref, searchProducts } from '@/lib/search';
import { stripDiacritics } from '@/lib/text';

export const metadata: Metadata = {
  title: 'Buscar productos',
  robots: { index: false, follow: true },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Ofertas que se sugieren cuando la búsqueda no encuentra nada. */
const FALLBACK_DEALS = 8;

export default async function BuscarPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const all = await getCatalogProducts();

  const query = readSearchQuery(params);
  const q = query.q ?? '';
  const brand = query.brand ? stripDiacritics(query.brand.toLowerCase()) : undefined;
  const maxPrice = query.maxPrice ? Number(query.maxPrice) : undefined;
  const minDiscount = query.minDiscount ? Number(query.minDiscount) : undefined;

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

  // Sin texto, o con una búsqueda amplia, la grilla traía el catálogo entero
  // (663 tarjetas, 2,5 MB) y crecía con él. Se muestra de a tandas, igual
  // que las categorías: ?pagina= dice cuántas se ven.
  const pagina = parsePageCount(params.pagina, results.length);
  const shown = results.slice(0, pagina * CATEGORY_PAGE);
  const remaining = results.length - shown.length;

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
        {/* El formulario no manda `pagina`: al cambiar el texto o un filtro
            la lista vuelve a su primera tanda. */}
        <FilterPanel defaultValues={query} />
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
          <ProductGrid products={shown} placement="buscar" />

          {remaining > 0 && (
            <div className="mt-8 flex flex-col items-center gap-2">
              {/* Mismo link que en las categorías: los productos nuevos
                  aparecen debajo, sin mover la página ni sumar un paso al
                  botón "atrás", y funciona sin JavaScript. */}
              <Link
                href={searchHref(query, pagina + 1)}
                replace
                scroll={false}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-full border border-accent/40 px-6 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/10"
              >
                <PendingLabel>
                  Ver {Math.min(CATEGORY_PAGE, remaining)} {remaining === 1 ? 'producto' : 'productos'} más
                </PendingLabel>
              </Link>
              <p className="text-xs text-muted">
                Mostrando {shown.length} de {results.length}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
