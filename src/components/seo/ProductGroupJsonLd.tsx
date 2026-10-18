import type { Product } from '@/lib/types';
import { modelPath, versionCapacity, versionColor, type ModelDef } from '@/lib/models';
import { jsonLdString, productOffer } from '@/components/seo/ProductJsonLd';

/**
 * El dato estructurado de una página de modelo: un ProductGroup con cada
 * versión como variante (Google, "Product variant structured data").
 *
 * Cada versión tiene su ficha, que sigue siendo la página de esa versión (su
 * propio canonical): la variante lleva la dirección de la ficha y la misma
 * oferta que la ficha declara (productOffer). `variesBy` dice solo lo que de
 * verdad cambia entre las versiones: el color y la capacidad, que Google lee
 * como `size` (así lo usan las tiendas para el almacenamiento de un celular).
 * Las ediciones de una consola no tienen propiedad propia: van en el nombre.
 *
 * Sin reseñas ni estrellas, igual que la ficha.
 */
export function productGroupJsonLd(model: ModelDef, versions: Product[], siteUrl: string, description: string) {
  const colors = new Set(versions.map((v) => versionColor(v.specs)?.toLowerCase()).filter(Boolean));
  const sizes = new Set(versions.map((v) => versionCapacity(v.specs)?.toLowerCase()).filter(Boolean));
  const variesBy = [
    ...(colors.size > 1 ? ['https://schema.org/color'] : []),
    ...(sizes.size > 1 ? ['https://schema.org/size'] : []),
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    name: model.name,
    ...(model.alias ? { alternateName: model.alias } : {}),
    url: `${siteUrl}${modelPath(model.slug)}`,
    description,
    brand: { '@type': 'Brand', name: model.brand },
    productGroupID: model.slug,
    ...(variesBy.length > 0 ? { variesBy } : {}),
    hasVariant: versions.map((v) => {
      const color = versionColor(v.specs);
      const size = versionCapacity(v.specs);
      return {
        '@type': 'Product',
        name: v.name,
        url: `${siteUrl}/producto/${v.slug}`,
        ...(v.ml_product_id ? { sku: v.ml_product_id } : {}),
        image: [v.image_url],
        ...(v.brand?.trim() ? { brand: { '@type': 'Brand', name: v.brand } } : {}),
        ...(color && colors.size > 1 ? { color } : {}),
        ...(size && sizes.size > 1 ? { size } : {}),
        inProductGroupWithID: model.slug,
        offers: productOffer(v),
      };
    }),
  };
}

export function ProductGroupJsonLd(props: {
  model: ModelDef;
  versions: Product[];
  siteUrl: string;
  description: string;
}) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html: jsonLdString(productGroupJsonLd(props.model, props.versions, props.siteUrl, props.description)),
      }}
    />
  );
}
