import type { Metadata } from 'next';
import { getCatalogProducts } from '@/lib/queries/products';
import { categoriesWithCounts } from '@/lib/queries/site-categories';
import { defaultComparePair, toCompareDetail } from '@/lib/compare';
import { CompareClient } from '@/components/compare/CompareClient';

export const metadata: Metadata = {
  title: 'Comparador de productos',
  alternates: { canonical: '/comparador' },
  description: 'Compara specs y precios de dos productos lado a lado.',
};

// La página es estática: ?a= y ?b= los lee el comparador en el navegador
// (ver CompareClient), así una visita no cuesta una consulta a Supabase.
export const revalidate = 300;

export default async function ComparadorPage() {
  const catalog = await getCatalogProducts();

  // La página lleva solo el par con que abre y las categorías. Antes le
  // pasaba al navegador todos los productos con sus specs: 790 KB que
  // crecían con el catálogo. El resto se pide a /comparador/datos.
  const [slugA, slugB] = defaultComparePair(catalog);
  const a = catalog.find((p) => p.slug === slugA);
  const b = catalog.find((p) => p.slug === slugB);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-2 font-heading text-2xl font-bold sm:text-3xl">Comparador</h1>
      <p className="mb-6 text-muted">
        Elige dos productos y compara sus especificaciones y precio en una
        sola tabla.
      </p>
      {a && b ? (
        <CompareClient
          initial={{ a: toCompareDetail(a), b: toCompareDetail(b) }}
          categories={categoriesWithCounts(catalog, 1)}
        />
      ) : (
        <p className="py-12 text-center text-muted">Todavía no hay productos para comparar.</p>
      )}
    </div>
  );
}
