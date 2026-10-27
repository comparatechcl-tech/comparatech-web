import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { pngToJpeg } from '@/lib/content/jpeg';
import { interFonts } from '@/lib/content/og-fonts';
import { COUPON_SIZES, CouponPiece } from '@/lib/content/coupons-template';
import { checkCouponPath, couponKey, couponPath } from '@/lib/social/coupons-url';

/**
 * La imagen de cupones (feed o historia) en JPG, en una dirección pública
 * firmada por el sitio (lib/social/coupons-url). La baja Instagram al
 * publicar desde /admin/historias/cupones, y el dueño la puede guardar desde
 * el teléfono. Como el carrusel, va fuera de /admin y de /api: la misma
 * dirección da siempre la misma imagen. No lee la base: todo viene firmado.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const BACKGROUND = '#070B14';

function refuse(message: string, status: number): Response {
  return new Response(message, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } });
}

const RECENT_MAX = 8;
const recent = new Map<string, Buffer>();

export async function GET(req: NextRequest, { params }: { params: Promise<{ data: string; file: string }> }) {
  const { data, file } = await params;

  // Sin firma válida no se dibuja nada.
  const key = couponKey();
  if (!key) return refuse('No encontrado', 404);
  const check = checkCouponPath(data, file, key, Math.floor(Date.now() / 1000));
  if (!check.ok) return refuse('No encontrado', check.reason === 'formato' ? 404 : 403);

  // Solo la dirección exacta que firmó el sitio.
  const path = couponPath(check.set, check.format, key);
  if (req.nextUrl.search || req.nextUrl.pathname !== path) return refuse('No encontrado', 404);

  let jpeg = recent.get(path) ?? null;
  if (!jpeg) {
    try {
      const png = new ImageResponse(<CouponPiece coupons={check.set.coupons} day={check.set.day} format={check.format} />, {
        ...COUPON_SIZES[check.format],
        fonts: await interFonts(),
      });
      jpeg = await pngToJpeg(await png.arrayBuffer(), BACKGROUND);
    } catch (err) {
      console.error('[social/cupones] no se pudo dibujar la imagen:', err instanceof Error ? err.message : err);
      return refuse('No se pudo generar la imagen', 500);
    }
    recent.set(path, jpeg);
    if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
  }

  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpeg.length),
      // Lo firmado no cambia: la misma dirección es siempre la misma imagen.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
