import { ImageResponse } from 'next/og';
import { getDeals, discountPercent } from '@/lib/queries/products';
import { BrandOgTemplate, OG_SIZES, OffersOgTemplate, loadPhoto } from '@/lib/content/og-template';

/**
 * Vista previa de /ofertas al compartirla: cuántas ofertas hay hoy, el
 * mayor descuento y las fotos de las tres primeras. Es el link que más se
 * comparte en grupos, y un número concreto invita más a abrirlo que el
 * logo solo.
 */

export const revalidate = 300;
export const alt = 'Ofertas del día en ComparaTech';
export const size = OG_SIZES.og;
export const contentType = 'image/png';

export default async function Image() {
  // Si la base falla, la vista previa sale con la marca en vez de romper el
  // link compartido.
  const deals = await getDeals().catch(() => null);
  if (!deals) {
    return new ImageResponse(<BrandOgTemplate format="og" title="Ofertas del día en tecnología" />, size);
  }

  const top = deals.slice(0, 3);
  const photos = await Promise.all(top.map((p) => loadPhoto(p.image_url, 'O')));
  const maxDiscount = deals.reduce((max, p) => Math.max(max, discountPercent(p)), 0);

  return new ImageResponse(
    <OffersOgTemplate count={deals.length} maxDiscount={maxDiscount} photos={photos} />,
    size
  );
}
