import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { enrichFromMl, getMlToken } from '@/lib/ml-enrichment';

interface CatalogRow {
  id: string;
  ml_product_id: string;
  seller_id: number | null;
  price: number;
  is_active: boolean;
  name: string;
  brand: string | null;
  specs: Record<string, string> | null;
  description: string | null;
}

/**
 * Un producto queda incompleto cuando se aprobó antes de que existiera el
 * enriquecimiento, o cuando ML estaba caído justo en ese momento. Sin esto
 * el hueco no se cerraba nunca: la ficha se publicaba con la tabla de
 * especificaciones vacía y sin marca, y el comparador no tenía nada que
 * comparar.
 */
function missingCatalogData(product: CatalogRow): boolean {
  return (
    !product.brand?.trim() ||
    !product.description?.trim() ||
    Object.keys(product.specs ?? {}).length === 0
  );
}

/**
 * Corre una vez al día vía Vercel Cron (ver vercel.json), para todo producto
 * aprobado que venga de la prospección automática (tiene ml_product_id):
 *  1. Refresca el precio del vendedor específico (seller_id) al que apunta
 *     el affiliate_url ya generado — NO al vendedor más barato del momento.
 *     Un mismo producto de catálogo puede tener 10+ vendedores a precios
 *     distintos; si tomáramos el más barato, el precio mostrado dejaría de
 *     coincidir con lo que el usuario paga al hacer click en el link.
 *  2. Si ese vendedor específico ya no ofrece el producto (se dio de baja
 *     o le venció el stock) o perdió reputación verde, desactiva el
 *     producto (is_active=false) en vez de borrarlo — deja de mostrarse en
 *     el sitio pero se conserva el historial, y queda pendiente de que se
 *     genere un link nuevo a mano si hay reemplazo. Si vuelve a cumplir, se
 *     reactiva solo.
 *  3. Rellena marca, specs y descripción en los productos que quedaron
 *     incompletos (aprobados antes de que existiera el enriquecimiento, o
 *     con ML caído en ese momento). Solo consulta ML de más para los que
 *     tienen huecos, no para todo el catálogo.
 * No toca productos cargados a mano sin ml_product_id.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const { data, error: fetchError } = await admin
    .from('products')
    .select('id, ml_product_id, seller_id, price, is_active, name, brand, specs, description')
    .not('ml_product_id', 'is', null);

  const products = data as CatalogRow[] | null;

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!products || products.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, deactivated: 0, repaired: 0, failed: 0 });
  }

  const accessToken = await getMlToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'No se pudo obtener token de ML' }, { status: 502 });
  }
  const auth = { Authorization: `Bearer ${accessToken}` };

  let updated = 0;
  let deactivated = 0;
  let repaired = 0;
  let failed = 0;

  for (const product of products) {
    try {
      const itemsRes = await fetch(
        `https://api.mercadolibre.com/products/${product.ml_product_id}/items`,
        { headers: auth }
      );
      const itemsData = await itemsRes.json();
      const offer = itemsData?.results?.find(
        (r: { seller_id: number }) => r.seller_id === product.seller_id
      );

      if (!itemsRes.ok || !offer) {
        // Ese vendedor específico ya no ofrece el producto (se dio de baja
        // o se quedó sin stock) — no reemplazamos por otro vendedor
        // automáticamente, el link de afiliado ya apunta a este.
        if (product.is_active) {
          await admin.from('products').update({ is_active: false }).eq('id', product.id);
        }
        deactivated++;
        continue;
      }

      const userRes = await fetch(`https://api.mercadolibre.com/users/${offer.seller_id}`, {
        headers: auth,
      });
      const userData = await userRes.json();
      const isGreen = String(userData?.seller_reputation?.level_id ?? '').includes('green');

      const patch: Record<string, unknown> = {};
      if (typeof offer.price === 'number' && offer.price > 0 && offer.price !== product.price) {
        patch.price = offer.price;
      }
      if (isGreen !== product.is_active) {
        patch.is_active = isGreen;
      }

      // Solo pega el request extra a ML si a este producto le falta algo:
      // el catálogo sano no paga el costo.
      if (missingCatalogData(product)) {
        const enrichment = await enrichFromMl(product.ml_product_id, accessToken, product.name);
        if (enrichment.brand && !product.brand?.trim()) patch.brand = enrichment.brand;
        if (enrichment.description && !product.description?.trim()) {
          patch.description = enrichment.description;
        }
        if (
          Object.keys(enrichment.specs).length > 0 &&
          Object.keys(product.specs ?? {}).length === 0
        ) {
          patch.specs = enrichment.specs;
        }
        if (patch.brand || patch.description || patch.specs) repaired++;
      }

      if (Object.keys(patch).length > 0) {
        const { error: updateError } = await admin.from('products').update(patch).eq('id', product.id);
        if (updateError) throw updateError;
      }

      if (isGreen) updated++;
      else deactivated++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, updated, deactivated, repaired, failed, total: products.length });
}
