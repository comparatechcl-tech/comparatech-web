import type { Metadata } from 'next';
import { getCatalogProducts } from '@/lib/queries/products';
import { CompareClient, type CompareProduct } from '@/components/compare/CompareClient';

export const metadata: Metadata = {
  title: 'Comparador de productos',
  alternates: { canonical: '/comparador' },
  description: 'Compara specs y precios de dos productos lado a lado.',
};

// La página es estática: ?a= y ?b= los lee el comparador en el navegador
// (ver CompareClient), así una visita no cuesta una consulta a Supabase.
export const revalidate = 300;

export default async function ComparadorPage() {
  // Solo los campos que usa la tabla: la descripción de cada producto
  // viajaría entera al navegador sin mostrarse nunca.
  const products: CompareProduct[] = (await getCatalogProducts()).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    category: p.category,
    ml_domain_id: p.ml_domain_id,
    seller_sales_count: p.seller_sales_count,
    price: p.price,
    image_url: p.image_url,
    specs: p.specs,
    affiliate_url: p.affiliate_url,
    outbound_url: p.outbound_url,
    ml_product_id: p.ml_product_id,
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="mb-2 font-heading text-2xl font-bold sm:text-3xl">Comparador</h1>
      <p className="mb-6 text-muted">
        Elige dos productos y compara sus especificaciones y precio en una
        sola tabla.
      </p>
      <CompareClient products={products} />
    </div>
  );
}
