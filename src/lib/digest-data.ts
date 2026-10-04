import type { SupabaseClient } from '@supabase/supabase-js';
import { SITE_URL } from '@/lib/site';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { readAffiliateSettings } from '@/lib/settings';
import { readAttributionStatus } from '@/lib/admin-settings';
import { fetchAllRows, minutesSince, readDaysSinceLastApproval } from '@/lib/admin-stats';
import { chileDateKey, chileDayStart, shiftDateKey } from '@/lib/clicks';
import {
  pickTopToApprove,
  rankForApproval,
  type DigestAttribution,
  type DigestCandidate,
  type DigestInput,
} from '@/lib/daily-digest';

type DbError = { code?: string; message: string } | null;

/** Columnas de candidato que existen desde siempre. */
const CANDIDATE_COLUMNS =
  'name, price, original_price, category, image_url, seller_nickname, prospected_at, ml_family_id';
/** La raíz llega con la migración 0018; sin ella se estima con la tasa más baja. */
const CANDIDATE_COLUMNS_0018 = `${CANDIDATE_COLUMNS}, ml_root_category`;

interface PendingRow extends DigestCandidate {
  prospected_at: string | null;
}

/**
 * Toda la cola de revisión, de a páginas (PostgREST corta en 1.000 filas).
 * Con la raíz si existe la columna; si no, sin ella.
 */
async function readPending(admin: SupabaseClient): Promise<{ rows: PendingRow[]; error: DbError }> {
  const read = (columns: string) =>
    fetchAllRows<PendingRow>(
      (from, to) =>
        admin
          .from('product_candidates')
          .select(columns)
          .eq('status', 'pending_review')
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
    );
  const first = await read(CANDIDATE_COLUMNS_0018);
  if (first.error && isMissingSchemaError(first.error)) return read(CANDIDATE_COLUMNS);
  return first;
}

/** Revisión de precios más reciente (price_checked_at más alto). */
async function readLastPriceCheck(admin: SupabaseClient): Promise<{ at: string | null; error: DbError }> {
  const { data, error } = await admin
    .from('products')
    .select('price_checked_at')
    .not('price_checked_at', 'is', null)
    .order('price_checked_at', { ascending: false })
    .limit(1);
  if (error) return { at: null, error };
  return { at: ((data ?? [])[0] as { price_checked_at?: string | null } | undefined)?.price_checked_at ?? null, error: null };
}

/**
 * Clics de ayer (hora de Chile). null si la tabla todavía no existe
 * (migración 0015): no es un error, es algo que falta activar.
 */
async function readClicksYesterday(admin: SupabaseClient, now: Date): Promise<{ count: number | null; error: DbError }> {
  // Un conteo con head:true no avisa si falta la tabla (supabase-js lo
  // convierte en count null sin error): se prueba antes con una fila.
  const probe = await admin.from('outbound_clicks').select('id').limit(1);
  if (probe.error) return isMissingSchemaError(probe.error) ? { count: null, error: null } : { count: null, error: probe.error };

  const today = chileDateKey(now);
  const { count, error } = await admin
    .from('outbound_clicks')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', chileDayStart(shiftDateKey(today, -1)).toISOString())
    .lt('created_at', chileDayStart(today).toISOString());
  if (error) return { count: null, error };
  return { count: count ?? null, error: count === null ? { message: 'sin conteo' } : null };
}

