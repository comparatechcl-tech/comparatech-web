import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { enrichFromMlProduct, getMlToken } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';
import { gatherDigestInput } from '@/lib/digest-data';
import { buildDigestHtml, buildDigestSubject, buildDigestText } from '@/lib/daily-digest';
import { sendEmail } from '@/lib/email';
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
  getSellers,
  getSubcategories,
  getWinners,
  isGreenSeller,
  mapWithConcurrency,
  type MlOffer,
} from '@/lib/ml-catalog';

/**
 * Prospección diaria del catálogo.
 *
 * Recorre los destacados de las subcategorías de las ramas que sigue el
 * proyecto, descarta lo que ya conoce, analiza el resto y deja en la cola de
 * revisión lo que agrega algo al sitio. Después refresca la cola y manda el
 * resumen por correo.
 *
 * El orden de las llamadas es lo que hace que todo entre en el techo de 60
 * segundos de la función:
 *   1. destacados de todas las subcategorías (una llamada cada una)
 *   2. se descarta lo ya visto, sin gastar una sola llamada más
 *   3. ficha de catálogo de lo que queda
 *   4. ganador de la caja de compra SOLO de lo que cae en la taxonomía
 *   5. reputación de los vendedores, en lotes de 20
 *
 * Lo descartado se recuerda en prospect_seen. Antes no: el cron analizaba
 * cada día los mismos ~60 destacados —el 82% fuera del mapa de dominios—,
 * los volvía a descartar, y nunca llegaba al resto de la lista. Había 675
 * destacados sin revisar y entraban 1 a 4 candidatos por día.
 *
 * Parámetros útiles para correrlo a mano:
 *   ?dry=1    analiza y reporta sin escribir nada ni mandar correo
 *   ?limit=N  cambia el tope de productos nuevos por corrida
 */

export const maxDuration = 60;

/** Margen antes del techo de Vercel, para alcanzar a guardar y responder. */
const TIME_BUDGET_MS = 45_000;

/**
 * Tope de productos nuevos analizados por corrida. Medido: 400 fichas en
 * 7,7 segundos, así que 300 deja holgura de sobra. Lo que no alcanza entra
 * en la corrida siguiente.
 */
const DEFAULT_MAX_NEW_PRODUCTS = 300;

const CONCURRENCY = 6;

const DAY_MS = 86_400_000;

/**
 * Cuándo vuelve a mirarse algo descartado. Los dominios fuera del mapa no
 * vencen por tiempo: vuelven solos el día que el dominio se suma al mapa.
 */
const RETRY_AFTER_DAYS: Record<string, number> = {
  sin_datos: 30,
  sin_ganador: 3,
  ganador_no_verde: 7,
  familia_publicada: 7,
  variante_del_lote: 7,
};

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

interface SeenRecord {
  ml_product_id: string;
  reason: string;
  domain_id: string | null;
}

/** IDs que la prospección miró hace poco y no vale la pena volver a analizar. */
async function loadExcludedSeen(admin: SupabaseAdmin): Promise<Set<string>> {
  const { data } = await admin.from('prospect_seen').select('ml_product_id, reason, domain_id, seen_at');
  const now = Date.now();
  const excluded = new Set<string>();

  for (const row of data ?? []) {
    if (row.reason === 'dominio_no_mapeado') {
      // Si el dominio ya está en el mapa, vuelve a ser elegible.
      if (!categoryFromDomain(row.domain_id)) excluded.add(row.ml_product_id);
      continue;
    }
    const retryDays = RETRY_AFTER_DAYS[row.reason] ?? 7;
    if (now - new Date(row.seen_at).getTime() < retryDays * DAY_MS) excluded.add(row.ml_product_id);
  }
  return excluded;
}

/**
 * Vuelve a mirar en ML los candidatos que esperan revisión y actualiza
 * precio, descuento y vendedor con el ganador de la caja de compra — el mismo
 * criterio con que se publica, para que el precio que se revisa sea el que
 * después se muestra.
 *
 * Un candidato sin ganador no se rechaza: suele ser temporal, y rechazarlo
 * lo sacaría para siempre de la prospección.
 */
