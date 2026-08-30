import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { enrichFromMlProduct, getMlToken } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';
import {
  buildPublishedCatalog,
  collapseCandidateFamilies,
  partitionCandidates,
} from '@/lib/prospect-filter';
import {
  ROOT_CATEGORIES,
  firstPictureUrl,
  getHighlightedProductIds,
  getProduct,
  getProductOffers,
  getSellers,
  getSubcategories,
  isGreenSeller,
  mapWithConcurrency,
  type MlOffer,
  type MlSeller,
} from '@/lib/ml-catalog';

/**
 * Prospección diaria del catálogo.
 *
 * Reemplaza al escenario de Make, que consumía créditos del plan gratuito y
 * chocaba contra el límite de ML al renovar su token ("Rate limiter
 * grant_type refresh_token was exceeded"). Acá se usa client_credentials,
 * que no necesita refresh.
 *
 * También amplía la fuente: Make miraba los destacados de dos o tres
 * categorías raíz —20 productos fijos cada una, casi los mismos todos los
 * días, por eso entraba alrededor de un candidato nuevo por jornada—. Este
 * recorre las subcategorías, que son unas 68 entre las cinco ramas del
 * proyecto y suman más de mil destacados.
 *
 * El orden de las llamadas es lo que hace que todo entre en el techo de 60
 * segundos de la función:
 *   1. destacados de todas las subcategorías (una llamada cada una)
 *   2. se descartan los IDs ya conocidos, sin gastar una sola llamada más
 *   3. ficha de catálogo de los que quedan
 *   4. ofertas SOLO de los que caen dentro de la taxonomía del sitio
 *   5. reputación de los vendedores, en lotes de 20
 *
 * Parámetros útiles para correrlo a mano:
 *   ?dry=1    analiza y reporta sin escribir nada
 *   ?limit=N  cambia el tope de productos nuevos por corrida
 */

export const maxDuration = 60;

/** Margen antes del techo de Vercel, para alcanzar a guardar y responder. */
const TIME_BUDGET_MS = 45_000;

/**
 * Tope de productos nuevos analizados por corrida. Lo que no alcanza a
 * entrar queda para el día siguiente: como los IDs ya vistos se descartan
 * antes de gastar llamadas, cada corrida avanza sobre lo que falta.
 */
const DEFAULT_MAX_NEW_PRODUCTS = 60;

const CONCURRENCY = 6;

