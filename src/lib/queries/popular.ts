import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/admin-stats';
import { getAllProducts, getCatalogProducts } from '@/lib/queries/products';
import { rankPopular } from '@/lib/popular';
import type { Product } from '@/lib/types';

/** El período que se mira: con menos días, el sitio no junta clics suficientes para ordenar nada. */
const POPULAR_DAYS = 30;

/**
 * Los ids de producto de los clics hacia Mercado Libre de los últimos 30
 * días, uno por clic. Se guarda una hora, como el catálogo: son unos cientos
 * de filas y la portada no necesita el dato al minuto.
 *
 * La tabla de clics solo se lee con el cliente de servicio. De acá salen
 * solo ids de producto: nada de quién hizo el clic. Si no se puede leer (sin
 * cliente, sin la tabla, la base falla), no hay lista y la sección no sale.
 */
const readClickedIds = unstable_cache(
  async (): Promise<string[]> => {
    const admin = getSupabaseAdmin();
    if (!admin) return [];
    const since = new Date(Date.now() - POPULAR_DAYS * 86_400_000).toISOString();
    const { rows, error } = await fetchAllRows<{ product_id: string | null }>((from, to) =>
      admin
        .from('outbound_clicks')
        .select('product_id')
        .not('product_id', 'is', null)
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, to)
    );
    if (error) throw new Error(error.message);
    return rows.map((r) => r.product_id).filter((id): id is string => Boolean(id));
  },
  ['popular-clicks-v1'],
  { revalidate: 3600, tags: ['catalog'] }
);

/**
 * Los productos más abiertos en Mercado Libre desde el sitio en los últimos
 * 30 días (lib/popular), para la portada. Nunca lanza: sin datos, lista vacía.
 */
export async function getPopularProducts(limit: number): Promise<Product[]> {
  try {
    const [clicks, all, catalog] = await Promise.all([readClickedIds(), getAllProducts(), getCatalogProducts()]);
    return rankPopular(clicks, all, catalog, limit);
  } catch (err) {
    console.warn('[populares] no se pudo armar la lista:', err instanceof Error ? err.message : String(err));
    return [];
  }
}
