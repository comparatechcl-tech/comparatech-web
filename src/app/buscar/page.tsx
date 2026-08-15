import type { Metadata } from 'next';
import { getAllProducts } from '@/lib/queries/products';
import { ProductGrid } from '@/components/product/ProductGrid';
import { FilterPanel } from '@/components/search/FilterPanel';
import { formatDiscountPct } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Buscar productos',
  robots: { index: false, follow: true },
};

interface SearchParams {
  q?: string;
  brand?: string;
  maxPrice?: string;
  minDiscount?: string;
}

export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const all = await getAllProducts();

  const q = params.q?.toLowerCase().trim();
  const brand = params.brand?.toLowerCase().trim();
  const maxPrice = params.maxPrice ? Number(params.maxPrice) : undefined;
  const minDiscount = params.minDiscount ? Number(params.minDiscount) : undefined;

  const results = all.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (brand && !p.brand.toLowerCase().includes(brand)) return false;
    if (maxPrice && p.price > maxPrice) return false;
    if (minDiscount) {
      const discount = formatDiscountPct(p.price, p.original_price) ?? 0;
      if (discount < minDiscount) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 font-heading text-2xl font-bold">Buscar</h1>
      <div className="mb-8">
        <FilterPanel
          defaultValues={{
            q: params.q,
            brand: params.brand,
            maxPrice: params.maxPrice,
            minDiscount: params.minDiscount,
          }}
        />
      </div>
      <ProductGrid products={results} />
    </div>
  );
}