async function refreshPendingCandidates(
  admin: SupabaseAdmin,
  token: string,
  outOfTime: () => boolean,
  dryRun: boolean
): Promise<{ updated: number; unavailable: number }> {
  const { data } = await admin
    .from('product_candidates')
    .select('id, ml_product_id, ml_item_id, price, original_price, seller_id')
    .eq('status', 'pending_review');

  const pending = data ?? [];
  if (pending.length === 0) return { updated: 0, unavailable: 0 };

  const checked = await mapWithConcurrency(pending, CONCURRENCY, async (candidate) => ({
    candidate,
    winners: outOfTime()
      ? ({ status: 'error', detail: 'sin tiempo' } as const)
      : await getWinners(candidate.ml_product_id, token),
  }));

  const sellers = await getSellers(
    checked.flatMap(({ winners }) => (winners.status === 'ok' ? [winners.offers[0].seller_id] : [])),
    token
  );

  let updated = 0;
  let unavailable = 0;

  for (const { candidate, winners } of checked) {
    if (winners.status !== 'ok') {
      if (winners.status === 'no_winner') unavailable++;
      continue;
    }
    const winner = winners.offers[0];
    const seller = sellers.get(winner.seller_id);
    if (!isGreenSeller(seller)) {
      unavailable++;
      continue;
    }

    const listPrice =
      typeof winner.original_price === 'number' && winner.original_price > winner.price
        ? winner.original_price
        : null;
    const changed =
      winner.price !== candidate.price ||
      listPrice !== candidate.original_price ||
      winner.item_id !== candidate.ml_item_id;
    if (!changed) continue;

    updated++;
    if (!dryRun) {
      await admin
        .from('product_candidates')
        .update({
          price: winner.price,
          original_price: listPrice,
          ml_item_id: winner.item_id,
          seller_id: winner.seller_id,
          seller_nickname: seller?.nickname ?? null,
          seller_sales_count: seller?.salesCount ?? 0,
        })
        .eq('id', candidate.id);
    }
  }

  return { updated, unavailable };
}

/**
 * Arma el resumen del día y lo manda por correo.
 *
 * Nunca lanza: si el correo falla, la prospección ya hizo su trabajo y sería
 * absurdo devolver error por eso. El motivo queda en la respuesta del cron,
 * que es donde se va a mirar cuando el correo no llegue.
 */
