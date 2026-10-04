import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { checkBasicAuth } from '@/lib/basic-auth';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { isOgFormat, productImageResponse, type OgFormat, type OgProduct } from '@/lib/content/og-template';

/**
 * Imágenes del kit para redes: /admin/kit/{id}?f=feed|story|pin, y con
 * &dl=1 se descargan como archivo.
 *
 * El middleware ya protege /admin, pero esta ruta lee con la clave de
 * servicio: se vuelve a revisar la clave por si algún día cambia el
 * matcher del middleware.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIT_FORMATS: OgFormat[] = ['feed', 'story', 'pin'];

const BASE_COLUMNS = 'slug, name, brand, price, original_price, image_url, price_checked_at';

export async function GET(req: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  if (!checkBasicAuth(req.headers.get('authorization'))) {
    return new NextResponse('Autenticación requerida', {
      status: 401,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }

  const { productId } = await params;
  if (!UUID_RE.test(productId)) return new NextResponse('Producto no válido', { status: 400 });

  const f = req.nextUrl.searchParams.get('f') ?? 'feed';
  const format: OgFormat = isOgFormat(f) && KIT_FORMATS.includes(f) ? f : 'feed';
  const download = req.nextUrl.searchParams.get('dl') === '1';

  const admin = getSupabaseAdmin();
  if (!admin) return new NextResponse('Supabase admin no configurado', { status: 500 });

  // offer_info llega con la migración 0016: sin ella, la pieza sale sin los
  // chips de envío.
  let { data, error } = await admin
    .from('products')
    .select(`${BASE_COLUMNS}, offer_info`)
    .eq('id', productId)
    .maybeSingle();
  if (error && isMissingSchemaError(error)) {
    ({ data, error } = await admin.from('products').select(BASE_COLUMNS).eq('id', productId).maybeSingle());
  }
  if (error) return new NextResponse(error.message, { status: 500 });
  if (!data) return new NextResponse('Ese producto no existe', { status: 404 });

  const product = data as unknown as OgProduct & { slug: string };
  const headers: Record<string, string> = {
    // El precio cambia: una imagen guardada en caché podría publicarse con
    // un precio viejo.
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (download) {
    const safeSlug = product.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 80) || 'producto';
    headers['Content-Disposition'] = `attachment; filename="comparatech-${safeSlug}-${format}.png"`;
  }

  return productImageResponse(product, format, { headers });
}
