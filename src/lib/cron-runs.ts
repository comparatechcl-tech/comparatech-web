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
  finish(ok: boolean, summary: unknown, error?: string): Promise<void>;
}

const NOOP_RUN: CronRun = { finish: async () => {} };

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
