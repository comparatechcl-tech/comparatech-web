import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getAllProducts, getProductBySlug, getSiblingVariants } from '@/lib/queries/products';
import { PriceTag } from '@/components/product/PriceTag';
import { ProductSpecsTable } from '@/components/product/ProductSpecsTable';
import { AffiliateButton } from '@/components/product/AffiliateButton';
import { ProductJsonLd } from '@/components/seo/ProductJsonLd';
import { VariantLinks } from '@/components/product/VariantLinks';
import { resolveDescription } from '@/lib/product-description';
import { truncateAtWord } from '@/lib/text';

export async function generateStaticParams() {
  const products = await getAllProducts();
  return products.map((p) => ({ slug: p.slug }));
}

// Revalida cada 5 minutos (precios/specs actualizados) y permite que
// productos nuevos, agregados después del build, se rendericen al vuelo
// la primera vez que alguien entra a su ficha (dynamicParams por defecto).
export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};

  // resolveDescription nunca devuelve vacío: si el producto se cargó sin
  // descripción, arma una de respaldo. Antes, un `description` vacío hacía
  // que Next omitiera la etiqueta y la ficha saliera a Google sin meta
  // description — pasaba en el 100% del catálogo.
  const description = truncateAtWord(resolveDescription(product));

  return {
    title: product.name,
    description,
    openGraph: {
      title: product.name,
      description,
      images: [product.image_url],
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
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
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const variants = await getSiblingVariants(product);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <ProductJsonLd product={product} />
      <div className="grid gap-8 sm:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-white">
          <Image src={product.image_url} alt={product.name} fill className="object-contain" />
        </div>

        <div>
          {product.brand?.trim() && (
            <span className="text-xs font-medium uppercase tracking-wide text-muted">{product.brand}</span>
          )}
          <h1 className="mt-1 font-heading text-2xl font-bold sm:text-3xl">{product.name}</h1>
          <div className="mt-3">
            <PriceTag price={product.price} originalPrice={product.original_price} />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">{resolveDescription(product)}</p>
          <AffiliateButton href={product.affiliate_url} className="mt-6 w-full sm:w-auto" />
          <p className="mt-3 text-xs text-muted">
            Al hacer clic serás dirigido a Mercado Libre para completar tu
            compra. Como afiliados, podemos ganar una comisión.
          </p>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="mb-3 font-heading text-lg font-semibold">Especificaciones</h2>
        <ProductSpecsTable product={product} />
      </div>

      <VariantLinks variants={variants} />
    </div>
  );
}
