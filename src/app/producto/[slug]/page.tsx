import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { CircleAlert } from 'lucide-react';
import {
  getAlternatives,
  getCatalogProducts,
  getProductBySlugAnyStatus,
  getSiblingVariants,
} from '@/lib/queries/products';
import { getCategoryInfo } from '@/lib/queries/categories';
import { PriceTag } from '@/components/product/PriceTag';
import { ProductSpecsTable } from '@/components/product/ProductSpecsTable';
import { AffiliateButton } from '@/components/product/AffiliateButton';
import { ProductJsonLd } from '@/components/seo/ProductJsonLd';
import { VariantLinks, type VariantLink } from '@/components/product/VariantLinks';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { ProductAlternatives } from '@/components/product/ProductAlternatives';
import { ProductHeroImage, StickyBuyBar } from '@/components/product/StickyBuyBar';
import { TrustChips } from '@/components/product/TrustChips';
import { PriceHistoryNote } from '@/components/product/PriceHistoryNote';
import { PriceFreshness } from '@/components/product/PriceFreshness';
import { resolveDescription } from '@/lib/product-description';
import { shortProductName, truncateAtWord } from '@/lib/text';
import { formatCLP, formatDiscountPct } from '@/lib/format';
import { buyUrl } from '@/lib/outbound';
import { reasonInfo, type InactiveReason } from '@/lib/inactive-reasons';
import { MIN_DEAL_DISCOUNT, discountOf } from '@/lib/deal-rank';
import type { Product } from '@/lib/types';

/**
 * Fichas que se generan en cada despliegue. Las demás se generan la primera
 * vez que alguien entra (dynamicParams, por defecto) y desde ahí salen de
 * caché igual que estas.
 *
 * Antes se generaban todas. Con 250 productos daba lo mismo; con 790 cada
 * despliegue armaba 724 fichas (más de 100 MB) y cualquier tropiezo de la
 * base en una de ellas botaba el despliegue entero. Como el catálogo crece
 * de a cien por día, el despliegue no puede depender de su tamaño.
 */
const PRERENDER_LIMIT = 150;

/**
 * Los nombres de Mercado Libre dan slugs de hasta 200 caracteres, y la ficha
 * pre-generada se guarda en archivos con ese nombre más un sufijo: muy cerca
 * del máximo de un nombre de archivo. Las de slug largo se generan al vuelo.
 */
const PRERENDER_MAX_SLUG = 150;

export async function generateStaticParams() {
  // Una por producto real (sin los otros colores): las destacadas y las
  // ofertas primero, que es a donde llega la gente; después, lo más vendido.
  const weight = (p: Product) => (p.is_featured ? 2 : 0) + (discountOf(p) >= MIN_DEAL_DISCOUNT ? 1 : 0);
  return (await getCatalogProducts())
    .filter((p) => p.slug.length <= PRERENDER_MAX_SLUG)
    .sort((a, b) => weight(b) - weight(a) || (b.seller_sales_count ?? 0) - (a.seller_sales_count ?? 0))
    .slice(0, PRERENDER_LIMIT)
    .map((p) => ({ slug: p.slug }));
}

// Revalida cada 5 minutos (precios/specs actualizados) y permite que
// productos nuevos, agregados después del build, se rendericen al vuelo
// la primera vez que alguien entra a su ficha (dynamicParams por defecto).
export const revalidate = 300;

/**
 * Cuánto tiempo sigue publicada la ficha de un producto sin vendedores.
 * Casi siempre vuelve solo en días (el cron lo reactiva apenas aparece un
 * vendedor); pasado este plazo es un producto descontinuado y la ficha deja
 * de tener sentido, así que pasa a 404 y Google la saca del índice.
 */
const INACTIVE_GRACE_DAYS = 60;

