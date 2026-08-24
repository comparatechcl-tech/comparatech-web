import type { Metadata } from 'next';
import { getCatalogProducts } from '@/lib/queries/products';
import { CompareClient } from '@/components/compare/CompareClient';

export const metadata: Metadata = {
  title: 'Comparador de productos',
  description: 'Compara specs y precios de dos productos lado a lado.',
};

export const revalidate = 300;

export default async function ComparadorPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
  const products = await getCatalogProducts();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-2 font-heading text-2xl font-bold sm:text-3xl">Comparador</h1>
      <p className="mb-6 text-muted">
        Elige dos productos y compara sus especificaciones y precio en una
        sola tabla.
      </p>
      <CompareClient products={products} initialSlugA={a} initialSlugB={b} />
    </div>
  );
}
