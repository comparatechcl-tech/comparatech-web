/**
 * Pedir que se armen los videos del día cuando hay algo que armar.
 *
 * Junta las dos mitades: qué videos propone el sitio ahora y todavía no están
 * armados (lib/social/videos: readVideoPicks, que solo lee) y el pedido a
 * GitHub para que corra la pasada (lib/video-dispatch). Sin nada por armar no
 * se le pide nada a GitHub.
 *
 * La usan /api/cron/videos (cada media hora, pg_cron) y el botón "Armar los
 * videos ahora" de /admin/videos. `deps` existe para las pruebas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { readVideoPicks } from '@/lib/social/videos';
import { dispatchVideoBuild, videoDispatchToken, type DispatchFailure, type DispatchResult } from '@/lib/video-dispatch';

export interface BuildRequest {
  /** false solo si se quiso pedir y GitHub no lo aceptó (o falló leer el plan). */
  ok: boolean;
  /** Se le pidió a GitHub que arme los videos. */
  pedido: boolean;
  /** Videos que el sitio propone ahora y todavía no están armados. */
  porArmar: number;
  /** Por qué no se pidió, o por qué falló. */
  motivo?: DispatchFailure | 'nada_por_armar' | 'prueba' | 'plan';
  detalle?: string;
}

/** El nombre de la pasada en la bitácora de los crons (cron_runs). */
export const VIDEOS_JOB = 'videos';

/** La pasada corre cada media hora: si la última tiene más que esto, no está corriendo. */
const ACTIVE_WINDOW_MS = 45 * 60_000;
/** Tope de pedidos seguidos: si algo no se puede armar, no se le pide a GitHub cada media hora todo el día. */
export const MAX_REQUESTS = 3;
export const REQUESTS_WINDOW_MS = 3 * 3_600_000;

/**
 * ¿La pasada automática está corriendo (pg_cron, migración 0023)? Se sabe por
 * la bitácora: cada pasada del sitio publicado queda anotada. Ante cualquier
 * duda, false. Nunca lanza.
 */
export async function videoCronActive(admin: SupabaseClient, now: Date): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('cron_runs')
      .select('id')
      .eq('job', VIDEOS_JOB)
      .gte('started_at', new Date(now.getTime() - ACTIVE_WINDOW_MS).toISOString())
      .limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Cuántas veces se le pidió a GitHub armar videos en las últimas horas; 0 si no se pudo contar. Nunca lanza. */
export async function recentBuildRequests(admin: SupabaseClient, now: Date): Promise<number> {
  try {
    const { count, error } = await admin
      .from('cron_runs')
      .select('id', { count: 'exact', head: true })
      .eq('job', VIDEOS_JOB)
      .eq('summary->>pedido', 'true')
      .gte('started_at', new Date(now.getTime() - REQUESTS_WINDOW_MS).toISOString());
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export interface BuildDeps {
  pending: (admin: SupabaseClient, now: Date) => Promise<number>;
  hasToken: () => boolean;
  dispatch: () => Promise<DispatchResult>;
}

/** Cuántos de los videos que el sitio propone ahora no están armados todavía. Solo lee. */
export async function pendingVideos(admin: SupabaseClient, now: Date): Promise<number> {
  const plan = await readVideoPicks(admin, now);
  return plan.picks.filter((pick) => !pick.exists).length;
}

const REAL_DEPS: BuildDeps = {
  pending: pendingVideos,
  hasToken: () => videoDispatchToken() !== null,
  dispatch: () => dispatchVideoBuild(),
};

/**
 * Si hay videos por armar, le pide a GitHub que corra la pasada. Nunca lanza.
 *
 * `write: false` (fuera del sitio publicado) cuenta lo que hay por armar y no
 * le pide nada a GitHub. Sin la llave tampoco se lee el plan: no hay a quién
 * pedirle.
 */
export async function requestVideoBuild(
  admin: SupabaseClient,
  now: Date,
  options: { write: boolean },
  deps: BuildDeps = REAL_DEPS
): Promise<BuildRequest> {
  if (options.write && !deps.hasToken()) {
    return {
      ok: false,
      pedido: false,
      porArmar: 0,
      motivo: 'sin_llave',
      detalle: 'Falta la llave de GitHub (variable GITHUB_VIDEOS_TOKEN en Railway).',
    };
  }

  let porArmar: number;
  try {
    porArmar = await deps.pending(admin, now);
  } catch (err) {
    return { ok: false, pedido: false, porArmar: 0, motivo: 'plan', detalle: err instanceof Error ? err.message : String(err) };
  }
  if (porArmar === 0) return { ok: true, pedido: false, porArmar: 0, motivo: 'nada_por_armar' };
  if (!options.write) return { ok: true, pedido: false, porArmar, motivo: 'prueba' };

  const result = await deps.dispatch();
  if (result.ok) return { ok: true, pedido: true, porArmar };
  return { ok: false, pedido: false, porArmar, motivo: result.reason, detalle: result.detail };
}