/** Lo que ve el comprador según por qué el producto salió de venta. */
const INACTIVE_MESSAGES: Record<InactiveReason, string> = {
  sin_ganador: 'Hoy no hay vendedores ofreciendo este producto en Mercado Libre.',
  ganador_no_verde: 'Hoy no hay un vendedor confiable para este producto.',
  link_otro_producto: 'Estamos actualizando el link de este producto.',
};
const INACTIVE_FALLBACK = 'Hoy este producto no está disponible en Mercado Libre.';

const PRIMARY_CTA_ID = 'cta-principal';
const SPECS_CTA_ID = 'cta-specs';

function inactiveMessage(reason: Product['inactive_reason']): string {
  return reason && reason in INACTIVE_MESSAGES ? INACTIVE_MESSAGES[reason] : INACTIVE_FALLBACK;
}

/** ¿Lleva tanto tiempo fuera de venta que ya no vale la pena mostrarlo? */
function isExpired(product: Product): boolean {
  if (product.is_active || !product.inactive_since) return false;
  const since = new Date(product.inactive_since).getTime();
  if (Number.isNaN(since)) return false;
  return Date.now() - since > INACTIVE_GRACE_DAYS * 86_400_000;
}

async function loadProduct(slug: string): Promise<Product | null> {
  const product = await getProductBySlugAnyStatus(slug);
  return product && !isExpired(product) ? product : null;
}

function categoryNameOf(product: Product): string {
  return getCategoryInfo(product.category)?.name ?? product.category;
}

/**
 * Lo único que necesita el bloque de variantes. Se arma a mano porque todo
 * lo que se pasa a un componente de cliente queda escrito en el HTML.
 */
