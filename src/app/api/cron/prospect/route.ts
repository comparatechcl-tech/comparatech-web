import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { isCronAuthorized } from '@/lib/cron-auth';
import { pingHealthcheck, startCronRun, type CronRun } from '@/lib/cron-runs';
import { fetchAllRows } from '@/lib/admin-stats';
import { enrichFromMlProduct, getMlToken, mlTokenError } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';
import { gatherDigestInput } from '@/lib/digest-data';
import { buildDigestHtml, buildDigestSubject, buildDigestText } from '@/lib/daily-digest';
import { parseRecipients, sendEmail } from '@/lib/email';
import {
  buildPublishedCatalog,
  canRetryCandidate,
  collapseCandidateFamilies,
  minCommissionFromEnv,
  partitionCandidates,
  passesCommissionFloor,
} from '@/lib/prospect-filter';
import {
  ROOT_CATEGORIES,
  firstPictureUrl,
  getHighlightedProducts,
  getProduct,
  getRootCategory,
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
 * revisión lo que agrega algo al sitio y deja una comisión que valga la
 * revisión (MIN_COMMISSION_CLP). Después manda el resumen por correo y, con
 * el tiempo que quede, refresca la cola.
 *
 * El orden de las llamadas es lo que hace que todo entre en el techo de 60
 * segundos de la función:
 *   1. destacados de todas las subcategorías (una llamada cada una)
 *   2. se descarta lo ya visto, sin gastar una sola llamada más
 *   3. ficha de catálogo de lo que queda
 *   4. ganador de la caja de compra SOLO de lo que cae en la taxonomía, y
 *      la raíz de su categoría para estimar la comisión
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
export const dynamic = 'force-dynamic';

/** Margen antes del techo de Vercel, para alcanzar a guardar y responder. */
const TIME_BUDGET_MS = 45_000;

/**
 * Tope de productos nuevos analizados por corrida. Medido: 400 fichas en
 * 7,7 segundos, así que 300 deja holgura de sobra. Lo que no alcanza entra
 * en la corrida siguiente.
 */
const DEFAULT_MAX_NEW_PRODUCTS = 300;

const CONCURRENCY = 8;

const DAY_MS = 86_400_000;

/** En cuántos días se recorre completo el segundo nivel de subcategorías. */
const LEVEL2_ROTATION = 3;

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
  // El precio cambia: algo que hoy deja poca comisión puede subir o pasar a
  // una categoría que paga más. Dos semanas es poco para perderlo y mucho
  // para no gastar llamadas en lo mismo todos los días.
  comision_baja: 14,
};

/** Un pendiente que nadie aprobó en 30 días ya no se va a aprobar: se archiva. */
const EXPIRE_PENDING_DAYS = 30;

/** Pendientes que se vuelven a mirar en ML por corrida, los menos recientes primero. */
const MAX_PENDING_REFRESH = 100;

/**
 * Tamaño de cada .in() contra la base. PostgREST devuelve como máximo 1.000
 * filas por consulta y la URL tiene un largo máximo: 200 ids caben holgados
 * en ambos.
 */
const ID_CHUNK = 200;

/** Columnas de la migración 0018. Sin ella se guarda el candidato igual, sin estas señales. */
const OPTIONAL_CANDIDATE_COLUMNS = [
  'highlight_position',
  'highlight_category_id',
  'ml_root_category',
  'is_full',
  'official_store',
  'checked_at',
] as const;

type SupabaseAdmin = SupabaseClient;
type DbError = { code?: string; message: string } | null;

