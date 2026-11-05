import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { SITE_URL } from '@/lib/site';
import { readShortsPlan } from '@/lib/social/shorts';

/**
 * El reel de hoy para TikTok y YouTube Shorts, listo para Metricool (ver
 * lib/social/shorts). Lo pide `node scripts/redes.mjs shorts`, que corre la
 * tarea de Claude del PC del dueño, con el mismo secreto de los crons.
 *
 * Solo lee: no publica ni anota nada.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  try {
    const plan = await readShortsPlan(admin, new Date(), SITE_URL);
    return NextResponse.json({ sitio: SITE_URL, ...plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
