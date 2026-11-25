import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { earlierRunInProgress, startCronRun } from '@/lib/cron-runs';
import { CHANNEL_JOB, channelName, readLastChannelPost, syncChannel } from '@/lib/channel-sync';
import { notifyIndexNow } from '@/lib/indexnow';
import { isProductionRuntime } from '@/lib/runtime-env';
import { SITE_URL } from '@/lib/site';

/**
 * Lee el canal oficial de afiliados de Mercado Libre en Telegram y lleva al
 * sitio el precio de los productos que ya están publicados (lib/channel-sync).
 * No le pide nada a Mercado Libre: un pedido a t.me y, por cada link nuevo,
 * uno a tinyurl.com.
 *
 * La llama pg_cron de Supabase cada media hora (migración 0021) y, de
 * respaldo, un workflow de GitHub Actions cada 2 horas. Una pasada de más no
 * cambia nada: cada aviso se anota una sola vez.
 *
 * Solo escribe en el sitio publicado (isProductionRuntime). En cualquier otro
 * lado, o con ?dry=1, corre en modo prueba: lee, decide y responde qué
 * guardaría, sin tocar la base ni la bitácora.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: 'Supabase admin no configurado' }, { status: 500 });

  const channel = channelName();
  const now = new Date();
  const dry = req.nextUrl.searchParams.get('dry') === '1' || !isProductionRuntime();

  if (dry) {
    try {
      const since = await readLastChannelPost(admin);
      const { summary } = await syncChannel(admin, { channel, now, since, write: false });
      return NextResponse.json(summary);
    } catch (err) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }

  // Sin canal configurado no se anota una corrida vacía cada media hora.
  if (!channel) {
    return NextResponse.json({ ok: true, omitida: 'Falta la dirección pública del canal de afiliados.' });
  }

  const run = await startCronRun(admin, CHANNEL_JOB);
  try {
    // Candado: dos pasadas juntas (pg_cron y el respaldo de GitHub) anotarían lo mismo dos veces en Actividad.
    if (await earlierRunInProgress(admin, CHANNEL_JOB, run.id)) {
      const body = { ok: true, omitida: 'otra pasada del canal estaba en curso' };
      await run.finish(true, body);
      return NextResponse.json(body);
    }

    const since = await readLastChannelPost(admin);
    const { summary, written } = await syncChannel(admin, { channel, now, since, write: true });

    let indexnow: unknown = null;
    if (written.length > 0) {
      // El precio se ve en casi todas las páginas públicas: se vuelve a armar
      // todo, como cuando se guarda un precio revisado a mano.
      revalidateTag('catalog');
      revalidatePath('/', 'layout');
      // Bing (de donde lee ChatGPT) vuelve a leer esas fichas. Nunca lanza.
      indexnow = await notifyIndexNow(written.map((w) => `${SITE_URL}/producto/${w.slug}`));
    }

    const body = { ...summary, ...(indexnow ? { indexnow } : {}) };
    await run.finish(summary.ok, body, summary.ok ? undefined : summary.omitida);
    return NextResponse.json(body, { status: summary.ok ? 200 : 502 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await run.finish(false, null, message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
