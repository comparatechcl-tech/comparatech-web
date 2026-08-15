import Link from 'next/link';
import { getFeaturedProducts } from '@/lib/queries/products';
import { CATEGORIES } from '@/lib/types';
import { ProductGrid } from '@/components/product/ProductGrid';
import { FounderBio } from '@/components/brand/FounderBio';

export default async function HomePage() {
  const featured = await getFeaturedProducts(8);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="mb-12 text-center">
        <h1 className="font-heading text-3xl font-bold sm:text-4xl">
          Compara antes de comprar en <span className="text-accent">Mercado Libre</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Precios, specs y descuentos de tecnología y hogar en un solo lugar,
          actualizados a diario.
        </p>
      </section>

      <section className="mb-12">
        <div className="mb-4 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/categoria/${c.slug}`}
              className="rounded-full border border-border px-4 py-1.5 text-sm text-muted transition hover:border-accent hover:text-accent"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <h2 className="mb-4 font-heading text-xl font-semibold">Destacados</h2>
        <ProductGrid products={featured} />
      </section>

      <section>
        <FounderBio />
      </section>
    </div>
  );
}
