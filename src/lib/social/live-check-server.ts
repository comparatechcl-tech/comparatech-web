import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAdminEvent } from '@/lib/admin-audit';
import { getMlToken } from '@/lib/ml-enrichment';
import { PRICED_COLUMNS, applyPricing, priceProducts } from '@/lib/pricing';
import { readAffiliateSettings } from '@/lib/settings';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { runLiveChecks, type LiveCheck, type LiveRow, type ShownOffer } from './live-price';

/**
 * La revisión en vivo del precio en Mercado Libre, sin la parte del
 * navegador: la usan el admin (app/admin/live-price-actions, después de
 * pedir la clave) y la publicación diaria automática (lib/social/meta-daily).
 *
 * Pregunta lo mismo que el refresco de precios (priceProducts: el ganador de
 * la caja de compra de la ficha /p/), nunca abre el link de afiliado, y si
 * algo cambió lo guarda igual que el refresco (applyPricing). Quien llama
 * decide si está en el sitio publicado: fuera de él no se debe llamar.
 */

/** Las columnas de la migración 0016 (offer_info y la categoría) y 0017 (deleted_at): sin ellas decide() escribiría de más. */
const FULL_COLUMNS = `${PRICED_COLUMNS}, is_hidden, offer_info, ml_category_id, ml_root_category, deleted_at`;
const BASE_COLUMNS = `${PRICED_COLUMNS}, is_hidden`;

export async function liveCheckOffers(
  admin: SupabaseClient,
  valid: { productId: string; shown: ShownOffer }[],
  actor: string
): Promise<Record<string, LiveCheck>> {
  // Sin las columnas nuevas no hay dónde guardar la categoría raíz: no se busca (igual que el refresco).
  let has0016 = true;
  // La configuración de links, una sola vez para todas (se pide recién si hay algo que revisar).
  let settings: Promise<boolean | undefined> | null = null;
  const directLinks = () => {
    if (!settings) {
      settings = readAffiliateSettings(admin).then(
        (read) => read.directLinks,
        // priceProducts la vuelve a leer por su cuenta.
        () => undefined
      );
    }
    return settings;
  };

  const { results, changes, checked } = await runLiveChecks(valid, {
    async readRows(wanted) {
      for (const columns of [FULL_COLUMNS, BASE_COLUMNS]) {
        const { data, error } = await admin.from('products').select(columns).in('id', wanted);
        if (error && columns === FULL_COLUMNS && isMissingSchemaError(error)) {
          has0016 = false;
          continue;
        }
        if (error) throw new Error(error.message);
        return (data ?? []) as unknown as LiveRow[];
      }
      return [];
    },
    async token() {
      return getMlToken();
    },
    async price(row, token) {
      // Sin verifyLink: nunca se abre el link de afiliado para esto.
      const [outcome] = await priceProducts([row], token, {
        concurrency: 1,
        directLinks: await directLinks(),
        resolveRoots: has0016,
      });
      if (!outcome) throw new Error('sin resultado');
      return outcome;
    },
    async save(outcome) {
      return (await applyPricing(admin, [outcome], 1)) === 0;
    },
  });

  if (changes.length > 0) {
    await logAdminEvent(admin, {
      actor,
      action: 'reverificar',
      target: changes.map((change) => change.productId).join(','),
      after: {
        revisados: checked,
        en_vivo: true,
        cambios: changes.map((change) => ({
          id: change.productId,
          estado: change.status,
          detalle: change.what,
          guardado: change.saved,
          precio_tarjeta: change.shown.price,
          precio_ahora: change.live ? change.live.price : null,
        })),
      },
    });
  }
  return results;
}
