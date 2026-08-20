import Link from 'next/link';
import Image from 'next/image';
import { getFeaturedProducts } from '@/lib/queries/products';
import { CATEGORIES } from '@/lib/types';
import { ProductGrid } from '@/components/product/ProductGrid';
import { FounderBio } from '@/components/brand/FounderBio';

// Revalida cada 5 minutos: así el catálogo se actualiza solo (sin tener que
// hacer un redeploy manual) cuando se cargan productos nuevos en Supabase.
export const revalidate = 300;

export default async function HomePage() {
  const featured = await getFeaturedProducts(8);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="relative mb-14 overflow-hidden rounded-3xl border border-border bg-surface px-6 py-14 text-center sm:py-20">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(60% 60% at 50% 0%, rgba(0,212,255,0.16) 0%, rgba(0,212,255,0) 70%)',
          }}
        />
        <Image
          src="/icon-512.png"
          alt=""
          width={104}
          height={104}
          priority
          className="mx-auto mb-6 h-24 w-24 drop-shadow-[0_0_28px_rgba(0,212,255,0.4)] sm:h-28 sm:w-28"
        />
        <h1 className="font-heading text-4xl font-bold leading-tight sm:text-5xl">
          Compara antes de comprar en <span className="text-accent">Mercado Libre</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
          Precios, specs y descuentos de tecnología y hogar en un solo lugar,
          actualizados a diario.
        </p>
      </section>

      <section className="mb-14">
        <div className="flex flex-wrap justify-center gap-2">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/categoria/${c.slug}`}
              className="rounded-full border border-border px-4 py-1.5 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-14">
        <div className="mb-5 flex items-baseline justify-between">
          <h2 className="font-heading text-2xl font-bold">Recién agregados</h2>
          <span className="text-sm text-muted">{featured.length} productos</span>
        </div>
        <ProductGrid products={featured} />
      </section>

      <section>
        <FounderBio />
      </section>
    </div>
  );
}
