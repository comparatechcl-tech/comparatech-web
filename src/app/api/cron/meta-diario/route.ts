import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { startCronRun } from '@/lib/cron-runs';
import { liveCheckOffers } from '@/lib/social/live-check-server';
import { DAILY_ACTOR, runMetaDaily } from '@/lib/social/meta-daily';
import { readVideoBoard } from '@/lib/social/videos';

/**
 * La publicación diaria automática de un reel en Instagram y Facebook
 * (lib/social/meta-daily). La llama el cron de Vercel dos veces al día
 * (vercel.json): la primera pasada elige y publica, la segunda termina
 * Instagram si quedó procesándose. Una pasada de más no publica dos veces.
 *
 * Solo en el sitio publicado (VERCEL_ENV === 'production'): las vistas
 * previas y el PC del dueño usan la misma base y las mismas cuentas, y no
 * deben publicar nada.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.VERCEL_ENV !== 'production') {
    return NextResponse.json({ ok: true, skipped: 'Solo publica el sitio en producción.' });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const run = await startCronRun(admin, 'meta-diario');
  try {
    const summary = await runMetaDaily(admin, new Date(), {
      readBoard: readVideoBoard,
      liveCheck: (items) => liveCheckOffers(admin, items, DAILY_ACTOR),
    });
    await run.finish(summary.ok, summary, summary.ok ? undefined : summary.skipped ?? 'falló una red');
    return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/EAA[A-Za-z0-9]{10,}/g, 'EAA…') : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
