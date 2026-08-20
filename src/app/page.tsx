import Link from 'next/link';
import Image from 'next/image';
import { Smartphone, Laptop, Headphones, Scale, Search, Check } from 'lucide-react';
import { getFeaturedProducts } from '@/lib/queries/products';
import { ProductGrid } from '@/components/product/ProductGrid';
import { FounderBio } from '@/components/brand/FounderBio';
import { QuickCompare } from '@/components/compare/QuickCompare';

// Revalida cada 5 minutos: así el catálogo se actualiza solo (sin tener que
// hacer un redeploy manual) cuando se cargan productos nuevos en Supabase.
export const revalidate = 300;

const BENEFITS = [
  'Comparación lado a lado',
  'Precios actualizados',
  'Enlaces directos a Mercado Libre',
  'Fácil y rápido',
];

const CATEGORY_CARDS = [
  {
    href: '/categoria/celulares',
    icon: Smartphone,
    color: 'text-accent bg-accent/10',
    title: 'Celulares',
    desc: 'Compara los mejores smartphones',
  },
  {
    href: '/categoria/computacion',
    icon: Laptop,
    color: 'text-blue bg-blue/10',
    title: 'Computación',
    desc: 'Notebooks, componentes y más',
  },
  {
    href: '/categoria/electronica',
    icon: Headphones,
    color: 'text-accent bg-accent/10',
    title: 'Electrónica',
    desc: 'Audífonos, parlantes, wearables',
  },
  {
    href: '/comparador',
    icon: Scale,
    color: 'text-mlYellow bg-mlYellow/10',
    title: 'Comparador',
    desc: 'Compara 2 productos en detalle',
  },
];

export default async function HomePage() {
  const featured = await getFeaturedProducts(8);
  const heroProducts = featured.slice(0, 3);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Hero */}
      <section className="relative mb-16 overflow-hidden rounded-3xl border border-border bg-surface px-6 py-12 sm:px-10 sm:py-16">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(55% 65% at 15% 15%, rgba(8,126,255,0.18) 0%, rgba(8,126,255,0) 60%), radial-gradient(45% 55% at 90% 20%, rgba(0,212,255,0.14) 0%, rgba(0,212,255,0) 65%)',
          }}
        />
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface2 px-3.5 py-1.5 text-xs font-medium text-muted">
              Compara · Elige · Ahorra
            </span>
            <h1 className="mt-5 font-heading text-4xl font-bold leading-[1.08] sm:text-5xl">
              Encuentra el mejor <br className="hidden sm:block" />
              producto al <span className="text-accent">mejor precio</span>
            </h1>
            <p className="mt-4 max-w-md text-muted">
              Compara especificaciones y precios de celulares, computadores,
              audífonos y más, todo en una sola tabla.
            </p>

            <ul className="mt-6 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm text-muted">
                  <Check size={15} className="shrink-0 text-accent" />
                  {b}
                </li>
              ))}
            </ul>

            <form action="/buscar" method="get" className="mt-7 flex max-w-md gap-2">
              <div className="relative flex-1">
                <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  name="q"
                  placeholder="Busca un producto, marca o modelo..."
                  className="w-full rounded-xl border border-border bg-surface2 py-3 pl-10 pr-3 text-sm text-white placeholder:text-muted transition focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-gradient-to-r from-blue to-accent px-5 py-3 font-heading text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Buscar →
              </button>
            </form>
          </div>

          {heroProducts.length > 0 && (
            <div className="relative mx-auto hidden h-72 w-full max-w-sm sm:block">
              <div
                className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
                style={{ background: 'radial-gradient(closest-side, rgba(0,212,255,0.22), transparent)' }}
              />
              {heroProducts.map((p, i) => (
                <div
                  key={p.id}
                  className="absolute overflow-hidden rounded-2xl border border-border bg-surface2 shadow-2xl"
                  style={{
                    width: i === 0 ? '65%' : '46%',
                    aspectRatio: '1 / 1',
                    top: i === 0 ? '8%' : i === 1 ? '48%' : '2%',
                    left: i === 0 ? '2%' : i === 1 ? '0%' : '54%',
                    transform: `rotate(${i === 0 ? -3 : i === 1 ? 4 : -6}deg)`,
                    zIndex: 3 - i,
                  }}
                >
                  <Image src={p.image_url} alt={p.name} fill className="object-cover" />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Categorías */}
      <section className="mb-16">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {CATEGORY_CARDS.map((c) => {
            const Icon = c.icon;
            return (
              <Link
                key={c.href}
                href={c.href}
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
              >
                <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${c.color}`}>
                  <Icon size={20} />
                </span>
                <div>
                  <p className="font-heading text-base font-semibold text-white">{c.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{c.desc}</p>
                </div>
                <span className="mt-auto text-xs font-medium text-accent opacity-0 transition group-hover:opacity-100">
                  Ver más →
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Comparador rápido */}
      {featured.length >= 2 && (
        <section className="mb-16">
          <QuickCompare products={featured} />
        </section>
      )}

      {/* Recién agregados */}
      <section className="mb-16">
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
