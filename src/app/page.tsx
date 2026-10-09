import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Search, Check, Tags, ChartNoAxesColumn, Link2, Flame, Sparkles } from 'lucide-react';
import { getCatalogProducts, getDeals } from '@/lib/queries/products';
import { getPriceStatsMany } from '@/lib/queries/price-history';
import { dropsById, rankDeals } from '@/lib/deal-rank';
import { ProductGrid } from '@/components/product/ProductGrid';
import { DealStrip } from '@/components/product/DealStrip';
import { DealSpotlight } from '@/components/product/DealSpotlight';
import { BrandFace } from '@/components/brand/BrandFace';
import { BRAND_GRADIENT, COMPARADOR_ICON, IconTile, categoryIconStyle } from '@/components/brand/CategoryIcon';
import { QuickCompare } from '@/components/compare/QuickCompare';
import { getSiteCategories } from '@/lib/queries/site-categories';

// El canonical va por pagina y no en el layout: ahi convertiria a todo el
// sitio en duplicado de la home.
export const metadata: Metadata = { alternates: { canonical: '/' } };

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
  { icon: Search, title: 'Ahorra tiempo', desc: 'Compara varios productos en segundos.' },
  { icon: Tags, title: 'Ofertas a la vista', desc: 'Mira qué productos aparecen con descuento en Mercado Libre y cuáles bajaron de precio.' },
  { icon: ChartNoAxesColumn, title: 'Información clara', desc: 'Especificaciones ordenadas y fáciles de entender.' },
  { icon: Link2, title: 'Enlaces directos', desc: 'Ve directamente a comprar en Mercado Libre.' },
];

/**
 * Qué decir de cada categoría en la portada. El icono y el color salen de
 * components/brand/CategoryIcon, el mismo mapa que usa el menú: una
 * categoría nueva aparece con icono aunque todavía no tenga texto acá.
 */
const CATEGORY_DESC: Record<string, string> = {
  celulares: 'Compara precios y especificaciones de smartphones',
  computacion: 'Notebooks, componentes y más',
  electronica: 'Televisores, relojes y accesorios',
  audio: 'Audífonos, parlantes y más',
  gaming: 'Consolas, controles y accesorios',
  hogar: 'Sillas, escritorios e iluminación',
  electrodomesticos: 'Línea blanca y cocina',
};

/** Hex de 6 dígitos a rgba, para el resplandor de cada tarjeta. */
function glowOf(hex: string, alpha = 0.45): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Ofertas que se miran en el historial para decidir cuál va primero. */
const DEALS_POOL = 24;
/** Cuántas ofertas van en la franja del celular y en la grilla de escritorio. */
const DEALS_MOBILE = 8;
const DEALS_DESKTOP = 8;
const PICKS_LIMIT = 4;
const NEW_LIMIT = 8;
/** Productos de cada categoría que ofrece el comparador rápido de la portada. */
const COMPARE_PER_CATEGORY = 15;

const dropDateFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  day: 'numeric',
  month: 'short',
});

