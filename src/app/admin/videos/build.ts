'use server';

/**
 * "Armar los videos ahora" (/admin/videos): le pide a GitHub que corra ya la
 * pasada que arma los videos del día, sin esperar su horario (lib/video-build).
 *
 * No arma nada por sí misma ni publica en ninguna red: los videos quedan en
 * esta misma página unos minutos después, para subirlos a mano como siempre.
 * Fuera del sitio publicado solo cuenta cuántos habría por armar.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { isProductionRuntime } from '@/lib/runtime-env';
import { requestVideoBuild } from '@/lib/video-build';

export type BuildNowResult =
  | {
      ok: true;
      /** Se le pidió a GitHub. false: no había nada por armar, o es una copia de prueba. */
      requested: boolean;
      /** Videos que el sitio propone ahora y todavía no están armados. */
      pending: number;
      test: boolean;
    }
  | { ok: false; error: string };

export async function buildVideosNow(): Promise<BuildNowResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'La base no está configurada en este servidor.' };

  const production = isProductionRuntime();
  const result = await requestVideoBuild(admin, new Date(), { write: production });
  if (!result.ok) return { ok: false, error: result.detalle ?? 'No se pudo pedir que se armen los videos.' };
  if (result.pedido) await logAdminEvent(admin, { actor, action: 'videos_armar', after: { count: result.porArmar } });
  return { ok: true, requested: result.pedido, pending: result.porArmar, test: !production };
}
