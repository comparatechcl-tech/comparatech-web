import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductsByCategory } from '@/lib/queries/products';
import { getSiteCategoriesWithCounts } from '@/lib/queries/site-categories';
import {
  SORT_OPTIONS,
  categoryIntro,
  categoryMetaDescription,
  filterByType,
  itemListJsonLd,
  parseSortOrder,
  sortProducts,
  summarizeCategory,
  typeChips,
  type SortOrder,
} from '@/lib/category-listing';
import { SITE_URL } from '@/lib/site';
import { ProductGrid } from '@/components/product/ProductGrid';
import { IconTile, categoryIconStyle } from '@/components/brand/CategoryIcon';

type Params = Promise<{ categoria: string }>;
type SearchParams = Promise<{ orden?: string | string[]; tipo?: string | string[] }>;

/**
 * Solo las categorías con productos: una categoría vacía no se pre-genera ni
 * se muestra. Antes /categoria/gaming respondía 200 con una grilla vacía,
 * una página que Google indexaba como contenido pobre.
 */
export async function generateStaticParams() {
  return (await getSiteCategoriesWithCounts(1)).map((c) => ({ categoria: c.slug }));
}

// Revalida cada 5 minutos para que el catálogo se actualice solo cuando
// cambien los productos en Supabase, sin necesitar un redeploy manual.
export const revalidate = 300;

/** La categoría si tiene al menos un producto visible; si no, undefined. */
async function findCategory(slug: string) {
  return (await getSiteCategoriesWithCounts(1)).find((c) => c.slug === slug);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { categoria } = await params;
  const info = await findCategory(categoria);
  if (!info) return {};

  const products = await getProductsByCategory(categoria);
  return {
    title: `${info.name} — Mejores precios en Chile`,
    // El canonical no lleva ?orden= ni ?tipo=: son la misma lista en otro
    // orden, no páginas distintas.
    alternates: { canonical: `/categoria/${categoria}` },
    description: categoryMetaDescription(info.name, summarizeCategory(products)),
  };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** URL de un chip: conserva el otro filtro y omite los valores por defecto. */
function chipHref(categoria: string, orden: SortOrder, tipo: string | undefined): string {
  const qs = new URLSearchParams();
  if (orden !== 'relevancia') qs.set('orden', orden);
  if (tipo) qs.set('tipo', tipo);
  const query = qs.toString();
  return `/categoria/${categoria}${query ? `?${query}` : ''}`;
}

function chipClass(active: boolean): string {
  return `inline-flex shrink-0 items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
    active
      ? 'border-accent bg-accent/10 text-accent'
      : 'border-border bg-surface text-muted hover:border-accent/40 hover:text-fg'
  }`;
}

export default async function CategoriaPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { categoria } = await params;
  const info = await findCategory(categoria);
  if (!info) notFound();

  const query = await searchParams;
  const orden = parseSortOrder(query.orden);
  const products = await getProductsByCategory(categoria);
  const chips = typeChips(products);
  const tipo = chips.some((c) => c.slug === single(query.tipo)) ? single(query.tipo) : undefined;
  const shown = sortProducts(filterByType(products, tipo), orden);
  const summary = summarizeCategory(products);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script
        type="application/ld+json"
        // Ya viene con '<' escapado (ver itemListJsonLd).
        dangerouslySetInnerHTML={{ __html: itemListJsonLd(products, SITE_URL, info.name) }}
      />

      <div className="flex items-center gap-3">
        <IconTile {...categoryIconStyle(categoria)} size="base" />
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">{info.name}</h1>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{categoryIntro(summary)}</p>

      <div className="mt-6 flex flex-col gap-3">
        {chips.length > 0 && (
          <nav aria-label="Filtrar por tipo" className="-mx-4 overflow-x-auto px-4">
            <ul className="flex gap-2">
              <li>
                <Link
                  href={chipHref(categoria, orden, undefined)}
                  aria-current={!tipo ? 'page' : undefined}
                  className={chipClass(!tipo)}
                >
                  Todos
                </Link>
              </li>
              {chips.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={chipHref(categoria, orden, c.slug)}
                    aria-current={tipo === c.slug ? 'page' : undefined}
                    className={chipClass(tipo === c.slug)}
                  >
                    {c.label}
                    <span className="text-[10px] opacity-70">{c.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label="Ordenar productos" className="-mx-4 overflow-x-auto px-4">
          <ul className="flex items-center gap-2">
            <li className="shrink-0 text-xs text-muted">Ordenar por:</li>
            {SORT_OPTIONS.map((o) => (
              <li key={o.value}>
                <Link
                  href={chipHref(categoria, o.value, tipo)}
                  aria-current={orden === o.value ? 'page' : undefined}
                  className={chipClass(orden === o.value)}
                >
                  {o.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mt-6">
        <ProductGrid products={shown} placement="categoria" />
      </div>
    </div>
  );
}
