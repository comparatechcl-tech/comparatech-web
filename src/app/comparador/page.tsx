import type { Metadata } from 'next';
import { getAllProducts } from '@/lib/queries/products';
import { CompareClient } from '@/components/compare/CompareClient';

export const metadata: Metadata = {
  title: 'Comparador de productos',
  description: 'Compara specs y precios de dos productos lado a lado.',
};

export default async function ComparadorPage() {
  const products = await getAllProducts();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-2 font-heading text-2xl font-bold">Comparador</h1>
      <p className="mb-6 text-sm text-muted">
        Elige dos productos y compara sus especificaciones y precio en una
        sola tabla.
      </p>
      <CompareClient products={products} />
    </div>
  );
}
