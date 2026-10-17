'use server';

import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { getMlToken } from '@/lib/ml-enrichment';
import { PRICED_COLUMNS, applyPricing, priceProducts } from '@/lib/pricing';
import { readAffiliateSettings } from '@/lib/settings';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { LIVE_TEXT, parseLiveItems, runLiveChecks, type LiveCheck, type LiveRow, type ShownOffer } from '@/lib/social/live-price';

/**
 * Revisión en vivo del precio de las tarjetas de /admin/historias y
 * /admin/videos (ver lib/social/live-price).
 *
 * Pregunta a Mercado Libre lo mismo que el refresco de precios, con
 * priceProducts: el ganador de la caja de compra de la ficha /p/. Nunca abre
 * el link de afiliado ni el meli.la (sin verifyLink): cada apertura cuenta
 * como un clic de afiliado.
 *
 * Solo en el sitio publicado (isLiveSite: VERCEL_ENV === 'production'): ahí,
 * si cambió lo que la tarjeta muestra, lo guarda igual que el refresco
 * (applyPricing, con su historial de precios), para que al tocar Actualizar
 * la tarjeta y la imagen salgan con lo de ahora. En cualquier otro lado (el
 * PC del dueño, las vistas previas de Vercel, las pruebas) no consulta
 * Mercado Libre ni escribe nada: cada tarjeta vuelve "no pude revisar".
 * VERCEL === '1' no basta: también vale en las vistas previas y en un
 * .env.local bajado con `vercel env pull`, que usan la misma base de
 * producción.
 *
 * No regenera páginas, a propósito: regenerar desde una acción rearma la
 * lista bajo el dedo (las tarjetas se corren y las imágenes se bajan de
 * nuevo). El sitio público toma el cambio en su próxima regeneración, a más
 * tardar en minutos.
 */

/** Las columnas de la migración 0016 (offer_info y la categoría) y 0017 (deleted_at): sin ellas decide() escribiría de más. */
const FULL_COLUMNS = `${PRICED_COLUMNS}, is_hidden, offer_info, ml_category_id, ml_root_category, deleted_at`;
const BASE_COLUMNS = `${PRICED_COLUMNS}, is_hidden`;

/** ¿Es el sitio publicado? Solo ahí se consulta Mercado Libre y se escribe. */
function isLiveSite(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

function allUnknown(ids: string[], what: string): Record<string, LiveCheck> {
  const results: Record<string, LiveCheck> = {};
  for (const id of ids) results[id] = { status: 'unknown', what };
  return results;
}

/**
 * Revisa en Mercado Libre el precio de hasta 16 tarjetas y dice, por
 * producto, si sigue igual a lo que muestra la tarjeta. Nunca se llama
 * dentro del toque de Compartir: el teléfono pierde el permiso de compartir
 * si se espera al servidor.
 */
export async function checkLivePrices(items: { productId: string; shown: ShownOffer }[]): Promise<Record<string, LiveCheck>> {
  const actor = await requireAdmin();
  const { items: valid, results: decided } = parseLiveItems(items);
  if (valid.length === 0) return decided;
  const ids = valid.map((item) => item.productId);

  if (!isLiveSite()) return { ...decided, ...allUnknown(ids, LIVE_TEXT.offline) };

  const admin = getSupabaseAdmin();
  if (!admin) return { ...decided, ...allUnknown(ids, LIVE_TEXT.siteDown) };

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

  return { ...decided, ...results };
}
