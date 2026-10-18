import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductsByCategory } from '@/lib/queries/products';
import { getSiteCategoriesWithCounts } from '@/lib/queries/site-categories';
import {
  CATEGORY_PAGE,
  categoryIntro,
  itemListJsonLd,
  parsePageCount,
  parseSortOrder,
  productsOfType,
  sortProducts,
  summarizeCategory,
  typeChips,
  typeIsCategory,
  typeMetaDescription,
  typePath,
} from '@/lib/category-listing';
import {
  LISTING_FILTERS,
  MIN_FILTER_PAGE,
  filterChips,
  filterPath,
  filterTitle,
  filtersOfType,
  getFilter,
  productsOfFilter,
} from '@/lib/listing-filters';
import { SITE_URL } from '@/lib/site';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { IconTile, categoryIconStyle } from '@/components/brand/CategoryIcon';
import { ListingBody, listingHref } from '../../ListingBody';
import { FilterLinks } from '../../FilterLinks';

/**
 * Una página filtrada dentro de un tipo (/categoria/electronica/televisores/55-pulgadas).
 * Ver lib/listing-filters: la lista es a mano, se indexan las de
 * MIN_FILTER_PAGE productos o más y las demás llevan noindex.
 */

type Params = Promise<{ categoria: string; tipo: string; filtro: string }>;
type SearchParams = Promise<{ orden?: string | string[]; pagina?: string | string[] }>;

/** Son pocas (la lista de lib/listing-filters): se arman todas en el despliegue. */
export function generateStaticParams() {
  return LISTING_FILTERS.map((f) => ({ categoria: f.category, tipo: f.type, filtro: f.slug }));
}

/** Un filtro que no está en la lista no tiene página. */
export const dynamicParams = false;

// Lo mismo que la página del tipo: el catálogo se actualiza solo.
export const revalidate = 300;

async function load(categoria: string, tipo: string, filtro: string) {
  const filter = getFilter(categoria, tipo, filtro);
  if (!filter) return null;
  const info = (await getSiteCategoriesWithCounts(1)).find((c) => c.slug === categoria);
  if (!info) return null;
  const inCategory = await getProductsByCategory(categoria);
  const ofType = productsOfType(inCategory, tipo);
  const products = productsOfFilter(ofType, filter);
  const typeLabel = typeChips(inCategory).find((t) => t.slug === tipo)?.label ?? tipo;
  return { filter, info, ofType, products, typeLabel, indexable: products.length >= MIN_FILTER_PAGE };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { categoria, tipo, filtro } = await params;
  const data = await load(categoria, tipo, filtro);
  if (!data || data.products.length === 0) return {};
  const { filter, products, indexable } = data;
  return {
    title: { absolute: filterTitle(filter) },
    description: typeMetaDescription(filter.label, summarizeCategory(products)),
    // Sin ?orden= ni ?pagina=, como en el tipo.
    alternates: { canonical: filterPath(filter) },
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function FiltroPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { categoria, tipo, filtro } = await params;
  const data = await load(categoria, tipo, filtro);
  if (!data) notFound();
  const { filter, info, ofType, products, typeLabel } = data;
  // Hoy sin productos: vuelve al tipo (o a la categoría), que puede tener otros.
  const typeIsSelf = typeIsCategory({ slug: tipo, label: typeLabel }, info);
  const parentPath = typeIsSelf ? `/categoria/${categoria}` : typePath(categoria, tipo);
  if (products.length === 0) redirect(parentPath);

  const query = await searchParams;
  const orden = parseSortOrder(single(query.orden));
  const listed = sortProducts(products, orden);
  const pagina = parsePageCount(query.pagina, listed.length);
  const shown = listed.slice(0, pagina * CATEGORY_PAGE);
  const path = filterPath(filter);
  const siblings = filtersOfType(categoria, tipo);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script
        type="application/ld+json"
        // Ya viene con '<' escapado (ver itemListJsonLd).
        dangerouslySetInnerHTML={{ __html: itemListJsonLd(products, SITE_URL, filter.label) }}
      />
      <Breadcrumbs
        items={[
          { name: 'Inicio', href: '/' },
          { name: info.name, href: `/categoria/${categoria}` },
          ...(typeIsSelf ? [] : [{ name: typeLabel, href: typePath(categoria, tipo) }]),
          { name: filter.label },
        ]}
      />

      <div className="flex items-center gap-3">
        <IconTile {...categoryIconStyle(categoria)} size="base" />
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">{filter.label}</h1>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{categoryIntro(summarizeCategory(products))}</p>

      <FilterLinks
        chips={filterChips(ofType, siblings)}
        hrefOf={(slug) => filterPath({ category: categoria, type: tipo, slug })}
        label={siblings.some((f) => f.rule.kind === 'pulgadas') ? 'Por tamaño y marca' : 'Por marca'}
        active={filtro}
        all={{ href: parentPath, label: `Todos (${ofType.length})` }}
      />

      <ListingBody
        chips={[]}
        allHref={parentPath}
        typeHref={(slug) => typePath(categoria, slug)}
        sortHref={(order) => listingHref(path, order)}
        orden={orden}
        shown={shown}
        total={listed.length}
        moreHref={listingHref(path, orden, pagina + 1)}
      />
    </div>
  );
}
