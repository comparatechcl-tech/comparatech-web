import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { startCronRun } from '@/lib/cron-runs';
import { isProductionRuntime } from '@/lib/runtime-env';
import { liveCheckOffers } from '@/lib/social/live-check-server';
import { STORY_ACTOR, runMetaStory } from '@/lib/social/meta-story';
import { pieceKey } from '@/lib/social/piece-url';
import { readStoryPicks } from '@/lib/social/stories';

/**
 * La historia automática de Instagram (lib/social/meta-story). La llama
 * pg_cron de Supabase dos veces al día (migración 0020): la primera publica,
 * la segunda solo reintenta si no salió nada. Una pasada de más no publica
 * dos veces.
 *
 * Solo en el sitio publicado (isProductionRuntime): las vistas previas y el
 * PC del dueño usan la misma base y las mismas cuentas, y no deben publicar.
 */

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isProductionRuntime()) {
    return NextResponse.json({ ok: true, skipped: 'Solo publica el sitio en producción.' });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const run = await startCronRun(admin, 'historia-diaria');
  try {
    const summary = await runMetaStory(admin, new Date(), {
      key: pieceKey(),
      readPicks: readStoryPicks,
      liveCheck: (items) => liveCheckOffers(admin, items, STORY_ACTOR),
    });
    await run.finish(summary.ok, summary, summary.ok ? undefined : summary.skipped ?? summary.state?.error ?? 'no se pudo publicar');
    return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/EAA[A-Za-z0-9]{10,}/g, 'EAA…') : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
