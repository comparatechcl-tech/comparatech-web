import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getGuideView } from '@/lib/queries/guides';
import { GUIDES, getGuide, guidePath, sectionRange, sectionSummary } from '@/lib/guides';
import { itemListJsonLd } from '@/lib/category-listing';
import { SITE_URL } from '@/lib/site';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { ProductGrid } from '@/components/product/ProductGrid';

/**
 * Una guía de compra (/guias/regalos-tecnologicos). Ver lib/guides: qué
 * guías hay, qué entra a cada sección y qué queda fuera.
 *
 * La lista se arma sola con el catálogo y el historial del día, así que la
 * página no puede decir que alguien eligió o probó cada producto: dice cómo
 * se armó, con las reglas de verdad (si cambian las reglas, cambia `method`).
 */

type Params = Promise<{ guia: string }>;

/** Son pocas (la lista de lib/guides): se arman todas en el despliegue. */
export function generateStaticParams() {
  return GUIDES.map((g) => ({ guia: g.slug }));
}

/** Una guía que no está en la lista no tiene página. */
export const dynamicParams = false;

// Como las fichas: los precios se revisan cada 30 minutos y la revisión
// purga el sitio cuando algo cambia.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { guia } = await params;
  const guide = getGuide(guia);
  if (!guide) return {};
  const url = guidePath(guide.slug);
  const view = await getGuideView(guide);
  const image = view.products[0]?.image_url;
  return {
    title: { absolute: guide.title },
    description: guide.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'ComparaTech',
      locale: 'es_CL',
      url,
      title: guide.title,
      description: guide.description,
      ...(image ? { images: [image] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: guide.title, description: guide.description },
  };
}

export default async function GuiaPage({ params }: { params: Params }) {
  const { guia } = await params;
  const guide = getGuide(guia);
  if (!guide) notFound();

  const view = await getGuideView(guide);
  const others = GUIDES.filter((g) => g.slug !== guide.slug);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {view.products.length > 0 && (
        <script
          type="application/ld+json"
          // Ya viene con '<' escapado (ver itemListJsonLd).
          dangerouslySetInnerHTML={{ __html: itemListJsonLd(view.products, SITE_URL, guide.heading) }}
        />
      )}
      <Breadcrumbs items={[{ name: 'Inicio', href: '/' }, { name: guide.name }]} />

      <h1 className="font-heading text-2xl font-bold sm:text-3xl">{guide.heading}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{guide.intro}</p>

      {guide.sections.length > 1 && (
        <nav aria-label="Secciones de la guía" className="mt-5">
          <ul className="flex flex-wrap gap-2">
            {guide.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {view.sections.map((s, i) => (
        <section key={s.section.id} id={s.section.id} aria-labelledby={`${s.section.id}-titulo`} className="mt-10 scroll-mt-24">
          <h2 id={`${s.section.id}-titulo`} className="font-heading text-lg font-semibold">
            {s.section.title}
          </h2>
          <p className="mb-4 mt-1 max-w-3xl text-sm text-muted">{sectionSummary(s)}</p>
          {s.products.length > 0 ? (
            <ProductGrid products={s.products} placement={guide.placement} drops={s.drops} eagerImages={i === 0 ? 4 : 0} />
          ) : (
            <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
              Hoy no hay productos que cumplan las reglas de esta lista ({sectionRange(s.section).toLowerCase()}). Se
              rearma sola con los precios del día.
            </p>
          )}
        </section>
      ))}

      <section aria-labelledby="como-armamos" className="mt-12 max-w-3xl">
        <h2 id="como-armamos" className="mb-3 font-heading text-lg font-semibold">
          Cómo armamos esta lista
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          {guide.method.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>
            No probamos los productos. Los precios se actualizan solos varias veces al día y pueden cambiar: el que vale
            es el que ves en Mercado Libre al comprar.{' '}
            <Link href="/como-funciona" className="text-accent hover:underline">
              Cómo funciona ComparaTech
            </Link>
            .
          </li>
        </ul>
      </section>

      <section aria-labelledby="mas" className="mt-10 max-w-3xl">
        <h2 id="mas" className="mb-3 font-heading text-lg font-semibold">
          También te puede servir
        </h2>
        <ul className="flex flex-wrap gap-2">
          {others.map((g) => (
            <li key={g.slug}>
              <Link
                href={guidePath(g.slug)}
                className="inline-flex items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
              >
                {g.heading}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/ofertas"
              className="inline-flex items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
            >
              Ofertas de hoy
            </Link>
          </li>
          <li>
            <Link
              href="/black-friday"
              className="inline-flex items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
            >
              Black Friday
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
