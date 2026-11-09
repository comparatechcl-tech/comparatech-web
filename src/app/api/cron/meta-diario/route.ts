import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { startCronRun } from '@/lib/cron-runs';
import { isProductionRuntime } from '@/lib/runtime-env';
import { liveCheckOffers } from '@/lib/social/live-check-server';
import { DAILY_ACTOR, readLastReelDomain, runMetaDaily } from '@/lib/social/meta-daily';
import { readVideoBoard } from '@/lib/social/videos';

/**
 * La publicación diaria automática de un reel en Instagram y Facebook
 * (lib/social/meta-daily). La llama el cron tres veces al día (vercel.json en
 * Vercel; pg_cron de Supabase desde la mudanza a Railway, migración 0019): la
 * primera pasada elige y publica, las otras terminan Instagram si quedó
 * procesándose. Una pasada de más no publica dos veces.
 *
 * Solo en el sitio publicado (isProductionRuntime): las vistas previas, la
 * copia de prueba y el PC del dueño usan la misma base y las mismas cuentas,
 * y no deben publicar nada.
 */

// 120 s: la primera pasada sube a Facebook y espera a Instagram, y con 60 s se cortó dos veces (27 y 31-10).
// Esperar a Meta casi no gasta CPU.
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isProductionRuntime()) {
    return NextResponse.json({ ok: true, skipped: 'Solo publica el sitio en producción.' });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const run = await startCronRun(admin, 'meta-diario');
  try {
    const summary = await runMetaDaily(admin, new Date(), {
      readBoard: readVideoBoard,
      lastDomain: readLastReelDomain,
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
