import Link from 'next/link';
import Image from 'next/image';
import { Search, Check, Tags, ChartNoAxesColumn, Link2 } from 'lucide-react';
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

const WHY_US = [
  { icon: Search, title: 'Ahorra tiempo', desc: 'Compara múltiples productos en segundos.' },
  { icon: Tags, title: 'Mejores precios', desc: 'Encuentra siempre la mejor oportunidad.' },
  { icon: ChartNoAxesColumn, title: 'Información clara', desc: 'Especificaciones ordenadas y fáciles de entender.' },
  { icon: Link2, title: 'Enlaces directos', desc: 'Ve directamente a comprar en Mercado Libre.' },
];

const CATEGORY_CARDS = [
  {
    href: '/categoria/celulares',
    image: '/category-celulares.png',
    glow: 'rgba(0,212,255,0.45)',
    title: 'Celulares',
    desc: 'Compara los mejores smartphones',
  },
  {
    href: '/categoria/computacion',
    image: '/category-computacion.png',
    glow: 'rgba(168,85,247,0.4)',
    title: 'Computación',
    desc: 'Notebooks, componentes y más',
  },
  {
    href: '/categoria/electronica',
    image: '/category-electronica.png',
    glow: 'rgba(16,217,160,0.4)',
    title: 'Electrónica',
    desc: 'Audífonos, parlantes, wearables',
  },
  {
    href: '/comparador',
    image: '/category-comparador.png',
    glow: 'rgba(255,230,0,0.4)',
    title: 'Comparador',
    desc: 'Compara 2 productos en detalle',
  },
];

export default async function HomePage() {
  const featured = await getFeaturedProducts(8);

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
            <h1 className="mt-5 font-heading text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
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
                  className="w-full rounded-xl border border-border bg-surface2 py-3 pl-10 pr-3 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-gradient-to-r from-blue to-accent px-5 py-3 font-heading text-sm font-semibold text-ink transition hover:opacity-90"
              >
                Buscar →
              </button>
            </form>
          </div>

          <div className="relative mx-auto hidden aspect-square w-full max-w-md sm:block">
            <Image
              src="/hero-products.png"
              alt="Notebook, celular y audífonos sobre una plataforma iluminada"
              fill
              sizes="(min-width: 640px) 448px, 0px"
              className="object-contain drop-shadow-2xl"
              priority
            />
          </div>
        </div>
      </section>

      {/* Categorías */}
      <section className="mb-16">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {CATEGORY_CARDS.map((c) => {
            return (
              <Link
                key={c.href}
                href={c.href}
                className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_0_40px_-14px_var(--glow)]"
                style={{ '--glow': c.glow } as React.CSSProperties}
              >
                <span className="relative flex h-16 w-16 items-center justify-center">
                  <span
                    className="absolute inset-0 rounded-full blur-xl"
                    style={{ background: c.glow }}
                  />
                  <Image src={c.image} alt="" width={64} height={64} className="relative object-contain" />
                </span>
                <div>
                  <p className="font-heading text-base font-semibold text-fg">{c.title}</p>
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

      {/* ¿Por qué usar ComparaTech? */}
      <section className="mb-16 text-center">
        <h2 className="font-heading text-2xl font-bold">¿Por qué usar ComparaTech?</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          Todo lo que necesitas para tomar la mejor decisión de compra.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {WHY_US.map((w) => {
            const Icon = w.icon;
            return (
              <div key={w.title} className="flex flex-col items-center gap-2.5">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                  <Icon size={20} />
                </span>
                <p className="font-heading text-sm font-semibold text-fg">{w.title}</p>
                <p className="text-xs leading-relaxed text-muted">{w.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <FounderBio />
      </section>
    </div>
  );
}