function pickCheapestGreenOffer(
  offers: MlOffer[],
  sellers: Map<number, MlSeller>
): MlOffer | null {
  // ML devuelve las ofertas de menor a mayor precio, así que la primera de
  // vendedor verde ya es la más barata que podemos publicar.
  return offers.find((o) => isGreenSeller(sellers.get(o.seller_id))) ?? null;
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const dryRun = req.nextUrl.searchParams.get('dry') === '1';
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit'));
  const maxNewProducts =
    Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_MAX_NEW_PRODUCTS;

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const token = await getMlToken();
  if (!token) {
    return NextResponse.json({ error: 'No se pudo obtener token de ML' }, { status: 502 });
  }

  // 1. Todas las subcategorías de las ramas que sigue el proyecto.
  const subcategories = (
    await mapWithConcurrency(ROOT_CATEGORIES, CONCURRENCY, (root) => getSubcategories(root, token))
  ).flat();

  // 2. Sus destacados.
  const highlighted = [
    ...new Set(
      (
        await mapWithConcurrency(subcategories, CONCURRENCY, (categoryId) =>
          getHighlightedProductIds(categoryId, token)
        )
      ).flat()
    ),
  ];

  // 3. Fuera lo ya conocido, antes de gastar llamadas de detalle. Incluye
  //    los candidatos rechazados: si alguien ya dijo que no, no vuelve a la
  //    cola de revisión.
  const [{ data: knownProducts }, { data: knownCandidates }] = await Promise.all([
    admin.from('products').select('ml_product_id, ml_family_id, price').eq('is_active', true),
    admin.from('product_candidates').select('ml_product_id'),
  ]);

  const alreadySeen = new Set<string>(
    [
      ...(knownProducts ?? []).map((p) => p.ml_product_id),
      ...(knownCandidates ?? []).map((c) => c.ml_product_id),
    ].filter(Boolean) as string[]
  );

  const unseen = highlighted.filter((id) => !alreadySeen.has(id));
  const toInspect = unseen.slice(0, maxNewProducts);

  // 4. Ficha de catálogo de cada producto nuevo.
  const fetched = (
    await mapWithConcurrency(toInspect, CONCURRENCY, async (productId) => {
      if (outOfTime()) return null;
      const product = await getProduct(productId, token);
      return product ? { productId, product } : null;
    })
  ).filter(Boolean) as { productId: string; product: unknown }[];

  // 5. El mapa de dominios (lib/categories) hace de lista blanca: define de
  //    qué se trata el sitio. Recorrer subcategorías enteras trae cosas que
  //    no pintan nada acá —una tanda de walkie-talkies, sets de
  //    destornilladores, una pantalla de repuesto para iPhone— y mandarlas a
  //    revisión humana devuelve el problema que veníamos resolviendo.
  //
  //    Se filtra antes de pedir las ofertas, así el descarte no cuesta una
  //    segunda llamada. Los dominios rechazados se reportan: si aparece uno
  //    que sí interesa, se suma al mapa y entra en la corrida siguiente.
  const unmappedDomains = new Map<string, number>();
  const relevant = [];

  for (const { productId, product } of fetched) {
    const name = (product as { name?: string })?.name?.trim();
    const imageUrl = firstPictureUrl(product);
    if (!name || !imageUrl) continue;

    const enrichment = enrichFromMlProduct(product, name);
    const category = categoryFromDomain(enrichment.domainId);

    if (!category) {
      const domain = enrichment.domainId ?? '(sin dominio)';
      unmappedDomains.set(domain, (unmappedDomains.get(domain) ?? 0) + 1);
      continue;
    }

    relevant.push({ productId, name, imageUrl, enrichment, category });
  }

  // 6. Ofertas de los que sí interesan.
  const withOffers = (
    await mapWithConcurrency(relevant, CONCURRENCY, async (item) => {
      if (outOfTime()) return null;
      const offers = await getProductOffers(item.productId, token);
      return offers.length > 0 ? { ...item, offers } : null;
    })
  ).filter(Boolean) as (typeof relevant[number] & { offers: MlOffer[] })[];

  // 7. Reputación de todos los vendedores involucrados, en lotes de 20.
  const sellers = await getSellers(
    withOffers.flatMap((d) => d.offers.map((o) => o.seller_id)),
    token
  );

  // 8. Un candidato por producto, con la oferta más barata de vendedor
  //    verde. Solo reputación verde entra al sitio, según las reglas del
  //    Programa de Afiliados (CLAUDE.md).
  let skippedNoGreenSeller = 0;
  const candidates = [];

  for (const item of withOffers) {
    const offer = pickCheapestGreenOffer(item.offers, sellers);
    if (!offer) {
      skippedNoGreenSeller++;
      continue;
    }
    const seller = sellers.get(offer.seller_id);

    candidates.push({
      ml_product_id: item.productId,
      ml_family_id: item.enrichment.familyId,
      ml_domain_id: item.enrichment.domainId,
      name: item.name,
      brand: item.enrichment.brand,
      category: item.category,
      price: offer.price,
      original_price: offer.original_price ?? null,
      image_url: item.imageUrl,
      description: item.enrichment.description,
      specs: item.enrichment.specs,
      seller_id: offer.seller_id,
      seller_nickname: seller?.nickname ?? null,
      seller_reputation: 'verde',
      seller_sales_count: seller?.salesCount ?? 0,
      source: 'ml_highlights',
    });
  }

  // 9. Los mismos filtros que ya aplicaba el endpoint de Make: colores
  //    repetidos dentro del lote y familias que el sitio ya publica.
  const { kept, dropped: sameBatchVariants } = collapseCandidateFamilies(candidates);
  const { fresh, skipped: skippedInCatalog } = partitionCandidates(
    kept,
    buildPublishedCatalog(knownProducts ?? [])
  );

  let inserted = 0;
  if (fresh.length > 0 && !dryRun) {
    const { error } = await admin
      .from('product_candidates')
      .upsert(fresh, { onConflict: 'ml_product_id' });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    inserted = fresh.length;
  }

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    inserted,
    would_insert: fresh.length,
    new_candidates: fresh.map((c) => ({
      name: c.name,
      category: c.category,
      price: c.price,
      seller: c.seller_nickname,
    })),
    subcategories: subcategories.length,
    highlighted: highlighted.length,
    already_known: highlighted.length - unseen.length,
    inspected: toInspect.length,
    pending_for_next_run: Math.max(unseen.length - toInspect.length, 0),
    skipped_unmapped_domain: [...unmappedDomains.values()].reduce((a, b) => a + b, 0),
    unmapped_domains: Object.fromEntries(
      [...unmappedDomains.entries()].sort((a, b) => b[1] - a[1])
    ),
    skipped_no_green_seller: skippedNoGreenSeller,
    skipped_same_batch_variants: sameBatchVariants.length,
    skipped_already_in_catalog: skippedInCatalog.length,
    elapsed_ms: Date.now() - startedAt,
  });
}
