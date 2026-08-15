import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

/**
 * Endpoint preparado para que Make.com actualice el catálogo a diario.
 * INACTIVO por defecto: mientras ENABLE_CATALOG_SYNC no sea "true" en las
 * variables de entorno, responde 404 sin ejecutar nada. Actívalo solo
 * después de revisar la autenticación y el formato del payload.
 *
 * Uso esperado una vez activado (POST):
 *   Headers: { "x-catalog-sync-token": "<CATALOG_SYNC_TOKEN>" }
 *   Body: { "products": [ { name, brand, category, price, ... } ] }
 */
export async function POST(req: NextRequest) {
  if (process.env.ENABLE_CATALOG_SYNC !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const token = req.headers.get('x-catalog-sync-token');
  if (!token || token !== process.env.CATALOG_SYNC_TOKEN) {
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
  if (!body?.products || !Array.isArray(body.products)) {
    return NextResponse.json({ error: 'Body inválido, se espera { products: [...] }' }, { status: 400 });
  }

  const { error } = await admin.from('products').upsert(body.products, {
    onConflict: 'slug',
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: body.products.length });
}
