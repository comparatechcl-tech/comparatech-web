import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Bitácora de los crons (tabla cron_runs, migración 0018) y avisos a un
 * servicio de healthcheck.
 *
 * Los crons corren solos, de madrugada o cada media hora, y si dejan de
 * funcionar nadie se entera hasta que los precios ya están viejos. Con la
 * bitácora el admin puede mostrar cuándo corrió cada uno y cómo terminó, y
 * el healthcheck manda un correo cuando un cron falla o deja de llegar.
 *
 * Nada de esto puede tumbar al cron: si la tabla aún no existe o la base
 * falla al anotar, el cron sigue su trabajo igual.
 */

export interface CronRun {
  /** La fila de la bitácora; null o ausente si no se pudo anotar (falta la tabla o la base falló). */
  id?: number | string | null;
  finish(ok: boolean, summary: unknown, error?: string): Promise<void>;
}

const NOOP_RUN: CronRun = { id: null, finish: async () => {} };

/** jsonb solo acepta lo que sobrevive a JSON (sin funciones, ni ciclos, ni BigInt). */
function toJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { nota: 'resumen no serializable' };
  }
}

export async function startCronRun(admin: SupabaseClient, job: string): Promise<CronRun> {
  let id: number | string;
  try {
    const { data, error } = await admin.from('cron_runs').insert({ job }).select('id').single();
    if (error || !data) {
      // Falta la migración 0018: se trabaja sin bitácora, en silencio.
      if (!isMissingSchemaError(error)) console.warn(`[cron-runs] no se pudo abrir ${job}:`, error?.message);
      return NOOP_RUN;
    }
    id = (data as { id: number | string }).id;
  } catch (err) {
    console.warn(`[cron-runs] no se pudo abrir ${job}:`, err);
    return NOOP_RUN;
  }

  let finished = false;
  return {
    id,
    async finish(ok, summary, error) {
      // Una sola vez: si una ruta llama a finish en el catch después de
      // haberlo hecho en el camino feliz, se queda el primer resultado.
      if (finished) return;
      finished = true;
      try {
        const { error: updateError } = await admin
          .from('cron_runs')
          .update({
            finished_at: new Date().toISOString(),
            ok,
            summary: toJson(summary),
            error: error ?? null,
          })
          .eq('id', id);
        if (updateError) console.warn(`[cron-runs] no se pudo cerrar ${job}:`, updateError.message);
      } catch (err) {
        console.warn(`[cron-runs] no se pudo cerrar ${job}:`, err);
      }
    },
  };
}

/**
 * Cuándo empezó la última corrida completa y exitosa del cron, si fue dentro
 * de `windowMs` y antes que esta; null si no hubo (o la base falla: ante la
 * duda, se corre). Las que se retiraron sin trabajar (summary.omitida) no
 * cuentan.
 */
export async function lastFullRunWithin(
  admin: SupabaseClient,
  job: string,
  id: number | string | null | undefined,
  windowMs: number
): Promise<string | null> {
  if (id === null || id === undefined) return null;
  try {
    const { data, error } = await admin
      .from('cron_runs')
      .select('started_at')
      .eq('job', job)
      .eq('ok', true)
      .is('summary->>omitida', null)
      .lt('id', id)
      .gte('started_at', new Date(Date.now() - windowMs).toISOString())
      .order('started_at', { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const startedAt = (data[0] as { started_at?: unknown }).started_at;
    return typeof startedAt === 'string' ? startedAt : null;
  } catch {
    return null;
  }
}

/** Una función de Vercel muere a los 60 s: una corrida abierta hace más que esto ya terminó o se cortó. */
const RUN_IN_PROGRESS_WINDOW_MS = 70_000;

/**
 * ¿Hay otra corrida del mismo cron en curso, empezada antes que esta? Sirve
 * de candado sin migración: el refresco se lanza desde cuatro lados (pg_cron,
 * Vercel, GitHub y el admin) y dos corridas juntas duplicaban filas del
 * historial de precios y la carga a Mercado Libre.
 *
 * Cada corrida se anota primero y después mira si hay una anterior abierta:
 * si dos parten a la vez, sigue solo la de id menor. Una corrida cortada sin
 * cerrar deja de contar a los 70 s. Ante cualquier duda (sin bitácora, la base
 * falla) responde false: es preferible una corrida de más que ninguna.
 */
export async function earlierRunInProgress(
  admin: SupabaseClient,
  job: string,
  id: number | string | null | undefined,
  windowMs = RUN_IN_PROGRESS_WINDOW_MS
): Promise<boolean> {
  if (id === null || id === undefined) return false;
  try {
    const { data, error } = await admin
      .from('cron_runs')
      .select('id')
      .eq('job', job)
      .is('finished_at', null)
      .lt('id', id)
      .gte('started_at', new Date(Date.now() - windowMs).toISOString())
      .limit(1);
    if (error) return false;
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

const HEALTHCHECK_TIMEOUT_MS = 5000;

/**
 * Avisa al healthcheck (por ejemplo healthchecks.io) que el cron terminó.
 * Si salió mal se llama a la misma URL con '/fail', que es la convención de
 * esos servicios para mandar la alerta altiro en vez de esperar a que el
 * aviso no llegue. Sin URL configurada no hace nada.
 */
export async function pingHealthcheck(url: string | undefined, ok: boolean): Promise<void> {
  const base = url?.trim();
  if (!base) return;
  const target = ok ? base : `${base.replace(/\/+$/, '')}/fail`;
  try {
    await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
  } catch (err) {
    // Que el servicio de avisos esté caído no es un error del cron.
    console.warn('[cron-runs] healthcheck no respondió:', err instanceof Error ? err.message : err);
  }
}