export default async function HomePage() {
  const [catalog, categories, allDeals] = await Promise.all([
    getCatalogProducts(),
    getSiteCategories(),
    getDeals(),
  ]);

  // Las ofertas que bajaron de verdad (según nuestro propio registro de
  // precios) van primero; el resto, por descuento. Se mira solo el comienzo
  // de la lista: leer el historial de las cien ofertas en cada regeneración
  // de la portada no cambia qué se ve arriba.
  const pool = allDeals.slice(0, DEALS_POOL);
  const stats = await getPriceStatsMany(pool.map((p) => p.id));
  const ranked = rankDeals(pool, stats);
  const drops = dropsById(ranked, stats);

  const spotlight = ranked[0];
  const spotlightDrop = spotlight ? drops[spotlight.id] : undefined;
  const mobileDeals = ranked.slice(0, DEALS_MOBILE);
  // En escritorio la primera ya está en el encabezado: la grilla sigue desde la segunda.
  const desktopDeals = ranked.slice(1, 1 + DEALS_DESKTOP);

  // Los productos marcados como destacados en el admin. Si no hay ninguno,
  // el bloque no aparece: mejor nada que una sección vacía.
  const picks = catalog.filter((p) => p.is_featured).slice(0, PICKS_LIMIT);

  // "Recién agregados" no repite lo que ya está más arriba: con un catálogo
  // chico, las mismas tarjetas dos veces en la portada parecían un relleno.
  const shownAbove = new Set([...ranked.slice(0, 1 + DEALS_DESKTOP), ...picks].map((p) => p.id));
  const fresh = catalog.filter((p) => !shownAbove.has(p.id)).slice(0, NEW_LIMIT);

  // El comparador rápido recibe solo lo que usa para elegir, y solo lo más
  // vendido de cada categoría: con el catálogo entero la portada llevaba dos
  // listas de 700 productos escritas en el HTML (dos tercios de su peso), y
  // nadie encuentra nada en un desplegable de ese largo. El comparador
  // completo sigue en /comparador.
  const perCategory = new Map<string, number>();
  const compareOptions = [...catalog]
    .sort((a, b) => (b.seller_sales_count ?? 0) - (a.seller_sales_count ?? 0))
    .filter((p) => {
      const used = perCategory.get(p.category) ?? 0;
      perCategory.set(p.category, used + 1);
      return used < COMPARE_PER_CATEGORY;
    })
    .map(({ slug, name, category, ml_domain_id, seller_sales_count }) => ({
      slug,
      name,
      category,
      ml_domain_id,
      seller_sales_count,
    }));

  const categoryCards = [
    ...categories.map((c) => ({
      href: `/categoria/${c.slug}`,
      title: c.name,
      desc: CATEGORY_DESC[c.slug] ?? 'Ver productos',
      style: categoryIconStyle(c.slug),
    })),
    {
      href: '/comparador',
      title: 'Comparador',
      desc: 'Compara 2 productos en detalle',
      style: COMPARADOR_ICON,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 sm:pt-8">
      {/* Hero. En el celular queda solo el título y el buscador: todo lo
          demás empujaba la primera oferta fuera de la pantalla, y el tráfico
          de redes llega casi entero desde el teléfono. En escritorio, la
          mitad derecha es la mejor oferta del momento. */}
      <section className="relative mb-6 overflow-hidden rounded-3xl border border-border bg-surface px-5 py-6 sm:mb-12 sm:px-10 sm:py-10">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(55% 65% at 15% 15%, rgba(8,126,255,0.18) 0%, rgba(8,126,255,0) 60%), radial-gradient(45% 55% at 90% 20%, rgba(0,212,255,0.14) 0%, rgba(0,212,255,0) 65%)',
          }}
        />
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-surface2 px-3.5 py-1.5 text-xs font-medium text-muted sm:inline-flex">
              Compara · Elige · Ahorra
            </span>
            <h1 className="font-heading text-3xl font-extrabold leading-[1.08] tracking-tight sm:mt-5 sm:text-5xl">
              Encuentra el mejor <br className="hidden sm:block" />
              producto al <span className="text-accent">mejor precio</span>
            </h1>
            <p className="mt-4 hidden max-w-md text-muted sm:block">
              Compara especificaciones y precios de celulares, computadores,
              audífonos y más, todo en una sola tabla.
            </p>

            <ul className="mt-6 hidden grid-cols-2 gap-x-6 gap-y-2 sm:grid">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm text-muted">
                  <Check size={15} className="shrink-0 text-accent" />
                  {b}
                </li>
              ))}
            </ul>

            <form action="/buscar" method="get" role="search" className="mt-5 flex max-w-md gap-2 sm:mt-7">
              <div className="relative flex-1">
                <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  name="q"
                  aria-label="Buscar productos"
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

          {spotlight ? (
            // Desde lg: más abajo el encabezado es de una columna y la
            // franja de ofertas viene justo después.
            <div className="hidden lg:block">
              <DealSpotlight
                product={(({ description: _description, ...card }) => card)(spotlight)}
                drop={spotlightDrop}
                dropDate={spotlightDrop ? dropDateFmt.format(new Date(spotlightDrop.since)) : null}
                dealsCount={allDeals.length}
              />
            </div>
          ) : (
            // Sin ninguna oferta en el catálogo queda la ilustración de siempre.
            <div className="relative mx-auto hidden aspect-square w-full max-w-md lg:block">
              <Image
                src="/hero-products.png"
                alt="Notebook, celular y audífonos sobre una plataforma iluminada"
                fill
                sizes="(min-width: 1024px) 448px, 0px"
                className="object-contain drop-shadow-2xl"
                priority
              />
            </div>
          )}
        </div>
      </section>

      {/* Ofertas — lo primero después del hero: es el gancho real del sitio
          y el destino de lo que se publica en redes. Solo aparece si hay
          rebajas de verdad, para no dejar una sección vacía. */}
      {mobileDeals.length > 0 && (
        <section className="mb-12 sm:mb-16">
          <div className="mb-3 flex items-end justify-between gap-4 sm:mb-5">
            <div>
              <h2 className="flex items-center gap-2 font-heading text-xl font-bold sm:text-2xl">
                <Flame size={22} className="text-orange-500" />
                Ofertas del día
              </h2>
              <p className="mt-1 hidden text-sm text-muted sm:block">
                {allDeals.length} {allDeals.length === 1 ? 'producto' : 'productos'} con 20% o más de descuento.
                Primero, los que bajaron de precio.
              </p>
            </div>
            <Link
              href="/ofertas"
              className="shrink-0 rounded-full border border-accent/40 px-3.5 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/10"
            >
              Ver las {allDeals.length} →
            </Link>
          </div>
          {/* Franja deslizable en el celular, grilla en pantallas grandes. */}
          <div className="lg:hidden">
            <DealStrip
              products={mobileDeals.map(({ description: _description, ...card }) => card)}
              placement="home-ofertas"
              drops={drops}
            />
          </div>
          <div className="hidden lg:block">
            <ProductGrid products={desktopDeals} placement="home-ofertas" drops={drops} />
          </div>
        </section>
      )}

      {/* Categorías */}
      <section className="mb-16">
        <h2 className="mb-5 font-heading text-xl font-bold sm:text-2xl">Explora por categoría</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {categoryCards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="group flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_0_40px_-14px_var(--glow)]"
              style={{ '--glow': glowOf(c.style.to) } as React.CSSProperties}
            >
              <IconTile {...c.style} className="transition duration-200 group-hover:scale-105" />
              <div>
                <p className="font-heading text-base font-semibold text-fg">{c.title}</p>
                <p className="mt-0.5 text-xs text-muted">{c.desc}</p>
              </div>
              <span className="mt-auto text-xs font-medium text-accent opacity-0 transition group-hover:opacity-100">
                Ver más →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Comparador rápido */}
      {compareOptions.length >= 2 && (
        <section className="mb-16">
          <QuickCompare products={compareOptions} />
        </section>
      )}

      {/* Destacados: los productos marcados así en el admin. El título no
          los atribuye a nadie ni los llama recomendados: nadie los revisa
          uno por uno. */}
      {picks.length > 0 && (
        <section className="mb-16">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="flex items-center gap-2 font-heading text-2xl font-bold">
              <Sparkles size={20} className="text-accent" />
              Destacados
            </h2>
          </div>
          <ProductGrid products={picks} placement="home" />
        </section>
      )}

      {/* Recién agregados */}
      {fresh.length > 0 && (
        <section className="mb-16">
          <div className="mb-5 flex items-baseline justify-between">
            <h2 className="font-heading text-2xl font-bold">Recién agregados</h2>
            <span className="text-sm text-muted">{fresh.length} productos</span>
          </div>
          <ProductGrid products={fresh} placement="home-nuevos" />
        </section>
      )}

      {/* ¿Por qué usar ComparaTech? */}
      <section className="mb-16 text-center">
        <h2 className="font-heading text-2xl font-bold">¿Por qué usar ComparaTech?</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          Precios y especificaciones en un solo lugar, para que compares antes de comprar.
        </p>
        <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {WHY_US.map((w) => (
            <div key={w.title} className="flex flex-col items-center gap-2.5">
              <IconTile icon={w.icon} {...BRAND_GRADIENT} size="base" />
              <p className="font-heading text-sm font-semibold text-fg">{w.title}</p>
              <p className="text-xs leading-relaxed text-muted">{w.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <BrandFace />
      </section>
    </div>
  );
}
