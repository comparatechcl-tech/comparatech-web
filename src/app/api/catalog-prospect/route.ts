import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

/**
 * Recibe candidatos prospectados por Make (highlights → products → items →
 * users de la API de ML) y los guarda en `product_candidates`, NUNCA en
 * `products` directo — nada llega al sitio público sin que un humano
 * complete affiliate_url a mano. INACTIVO por defecto, igual que
 * /api/catalog-sync.
 *
 * Body esperado (POST):
 *   { candidates: [ { ml_product_id, name, brand, category, price,
 *     original_price, image_url, description, specs, seller_id,
 *     seller_nickname, seller_reputation, seller_sales_count } ] }
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_CATALOG_PROSPECT !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = req.headers.get('x-catalog-sync-token');
  if (!token || token !== process.env.CATALOG_PROSPECT_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: 'Supabase admin client no configurado' },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body?.candidates || !Array.isArray(body.candidates)) {
    return NextResponse.json(
      { error: 'Body inválido, se espera { candidates: [...] }' },
      { status: 400 }
    );
  }

  // Solo vendedores con reputación verde entran a revisión, según la regla
  // del Programa de Afiliados de ML (CLAUDE.md).
  const accepted = body.candidates.filter((c: { seller_reputation?: string }) => c.seller_reputation === 'verde');
  const skipped = body.candidates.length - accepted.length;

  if (accepted.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, skipped });
  }

  const { error } = await admin.from('product_candidates').upsert(accepted, {
    onConflict: 'ml_product_id',
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inserted: accepted.length, skipped });
}
