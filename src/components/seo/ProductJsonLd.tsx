import { Product } from '@/lib/types';
import { resolveDescription } from '@/lib/product-description';
import { buyUrl } from '@/lib/outbound';
import { SITE_URL } from '@/lib/site';

/**
 * JSON dentro de un <script>. Un nombre o una spec con "</script>" cerraría
 * la etiqueta y lo que viene después se ejecutaría como HTML: los datos
 * vienen de Mercado Libre y de lo que se pega en el admin, así que se
 * escapa siempre.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/**
 * La oferta de un producto, la misma en la ficha y en la página de su modelo.
 *
 * Solo lo que es cierto hoy: si el producto está fuera de venta se declara
 * OutOfStock y sin link de compra (un link a una oferta que no existe es
 * justo lo que Google penaliza).
 */
export function productOffer(product: Product) {
  const freeShipping = product.offer_info?.free_shipping === true;

  return {
    '@type': 'Offer',
    priceCurrency: 'CLP',
    price: product.price,
    ...(product.ml_product_id ? { sku: product.ml_product_id } : {}),
    // Sin itemCondition: la condición de la oferta (nuevo, usado) no se guarda.
    ...(product.is_active
      ? { availability: 'https://schema.org/InStock', url: buyUrl(product) }
      : { availability: 'https://schema.org/OutOfStock' }),
    // El envío gratis lo confirma Mercado Libre en la última revisión de
    // precio; sin ese dato no se declara nada.
    ...(freeShipping
      ? {
          shippingDetails: {
            '@type': 'OfferShippingDetails',
            shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'CLP' },
            shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'CL' },
          },
        }
      : {}),
  };
}

/**
 * Dato estructurado de la ficha. Nunca aggregateRating ni review: no tenemos
 * reseñas propias, y copiar las de ML sería inventarlas.
 */
export function ProductJsonLd({ product }: { product: Product }) {
  const offer = productOffer(product);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    // La ficha de este sitio (la misma del canonical) y el código del
    // producto en el catálogo de Mercado Libre: con eso Google sabe que
    // varias páginas hablan del mismo producto.
    url: `${SITE_URL}/producto/${product.slug}`,
    ...(product.ml_product_id ? { sku: product.ml_product_id } : {}),
    image: [product.image_url],
    description: resolveDescription(product),
    // Google marca el dato estructurado como inválido si `brand.name` viene
    // vacío — mejor omitir la propiedad completa cuando no sabemos la marca.
    ...(product.brand?.trim() ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    offers: offer,
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }}
    />
  );
}
