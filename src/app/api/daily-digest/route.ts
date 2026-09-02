import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { gatherDigestInput } from '@/lib/digest-data';
import { buildDigestHtml, buildDigestSubject, buildDigestText } from '@/lib/daily-digest';

/**
 * Vista previa del resumen diario.
 *
 * El correo lo envía el cron de prospección (ver /api/cron/prospect), que
 * corre justo antes. Este endpoint queda para poder revisar cómo se ve el
 * correo en cualquier momento, sin esperar a las 08:00 ni disparar un envío:
 *
 *   ?preview=1  devuelve el HTML renderizado en el navegador
 *   sin params  devuelve asunto, html y texto como JSON
 */

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const input = await gatherDigestInput(admin);
  const html = buildDigestHtml(input);

  if (req.nextUrl.searchParams.get('preview') === '1') {
    return new NextResponse(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  return NextResponse.json({
    subject: buildDigestSubject(input),
    html,
    text: buildDigestText(input),
    new_candidates: input.newCandidates.length,
    pending_total: input.pendingTotal,
    published_total: input.publishedTotal,
    needs_attention: input.needsAttention.length,
  });
}
