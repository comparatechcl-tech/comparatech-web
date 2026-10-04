import { ImageResponse } from 'next/og';
import { getSupabase } from '@/lib/supabase/client';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { BrandOgTemplate, OG_SIZES, productImageResponse, type OgProduct } from '@/lib/content/og-template';

/**
 * Vista previa de la ficha al compartirla (WhatsApp, Telegram, Facebook).
 *
 * Antes se mostraba la foto de ML sola, sin precio: quien recibía el link
 * no sabía si valía la pena abrirlo. Ahora va el precio grande, el
 * descuento real y la hora en que se revisó.
 *
 * Lectura propia y mínima con el cliente anon (la tabla deja leer solo lo
 * no oculto): no pasa por el catálogo completo, que esta imagen no necesita.
 */

export const revalidate = 300;
export const alt = 'Precio en Mercado Libre, revisado por ComparaTech';
export const size = OG_SIZES.og;
export const contentType = 'image/png';

const BASE_COLUMNS = 'name, brand, price, original_price, image_url, price_checked_at, is_active';

type OgRow = OgProduct & { is_active: boolean };

async function readProduct(slug: string): Promise<OgRow | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  // De la más completa a la mínima: offer_info y deleted_at llegan con
  // migraciones que pueden no estar aplicadas todavía.
  const tiers = [
    { columns: `${BASE_COLUMNS}, offer_info`, excludeDeleted: true },
    { columns: `${BASE_COLUMNS}, offer_info`, excludeDeleted: false },
    { columns: BASE_COLUMNS, excludeDeleted: false },
  ];
  for (const tier of tiers) {
    let query = supabase.from('products').select(tier.columns).eq('slug', slug).eq('is_hidden', false);
    if (tier.excludeDeleted) query = query.is('deleted_at', null);
    const { data, error } = await query.maybeSingle();
    if (error && isMissingSchemaError(error)) continue;
    if (error) return null;
    return (data as unknown as OgRow | null) ?? null;
  }
  return null;
}

export default async function Image({ params }: { params: { slug: string } }) {
  // En Next 15 llega como objeto; en 16 pasa a ser promesa. await sirve para las dos.
  const { slug } = await params;
  const product = await readProduct(slug).catch(() => null);
  if (!product) {
    return new ImageResponse(<BrandOgTemplate format="og" title="Compara precios de tecnología en Chile" />, size);
  }
  // Sin vendedor no hay precio que mostrar: uno viejo en la vista previa
  // promete algo que la ficha ya no ofrece.
  if (!product.is_active) {
    return new ImageResponse(<BrandOgTemplate format="og" title="Mira alternativas con precio revisado hoy" />, size);
  }
  return productImageResponse(product, 'og');
}
