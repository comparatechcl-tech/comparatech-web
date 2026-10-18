import { NextRequest, NextResponse, after } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { notifyIndexNow, type IndexNowResult } from '@/lib/indexnow';
import { modelPathsForSlugs } from '@/lib/models';
import { SITE_URL } from '@/lib/site';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { earlierRunInProgress, pingHealthcheck, startCronRun } from '@/lib/cron-runs';
import { fetchAllRows } from '@/lib/admin-stats';
import { oldestVisibleMinutes, refreshQueue } from '@/lib/refresh-queue';
import { syncTelegramPosts } from '@/lib/social/telegram';
import { enrichFromMl, getMlToken, mlTokenAttempts, mlTokenError } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';
import { mapWithConcurrency, mlErrorsSince } from '@/lib/ml-catalog';
import { resolveLinkTarget } from '@/lib/link-check';
import { readAffiliateSettings } from '@/lib/settings';
import {
  PRICED_COLUMNS,
  applyPricing,
  hasVisibleChanges,
  priceProducts,
  pricingConcurrency,
  priorityOutcomes,
  summarizePricing,
  type PricedProduct,
} from '@/lib/pricing';

/**
 * Refresco de precios y disponibilidad.
 *
 * Corre cada 30 minutos desde Supabase (pg_cron, ver la migración 0011),
 * además de una vez al día desde Vercel Cron y de respaldo desde GitHub
 * Actions: el plan gratuito de Vercel solo permite crons diarios, y el
 * programador de GitHub resultó impuntual (corría cada 3 a 6 horas).
 *
 * El precio publicado es el del ganador de la caja de compra — lo que ve el
 * comprador en la ficha (ver lib/pricing). Cuando algo cambia, se invalida
 * la caché de las páginas para que el sitio lo refleje de inmediato en vez
 * de esperar los 5 minutos de revalidación.
 *
 * Los productos ocultados a mano no se tocan: esa decisión es humana.
 *
 * Una corrida que no pudo hacer su trabajo responde 500 (ver isHealthy): así
 * el curl -f de GitHub Actions y el healthcheck lo notan. Antes respondía
 * 200 aunque ML hubiera fallado en la mitad de los productos, y un precio
 * viejo pasaba días sin que nadie se enterara.
 *
 * Si una corrida no alcanza a consultar todo (ML lento o un catálogo mucho
 * más grande: hoy consulta 1.214 productos en unos 6,5 s), lo que faltó
 * queda para la siguiente sin contar como falla: primero van las ofertas y lo
 * que tuvo clics o salió en redes, después lo revisado hace más tiempo (ver
 * lib/refresh-queue). El atraso se mide con el precio visible más viejo, en
 * el resumen de cada corrida y en /api/health. El resumen trae también lo
 * que tardó cada etapa (tiempos_ms).
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** Desde aquí no se piden más datos a ML: lo que falta queda para la próxima. */
const TIME_BUDGET_MS = 40_000;

/**
 * Hasta cuándo se puede empezar a escribir. Las consultas a ML que ya
 * estaban en curso al cumplirse el presupuesto pueden tardar hasta ~17 s más
 * (timeout de 8 s con un reintento), así que se deja un margen propio para
 * las escrituras: si se empiezan muy tarde, Vercel corta la función a los
 * 60 s en medio de ellas y la corrida queda a medias sin aviso.
 */
const WRITE_DEADLINE_MS = 52_000;

/**
 * Pasado WRITE_DEADLINE_MS ya no se escribe todo, pero hasta aquí sí lo
 * urgente (ver priorityOutcomes): antes se botaba la corrida entera y un
 * producto sin vendedor confiable seguía con el botón de compra activo
 * mientras ML anduviera lento. Después de esto no se escribe nada.
 */
const HARD_STOP_MS = 56_000;

