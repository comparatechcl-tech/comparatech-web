import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { startCronRun } from '@/lib/cron-runs';
import { isProductionRuntime } from '@/lib/runtime-env';
import { MAX_REQUESTS, VIDEOS_JOB, recentBuildRequests, requestVideoBuild } from '@/lib/video-build';
import { videoDispatchToken } from '@/lib/video-dispatch';

/**
 * Mira si hay videos por armar y, si los hay, le pide a GitHub que corra la
 * pasada que los arma (lib/video-build). Así un precio recién revisado en el
 * admin tiene su video en un rato, sin esperar el horario de GitHub, que
 * atrasa o se salta casi todas las pasadas programadas.
 *
 * La llama pg_cron de Supabase cada media hora (migración 0023). Sin videos
 * por armar no le pide nada a GitHub.
 *
 * Solo pide en el sitio publicado (isProductionRuntime) y con la llave
 * GITHUB_VIDEOS_TOKEN puesta. En cualquier otro lado responde cuántos videos
 * habría por armar, sin pedir nada.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Supabase admin no configurado' }, { status: 500 });

  const now = new Date();
  if (!isProductionRuntime()) {
    const result = await requestVideoBuild(admin, now, { write: false });
    return NextResponse.json({ ...result, prueba: true }, { status: result.ok ? 200 : 500 });
  }

  // Sin la llave no hay a quién pedirle: no se anota una pasada vacía cada media hora.
  if (!videoDispatchToken()) {
    return NextResponse.json({ ok: true, omitida: 'Falta la llave de GitHub (GITHUB_VIDEOS_TOKEN): los videos siguen con el horario de GitHub.' });
  }

  // Cada pasada queda anotada: así /admin/videos sabe que la revisión automática está corriendo.
  const run = await startCronRun(admin, VIDEOS_JOB);
  try {
    // Si algo no se puede armar, seguiría "por armar" todo el día: no se insiste cada media hora.
    if ((await recentBuildRequests(admin, now)) >= MAX_REQUESTS) {
      const body = { ok: true, pedido: false, omitida: 'Ya se pidió varias veces en las últimas horas: se espera la próxima pasada programada.' };
      await run.finish(true, body);
      return NextResponse.json(body);
    }
    const result = await requestVideoBuild(admin, now, { write: true });
    await run.finish(result.ok, result, result.ok ? undefined : result.detalle);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
