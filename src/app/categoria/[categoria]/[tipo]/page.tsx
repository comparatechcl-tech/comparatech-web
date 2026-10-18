import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getCatalogProducts, getProductsByCategory } from '@/lib/queries/products';
import { categoriesWithCounts, getSiteCategoriesWithCounts } from '@/lib/queries/site-categories';
import {
  CATEGORY_PAGE,
  categoryIntro,
  indexableTypes,
  isTypeSlug,
  itemListJsonLd,
  parsePageCount,
  parseSortOrder,
  productsOfType,
  sortProducts,
  summarizeCategory,
  typeChips,
  typeMetaDescription,
  typePath,
} from '@/lib/category-listing';
import { SITE_URL } from '@/lib/site';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { IconTile, categoryIconStyle } from '@/components/brand/CategoryIcon';
import { ListingBody, listingHref } from '../ListingBody';
import { FilterLinks } from '../FilterLinks';
import { filterChips, filterPath, filtersOfType } from '@/lib/listing-filters';

/**
 * La página de un tipo de producto dentro de su categoría
 * (/categoria/audio/audifonos). Ver "Páginas por tipo" en
 * lib/category-listing: se indexan las de MIN_TYPE_PAGE productos o más; las
 * más chicas existen (los chips llevan a ellas) pero con noindex.
 */

type Params = Promise<{ categoria: string; tipo: string }>;
type SearchParams = Promise<{
  orden?: string | string[];
  pagina?: string | string[];
}>;

/** Se pre-generan las que se indexan; las demás, la primera vez que alguien entra. */
export async function generateStaticParams() {
  const catalog = await getCatalogProducts();
  return categoriesWithCounts(catalog, 1).flatMap((category) =>
    indexableTypes(
      catalog.filter((p) => p.category === category.slug),
      category,
    ).map((type) => ({ categoria: category.slug, tipo: type.slug })),
  );
}

// Lo mismo que la página de la categoría: el catálogo se actualiza solo.
export const revalidate = 300;

/** La categoría, sus productos y el tipo pedido (undefined si hoy no tiene productos en ella). */
async function load(categoria: string, tipo: string) {
  const info = (await getSiteCategoriesWithCounts(1)).find((c) => c.slug === categoria);
  if (!info) return null;
  const products = await getProductsByCategory(categoria);
  const chip = typeChips(products).find((t) => t.slug === tipo);
  const indexable = indexableTypes(products, info).some((t) => t.slug === tipo);
  return { info, products, chip, indexable };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { categoria, tipo } = await params;
  const data = await load(categoria, tipo);
  if (!data?.chip) return {};

  const { chip, products, indexable } = data;
  return {
    // El formato que aprobó el dueño el 17-10-2026, el mismo de las categorías.
    title: `${chip.label} — Precios y ofertas en Chile`,
    description: typeMetaDescription(chip.label, summarizeCategory(productsOfType(products, tipo))),
    // Sin ?orden= ni ?pagina=, como en la categoría.
    alternates: { canonical: typePath(categoria, tipo) },
    // Con pocos productos, o con el mismo nombre que la categoría, la página
    // sirve para navegar pero no para Google.
    ...(indexable ? {} : { robots: { index: false, follow: true } }),
  };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TipoPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { categoria, tipo } = await params;
  const data = await load(categoria, tipo);
  if (!data) notFound();
  if (!data.chip) {
    // Un tipo que existe pero hoy no tiene productos en esta categoría vuelve
    // a la categoría (puede volver a tener); una dirección inventada, 404.
    if (isTypeSlug(tipo)) redirect(`/categoria/${categoria}`);
    notFound();
  }

  const { info, products, chip } = data;
  const query = await searchParams;
  const orden = parseSortOrder(single(query.orden));
  const ofType = productsOfType(products, tipo);
  const listed = sortProducts(ofType, orden);
  const pagina = parsePageCount(query.pagina, listed.length);
  const shown = listed.slice(0, pagina * CATEGORY_PAGE);
  const path = typePath(categoria, tipo);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <script
        type="application/ld+json"
        // Ya viene con '<' escapado (ver itemListJsonLd).
        dangerouslySetInnerHTML={{ __html: itemListJsonLd(ofType, SITE_URL, chip.label) }}
      />
      <Breadcrumbs
        items={[
          { name: 'Inicio', href: '/' },
          { name: info.name, href: `/categoria/${categoria}` },
          { name: chip.label },
        ]}
      />

      <div className="flex items-center gap-3">
        <IconTile {...categoryIconStyle(categoria)} size="base" />
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">{chip.label}</h1>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{categoryIntro(summarizeCategory(ofType))}</p>

      {/* Las páginas filtradas de este tipo (lib/listing-filters): "Smart TV 55 pulgadas", "Parlantes JBL". */}
      <FilterLinks
        chips={filterChips(ofType, filtersOfType(categoria, tipo))}
        hrefOf={(slug) => filterPath({ category: categoria, type: tipo, slug })}
        label={filtersOfType(categoria, tipo).some((f) => f.rule.kind === 'pulgadas') ? 'Por tamaño y marca' : 'Por marca'}
      />

      <ListingBody
        chips={typeChips(products)}
        activeType={tipo}
        allHref={`/categoria/${categoria}`}
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
