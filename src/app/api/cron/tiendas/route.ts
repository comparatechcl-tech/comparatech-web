import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { earlierRunInProgress, startCronRun } from '@/lib/cron-runs';
import { isProductionRuntime } from '@/lib/runtime-env';
import { countOffers } from '@/lib/store-offers';
import { readFicha } from '@/lib/store-read-cache';
import { cleanStoreUrl, skuFromStoreUrl } from '@/lib/stores';
import { STORES_JOB, slugsOf, syncStoreOffers } from '@/lib/store-sync';

/**
 * Vuelve a leer el precio de las fichas de otras tiendas enlazadas a
 * productos del sitio (lib/store-sync). Solo tiendas que dejan leer sus
 * páginas, de a una ficha, identificándose y sin insistir ante un bloqueo.
 * No le pide nada a Mercado Libre.
 *
 * La llama un workflow de GitHub Actions cada 2 horas; cada ficha se lee
 * cuando le toca (dos veces al día), así que una pasada de más no pide nada.
 *
 * Solo escribe en el sitio publicado (isProductionRuntime). En cualquier otro
 * lado, o con ?dry=1, corre en modo prueba: lee, decide y responde qué
 * guardaría, sin tocar la base ni la bitácora. En modo prueba lee a lo más 3
 * fichas: es para mirar, no para cargar a las tiendas.
 */

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Una pasada puede durar cerca de dos minutos: la anterior cuenta como "en curso" hasta entonces. */
const IN_PROGRESS_WINDOW_MS = 150_000;
const DRY_LIMIT = 3;

/** Lee una ficha (solo de las tiendas de la lista, con las mismas reglas de siempre) y resume qué entendió. */
async function probeFicha(raw: string): Promise<Record<string, unknown>> {
  const clean = cleanStoreUrl(raw);
  if (!clean) return { ok: false, motivo: 'no_es_tienda' };
  const started = Date.now();
  const read = await readFicha(clean.url, clean.store, skuFromStoreUrl(raw), true);
  const ms = Date.now() - started;
  if (read.ok) return { ok: true, tienda: clean.store.key, ms, ...read.value };
  return { ok: false, tienda: clean.store.key, ms, motivo: read.reason, detalle: read.detail, versiones: read.variants?.length ?? 0 };
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Supabase admin no configurado' }, { status: 500 });

  // ?probar=<ficha de una tienda>: lee esa ficha desde este servidor y responde
  // qué entendió, sin guardar nada. Sirve para saber si la tienda le responde
  // al sitio publicado (no es lo mismo que probar desde un PC).
  const probe = req.nextUrl.searchParams.get('probar');
  if (probe) return NextResponse.json(await probeFicha(probe));

  const now = new Date();
  const dry = req.nextUrl.searchParams.get('dry') === '1' || !isProductionRuntime();

  if (dry) {
    try {
      const { summary } = await syncStoreOffers(admin, { now, write: false, limit: DRY_LIMIT });
      return NextResponse.json(summary);
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // Sin fichas enlazadas (o sin la migración 0022) no se anota una pasada vacía cada 2 horas.
  if (!(await countOffers(admin))) {
    return NextResponse.json({ ok: true, omitida: 'No hay fichas de otras tiendas enlazadas.' });
  }

  const run = await startCronRun(admin, STORES_JOB);
  try {
    // Candado: dos pasadas juntas le pedirían lo mismo dos veces a cada tienda.
    if (await earlierRunInProgress(admin, STORES_JOB, run.id, IN_PROGRESS_WINDOW_MS)) {
      const body = { ok: true, omitida: 'otra pasada de las tiendas estaba en curso' };
      await run.finish(true, body);
      return NextResponse.json(body);
    }

    const { summary, changedProductIds } = await syncStoreOffers(admin, { now, write: true });

    // Solo las fichas del sitio que cambiaron a la vista: el precio de otra
    // tienda no aparece en ninguna otra página.
    const slugs = changedProductIds.length > 0 ? await slugsOf(admin, changedProductIds) : [];
    for (const slug of slugs) revalidatePath(`/producto/${slug}`);

    // El detalle de cada ficha no va a la bitácora: con cientos de fichas pesaría demasiado.
    const { detalle, ...brief } = summary;
    const body = { ...brief, fichas_rearmadas: slugs.length };
    await run.finish(summary.ok, body, summary.ok ? undefined : summary.error);
    return NextResponse.json({ ...body, detalle: detalle.slice(0, 40) }, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
