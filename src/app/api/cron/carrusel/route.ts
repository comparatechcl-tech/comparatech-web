import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { startCronRun } from '@/lib/cron-runs';
import { isProductionRuntime } from '@/lib/runtime-env';
import { SITE_URL } from '@/lib/site';
import { CAROUSEL_AUTO_ACTOR, runCarouselAuto } from '@/lib/social/carousel-auto';
import { liveCheckOffers } from '@/lib/social/live-check-server';

/**
 * El carrusel "Top bajas de la semana" automático (lib/social/carousel-auto).
 * El cron lo llama todos los días (vercel.json en Vercel; pg_cron de Supabase
 * desde la mudanza a Railway, migración 0019); solo publica los jueves y los
 * días extra del Black Friday.
 *
 * Solo en el sitio publicado (isProductionRuntime): las vistas previas, la
 * copia de prueba y el PC del dueño usan la misma base y las mismas cuentas.
 */

// Instagram procesa cada lámina antes de armar el carrusel: puede tardar.
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isProductionRuntime()) {
    return NextResponse.json({ ok: true, skipped: 'Solo publica el sitio en producción.' });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const run = await startCronRun(admin, 'carrusel');
  try {
    const summary = await runCarouselAuto(admin, new Date(), {
      siteUrl: SITE_URL,
      liveCheck: (items) => liveCheckOffers(admin, items, CAROUSEL_AUTO_ACTOR),
    });
    await run.finish(summary.ok, summary, summary.ok ? undefined : summary.skipped ?? 'falló una red');
    return NextResponse.json(summary, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/EAA[A-Za-z0-9]{10,}/g, 'EAA…') : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