async function sendDailyDigest(admin: SupabaseAdmin) {
  const to = process.env.DIGEST_TO?.trim();
  if (!to) return { ok: false as const, error: 'DIGEST_TO no configurado' };

  const input = await gatherDigestInput(admin);
  const result = await sendEmail({
    to,
    subject: buildDigestSubject(input),
    html: buildDigestHtml(input),
    text: buildDigestText(input),
  });

  return result.ok
    ? { ok: true as const, sent_to: to, new_candidates: input.newCandidates.length }
    : { ok: false as const, error: result.error };
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

  // 3. Fuera lo ya conocido, antes de gastar llamadas de detalle: lo
  //    publicado, lo que ya pasó por revisión —incluido lo rechazado: si
  //    alguien dijo que no, no vuelve a la cola— y lo descartado hace poco.
  const [{ data: knownProducts }, { data: knownCandidates }, excludedSeen] = await Promise.all([
    admin.from('products').select('ml_product_id, ml_family_id, price').eq('is_active', true),
    admin.from('product_candidates').select('ml_product_id'),
    loadExcludedSeen(admin),
  ]);

  const alreadySeen = new Set<string>(
    [
      ...(knownProducts ?? []).map((p) => p.ml_product_id),
      ...(knownCandidates ?? []).map((c) => c.ml_product_id),
      ...excludedSeen,
    ].filter(Boolean) as string[]
  );

  const unseen = highlighted.filter((id) => !alreadySeen.has(id));
  const toInspect = unseen.slice(0, maxNewProducts);
  const seenRecords: SeenRecord[] = [];

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
  //    no pintan nada acá —walkie-talkies, sets de destornilladores,
  //    pantallas de repuesto— y mandarlas a revisión humana sería ruido.
  //
  //    Se filtra antes de pedir el ganador, así el descarte no cuesta una
  //    segunda llamada. Los dominios rechazados se reportan: si aparece uno
  //    que sí interesa, se suma al mapa y sus productos vuelven solos.
  const unmappedDomains = new Map<string, number>();
  const relevant = [];

  for (const { productId, product } of fetched) {
    const name = (product as { name?: string })?.name?.trim();
    const imageUrl = firstPictureUrl(product);
    if (!name || !imageUrl) {
      seenRecords.push({ ml_product_id: productId, reason: 'sin_datos', domain_id: null });
      continue;
    }

    const enrichment = enrichFromMlProduct(product, name);
    const category = categoryFromDomain(enrichment.domainId);

    if (!category) {
      const domain = enrichment.domainId ?? '(sin dominio)';
      unmappedDomains.set(domain, (unmappedDomains.get(domain) ?? 0) + 1);
      seenRecords.push({
        ml_product_id: productId,
        reason: 'dominio_no_mapeado',
        domain_id: enrichment.domainId,
      });
      continue;
    }

    relevant.push({ productId, name, imageUrl, enrichment, category });
  }

  // 6. Ganador de la caja de compra de los que sí interesan: es el precio
  //    que se va a publicar, porque es el que ve el comprador en la ficha.
  let skippedNoWinner = 0;
  const withWinner = (
    await mapWithConcurrency(relevant, CONCURRENCY, async (item) => {
      if (outOfTime()) return null;
      const winners = await getWinners(item.productId, token);
      if (winners.status === 'no_winner') {
        skippedNoWinner++;
        seenRecords.push({ ml_product_id: item.productId, reason: 'sin_ganador', domain_id: item.enrichment.domainId });
        return null;
      }
      // Un error transitorio no se recuerda: se reintenta mañana.
      return winners.status === 'ok' ? { ...item, winner: winners.offers[0] } : null;
    })
  ).filter(Boolean) as (typeof relevant[number] & { winner: MlOffer })[];

  // 7. Reputación de los ganadores, en lotes de 20.
  const sellers = await getSellers(
    withWinner.map((d) => d.winner.seller_id),
    token
  );

  // 8. Solo entra si el ganador tiene reputación verde: es quien le vende al
  //    comprador, y el Programa de Afiliados solo admite vendedores verdes.
  let skippedNoGreenSeller = 0;
  const candidates = [];

  for (const item of withWinner) {
    const seller = sellers.get(item.winner.seller_id);
    if (!isGreenSeller(seller)) {
      skippedNoGreenSeller++;
      seenRecords.push({ ml_product_id: item.productId, reason: 'ganador_no_verde', domain_id: item.enrichment.domainId });
      continue;
    }

    candidates.push({
      ml_product_id: item.productId,
      ml_family_id: item.enrichment.familyId,
      ml_domain_id: item.enrichment.domainId,
      ml_item_id: item.winner.item_id,
      name: item.name,
      brand: item.enrichment.brand,
      category: item.category,
      price: item.winner.price,
      original_price:
        typeof item.winner.original_price === 'number' && item.winner.original_price > item.winner.price
          ? item.winner.original_price
          : null,
      image_url: item.imageUrl,
      description: item.enrichment.description,
      specs: item.enrichment.specs,
      seller_id: item.winner.seller_id,
      seller_nickname: seller?.nickname ?? null,
      seller_reputation: 'verde',
      seller_sales_count: seller?.salesCount ?? 0,
      source: 'ml_highlights',
    });
  }

  // 9. Colores repetidos dentro del lote y familias que el sitio ya publica.
  const { kept, dropped: sameBatchVariants } = collapseCandidateFamilies(candidates);
  const { fresh, skipped: skippedInCatalog } = partitionCandidates(
    kept,
    buildPublishedCatalog(knownProducts ?? [])
  );
  for (const c of sameBatchVariants) {
    seenRecords.push({ ml_product_id: c.ml_product_id, reason: 'variante_del_lote', domain_id: c.ml_domain_id });
  }
  for (const { candidate } of skippedInCatalog) {
    seenRecords.push({ ml_product_id: candidate.ml_product_id, reason: 'familia_publicada', domain_id: candidate.ml_domain_id });
  }

  let inserted = 0;
  if (!dryRun) {
    if (fresh.length > 0) {
      const { error } = await admin
        .from('product_candidates')
        .upsert(fresh, { onConflict: 'ml_product_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      inserted = fresh.length;
    }

    if (seenRecords.length > 0) {
      const now = new Date().toISOString();
      await admin
        .from('prospect_seen')
        .upsert(seenRecords.map((r) => ({ ...r, seen_at: now })), { onConflict: 'ml_product_id' });
    }
  }

  // 10. Refresca la cola de revisión: los candidatos pueden esperar días y
  //     el precio con que entraron deja de ser el que se ve en la ficha.
  const refreshed = await refreshPendingCandidates(admin, token, outOfTime, dryRun);

  // 11. El resumen sale al final, para que refleje el estado del día.
  const digest = dryRun ? { ok: true as const, skipped: 'dry_run' } : await sendDailyDigest(admin);

  return NextResponse.json({
    ok: true,
    dry_run: dryRun,
    inserted,
    would_insert: fresh.length,
    candidates_refreshed: refreshed.updated,
    candidates_unavailable: refreshed.unavailable,
    digest,
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
    remembered_discards: seenRecords.length,
    skipped_unmapped_domain: [...unmappedDomains.values()].reduce((a, b) => a + b, 0),
    unmapped_domains: Object.fromEntries(
      [...unmappedDomains.entries()].sort((a, b) => b[1] - a[1])
    ),
    skipped_no_winner: skippedNoWinner,
    skipped_no_green_seller: skippedNoGreenSeller,
    skipped_same_batch_variants: sameBatchVariants.length,
    skipped_already_in_catalog: skippedInCatalog.length,
    elapsed_ms: Date.now() - startedAt,
  });
}
