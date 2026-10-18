import { notFound, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductsByCategory } from '@/lib/queries/products';
import { getSiteCategoriesWithCounts } from '@/lib/queries/site-categories';
import {
  CATEGORY_PAGE,
  categoryIntro,
  categoryMetaDescription,
  itemListJsonLd,
  parsePageCount,
  parseSortOrder,
  sortProducts,
  summarizeCategory,
  typeChips,
  typePath,
} from '@/lib/category-listing';
import { SITE_URL } from '@/lib/site';
import { IconTile, categoryIconStyle } from '@/components/brand/CategoryIcon';
import { ListingBody, listingHref } from './ListingBody';

type Params = Promise<{ categoria: string }>;
type SearchParams = Promise<{
  orden?: string | string[];
  tipo?: string | string[];
  pagina?: string | string[];
}>;

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
    title: `${info.name} — Precios y ofertas en Chile`,
    // El canonical no lleva ?orden= ni ?pagina=: son la misma lista en otro
    // orden o más larga, no páginas distintas.
    alternates: { canonical: `/categoria/${categoria}` },
    description: categoryMetaDescription(info.name, summarizeCategory(products)),
  };
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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

  // El filtro viejo (?tipo=audifonos) es ahora la página del tipo. Los links
  // ya publicados o guardados llevan ahí, con redirección permanente.
  const tipo = single(query.tipo);
  if (tipo && chips.some((c) => c.slug === tipo)) permanentRedirect(listingHref(typePath(categoria, tipo), orden));

  const listed = sortProducts(products, orden);
  // Con todos los productos en una sola grilla, la página crecía con el
  // catálogo (Computación pesaba 1 MB). Se muestra de a tandas.
  const pagina = parsePageCount(query.pagina, listed.length);
  const shown = listed.slice(0, pagina * CATEGORY_PAGE);
  const path = `/categoria/${categoria}`;

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
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{categoryIntro(summarizeCategory(products))}</p>

      <ListingBody
        chips={chips}
        allHref={path}
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
