import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getProductsByCategory } from '@/lib/queries/products';
import { getCategoryInfo, getAllCategories } from '@/lib/queries/categories';
import { ProductGrid } from '@/components/product/ProductGrid';

export function generateStaticParams() {
  return getAllCategories().map((c) => ({ categoria: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ categoria: string }>;
}): Promise<Metadata> {
  const { categoria } = await params;
  const info = getCategoryInfo(categoria);
  if (!info) return {};

  return {
    title: `${info.name} — Mejores precios en Chile`,
    description: `Compara precios y ofertas de ${info.name.toLowerCase()} en Mercado Libre Chile.`,
  };
}

export default async function CategoriaPage({
  params,
}: {
  params: Promise<{ categoria: string }>;
}) {
  const { categoria } = await params;
  const info = getCategoryInfo(categoria);
  if (!info) notFound();

  const products = await getProductsByCategory(categoria);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 font-heading text-2xl font-bold">{info.name}</h1>
      <ProductGrid products={products} />
    </div>
  );
}
