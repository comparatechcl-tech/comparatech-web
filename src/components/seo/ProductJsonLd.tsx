import { Product } from '@/lib/types';
import { resolveDescription } from '@/lib/product-description';

export function ProductJsonLd({ product }: { product: Product }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: [product.image_url],
    description: resolveDescription(product),
    // Google marca el dato estructurado como inválido si `brand.name` viene
    // vacío — mejor omitir la propiedad completa cuando no sabemos la marca.
    ...(product.brand?.trim() ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'CLP',
      price: product.price,
      availability: 'https://schema.org/InStock',
      url: product.affiliate_url,
    },
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