/** Promesa que nunca lanza: si falla, devuelve el error como dato. */
async function settle<T>(promise: PromiseLike<T>): Promise<{ value: T | null; thrown: string | null }> {
  try {
    return { value: await promise, thrown: null };
  } catch (err) {
    return { value: null, thrown: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Junta los datos del resumen diario.
 *
 * Vive aparte de la ruta porque lo usan dos lugares: el endpoint que permite
 * previsualizar el correo en el navegador, y el cron que lo envía.
 *
 * Nunca lanza: cada consulta que falla queda en `errors` con un nombre que
 * la dueña entienda, y el correo sale igual avisando que hay datos
 * incompletos. Un correo que no llega porque falló el conteo de clics es
 * peor que uno que llega con un número de menos.
 */
export async function gatherDigestInput(admin: SupabaseClient, now: Date = new Date()): Promise<DigestInput> {
  const errors: string[] = [];
  const failed = (label: string, err: DbError | string | null | undefined) => {
    if (!err) return false;
    const message = typeof err === 'string' ? err : err.message;
    console.error(`[digest] falló ${label}: ${message}`);
    errors.push(label);
    return true;
  };

  // Ventana de 24 horas en vez de "día calendario": evita depender de la
  // zona horaria del servidor y del cambio de hora en Chile.
  const since = now.getTime() - 24 * 60 * 60 * 1000;

  const [pendingRes, publishedRes, offSiteRes, approvalRes, priceRes, clicksRes, settingsRes, attributionRes] =
    await Promise.all([
      settle(readPending(admin)),
      settle(
        admin
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('is_hidden', false)
      ),
      // Todo lo que está fuera del sitio sin que nadie lo haya ocultado. Se
      // separa abajo entre lo que requiere acción y lo que vuelve solo.
      // Tope alto pero tope: el correo solo lista los nombres que necesitan link.
      settle(
        admin
          .from('products')
          .select('name, inactive_reason')
          .eq('is_active', false)
          .eq('is_hidden', false)
          .order('inactive_since', { ascending: false, nullsFirst: false })
          .limit(1000)
      ),
      settle(readDaysSinceLastApproval(admin, now)),
      settle(readLastPriceCheck(admin)),
      settle(readClicksYesterday(admin, now)),
      settle(readAffiliateSettings(admin)),
      settle(readAttributionStatus(admin)),
    ]);

  // Cola de revisión
  let pending: PendingRow[] = [];
  if (!failed('candidatos por revisar', pendingRes.thrown ?? pendingRes.value?.error)) {
    pending = pendingRes.value?.rows ?? [];
  }
  const ranked = rankForApproval(pending);
  const newCandidates = ranked.filter((c) => c.prospected_at && new Date(c.prospected_at).getTime() >= since);

  // Publicados
  let publishedTotal = 0;
  if (!failed('productos publicados', publishedRes.thrown ?? publishedRes.value?.error)) {
    publishedTotal = publishedRes.value?.count ?? 0;
  }

  // Fuera del sitio. Solo link_otro_producto es un problema real: lo demás
  // es pausa automática y vuelve sola.
  let offSite: { name: string; inactive_reason: string | null }[] = [];
  if (!failed('productos fuera del sitio', offSiteRes.thrown ?? offSiteRes.value?.error)) {
    offSite = (offSiteRes.value?.data ?? []) as typeof offSite;
  }
  const needsLink = offSite.filter((p) => p.inactive_reason === 'link_otro_producto');

  // Días sin publicar
  let daysSinceLastApproval: number | null = null;
  if (!failed('última aprobación', approvalRes.thrown ?? approvalRes.value?.error)) {
    daysSinceLastApproval = approvalRes.value?.data?.days ?? null;
  }

  // Salud de los precios
  let lastPriceCheckMinutes: number | null = null;
  if (!failed('última revisión de precios', priceRes.thrown ?? priceRes.value?.error)) {
    lastPriceCheckMinutes = minutesSince(priceRes.value?.at ?? null, now);
  }

  // Clics de ayer
  let clicsAyer: number | null = null;
  if (!failed('clics de ayer', clicksRes.thrown ?? clicksRes.value?.error)) {
    clicsAyer = clicksRes.value?.count ?? null;
  }

  // Modo de links. readAffiliateSettings no lanza (devuelve los valores por
  // omisión si falla), pero se cubre igual.
  failed('configuración de links', settingsRes.thrown);
  const settings = settingsRes.value ?? { directLinks: false, word: null };
  failed('prueba de atribución', attributionRes.thrown);
  const attribution: DigestAttribution = attributionRes.value?.status ?? 'pendiente';

  return {
    newCandidates,
    topToApprove: pickTopToApprove(ranked),
    pendingTotal: pending.length,
    publishedTotal,
    needsLink: needsLink.map((p) => ({ name: p.name })),
    pausedCount: offSite.length - needsLink.length,
    adminUrl: SITE_URL,
    daysSinceLastApproval,
    linkMode: { directLinks: settings.directLinks, word: settings.word },
    attribution,
    lastPriceCheckMinutes,
    clicsAyer,
    errors,
  };
}
