import { NextResponse, type NextRequest } from 'next/server';
import { getRankedDeals } from '@/lib/queries/deals';
import { getCategoryInfo } from '@/lib/categories';
import { dealsBatch, parseDealsBatchQuery } from '@/lib/deals-listing';

/**
 * Una tanda de ofertas para la página /ofertas: las que siguen al tocar
 * "ver más", o las primeras de un filtro (?cat=, ?hot=1, ?desde=).
 *
 * Vive fuera de /api a propósito: todo /api sale con Cache-Control no-store
 * (ver next.config.js), y esto tiene que quedar guardado en el CDN igual que
 * la página. Como lee la dirección, Next la ejecuta en cada pedido; el
 * s-maxage hace que Vercel responda la misma dirección desde su caché por 5
 * minutos, que es lo que dura la página.
 */

const CACHE_HEADERS = {
  // max-age=0: el navegador no guarda nada por su cuenta; lo guarda el CDN.
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=300',
  // Son datos para la página, no una página: que no aparezca en Google.
  'X-Robots-Tag': 'noindex',
};

const REJECT_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(request: NextRequest) {
  const query = parseDealsBatchQuery(request.nextUrl.searchParams);
  if (!query) {
    return NextResponse.json({ error: 'Consulta no válida' }, { status: 400, headers: REJECT_HEADERS });
  }

  const { ranked, drops } = await getRankedDeals();

  // Una categoría que no existe se rechaza en vez de responder una lista
  // vacía: cada dirección distinta que responde bien ocupa un lugar en el
  // caché. Una que existe y hoy no tiene ofertas sí responde vacía.
  const { category } = query.filter;
  if (category && !getCategoryInfo(category) && !ranked.some((p) => p.category === category)) {
    return NextResponse.json({ error: 'Categoría desconocida' }, { status: 400, headers: REJECT_HEADERS });
  }

  return NextResponse.json(dealsBatch(ranked, drops, query.filter, query.offset), {
    headers: CACHE_HEADERS,
  });
}
