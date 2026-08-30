import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';
import {
  buildDigestHtml,
  buildDigestSubject,
  buildDigestText,
  type DigestCandidate,
} from '@/lib/daily-digest';

/**
 * Devuelve el resumen diario del catálogo con el correo ya armado.
 *
 * Existe porque el correo de las 08:00 llegaba todos los días "(sin asunto)"
 * y en blanco: los campos de asunto y contenido del módulo de Gmail estaban
 * vacíos. En vez de escribir el texto dentro de Make —donde no se versiona,
 * no se prueba y una fórmula mal armada rompe el correo en silencio— el
 * contenido se arma acá y Make solo mapea dos campos:
 *
 *   Subject → {{body.subject}}
 *   Content → {{body.html}}    (Body type: Raw HTML)
 *
 * Se puede abrir en el navegador con ?preview=1 para ver cómo queda el correo
 * antes de que salga.
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

  // Ventana de 24 horas en vez de "día calendario": evita depender de la
  // zona horaria del servidor y del cambio de hora en Chile.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [newRes, pendingRes, publishedRes, attentionRes] = await Promise.all([
    admin
      .from('product_candidates')
      .select('name, price, category, image_url, seller_nickname')
      .eq('status', 'pending_review')
      .gte('prospected_at', since)
      .order('price', { ascending: true }),
    admin
      .from('product_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    admin
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('is_hidden', false),
    // Se cayeron del sitio solos y no se recuperan sin intervención: el
    // vendedor dejó de ofrecer el producto, o el link apunta a otra oferta.
    admin
      .from('products')
      .select('name')
      .eq('is_active', false)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false }),
  ]);

  const input = {
    newCandidates: (newRes.data ?? []) as DigestCandidate[],
    pendingTotal: pendingRes.count ?? 0,
    publishedTotal: publishedRes.count ?? 0,
    needsAttention: (attentionRes.data ?? []) as { name: string }[],
    adminUrl: SITE_URL,
  };

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
