import { Product } from '@/lib/types';
import { resolveDescription } from '@/lib/product-description';
import { buyUrl } from '@/lib/outbound';

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
 * Dato estructurado de la ficha.
 *
 * Solo lo que es cierto hoy: si el producto está fuera de venta se declara
 * OutOfStock y sin link de compra (un link a una oferta que no existe es
 * justo lo que Google penaliza). Nunca aggregateRating ni review: no tenemos
 * reseñas propias, y copiar las de ML sería inventarlas.
 */
export function ProductJsonLd({ product }: { product: Product }) {
  const freeShipping = product.offer_info?.free_shipping === true;

  const offer = {
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
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
