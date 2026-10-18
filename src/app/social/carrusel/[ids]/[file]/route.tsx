import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { getSupabase } from '@/lib/supabase/client';
import { siteName } from '@/lib/content/captions';
import { pngToJpeg } from '@/lib/content/jpeg';
import { interFonts } from '@/lib/content/og-fonts';
import { loadPhoto } from '@/lib/content/og-template';
import { CAROUSEL_SIZE, CarouselClosing, CarouselCover, CarouselProductSlide } from '@/lib/content/carousel-template';
import { carouselKey, carouselPath, carouselRangeLabel, checkCarouselPath, type CarouselSlide } from '@/lib/social/carousel-url';
import { SITE_URL } from '@/lib/site';

/**
 * Las láminas del carrusel semanal (portada, una por producto y cierre), en
 * JPG y en direcciones públicas firmadas por el sitio (lib/social/carousel-url).
 * Las baja el admin (/admin/historias/carrusel) para compartirlas desde el
 * teléfono; como las piezas de un producto (/social/pieza), van fuera de
 * /admin y de /api para que el navegador y Vercel las puedan guardar: la
 * misma dirección da siempre la misma imagen.
 *
 * Solo se dibuja lo que sigue a la venta y visible: la portada pide todos los
 * productos del carrusel, y cada lámina el suyo.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const BACKGROUND = '#070B14';

function refuse(message: string, status: number): Response {
  return new Response(message, { status, headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' } });
}

interface SlideRow {
  id: string;
  name: string;
  brand: string | null;
  image_url: string;
  is_active: boolean;
  ml_domain_id: string | null;
  specs: Record<string, unknown> | null;
}

type Drawn = { jpeg: Buffer } | { error: string; status: number };

/** Lo dibujado hace poco y lo que se está dibujando, como en /social/pieza: la misma lámina pedida a la vez se dibuja una vez. */
const RECENT_MAX = 16;
/** Poco rato: lo guardado no vuelve a mirar si el producto sigue a la venta. */
const RECENT_TTL_MS = 10 * 60_000;
const recent = new Map<string, { jpeg: Buffer; at: number }>();
const drawing = new Map<string, Promise<Drawn>>();

const iso = (seconds: number) => (seconds > 0 ? new Date(seconds * 1000).toISOString() : null);

async function readRows(ids: string[]): Promise<{ rows: Map<string, SlideRow> } | { error: string; status: number }> {
  // Lectura pública: lo oculto a mano no se ve con esta clave.
  const supabase = getSupabase();
  if (!supabase) return { error: 'No disponible', status: 503 };
  const { data, error } = await supabase
    .from('products')
    .select('id, name, brand, image_url, is_active, ml_domain_id, specs')
    .in('id', ids);
  if (error) return { error: 'No disponible', status: 502 };
  const rows = new Map(((data ?? []) as SlideRow[]).map((row) => [row.id, row]));
  // Todo lo del carrusel tiene que seguir a la venta: de lo que ya no se vende no se publica nada.
  if (ids.some((id) => !rows.get(id)?.is_active)) return { error: 'No encontrado', status: 404 };
  return { rows };
}

async function draw(slide: CarouselSlide): Promise<Drawn> {
  const { set } = slide;
  const rangeLabel = carouselRangeLabel(set.kind, set.day);
  let node: JSX.Element;

  if (slide.type === 'cierre') {
    node = <CarouselClosing site={siteName(SITE_URL) ?? 'comparatech.cl'} rangeLabel={rangeLabel} />;
  } else if (slide.type === 'portada') {
    const read = await readRows(set.ids);
    if ('error' in read) return read;
    // La foto mediana basta para los cuadros de la portada, y pesa menos.
    const photos = await Promise.all(set.ids.map((id) => loadPhoto((read.rows.get(id) as SlideRow).image_url, 'O')));
    if (photos.some((photo) => !photo)) return { error: 'No se pudo bajar la foto de un producto', status: 502 };
    node = <CarouselCover kind={set.kind} rangeLabel={rangeLabel} photos={photos} />;
  } else {
    const id = set.ids[slide.item.rank - 1];
    const read = await readRows([id]);
    if ('error' in read) return read;
    const row = read.rows.get(id) as SlideRow;
    // Sin la foto la lámina saldría con el marco vacío: mejor fallar, y el admin lo dice.
    const photo = await loadPhoto(row.image_url, 'F');
    if (!photo) return { error: 'No se pudo bajar la foto del producto', status: 502 };
    const item = slide.item;
    node = (
      <CarouselProductSlide
        rank={item.rank}
        photo={photo}
        product={{
          name: row.name,
          brand: row.brand,
          ml_domain_id: row.ml_domain_id,
          specs: row.specs,
          price: item.price,
          dropAmount: item.dropAmount,
          dropSince: iso(item.dropSince) as string,
          checkedAt: iso(item.checkedAt),
          freeShipping: item.freeShipping,
          full: item.full,
        }}
      />
    );
  }

  try {
    const png = new ImageResponse(node, { ...CAROUSEL_SIZE, fonts: await interFonts() });
    return { jpeg: await pngToJpeg(await png.arrayBuffer(), BACKGROUND) };
  } catch (err) {
    console.error('[social/carrusel] no se pudo dibujar la lámina:', err instanceof Error ? err.message : err);
    return { error: 'No se pudo generar la imagen', status: 500 };
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ ids: string; file: string }> }) {
  const { ids, file } = await params;

  // Sin firma válida no se toca la base ni se dibuja nada.
  const key = carouselKey();
  if (!key) return refuse('No encontrado', 404);
  const check = checkCarouselPath(ids, file, key, Math.floor(Date.now() / 1000));
  if (!check.ok) return refuse('No encontrado', check.reason === 'formato' ? 404 : 403);

  // Solo la dirección exacta que firmó el sitio: con parámetros o escrita de otra forma se rechaza.
  const path = carouselPath(check.slide, key);
  if (req.nextUrl.search || req.nextUrl.pathname !== path) return refuse('No encontrado', 404);

  const now = Date.now();
  const cached = recent.get(path);
  let jpeg = cached && now - cached.at < RECENT_TTL_MS ? cached.jpeg : null;
  if (!jpeg) {
    let pending = drawing.get(path);
    if (!pending) {
      pending = draw(check.slide).finally(() => drawing.delete(path));
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
      // La misma dirección da la misma imagen, pero se guarda poco rato: si un
      // producto se oculta o se agota, la lámina tiene que dejar de salir.
      'Cache-Control': 'public, max-age=300, s-maxage=600',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
