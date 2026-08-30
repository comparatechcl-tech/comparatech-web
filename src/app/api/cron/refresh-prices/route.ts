import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { enrichFromMl, getMlToken } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';

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
  ml_family_id: string | null;
  ml_domain_id: string | null;
  ml_item_id: string | null;
  is_hidden: boolean;
  category: string;
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
    !product.ml_family_id ||
    !product.ml_domain_id ||
    Object.keys(product.specs ?? {}).length === 0
  );
}

/**
 * Corre una vez al día vía Vercel Cron (ver vercel.json), para todo producto
 * aprobado que venga de la prospección automática (tiene ml_product_id):
 *  1. Refresca el precio siguiendo la oferta exacta que destaca el link de
 *     afiliado (ml_item_id) — NO el vendedor más barato del momento, ni uno
 *     elegido aparte. Un mismo producto de catálogo tiene 10+ vendedores a
 *     precios distintos: si el precio no sigue al link, el sitio termina
 *     anunciando algo distinto a lo que el comprador encuentra en ML.
 *  2. Si esa oferta ya no existe (se dio de baja
 *     o le venció el stock) o perdió reputación verde, desactiva el
 *     producto (is_active=false) en vez de borrarlo — deja de mostrarse en
 *     el sitio pero se conserva el historial, y queda pendiente de que se
 *     genere un link nuevo a mano si hay reemplazo. Si vuelve a cumplir, se
 *     reactiva solo.
 *  3. Rellena marca, specs, descripción y familia en los productos que quedaron
 *     incompletos (aprobados antes de que existiera el enriquecimiento, o
 *     con ML caído en ese momento). Solo consulta ML de más para los que
 *     tienen huecos, no para todo el catálogo, y de paso recategoriza
 *     segun el domain_id de ML.
 *  4. No toca los productos ocultados a mano (is_hidden): esa decision es
 *     humana y el cron la respeta.
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
    .select(
      'id, ml_product_id, seller_id, price, is_active, name, brand, specs, description, ml_family_id, ml_domain_id, ml_item_id, is_hidden, category'
    )
    .not('ml_product_id', 'is', null);

  const products = data as CatalogRow[] | null;

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!products || products.length === 0) {
    return NextResponse.json({ ok: true, updated: 0, deactivated: 0, repaired: 0, hidden: 0, failed: 0 });
  }

  const accessToken = await getMlToken();
  if (!accessToken) {
    return NextResponse.json({ error: 'No se pudo obtener token de ML' }, { status: 502 });
  }
  const auth = { Authorization: `Bearer ${accessToken}` };

  let updated = 0;
  let deactivated = 0;
  let repaired = 0;
  let hidden = 0;
  let failed = 0;

  for (const product of products) {
    // Bajado a mano desde /admin/productos. Sin este corte, el cron veria
    // que el vendedor sigue vigente y lo volveria a publicar al dia
    // siguiente, pisando una decision humana.
    if (product.is_hidden) {
      hidden++;
      continue;
    }

    try {
      const itemsRes = await fetch(
        `https://api.mercadolibre.com/products/${product.ml_product_id}/items`,
        { headers: auth }
      );
      const itemsData = await itemsRes.json();
      const offers: { item_id: string; seller_id: number; price: number }[] =
        itemsData?.results ?? [];

      // El precio sigue a la oferta exacta que destaca el link de afiliado
      // (ml_item_id), no al vendedor elegido durante la prospección. Eran
      // dos cosas independientes y se separaban: 6 de 16 productos
      // publicaban el precio de un vendedor distinto al que llevaba el
      // link, y en un caso el sitio anunciaba $17.990 para un producto que
      // el comprador encontraba a $19.990.
      //
      // Sin ml_item_id (productos anteriores a esto, o cargados a mano) se
      // sigue usando el vendedor como antes.
      const offer = product.ml_item_id
        ? offers.find((r) => r.item_id === product.ml_item_id)
        : offers.find((r) => r.seller_id === product.seller_id);

      if (!itemsRes.ok || !offer) {
        // La oferta a la que apunta el link ya no existe: se dio de baja, se
        // quedó sin stock o el link quedó apuntando a otro producto. No se
        // reemplaza por otro vendedor automáticamente — habría que generar
        // un link nuevo a mano.
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
      // El vendedor pasa a ser el de la oferta del link, para que la
      // reputación que se verifica y la que se muestra sean las de quien
      // realmente le vende al usuario.
      if (offer.seller_id !== product.seller_id) {
        patch.seller_id = offer.seller_id;
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
        if (enrichment.familyId && !product.ml_family_id) {
          patch.ml_family_id = enrichment.familyId;
        }
        if (enrichment.domainId && !product.ml_domain_id) {
          patch.ml_domain_id = enrichment.domainId;
          // La categoría se recalcula solo cuando aprendemos el dominio, que
          // es más preciso que el que venía del bloque de destacados de ML.
          const mapped = categoryFromDomain(enrichment.domainId);
          if (mapped && mapped !== product.category) patch.category = mapped;
        }
        if (
          patch.brand ||
          patch.description ||
          patch.specs ||
          patch.ml_family_id ||
          patch.ml_domain_id
        ) {
          repaired++;
        }
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

  return NextResponse.json({ ok: true, updated, deactivated, repaired, hidden, failed, total: products.length });
}
