import { getSupabase } from '@/lib/supabase/client';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { publicStoreOffers, type PublicStoreOffer } from '@/lib/store-offers';
import { getStoreSettings } from '@/lib/store-settings';

/**
 * El precio de otras tiendas para la ficha pública de un producto.
 *
 * Se lee con el cliente anon: la tabla tiene una policy de lectura pública
 * solo para las ofertas activas de productos visibles (migración 0022).
 *
 * Nunca lanza y, mientras el dueño no lo encienda en /admin/tiendas, no
 * entrega nada: la ficha se muestra igual que siempre.
 */

/** Tras un "no existe la tabla" se deja de preguntar por un rato (como lib/queries/price-history). */
const MISSING_TABLE_RETRY_MS = 10 * 60 * 1000;
let missingTableUntil = 0;

export async function getStoreOffers(productId: string): Promise<PublicStoreOffer[]> {
  try {
    if (!(await getStoreSettings()).show) return [];
    const supabase = getSupabase();
    if (!supabase || Date.now() < missingTableUntil) return [];
    const { data, error } = await supabase
      .from('store_offers')
      .select('store, url, external_id, seller, price, checked_at, status')
      .eq('product_id', productId)
      .limit(20);
    if (error) {
      if (isMissingSchemaError(error)) missingTableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      else console.warn('[store-offers] no se pudieron leer las otras tiendas:', error.message);
      return [];
    }
    return publicStoreOffers((data ?? []) as Parameters<typeof publicStoreOffers>[0]);
  } catch (err) {
    console.warn('[store-offers] no se pudieron leer las otras tiendas:', err instanceof Error ? err.message : err);
    return [];
  }
}
