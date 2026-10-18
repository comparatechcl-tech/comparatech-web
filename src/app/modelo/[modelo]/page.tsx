import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCatalogProducts } from '@/lib/queries/products';
import { getModelHistories, getModelVersions } from '@/lib/queries/models';
import { getCategoryInfo } from '@/lib/queries/categories';
import {
  MODELS,
  modelHeading,
  modelIntro,
  modelMetaDescription,
  modelPath,
  modelTitle,
  versionLabel,
} from '@/lib/models';
import { domainLabel, indexableTypes, typePath, typeSlug } from '@/lib/category-listing';
import { dropsById } from '@/lib/deal-rank';
import { formatCLP } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { ProductGrid } from '@/components/product/ProductGrid';
import { ModelPriceHistory } from '@/components/product/ModelPriceHistory';
import { ProductGroupJsonLd } from '@/components/seo/ProductGroupJsonLd';
import { PhotoViewer } from '@/components/product/PhotoViewer';
import { viewerItems } from '@/lib/photo-viewer';

/**
 * La página de un modelo (/modelo/iphone-17): todas sus versiones con el
 * precio de hoy y el historial del precio más bajo entre ellas. Ver
 * lib/models (qué modelos tienen página y cómo se reconoce cada versión).
 *
 * Las fichas siguen siendo la página de cada versión, con su canonical; esta
 * es la de las búsquedas del modelo ("precio iphone 17"), y cada ficha
 * enlaza acá desde sus migas.
 */

type Params = Promise<{ modelo: string }>;

/** Son pocos (la lista de lib/models): se arman todos en el despliegue. */
export function generateStaticParams() {
  return MODELS.map((m) => ({ modelo: m.slug }));
}

/** Un modelo que no está en la lista no tiene página. */
export const dynamicParams = false;

// Como las fichas: los precios se revisan cada 30 minutos y la revisión
// purga el sitio cuando algo cambia.
export const revalidate = 300;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { modelo } = await params;
  const data = await getModelVersions(modelo);
  if (!data || data.onSale.length + data.paused.length === 0) return {};

  const { model, onSale } = data;
  const title = modelTitle(model);
  const description = modelMetaDescription(
    model,
    onSale.map((p) => p.price),
  );
  const url = modelPath(model.slug);
  const image = (onSale[0] ?? data.paused[0]).image_url;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'ComparaTech', locale: 'es_CL', url, title, description, images: [image] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function ModeloPage({ params }: { params: Params }) {
  const { modelo } = await params;
  const data = await getModelVersions(modelo);
  if (!data) notFound();
  const { model, onSale, paused } = data;
  const versions = [...onSale, ...paused];
  if (versions.length === 0) notFound();

  const now = Date.now();
  const [{ histories, stats }, catalog] = await Promise.all([getModelHistories(versions), getCatalogProducts()]);
  const drops = dropsById(onSale, stats, now);
  const prices = onSale.map((p) => p.price);
  const viewer = viewerItems(versions[0], versions, (p) => versionLabel(model, p));
  const description = modelMetaDescription(model, prices);

  // Las migas, como en la ficha: la categoría y el tipo, si su página se indexa.
  const category = versions[0].category;
  const categoryName = getCategoryInfo(category)?.name ?? category;
  const typeCrumb = indexableTypes(
    catalog.filter((p) => p.category === category),
    { slug: category, name: categoryName },
  ).find((t) => t.slug === typeSlug(domainLabel(versions[0].ml_domain_id)));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <ProductGroupJsonLd model={model} versions={versions} siteUrl={SITE_URL} description={description} />
      <Breadcrumbs
        items={[
          { name: 'Inicio', href: '/' },
          { name: categoryName, href: `/categoria/${category}` },
          ...(typeCrumb ? [{ name: typeCrumb.label, href: typePath(category, typeCrumb.slug) }] : []),
          { name: model.name },
        ]}
      />

      <h1 className="font-heading text-2xl font-bold sm:text-3xl">{modelHeading(model)}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{modelIntro(model, prices, paused.length)}</p>

      <section aria-labelledby="versiones" className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="versiones" className="font-heading text-lg font-semibold">
            Versiones y precio de hoy
          </h2>
          {/* Las fotos de todas las versiones en grande, una tras otra (lib/photo-viewer). */}
          <PhotoViewer variant="button" items={viewer.items} title={model.name} />
        </div>
        {onSale.length > 0 ? (
          <ProductGrid products={onSale} placement="modelo" drops={drops} eagerImages={4} />
        ) : (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            Hoy ninguna versión tiene un vendedor con reputación verde en Mercado Libre. Apenas vuelva a haber uno, la
            página se actualiza sola.
          </p>
        )}

        {paused.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-fg">Sin vendedor con reputación verde hoy</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {paused.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/producto/${p.slug}`}
                    prefetch={false}
                    className="inline-flex flex-wrap items-baseline gap-x-1.5 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-fg transition hover:border-accent/40"
                  >
                    {versionLabel(model, p)}{' '}
                    <span className="text-xs text-muted">último precio {formatCLP(p.price)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <ModelPriceHistory model={model} versions={versions} histories={histories} now={now} />

      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted">
        Los precios son los que muestra Mercado Libre en cada ficha y pueden cambiar en cualquier momento: el que vale es
        el que ves al comprar. Solo mostramos vendedores con reputación verde.
      </p>
    </div>
  );
}