/**
 * Las raíces de categoría no se empiezan a buscar después de esto: una
 * consulta que arranca tarde puede tardar ~17 s (8 s + reintento) y dejaría
 * las escrituras fuera de plazo. Las de ganadores siguen hasta TIME_BUDGET_MS.
 */
const ENRICHMENT_CUTOFF_MS = WRITE_DEADLINE_MS - 18_000;

/** Columnas de la migración 0016: si se leen, decide() compara contra lo guardado. */
const COLUMNS_0016 = 'offer_info, ml_category_id, ml_root_category';
// slug: para avisarle a Bing (IndexNow) qué fichas cambiaron. price_checked_at:
// para medir el precio visible más viejo que queda. Sin descripción ni specs:
// eran la mitad de lo que se leía en cada corrida y solo las usa la
// reparación, que lee aparte sus pocos productos.
const REFRESH_COLUMNS = `${PRICED_COLUMNS}, slug, price_checked_at`;

type RefreshRow = PricedProduct & { slug?: string | null; price_checked_at?: string | null };

/** Sobre esta proporción de errores transitorios, la corrida cuenta como fallida. */
const MAX_TRANSIENT_RATIO = 0.5;

/**
 * Productos con datos incompletos que se reparan por corrida. Cada uno
 * cuesta una llamada extra a ML, y como esto ahora corre cada media hora no
 * hace falta apurarse: se van completando de a poco.
 */
const MAX_REPAIRS_PER_RUN = 8;

interface RepairRow {
  id: string;
  ml_product_id: string;
  name: string;
  brand: string | null;
  specs: Record<string, string> | null;
  description: string | null;
  ml_family_id: string | null;
  ml_domain_id: string | null;
  category: string;
}

/**
 * ¿Le falta algo que ML suele tener? La familia no cuenta: muchos productos
 * de catálogo no tienen (71 de 1.214 el 18-10-2026), y esos se volvían a
 * pedir en cada corrida sin resultado. Si falta junto con lo demás, la
 * reparación la completa igual.
 */
function missingCatalogData(p: RepairRow): boolean {
  return !p.brand?.trim() || !p.description?.trim() || !p.ml_domain_id || Object.keys(p.specs ?? {}).length === 0;
}

const REPAIR_COLUMNS = 'id, ml_product_id, name, brand, specs, description, ml_family_id, ml_domain_id, category';
/** Lo mismo que missingCatalogData, en el idioma de PostgREST (se comprobó contra la base el 18-10). */
const REPAIR_FILTER = 'brand.is.null,brand.eq.,description.is.null,description.eq.,ml_domain_id.is.null,specs.is.null,specs.eq.{}';

/**
 * Completa marca, specs, descripción, familia y dominio de los productos que
 * quedaron incompletos (aprobados antes de que existiera el enriquecimiento,
 * o con ML caído en ese momento). Solo rellena vacíos: nunca pisa datos.
 */
async function repairMissingData(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  token: string,
  outOfTime: () => boolean
): Promise<number> {
  const { data, error } = await admin
    .from('products')
    .select(REPAIR_COLUMNS)
    .not('ml_product_id', 'is', null)
    .eq('is_hidden', false)
    .or(REPAIR_FILTER)
    .order('price_checked_at', { ascending: true, nullsFirst: true })
    .order('id', { ascending: true })
    .limit(MAX_REPAIRS_PER_RUN * 5);
  if (error) {
    console.warn('[refresh] no se pudieron leer los productos incompletos:', error.message);
    return 0;
  }
  const pending = ((data ?? []) as unknown as RepairRow[]).filter(missingCatalogData).slice(0, MAX_REPAIRS_PER_RUN);

  const results = await mapWithConcurrency(pending, 4, async (p) => {
    if (outOfTime()) return 0;
    const e = await enrichFromMl(p.ml_product_id, token, p.name);
    const patch: Record<string, unknown> = {};
    if (e.brand && !p.brand?.trim()) patch.brand = e.brand;
    if (e.description && !p.description?.trim()) patch.description = e.description;
    if (Object.keys(e.specs).length > 0 && Object.keys(p.specs ?? {}).length === 0) patch.specs = e.specs;
    if (e.familyId && !p.ml_family_id) patch.ml_family_id = e.familyId;
    if (e.domainId && !p.ml_domain_id) {
      patch.ml_domain_id = e.domainId;
      const mapped = categoryFromDomain(e.domainId);
      if (mapped && mapped !== p.category) patch.category = mapped;
    }
    if (Object.keys(patch).length === 0) return 0;
    const { error } = await admin.from('products').update(patch).eq('id', p.id);
    return error ? 0 : 1;
  });

  return results.reduce<number>((a, b) => a + b, 0);
}

