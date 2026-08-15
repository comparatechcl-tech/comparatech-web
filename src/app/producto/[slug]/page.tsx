import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import { getAllProducts, getProductBySlug } from '@/lib/queries/products';
import { PriceTag } from '@/components/product/PriceTag';
import { ProductSpecsTable } from '@/components/product/ProductSpecsTable';
import { AffiliateButton } from '@/components/product/AffiliateButton';
import { ProductJsonLd } from '@/components/seo/ProductJsonLd';

export async function generateStaticParams() {
  const products = await getAllProducts();
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return {};

  return {
    title: product.name,
    description: product.description,
    openGraph: {
      title: product.name,
      description: product.description,
      images: [product.image_url],
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description: product.description,
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <ProductJsonLd product={product} />
      <div className="grid gap-8 sm:grid-cols-2">
        <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface">
          <Image src={product.image_url} alt={product.name} fill className="object-cover" />
        </div>

        <div>
          <span className="text-xs uppercase tracking-wide text-muted">{product.brand}</span>
          <h1 className="mt-1 font-heading text-2xl font-bold">{product.name}</h1>
          <div className="mt-3">
            <PriceTag price={product.price} originalPrice={product.original_price} />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted">{product.description}</p>
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
    </div>
  );
}
