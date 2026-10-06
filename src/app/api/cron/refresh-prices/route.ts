import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { pingHealthcheck, startCronRun } from '@/lib/cron-runs';
import { fetchAllRows } from '@/lib/admin-stats';
import { syncTelegramPosts } from '@/lib/social/telegram';
import { enrichFromMl, getMlToken, mlTokenError } from '@/lib/ml-enrichment';
import { categoryFromDomain } from '@/lib/categories';
import { mapWithConcurrency, mlErrorCounts } from '@/lib/ml-catalog';
import { resolveLinkTarget } from '@/lib/link-check';
import { readAffiliateSettings } from '@/lib/settings';
import {
  PRICED_COLUMNS,
  applyPricing,
  hasVisibleChanges,
  priceProducts,
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
const REFRESH_COLUMNS = `${PRICED_COLUMNS}, name, brand, specs, description, ml_family_id, ml_domain_id, category`;

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

function missingCatalogData(p: RepairRow): boolean {
  return (
    !p.brand?.trim() ||
    !p.description?.trim() ||
    !p.ml_family_id ||
    !p.ml_domain_id ||
    Object.keys(p.specs ?? {}).length === 0
  );
}

/**
 * Completa marca, specs, descripción, familia y dominio de los productos que
 * quedaron incompletos (aprobados antes de que existiera el enriquecimiento,
 * o con ML caído en ese momento). Solo rellena vacíos: nunca pisa datos.
 */
async function repairMissingData(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  rows: RepairRow[],
  token: string,
  outOfTime: () => boolean
): Promise<number> {
  const pending = rows.filter(missingCatalogData).slice(0, MAX_REPAIRS_PER_RUN);

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

type Summary = ReturnType<typeof summarizePricing>;

/**
 * ¿La corrida hizo su trabajo? Falla si alguna escritura no se guardó o si
 * más de la mitad de los productos no se pudo revisar (ML caído, token
 * rechazado, sin tiempo): en ambos casos el sitio queda con precios viejos.
 */
function isHealthy(summary: Pick<Summary, 'revisados' | 'errores_transitorios'>, writeErrors: number): boolean {
  if (writeErrors > 0) return false;
  if (summary.revisados === 0) return true;
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
  const mlErrorsBefore = mlErrorCounts();
  const mlErrorsThisRun = () => {
    const delta: Record<string, number> = {};
    for (const [endpoint, n] of Object.entries(mlErrorCounts())) {
      const d = n - (mlErrorsBefore[endpoint] ?? 0);
      if (d > 0) delta[endpoint] = d;
    }
    return delta;
  };

  /** Cierra la bitácora, avisa al healthcheck y responde. */
  const finish = async (ok: boolean, body: Record<string, unknown>, status: number, error?: string) => {
    const payload = { ok, ...body, elapsed_ms: Date.now() - startedAt };
    await Promise.all([run.finish(ok, payload, error), pingHealthcheck(healthcheckUrl, ok)]);
    return NextResponse.json(payload, { status });
  };

  try {
    // De a páginas: PostgREST corta en 1.000 filas y el catálogo crece.
    //
    // Primero los que llevan más tiempo sin revisar (y los nunca revisados).
    // Si el catálogo crece hasta no caber en una corrida, lo que quede fuera
    // por tiempo pasa al frente de la siguiente. Ordenado por id, los
    // últimos de la lista se quedaban sin revisar corrida tras corrida, con
    // el precio viejo y sin que nada avisara.
    const readProducts = (columns: string) =>
      fetchAllRows<PricedProduct & RepairRow>(
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
    let { rows: data, error } = await readProducts(`${REFRESH_COLUMNS}, ${COLUMNS_0016}`);
    if (error && isMissingSchemaError(error)) {
      has0016 = false;
      ({ rows: data, error } = await readProducts(REFRESH_COLUMNS));
    }

    if (error) return finish(false, { error: error.message }, 500, error.message);
    const rows = data;
    if (rows.length === 0) return finish(true, { revisados: 0 }, 200);

    const token = await getMlToken();
    if (!token) {
      // Con el motivo: "sin token" a secas no decía si ML estaba rechazando
      // los pedidos, caído o si las credenciales dejaron de servir.
      const reason = mlTokenError() ?? 'sin detalle';
      return finish(false, { error: `No se pudo obtener token de ML (${reason})` }, 502, `sin token de ML: ${reason}`);
    }

    const { directLinks } = await readAffiliateSettings(admin);
    const outcomes = await priceProducts(rows, token, {
      concurrency: 6,
      outOfTime,
      directLinks,
      verifyLink: (p) => resolveLinkTarget(p.affiliate_url, p.ml_product_id, token),
      resolveRoots: has0016,
      stopEnrichment: () => Date.now() - startedAt > ENRICHMENT_CUTOFF_MS,
    });
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

    const repaired = !late && !outOfTime() ? await repairMissingData(admin, rows, token, outOfTime) : 0;

    // toWrite ya es lo que se escribió: vacío si se pasó del corte duro.
    const visible = hasVisibleChanges(toWrite) || repaired > 0;
    if (visible) {
      revalidatePath('/', 'layout');
      revalidateTag('catalog');
    }

    // Una escritura parcial sigue contando como corrida degradada.
    const ok = !late && isHealthy(summary, writeErrors);
    return finish(
      ok,
      {
        ...summary,
        datos_reparados: repaired,
        errores_de_escritura: writeErrors,
        escrituras_omitidas_por_tiempo: writesSkipped,
        escrituras_parciales_por_tiempo: late && !writesSkipped ? toWrite.length : 0,
        columnas_0016: has0016,
        telegram,
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
            : `${summary.errores_transitorios} de ${summary.revisados} con error transitorio`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finish(false, { error: message }, 500, message);
  }
}