function toVariantLink(p: Product): VariantLink {
  return { id: p.id, slug: p.slug, name: p.name, price: p.price, image_url: p.image_url, specs: p.specs };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) return {};

  const short = shortProductName(product.name);
  const discount = formatDiscountPct(product.price, product.original_price);
  // El título lleva lo que la gente busca ("precio", "ofertas", "Chile") y
  // el nombre corto: el de ML (76-90 caracteres) se comía todo el espacio
  // que Google muestra.
  const title = `${short}: precio y ofertas en Chile`;
  const description = truncateAtWord(
    product.is_active
      ? `${short} a ${formatCLP(product.price)}${discount ? ` (${discount}% dcto)` : ''} en Mercado Libre. Compara specs y vendedores, precio revisado hoy.`
      : `${short}: hoy no está a la venta en Mercado Libre. Mira alternativas en ${categoryNameOf(product)} con precio revisado hoy.`,
    155
  );
  const url = `/producto/${product.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Si existe opengraph-image para la ruta, Next la usa antes que estas
    // imágenes; la foto de ML queda como respaldo.
    openGraph: {
      type: 'website',
      siteName: 'ComparaTech',
      locale: 'es_CL',
      url,
      title,
      description,
      images: [product.image_url],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [product.image_url],
    },
  };
}

export default async function ProductoPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await loadProduct(slug);
  if (!product) notFound();

  const [variants, alternatives, catalog] = await Promise.all([
    getSiblingVariants(product),
    getAlternatives(product, 6),
    getCatalogProducts(),
  ]);

  const categoryName = categoryNameOf(product);
  const short = shortProductName(product.name);
  const href = buyUrl(product);
  const variantLinks = variants.map(toVariantLink);
  const breadcrumbs = (
    <Breadcrumbs
      items={[
        { name: 'Inicio', href: '/' },
        { name: categoryName, href: `/categoria/${product.category}` },
        { name: short },
      ]}
    />
  );

  // Ficha sin vendedores: sigue respondiendo 200 e indexable, sin botón de
  // compra, y con las alternativas como lo principal de la página.
  if (!product.is_active) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <ProductJsonLd product={product} />
        {breadcrumbs}
        <div className="grid gap-8 sm:grid-cols-2">
          <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-white opacity-80">
            <ProductHeroImage src={product.image_url} alt={product.name} />
          </div>

          <div>
            {product.brand?.trim() && (
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{product.brand}</span>
            )}
            <h1 className="mt-1 font-heading text-2xl font-bold sm:text-3xl">{product.name}</h1>
            <div
              role="status"
              className="mt-4 flex items-start gap-2.5 rounded-xl border border-border bg-surface2 p-4 text-sm text-fg"
            >
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
              <p>
                {inactiveMessage(product.inactive_reason)}{' '}
                <a href="#alternativas" className="font-medium text-accent hover:underline">
                  Mira las alternativas disponibles
                </a>
                .
              </p>
            </div>
            <p className="mt-3 text-xs text-muted">
              Último precio que vimos: {formatCLP(product.price)}.
              {/* Solo si de verdad vuelve sola: un link a otro producto
                  necesita que alguien genere uno nuevo. */}
              {reasonInfo(product.inactive_reason).auto &&
                ' Apenas vuelva a haber un vendedor confiable, la ficha se actualiza sola.'}
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">{resolveDescription(product)}</p>
          </div>
        </div>

        <ProductAlternatives alternatives={alternatives} title="Alternativas disponibles" highlight />

        <VariantLinks variants={variantLinks} />

        {Object.keys(product.specs ?? {}).length > 0 && (
          <div className="mt-10">
            <h2 className="mb-3 font-heading text-lg font-semibold">Especificaciones</h2>
            <ProductSpecsTable product={product} hideSeller />
          </div>
        )}
      </div>
    );
  }

  // "Compáralo con" solo si el comparador puede abrir este producto: ahí se
  // listan las tarjetas del catálogo, una por producto real.
  const comparable = catalog.some((p) => p.slug === product.slug);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <ProductJsonLd product={product} />
      {breadcrumbs}
      <div className="grid gap-8 sm:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-white">
          <ProductHeroImage src={product.image_url} alt={product.name} />
        </div>

        <div>
          {product.brand?.trim() && (
            <span className="text-xs font-medium uppercase tracking-wide text-muted">{product.brand}</span>
          )}
          <h1 className="mt-1 font-heading text-2xl font-bold sm:text-3xl">{product.name}</h1>
          <div className="mt-3">
            <PriceTag price={product.price} originalPrice={product.original_price} />
            <PriceFreshness checkedAt={product.price_checked_at} />
          </div>
          <TrustChips product={product} />
          <PriceHistoryNote productId={product.id} price={product.price} />
          <div id={PRIMARY_CTA_ID} className="mt-6">
            <AffiliateButton
              href={href}
              productId={product.id}
              productName={product.name}
              placement="ficha"
              className="w-full sm:w-auto"
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            Al hacer clic serás dirigido a Mercado Libre para completar tu
            compra. Como afiliados, podemos ganar una comisión.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">{resolveDescription(product)}</p>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="mb-3 font-heading text-lg font-semibold">Especificaciones</h2>
        <ProductSpecsTable product={product} />
        {/* Quien lee la tabla hasta el final está decidiendo: el botón
            tiene que estar ahí, no arriba. */}
        <div id={SPECS_CTA_ID} className="mt-5 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
          <AffiliateButton
            href={href}
            productId={product.id}
            productName={product.name}
            placement="ficha"
            label={`Ver oferta a ${formatCLP(product.price)}`}
            className="w-full sm:w-auto"
          />
          <span className="text-xs text-muted">Precio y stock final en Mercado Libre.</span>
        </div>
      </div>

      <VariantLinks variants={variantLinks} />

      <ProductAlternatives
        alternatives={alternatives}
        title={`Alternativas en ${categoryName}`}
        compareFromSlug={comparable ? product.slug : undefined}
      />

      <StickyBuyBar
        href={href}
        productId={product.id}
        productName={product.name}
        price={product.price}
        originalPrice={product.original_price}
        imageUrl={product.image_url}
        primaryCtaId={PRIMARY_CTA_ID}
        otherCtaIds={[SPECS_CTA_ID]}
      />
    </div>
  );
}
