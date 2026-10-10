import { NextResponse, type NextRequest } from 'next/server';
import { getCatalogProducts } from '@/lib/queries/products';
import { parseCompareQuery, toCompareCandidate, toCompareDetail, type CompareList } from '@/lib/compare';

/**
 * Los datos que /comparador pide a medida que se usan:
 *  - ?cat=audio   → los productos de esa categoría, con lo justo para
 *                   elegirlos en los selectores.
 *  - ?slug=...    → un producto con sus specs, para la tabla.
 *
 * Así la página no lleva el catálogo entero. Fuera de /api y con s-maxage
 * por lo mismo que /ofertas/lote: queda 5 minutos en el caché del CDN, y
 * casi todos los pedidos se responden sin ejecutar nada.
 */

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=300',
  'X-Robots-Tag': 'noindex',
};

const REJECT_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function GET(request: NextRequest) {
  const query = parseCompareQuery(request.nextUrl.searchParams);
  if (!query) {
    return NextResponse.json({ error: 'Consulta no válida' }, { status: 400, headers: REJECT_HEADERS });
  }

  // El catálogo de los listados: una ficha por producto real, sin variantes.
  const catalog = await getCatalogProducts();

  if ('slug' in query) {
    const product = catalog.find((p) => p.slug === query.slug);
    // Un producto que ya no está a la venta no se guarda en el caché: cada
    // dirección que responde bien ocupa un lugar.
    if (!product) {
      return NextResponse.json({ error: 'Producto no disponible' }, { status: 404, headers: REJECT_HEADERS });
    }
    return NextResponse.json(toCompareDetail(product), { headers: CACHE_HEADERS });
  }

  const items = catalog.filter((p) => p.category === query.category).map(toCompareCandidate);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Categoría sin productos' }, { status: 404, headers: REJECT_HEADERS });
  }
  const body: CompareList = { items };
  return NextResponse.json(body, { headers: CACHE_HEADERS });
}
