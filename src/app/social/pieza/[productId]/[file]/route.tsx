import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase/client';
import { pngToJpeg } from '@/lib/content/jpeg';
import { OG_SIZES, ProductOgTemplate, loadPhoto, type OgProduct } from '@/lib/content/og-template';
import { checkPiecePath, pieceKey, piecePath, type PieceSnapshot } from '@/lib/social/piece-url';

/**
 * La pieza de un producto para redes, en JPG y en una dirección pública.
 *
 * Metricool (desde donde se programan Instagram, Facebook y TikTok) solo
 * recibe la imagen por link, y la del kit del admin está detrás de la clave.
 * Acá sale la misma pieza, pero únicamente para direcciones firmadas por el
 * sitio (lib/social/piece-url): el precio y la hora van en la dirección, de
 * modo que la imagen coincide siempre con el texto del post.
 *
 * JPG y no PNG: TikTok y las historias de Instagram no aceptan PNG.
 *
 * Fuera de /api a propósito: esas rutas llevan 'no-store' (next.config.js) y
 * esta sí conviene guardarla, porque la misma dirección da siempre la misma
 * imagen.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const BACKGROUND = '#070B14';

function refuse(message: string, status: number): Response {
  return new Response(message, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } });
}

interface PieceRow {
  name: string;
  brand: string | null;
  image_url: string;
  is_active: boolean;
}

type Drawn = { jpeg: Buffer } | { error: string; status: number };

/**
 * Las últimas piezas dibujadas y las que se están dibujando. El caché de
 * Vercel no cubre todo (es por región, y las cabeceras del pedido lo
 * parten): sin esto, pedir la misma dirección muchas veces a la vez
 * dibujaría la misma imagen otras tantas.
 */
const RECENT_MAX = 16;
/**
 * Poco rato: lo que se guarda no vuelve a mirar si el producto sigue a la
 * venta, y una pieza de algo que se ocultó o se agotó no debe seguir saliendo.
 */
const RECENT_TTL_MS = 10 * 60_000;
const recent = new Map<string, { jpeg: Buffer; at: number }>();
const drawing = new Map<string, Promise<Drawn>>();

async function draw(s: PieceSnapshot): Promise<Drawn> {
  // Lectura pública: lo oculto a mano no se ve con esta clave. Además tiene
  // que seguir a la venta; una pieza de algo que ya no se vende no se publica.
  const supabase = getSupabase();
  if (!supabase) return { error: 'No disponible', status: 503 };
  const { data, error } = await supabase
    .from('products')
    .select('name, brand, image_url, is_active')
    .eq('id', s.productId)
    .maybeSingle();
  if (error) return { error: 'No disponible', status: 502 };
  const row = data as PieceRow | null;
  if (!row || !row.is_active) return { error: 'No encontrado', status: 404 };

  // Sin la foto la pieza saldría con el marco vacío: mejor fallar, que quien
  // programa el post se entere, a publicar una imagen sin producto.
  const photo = await loadPhoto(row.image_url, 'F');
  if (!photo) return { error: 'No se pudo bajar la foto del producto', status: 502 };

  const product: OgProduct = {
    name: row.name,
    brand: row.brand,
    price: s.price,
    original_price: s.listPrice > 0 ? s.listPrice : null,
    image_url: row.image_url,
    price_checked_at: s.checkedAt > 0 ? new Date(s.checkedAt * 1000).toISOString() : null,
    offer_info: { free_shipping: s.freeShipping, is_full: s.full },
  };

  try {
    const png = new ImageResponse(<ProductOgTemplate product={product} format={s.format} photo={photo} />, OG_SIZES[s.format]);
    return { jpeg: await pngToJpeg(await png.arrayBuffer(), BACKGROUND) };
  } catch (err) {
    console.error('[social/pieza] no se pudo dibujar la pieza:', err instanceof Error ? err.message : err);
    return { error: 'No se pudo generar la imagen', status: 500 };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ productId: string; file: string }> }) {
  const { productId, file } = await params;

  // Sin firma válida no se toca la base ni se dibuja nada: es lo único que
  // un desconocido puede pedir, y así no cuesta casi nada.
  const key = pieceKey();
  if (!key) return refuse('No encontrado', 404);
  const check = checkPiecePath(productId, file, key, Math.floor(Date.now() / 1000));
  if (!check.ok) return refuse('No encontrado', check.reason === 'formato' ? 404 : 403);
  const s = check.snapshot;

  // Solo la dirección exacta que firmó el sitio: con parámetros (?x=1) o
  // escrita de otra forma se rechaza. No lo cierra todo (hay parámetros
  // internos de Next que no llegan hasta acá): lo que de verdad impide que
  // una firma filtrada haga dibujar sin límite es `recent` y `drawing`.
  const path = piecePath(s, key);
  if (req.nextUrl.search || req.nextUrl.pathname !== path) return refuse('No encontrado', 404);

  const now = Date.now();
  const cached = recent.get(path);
  let jpeg = cached && now - cached.at < RECENT_TTL_MS ? cached.jpeg : null;
  if (!jpeg) {
    let pending = drawing.get(path);
    if (!pending) {
      pending = draw(s).finally(() => drawing.delete(path));
      drawing.set(path, pending);
    }
    const drawn = await pending;
    if ('error' in drawn) {
      recent.delete(path);
      return refuse(drawn.error, drawn.status);
    }
    jpeg = drawn.jpeg;
    recent.delete(path);
    recent.set(path, { jpeg, at: now });
    if (recent.size > RECENT_MAX) recent.delete(recent.keys().next().value as string);
  }

  return new Response(new Uint8Array(jpeg), {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(jpeg.length),
      // La misma dirección da la misma imagen, pero se guarda poco rato: si
      // el producto se oculta o se agota, la pieza tiene que dejar de salir.
      'Cache-Control': 'public, max-age=300, s-maxage=600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
