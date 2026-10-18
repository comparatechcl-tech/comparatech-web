import { NextResponse, type NextRequest } from 'next/server';
import { getSlugByMlProductId } from '@/lib/queries/products';
import { mlIdFromShortCode } from '@/lib/content/short-link';
import { SITE_URL } from '@/lib/site';

/**
 * Link corto de un producto: comparatech.cl/p/78729874 lleva a su ficha (ver
 * lib/content/short-link). Los textos nuevos ya no lo llevan; sigue para los
 * que se publicaron con él el 18-10-2026.
 *
 * ?src=corto queda guardado en la visita (UtmCapture), así Métricas cuenta
 * cuántas compras empiezan con un link corto. Un código que no existe, o de
 * un producto que ya no está, lleva a /hoy: lo publicado hoy, que es lo más
 * probable que la persona estuviera buscando.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  const mlId = mlIdFromShortCode(codigo);
  let slug: string | null = null;
  if (mlId) {
    try {
      slug = await getSlugByMlProductId(mlId);
    } catch (err) {
      console.error('[p] no se pudo leer el producto:', err instanceof Error ? err.message : err);
    }
  }
  const target = slug ? `${SITE_URL}/producto/${encodeURIComponent(slug)}?src=corto` : `${SITE_URL}/hoy?src=corto`;
  // Temporal: el producto puede salir del sitio y el mismo código, llevar a otra parte.
  return NextResponse.redirect(target, 307);
}
