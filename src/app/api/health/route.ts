import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Estado del sitio para un monitor externo (UptimeRobot, healthchecks.io…).
 *
 * Responde 200 si los precios y la prospección están al día, y 503 si no.
 * Un cron que deja de correr no avisa por sí solo: el sitio sigue arriba,
 * pero con precios viejos, y el comprador ve en Mercado Libre otro precio
 * que el publicado. Este endpoint convierte eso en una alerta.
 *
 * Público a propósito (el monitor no tiene credenciales), así que solo
 * devuelve antigüedades en minutos y horas: nada de nombres, errores de la
 * base ni configuración.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Antigüedad máxima aceptable de la última revisión de precios. pg_cron la
 * corre cada 30 minutos (migración 0011): 90 deja pasar una corrida fallida
 * sin alarma, pero no dos seguidas. Se puede subir con
 * HEALTH_MAX_PRICE_AGE_MIN si algún día se vuelve al cron diario.
 */
const DEFAULT_MAX_PRICE_AGE_MIN = 90;

/** La prospección es diaria: 26 horas cubren el margen de hora de Vercel Cron. */
const MAX_PROSPECT_AGE_H = 26;

function maxPriceAgeMin(): number {
  const value = Number(process.env.HEALTH_MAX_PRICE_AGE_MIN);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_PRICE_AGE_MIN;
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : Math.max(0, now - ms);
}

async function latestPriceCheck(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin
    .from('products')
    .select('price_checked_at')
    .not('price_checked_at', 'is', null)
    .order('price_checked_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data ?? [])[0] as { price_checked_at?: string } | undefined)?.price_checked_at ?? null;
}

/**
 * Última prospección que terminó bien, según la bitácora (migración 0018).
 * Sin bitácora, el descarte o candidato más reciente: la prospección deja
 * uno u otro en cada corrida que analiza algo.
 */
async function latestProspect(admin: SupabaseClient): Promise<string | null> {
  const runs = await admin
    .from('cron_runs')
    .select('finished_at')
    .eq('job', 'prospect')
    .eq('ok', true)
    .not('finished_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (!runs.error) {
    const at = ((runs.data ?? [])[0] as { finished_at?: string } | undefined)?.finished_at;
    if (at) return at;
  } else if (!isMissingSchemaError(runs.error)) {
    throw new Error(runs.error.message);
  }

  const [seen, candidates] = await Promise.all([
    admin.from('prospect_seen').select('seen_at').order('seen_at', { ascending: false }).limit(1),
    admin.from('product_candidates').select('prospected_at').order('prospected_at', { ascending: false }).limit(1),
  ]);
  if (seen.error) throw new Error(seen.error.message);
  if (candidates.error) throw new Error(candidates.error.message);
  const values = [
    ((seen.data ?? [])[0] as { seen_at?: string } | undefined)?.seen_at,
    ((candidates.data ?? [])[0] as { prospected_at?: string } | undefined)?.prospected_at,
  ].filter((v): v is string => !!v);
  return values.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

export async function GET() {
  const headers = { 'cache-control': 'no-store, max-age=0' };
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, precios_hace_min: null, prospeccion_hace_h: null }, { status: 503, headers });
  }

  try {
    const now = Date.now();
    const [priceAt, prospectAt] = await Promise.all([latestPriceCheck(admin), latestProspect(admin)]);
    const priceAge = ageMs(priceAt, now);
    const prospectAge = ageMs(prospectAt, now);

    const preciosHaceMin = priceAge === null ? null : Math.floor(priceAge / 60_000);
    const prospeccionHaceH = prospectAge === null ? null : Math.round((prospectAge / 3_600_000) * 10) / 10;

    const ok =
      preciosHaceMin !== null &&
      preciosHaceMin <= maxPriceAgeMin() &&
      prospeccionHaceH !== null &&
      prospeccionHaceH <= MAX_PROSPECT_AGE_H;

    return NextResponse.json(
      { ok, precios_hace_min: preciosHaceMin, prospeccion_hace_h: prospeccionHaceH },
      { status: ok ? 200 : 503, headers }
    );
  } catch (err) {
    // El detalle va a los logs de Vercel, no a la respuesta pública.
    console.error('[health] no se pudo leer la base:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, precios_hace_min: null, prospeccion_hace_h: null }, { status: 503, headers });
  }
}