/** Ventanas de "visto hace poco" para la prioridad (ver lib/refresh-queue). */
const HOT_CLICK_DAYS = 7;
const HOT_POST_DAYS = 14;
/** Filas por fuente: alcanza para saber qué productos están en juego. */
const HOT_ROWS = 1000;

/**
 * Productos con clics o publicaciones recientes. Si una consulta falla (o
 * falta su tabla), esa fuente no suma prioridad y la corrida sigue igual.
 */
async function readHotProductIds(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<Set<string>> {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const ids = new Set<string>();
  try {
    const [clicks, posts] = await Promise.all([
      admin
        .from('outbound_clicks')
        .select('product_id')
        .not('product_id', 'is', null)
        .gte('created_at', daysAgo(HOT_CLICK_DAYS))
        .order('created_at', { ascending: false })
        .limit(HOT_ROWS),
      admin
        .from('social_posts')
        .select('product_id')
        .not('product_id', 'is', null)
        .in('status', ['publicado', 'editado'])
        .gte('posted_at', daysAgo(HOT_POST_DAYS))
        .order('posted_at', { ascending: false })
        .limit(HOT_ROWS),
    ]);
    for (const { data, error } of [clicks, posts]) {
      if (error) continue;
      for (const row of (data ?? []) as { product_id: string | null }[]) if (row.product_id) ids.add(row.product_id);
    }
  } catch (err) {
    console.warn('[refresh] sin prioridad por clics y redes:', err instanceof Error ? err.message : err);
  }
  return ids;
}

type Summary = ReturnType<typeof summarizePricing>;

/**
 * ¿La corrida hizo su trabajo? Falla si alguna escritura no se guardó, si
 * más de la mitad de lo que se consultó dio error (ML caído o limitando,
 * token rechazado) o si no alcanzó a consultar nada. Lo que quedó fuera por
 * tiempo no cuenta: pasa al frente de la corrida siguiente.
 */
function isHealthy(
  summary: Pick<Summary, 'revisados' | 'errores_transitorios' | 'sin_tiempo'>,
  writeErrors: number
): boolean {
  if (writeErrors > 0) return false;
  if (summary.revisados === 0) return summary.sin_tiempo === 0;
  return summary.errores_transitorios / summary.revisados <= MAX_TRANSIENT_RATIO;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;
  const healthcheckUrl = process.env.HEALTHCHECK_REFRESH_URL;

  const admin = getSupabaseAdmin();
  if (!admin) {
    await pingHealthcheck(healthcheckUrl, false);
    return NextResponse.json({ ok: false, error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const run = await startCronRun(admin, 'refresh-prices');

  // Los contadores de errores de ML viven en el proceso y se acumulan entre
  // corridas que reutilizan la misma función: se reporta solo lo de esta.
  const mlErrorsThisRun = mlErrorsSince();

  /** Cierra la bitácora, avisa al healthcheck y responde. */
  const finish = async (ok: boolean, body: Record<string, unknown>, status: number, error?: string) => {
    const payload = { ok, ...body, elapsed_ms: Date.now() - startedAt };
    await Promise.all([run.finish(ok, payload, error), pingHealthcheck(healthcheckUrl, ok)]);
    return NextResponse.json(payload, { status });
  };

  // Candado: si otra corrida empezó antes y sigue abierta, esta se retira.
  // Responde 200 porque no es una falla: la otra está haciendo el trabajo.
  if (await earlierRunInProgress(admin, 'refresh-prices', run.id)) {
    return finish(true, { omitida: 'otra revisión de precios estaba en curso' }, 200);
  }

  try {
    // De a páginas: PostgREST corta en 1.000 filas y el catálogo crece.
    //
    // Primero los que llevan más tiempo sin revisar (y los nunca revisados).
    // Si el catálogo crece hasta no caber en una corrida, lo que quede fuera
    // por tiempo pasa al frente de la siguiente. Ordenado por id, los
    // últimos de la lista se quedaban sin revisar corrida tras corrida, con
    // el precio viejo y sin que nada avisara.
    const readProducts = (columns: string) =>
      fetchAllRows<RefreshRow>(
        (from, to) =>
          admin
            .from('products')
            .select(columns)
            .not('ml_product_id', 'is', null)
            .eq('is_hidden', false)
            .order('price_checked_at', { ascending: true, nullsFirst: true })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
      );

    // Se leen offer_info y las categorías guardadas para que decide() solo
    // escriba y consulte raíces cuando algo cambió. Sin la migración 0016 se
    // leen sin ellas y no se buscan raíces: no habría dónde guardarlas, y
    // cada corrida repetía una consulta a ML por categoría.
    let has0016 = true;
    const hotRead = readHotProductIds(admin);
    let { rows: data, error } = await readProducts(`${REFRESH_COLUMNS}, ${COLUMNS_0016}`);
    if (error && isMissingSchemaError(error)) {
      has0016 = false;
      ({ rows: data, error } = await readProducts(REFRESH_COLUMNS));
    }

    if (error) return finish(false, { error: error.message }, 500, error.message);
    const rows = data;
    if (rows.length === 0) return finish(true, { revisados: 0 }, 200);
    const { queue, priority } = refreshQueue(rows, await hotRead);

    const token = await getMlToken();
    if (!token) {
      // Con el motivo: "sin token" a secas no decía si ML estaba rechazando
      // los pedidos, caído o si las credenciales dejaron de servir.
      const reason = mlTokenError() ?? 'sin detalle';
      return finish(false, { error: `No se pudo obtener token de ML (${reason})` }, 502, `sin token de ML: ${reason}`);
    }
    const tokenAttempts = mlTokenAttempts();

    const { directLinks } = await readAffiliateSettings(admin);
    const readMs = Date.now() - startedAt;
    const outcomes = await priceProducts(queue, token, {
      concurrency: pricingConcurrency(queue.length),
      outOfTime,
      directLinks,
      verifyLink: (p) => resolveLinkTarget(p.affiliate_url, p.ml_product_id, token),
      resolveRoots: has0016,
      stopEnrichment: () => Date.now() - startedAt > ENRICHMENT_CUTOFF_MS,
    });
    const mlMs = Date.now() - startedAt - readMs;
    const summary = summarizePricing(outcomes);

    // Escribir tarde es peor que no escribir: Vercel corta a los 60 s y la
    // corrida quedaría a medias sin respuesta. Pasado el plazo se escribe
    // solo lo urgente (bajas, vueltas y precios, pocas filas); pasado el
    // corte duro, nada. Lo no escrito se reintenta en la próxima corrida
    // (cada 30 minutos).
    const elapsed = Date.now() - startedAt;
    const late = elapsed > WRITE_DEADLINE_MS;
    const writesSkipped = elapsed > HARD_STOP_MS;
    const toWrite = !late ? outcomes : writesSkipped ? [] : priorityOutcomes(outcomes);
    const writeErrors = toWrite.length > 0 ? await applyPricing(admin, toWrite) : 0;
    const writeMs = Date.now() - startedAt - elapsed;
    const freshIds = new Set(toWrite.filter((o) => 'price_checked_at' in o.patch).map((o) => o.id));

    // Los posts de Telegram muestran el precio publicado: se corrigen apenas
    // cambió, si queda tiempo. Que falle no tumba el refresco.
    let telegram: { edited: number; skipped?: string } | { error: string } = { edited: 0, skipped: 'sin tiempo' };
    if (!late && !outOfTime()) {
      try {
        telegram = await syncTelegramPosts(admin);
      } catch (err) {
        telegram = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    const repaired = !late && !outOfTime() ? await repairMissingData(admin, token, outOfTime) : 0;

    // toWrite ya es lo que se escribió: vacío si se pasó del corte duro.
    const visible = hasVisibleChanges(toWrite) || repaired > 0;
    if (visible) {
      revalidatePath('/', 'layout');
      revalidateTag('catalog');
    }

    // Bing (IndexNow): las fichas cuyo precio o disponibilidad cambió, y las
    // páginas de sus modelos. Con tiempo se avisa acá y queda en la
    // bitácora; sin tiempo, después de responder. Que falle no cambia nada:
    // igual están en el sitemap.
    const slugById = new Map(rows.map((r) => [r.id, r.slug]));
    const changedSlugs = priorityOutcomes(toWrite)
      .map((o) => slugById.get(o.id))
      .filter((slug): slug is string => Boolean(slug));
    const changedUrls = [
      ...changedSlugs.map((slug) => `${SITE_URL}/producto/${slug}`),
      // Y las páginas de modelo que muestran esos precios (lib/models).
      ...modelPathsForSlugs(changedSlugs).map((path) => `${SITE_URL}${path}`),
    ];
    let indexnow: IndexNowResult | { en_segundo_plano: number } = { omitido: 'nada que avisar' };
    if (changedUrls.length > 0) {
      if (!late && !outOfTime()) {
        indexnow = await notifyIndexNow(changedUrls);
      } else {
        after(async () => console.log('[indexnow]', await notifyIndexNow(changedUrls)));
        indexnow = { en_segundo_plano: changedUrls.length };
      }
    }

    // Una escritura parcial sigue contando como corrida degradada.
    const ok = !late && isHealthy(summary, writeErrors);
    return finish(
      ok,
      {
        ...summary,
        // Ofertas y productos con clics o en redes que pasaron adelante.
        prioritarios: priority,
        // El precio visible más viejo que quedó: si sube corrida tras
        // corrida, el catálogo ya no cabe en el ritmo de revisión.
        precio_mas_viejo_min: oldestVisibleMinutes(rows, freshIds, Date.now()),
        // preparacion: leer el catálogo, la prioridad, el token y la configuración.
        tiempos_ms: { preparacion: readMs, mercado_libre: mlMs, escritura: writeMs },
        datos_reparados: repaired,
        errores_de_escritura: writeErrors,
        escrituras_omitidas_por_tiempo: writesSkipped,
        escrituras_parciales_por_tiempo: late && !writesSkipped ? toWrite.length : 0,
        columnas_0016: has0016,
        // 0 = token en memoria; 1 = ML lo entregó a la primera; más = hubo
        // que insistir (pasa en los primeros segundos de cada hora en punto).
        token_intentos: tokenAttempts,
        telegram,
        indexnow,
        sitio_actualizado: visible,
        // 429/5xx/red por endpoint de ML: muestra si ML nos está limitando.
        errores_ml: mlErrorsThisRun(),
      },
      ok ? 200 : 500,
      ok
        ? undefined
        : writesSkipped
          ? 'sin tiempo para escribir'
          : late
            ? `sin tiempo: solo se escribieron ${toWrite.length} cambios urgentes`
            : writeErrors > 0
            ? `${writeErrors} escrituras fallidas`
            : summary.revisados === 0
              ? 'sin tiempo para consultar ningún producto'
              : `${summary.errores_transitorios} de ${summary.revisados} con error transitorio`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finish(false, { error: message }, 500, message);
  }
}
