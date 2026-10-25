'use server';

import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { LIVE_TEXT, parseLiveItems, type LiveCheck, type ShownOffer } from '@/lib/social/live-price';
import { liveCheckOffers } from '@/lib/social/live-check-server';

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

  const results = await liveCheckOffers(admin, valid, actor);
  return { ...decided, ...results };
}