interface SeenRecord {
  ml_product_id: string;
  reason: string;
  domain_id: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Lee de a 200 ids a la vez. Antes se leían las tablas completas, y al pasar
 * las 1.000 filas PostgREST cortaba la respuesta sin avisar: lo que quedaba
 * afuera se volvía a analizar (y a mandar a revisión) como si fuera nuevo.
 */
async function selectByIds<T>(
  ids: string[],
  query: (ids: string[]) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<{ rows: T[]; error: DbError }> {
  const results = await mapWithConcurrency(chunk(ids, ID_CHUNK), 4, async (part) => query(part));
  const rows: T[] = [];
  for (const { data, error } of results) {
    if (error) return { rows, error };
    rows.push(...((data ?? []) as T[]));
  }
  return { rows, error: null };
}

/** IDs, de entre los destacados, que la prospección miró hace poco y no vale la pena volver a analizar. */
async function loadExcludedSeen(admin: SupabaseAdmin, ids: string[]): Promise<Set<string>> {
  const { rows, error } = await selectByIds<{
    ml_product_id: string;
    reason: string;
    domain_id: string | null;
    seen_at: string;
  }>(ids, (part) =>
    admin.from('prospect_seen').select('ml_product_id, reason, domain_id, seen_at').in('ml_product_id', part)
  );
  if (error) throw new Error(`No se pudo leer prospect_seen: ${error.message}`);

  const now = Date.now();
  const excluded = new Set<string>();
  for (const row of rows) {
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

interface KnownCandidates {
  /** Ya pasaron (o están) en revisión: no se vuelven a analizar. */
  blocked: Set<string>;
  /** Rechazados por un motivo pasajero o vencidos hace más de 45 días: se reconsideran. */
  retryable: Set<string>;
  /** Existe reject_reason (migración 0014). */
  has0014: boolean;
}

async function loadKnownCandidates(admin: SupabaseAdmin, ids: string[]): Promise<KnownCandidates> {
  type Row = { ml_product_id: string; status: string; reviewed_at: string | null; reject_reason?: string | null };
  const read = (columns: string) =>
    selectByIds<Row>(ids, (part) => admin.from('product_candidates').select(columns).in('ml_product_id', part));

  let has0014 = true;
  let result = await read('ml_product_id, status, reviewed_at, reject_reason');
  if (result.error && isMissingSchemaError(result.error)) {
    has0014 = false;
    result = await read('ml_product_id, status, reviewed_at');
  }
  if (result.error) throw new Error(`No se pudo leer product_candidates: ${result.error.message}`);

  const now = Date.now();
  const blocked = new Set<string>();
  const retryable = new Set<string>();
  for (const row of result.rows) {
    // Rechazos pasajeros y vencidos, pasados 45 días (lib/prospect-filter).
    if (canRetryCandidate(row, now)) retryable.add(row.ml_product_id);
    else blocked.add(row.ml_product_id);
  }
  return { blocked, retryable, has0014 };
}

function withoutOptionalColumns<T extends object>(row: T): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const column of OPTIONAL_CANDIDATE_COLUMNS) delete rest[column];
  return rest;
}

/**
 * Archiva los pendientes que llevan más de 30 días sin que nadie los mire.
 * Sin la migración 0014 el estado 'expired' no existe (falla la constraint)
 * y no se hace nada.
 *
 * Se marca reviewed_at con la hora del vencimiento (reviewed_by queda null,
 * así no cuenta como revisado por alguien): sin esa fecha el vencido no
 * aparecía en /admin/candidatos/rechazados, no se podía recuperar y la
 * prospección no lo volvía a traer nunca.
 *
 * Un candidato recuperado desde rechazados conserva su prospected_at viejo
 * pero trae reviewed_at con la hora de la recuperación: solo vence si los
 * dos relojes pasaron los 30 días, o se volvería a archivar esa misma noche.
 */
async function expireStalePending(admin: SupabaseAdmin): Promise<{ expired: number } | { skipped: string }> {
  const cutoff = new Date(Date.now() - EXPIRE_PENDING_DAYS * DAY_MS).toISOString();
  const { count, error } = await admin
    .from('product_candidates')
    .update({ status: 'expired', reviewed_at: new Date().toISOString() }, { count: 'exact' })
    .eq('status', 'pending_review')
    .lt('prospected_at', cutoff)
    .or(`reviewed_at.is.null,reviewed_at.lt."${cutoff}"`);
  if (error) {
    // 23514: viola la constraint de estados (falta la migración 0014).
    if (error.code === '23514' || isMissingSchemaError(error)) return { skipped: 'falta la migración 0014' };
    return { skipped: `no se pudo archivar: ${error.message}` };
  }
  return { expired: count ?? 0 };
}

interface RefreshResult {
  checked: number;
  updated: number;
  unavailable: number;
  /** Se cortó por tiempo antes de terminar. */
  cut_short: boolean;
}

/**
 * Vuelve a mirar en ML los candidatos que esperan revisión y actualiza
 * precio, descuento y vendedor con el ganador de la caja de compra — el mismo
 * criterio con que se publica, para que el precio que se revisa sea el que
 * después se muestra.
 *
 * Solo los 100 que llevan más tiempo sin revisarse (checked_at más antiguo,
 * los nunca revisados primero): con cientos de pendientes no alcanzaban todos
 * en el minuto de la función, y como siempre se empezaba por los mismos, los
 * del final nunca se actualizaban.
 *
 * Un candidato sin ganador no se rechaza: suele ser temporal, y rechazarlo
 * lo sacaría para siempre de la prospección.
 */
async function refreshPendingCandidates(
  admin: SupabaseAdmin,
  token: string,
  outOfTime: () => boolean,
  dryRun: boolean
): Promise<RefreshResult> {
  const result: RefreshResult = { checked: 0, updated: 0, unavailable: 0, cut_short: false };
  if (outOfTime()) return { ...result, cut_short: true };

  type Row = {
    id: string;
    ml_product_id: string;
    ml_item_id: string | null;
    price: number;
    original_price: number | null;
    seller_id: number | null;
  };
  const base = 'id, ml_product_id, ml_item_id, price, original_price, seller_id';

  let hasCheckedAt = true;
  let read = await admin
    .from('product_candidates')
    .select(base)
    .eq('status', 'pending_review')
    .order('checked_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PENDING_REFRESH);
  if (read.error && isMissingSchemaError(read.error)) {
    // Sin checked_at (migración 0018) no hay cómo rotar: los más nuevos primero.
    hasCheckedAt = false;
    read = await admin
      .from('product_candidates')
      .select(base)
      .eq('status', 'pending_review')
      .order('prospected_at', { ascending: false })
      .limit(MAX_PENDING_REFRESH);
  }
  if (read.error) throw new Error(`No se pudo leer la cola de revisión: ${read.error.message}`);

  const pending = (read.data ?? []) as Row[];
  if (pending.length === 0) return result;

  // Paso 1: ganador de cada uno.
  const checked = await mapWithConcurrency(pending, CONCURRENCY, async (candidate) => ({
    candidate,
    winners: outOfTime()
      ? ({ status: 'error', detail: 'sin tiempo' } as const)
      : await getWinners(candidate.ml_product_id, token),
  }));

  // Paso 2: reputación de los ganadores.
  if (outOfTime()) return { ...result, cut_short: true };
  const sellers = await getSellers(
    checked.flatMap(({ winners }) => (winners.status === 'ok' ? [winners.offers[0].seller_id] : [])),
    token
  );

  const now = new Date().toISOString();
  const unchanged: string[] = [];

  for (const { candidate, winners } of checked) {
    if (winners.status === 'error') continue; // No se pudo mirar: sigue primero en la fila.
    result.checked++;

    if (winners.status === 'no_winner') {
      result.unavailable++;
      unchanged.push(candidate.id);
      continue;
    }
    const winner = winners.offers[0];
    const seller = sellers.get(winner.seller_id);
    if (!isGreenSeller(seller)) {
      result.unavailable++;
      unchanged.push(candidate.id);
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
    if (!changed) {
      unchanged.push(candidate.id);
      continue;
    }

    result.updated++;
    if (dryRun) continue;
    // Pasado el presupuesto, Vercel puede cortar en medio de una escritura.
    if (outOfTime()) {
      result.cut_short = true;
      break;
    }
    await admin
      .from('product_candidates')
      .update({
        price: winner.price,
        original_price: listPrice,
        ml_item_id: winner.item_id,
        seller_id: winner.seller_id,
        seller_nickname: seller?.nickname ?? null,
        seller_sales_count: seller?.salesCount ?? 0,
        ...(hasCheckedAt ? { checked_at: now } : {}),
      })
      .eq('id', candidate.id);
  }

  // Los que no cambiaron igual quedan marcados como revisados, de una vez:
  // así la próxima corrida empieza por otros.
  if (!dryRun && hasCheckedAt && unchanged.length > 0 && !outOfTime()) {
    await admin.from('product_candidates').update({ checked_at: now }).in('id', unchanged);
  }

  return result;
}

type DigestResult =
  | { ok: true; sent_to: number; new_candidates: number; datos_incompletos?: string[] }
  | { ok: true; skipped: string }
  | { ok: false; error: string };

/**
 * Arma el resumen del día y lo manda por correo.
 *
 * Nunca lanza: si el correo falla, la prospección ya hizo su trabajo y sería
 * absurdo devolver error por eso. El motivo queda en la respuesta del cron y
 * en cron_runs, y el healthcheck recibe el aviso de falla.
 */
async function sendDailyDigest(admin: SupabaseAdmin): Promise<DigestResult> {
  const to = parseRecipients(process.env.DIGEST_TO);
  if (to.length === 0) return { ok: false, error: 'DIGEST_TO no configurado' };

  try {
    const input = await gatherDigestInput(admin);
    const result = await sendEmail({
      to,
      subject: buildDigestSubject(input),
      html: buildDigestHtml(input),
      text: buildDigestText(input),
    });

    return result.ok
      ? {
          ok: true,
          // Cuántos destinatarios, no cuáles: esto queda guardado en cron_runs.
          sent_to: to.length,
          new_candidates: input.newCandidates.length,
          ...(input.errors.length > 0 ? { datos_incompletos: input.errors } : {}),
        }
      : { ok: false, error: result.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fallo al armar el correo' };
  }
}

const NOOP_RUN: CronRun = { finish: async () => {} };

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const dryRun = req.nextUrl.searchParams.get('dry') === '1';
  const requestedLimit = Number(req.nextUrl.searchParams.get('limit'));
  const maxNewProducts =
    Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_MAX_NEW_PRODUCTS;
  const minCommission = minCommissionFromEnv();
  // Una corrida de prueba a mano no avisa al healthcheck: no es la diaria.
  const healthcheckUrl = dryRun ? undefined : process.env.HEALTHCHECK_PROSPECT_URL;

  const admin = getSupabaseAdmin();
  if (!admin) {
    await pingHealthcheck(healthcheckUrl, false);
    return NextResponse.json({ ok: false, error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const run = dryRun ? NOOP_RUN : await startCronRun(admin, 'prospect');
  const fail = async (status: number, error: string) => {
    const body = { ok: false, dry_run: dryRun, error, elapsed_ms: Date.now() - startedAt };
    await Promise.all([run.finish(false, body, error), pingHealthcheck(healthcheckUrl, false)]);
    return NextResponse.json(body, { status });
  };

  try {
    const token = await getMlToken();
    if (!token) return fail(502, `No se pudo obtener token de ML (${mlTokenError() ?? 'sin detalle'})`);

    // 1. Subcategorías de las ramas que sigue el proyecto, en dos niveles. El
    //    segundo nivel casi triplica los destacados (en un censo de octubre de
    //    2026: 870 en el primero y 1.754 más en el segundo), pero son unas 600
    //    categorías: se reparten en LEVEL2_ROTATION días para que cada corrida
    //    entre en el tiempo de la función.
    const level1 = (
      await mapWithConcurrency(ROOT_CATEGORIES, CONCURRENCY, (root) => getSubcategories(root, token))
    ).flat();
    const level1Ids = new Set(level1);
    const level2All = (
      await mapWithConcurrency(level1, CONCURRENCY, (id) => getSubcategories(id, token))
    )
      .flat()
      .filter((id) => !level1Ids.has(id));
    const turn = Math.floor(Date.now() / DAY_MS) % LEVEL2_ROTATION;
    const level2 = level2All.filter((_, i) => i % LEVEL2_ROTATION === turn);
    const subcategories = [...level1, ...level2];

    // 2. Sus destacados, con la mejor posición de cada producto: si aparece
    //    en varias categorías, vale la mejor. La posición dice qué se vende
    //    más y ordena la cola de revisión.
    const best = new Map<string, { position: number; categoryId: string }>();
    const perCategory = await mapWithConcurrency(subcategories, CONCURRENCY, async (categoryId) => ({
      categoryId,
      items: await getHighlightedProducts(categoryId, token),
    }));
    for (const { categoryId, items } of perCategory) {
      for (const { id, position } of items) {
        const current = best.get(id);
        if (!current || position < current.position) best.set(id, { position, categoryId });
      }
    }
    // Los mejor rankeados primero: si no alcanza el tope de la corrida, lo
    // que queda para mañana es lo que menos se vende.
    const highlighted = [...best.entries()]
      .sort((a, b) => a[1].position - b[1].position)
      .map(([id]) => id);

    // 3. Fuera lo ya conocido, antes de gastar llamadas de detalle: lo
    //    publicado, lo que ya pasó por revisión —incluido lo rechazado: si
    //    alguien dijo que no, no vuelve a la cola, salvo los rechazos por un
    //    precio o vendedor del momento— y lo descartado hace poco.
    //
    //    De candidatos y descartes solo se consultan los ids destacados, de a
    //    200: leer las tablas completas chocaba con el tope de 1.000 filas de
    //    PostgREST. El catálogo se lee entero, de a páginas, porque el
    //    filtro de familias necesita todas las publicadas.
    const [productsRead, known, excludedSeen] = await Promise.all([
      fetchAllRows<{ ml_product_id: string | null; ml_family_id: string | null; price: number }>(
        (from, to) =>
          admin
            .from('products')
            .select('ml_product_id, ml_family_id, price')
            .eq('is_active', true)
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
      ),
      loadKnownCandidates(admin, highlighted),
      loadExcludedSeen(admin, highlighted),
    ]);
    if (productsRead.error) return fail(500, `No se pudo leer el catálogo: ${productsRead.error.message}`);
    const knownProducts = productsRead.rows;

    const alreadySeen = new Set<string>(
      [...knownProducts.map((p) => p.ml_product_id), ...known.blocked, ...excludedSeen].filter(
        Boolean
      ) as string[]
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
    //    Con su categoría se sabe la raíz, y con ella la comisión: lo que
    //    deja menos que el piso no se manda a revisión.
    let skippedNoWinner = 0;
    let skippedLowCommission = 0;
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
        if (winners.status !== 'ok') return null;

        const winner = winners.offers[0];
        // Si ML no responde la raíz se estima con la tasa más baja: puede
        // dejar fuera algo de Hogar barato, que vuelve en 14 días.
        const root = winner.category_id ? await getRootCategory(winner.category_id, token) : null;
        if (!passesCommissionFloor(winner.price, root, minCommission)) {
          skippedLowCommission++;
          seenRecords.push({ ml_product_id: item.productId, reason: 'comision_baja', domain_id: item.enrichment.domainId });
          return null;
        }
        return { ...item, winner, root };
      })
    ).filter(Boolean) as (typeof relevant[number] & { winner: MlOffer; root: string | null })[];

    // 7. Reputación de los ganadores, en lotes de 20.
    const sellers = await getSellers(
      withWinner.map((d) => d.winner.seller_id),
      token
    );

    // 8. Solo entra si el ganador tiene reputación verde: es quien le vende al
    //    comprador, y el Programa de Afiliados solo admite vendedores verdes.
    let skippedNoGreenSeller = 0;
    const nowIso = new Date().toISOString();
    const candidates = [];

    for (const item of withWinner) {
      const seller = sellers.get(item.winner.seller_id);
      if (!isGreenSeller(seller)) {
        skippedNoGreenSeller++;
        seenRecords.push({ ml_product_id: item.productId, reason: 'ganador_no_verde', domain_id: item.enrichment.domainId });
        continue;
      }

      const highlight = best.get(item.productId);
      const retrying = known.retryable.has(item.productId);
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
        // Explícitos para que un rechazado que vuelve entre como nuevo: el
        // upsert pisa la fila que ya existía.
        status: 'pending_review',
        prospected_at: nowIso,
        reviewed_at: null,
        ...(retrying && known.has0014 ? { reject_reason: null, reviewed_by: null } : {}),
        // Migración 0018.
        highlight_position: highlight?.position ?? null,
        highlight_category_id: highlight?.categoryId ?? null,
        ml_root_category: item.root,
        is_full: item.winner.shipping?.logistic_type === 'fulfillment',
        official_store: item.winner.official_store_id != null,
        checked_at: nowIso,
      });
    }

    // 9. Colores repetidos dentro del lote y familias que el sitio ya publica.
    const { kept, dropped: sameBatchVariants } = collapseCandidateFamilies(candidates);
    const { fresh, skipped: skippedInCatalog } = partitionCandidates(
      kept,
      buildPublishedCatalog(knownProducts)
    );
    for (const c of sameBatchVariants) {
      seenRecords.push({ ml_product_id: c.ml_product_id, reason: 'variante_del_lote', domain_id: c.ml_domain_id });
    }
    for (const { candidate } of skippedInCatalog) {
      seenRecords.push({ ml_product_id: candidate.ml_product_id, reason: 'familia_publicada', domain_id: candidate.ml_domain_id });
    }

    let inserted = 0;
    let signalsSaved = true;
    let expiry: { expired: number } | { skipped: string } = { skipped: 'dry_run' };
    if (!dryRun) {
      if (fresh.length > 0) {
        let { error } = await admin
          .from('product_candidates')
          .upsert(fresh, { onConflict: 'ml_product_id' });
        if (error && isMissingSchemaError(error)) {
          // Sin la migración 0018: se guarda sin las señales nuevas.
          signalsSaved = false;
          ({ error } = await admin
            .from('product_candidates')
            .upsert(fresh.map(withoutOptionalColumns), { onConflict: 'ml_product_id' }));
        }
        if (error) return fail(502, error.message);
        inserted = fresh.length;
      }

      if (seenRecords.length > 0) {
        await admin
          .from('prospect_seen')
          .upsert(seenRecords.map((r) => ({ ...r, seen_at: nowIso })), { onConflict: 'ml_product_id' });
      }

      expiry = await expireStalePending(admin);
    }

    // 10. El resumen sale ANTES de refrescar la cola: refrescar es lo que más
    //     tarda, y si se comía el minuto de la función el correo no salía.
    //     Lo que importa del correo es lo que entró hoy, que ya está guardado.
    const digest: DigestResult = dryRun ? { ok: true, skipped: 'dry_run' } : await sendDailyDigest(admin);

    // 11. Refresca la cola de revisión: los candidatos pueden esperar días y
    //     el precio con que entraron deja de ser el que se ve en la ficha.
    let refreshed: RefreshResult | { error: string };
    try {
      refreshed = await refreshPendingCandidates(admin, token, outOfTime, dryRun);
    } catch (err) {
      refreshed = { error: err instanceof Error ? err.message : String(err) };
    }

    const body = {
      ok: true,
      dry_run: dryRun,
      inserted,
      would_insert: fresh.length,
      signals_saved: signalsSaved,
      expired: expiry,
      candidates_refresh: refreshed,
      digest,
      new_candidates: fresh.map((c) => ({
        name: c.name,
        category: c.category,
        price: c.price,
        seller: c.seller_nickname,
        position: c.highlight_position,
      })),
      subcategories: subcategories.length,
      subcategories_level2: `${level2.length} de ${level2All.length} (turno ${turn + 1}/${LEVEL2_ROTATION})`,
      highlighted: highlighted.length,
      already_known: highlighted.length - unseen.length,
      rejected_retried: toInspect.filter((id) => known.retryable.has(id)).length,
      inspected: toInspect.length,
      pending_for_next_run: Math.max(unseen.length - toInspect.length, 0),
      remembered_discards: seenRecords.length,
      skipped_unmapped_domain: [...unmappedDomains.values()].reduce((a, b) => a + b, 0),
      unmapped_domains: Object.fromEntries(
        [...unmappedDomains.entries()].sort((a, b) => b[1] - a[1])
      ),
      skipped_no_winner: skippedNoWinner,
      skipped_low_commission: skippedLowCommission,
      min_commission_clp: minCommission,
      skipped_no_green_seller: skippedNoGreenSeller,
      skipped_same_batch_variants: sameBatchVariants.length,
      skipped_already_in_catalog: skippedInCatalog.length,
      elapsed_ms: Date.now() - startedAt,
    };

    // La prospección terminó bien aunque el correo haya fallado, y la
    // bitácora lo dice así (el admin lee el correo aparte, en summary.digest).
    // El healthcheck sí recibe la falla: un correo que no llega no avisa de
    // ninguna otra forma.
    const digestError = digest.ok ? undefined : `correo: ${digest.error}`;
    await Promise.all([run.finish(true, body, digestError), pingHealthcheck(healthcheckUrl, digest.ok)]);
    return NextResponse.json(body);
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : String(err));
  }
}
