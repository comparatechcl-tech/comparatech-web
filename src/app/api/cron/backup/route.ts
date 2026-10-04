import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { pingHealthcheck, startCronRun } from '@/lib/cron-runs';
import { fetchAllRows } from '@/lib/admin-stats';
import { parseRecipients, sendEmail, toBase64, toCsv } from '@/lib/email';
import { isMeliLaUrl } from '@/lib/outbound';
import { chileDateKey } from '@/lib/clicks';
import { escapeHtml } from '@/lib/daily-digest';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Respaldo semanal de los links de afiliado, por correo.
 *
 * Los meli.la se generan a mano, uno por uno, en la Central de Afiliados:
 * son ~110 y rehacerlos tomaría días. Si la base se pierde o alguien borra
 * algo por error, este correo es la copia para recuperarlos. Llega a
 * DIGEST_TO con dos CSV (productos y candidatos pendientes) y la
 * configuración del sitio en JSON.
 *
 * Por correo y no como artifact de GitHub Actions a propósito: el repo es
 * público y cualquiera podría descargar el respaldo.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type DbError = { code?: string; message: string } | null;

interface ProductBackupRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  ml_product_id: string | null;
  affiliate_url: string | null;
  is_active: boolean;
  is_hidden: boolean;
  category: string;
  price: number;
}

interface CandidateBackupRow extends Record<string, unknown> {
  id: string;
  ml_product_id: string;
  name: string;
  price: number;
  status: string;
}

const PRODUCT_COLUMNS: (keyof ProductBackupRow & string)[] = [
  'id',
  'slug',
  'name',
  'ml_product_id',
  'affiliate_url',
  'is_active',
  'is_hidden',
  'category',
  'price',
];
const CANDIDATE_COLUMNS: (keyof CandidateBackupRow & string)[] = ['id', 'ml_product_id', 'name', 'price', 'status'];

/** Los clics más viejos que esto se borran (ver /privacidad). */
const CLICK_RETENTION_DAYS = 180;

/**
 * Borra los clics de más de 180 días. /api/e acepta hasta 20.000 por día:
 * sin una limpieza, la tabla iría llenando de a poco los 500 MB del plan
 * gratis de Supabase. Va en este cron porque corre una vez por semana.
 * Que falle no tumba el respaldo.
 */
async function pruneOldClicks(admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<number | string> {
  const cutoff = new Date(Date.now() - CLICK_RETENTION_DAYS * 86_400_000).toISOString();
  const { count, error } = await admin
    .from('outbound_clicks')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff);
  if (error) return isMissingSchemaError(error) ? 'falta la migración 0015' : error.message;
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const healthcheckUrl = process.env.HEALTHCHECK_BACKUP_URL;
  const admin = getSupabaseAdmin();
  if (!admin) {
    await pingHealthcheck(healthcheckUrl, false);
    return NextResponse.json({ ok: false, error: 'Supabase admin no configurado' }, { status: 500 });
  }

  const run = await startCronRun(admin, 'backup');
  const finish = async (ok: boolean, body: Record<string, unknown>, error?: string) => {
    const payload = { ok, ...body, elapsed_ms: Date.now() - startedAt };
    await Promise.all([run.finish(ok, payload, error), pingHealthcheck(healthcheckUrl, ok)]);
    return NextResponse.json(payload, { status: ok ? 200 : 500 });
  };

  try {
    const to = parseRecipients(process.env.DIGEST_TO);
    if (to.length === 0) return finish(false, { error: 'DIGEST_TO no configurado' }, 'DIGEST_TO no configurado');

    // De a páginas: PostgREST corta en 1.000 filas, y un respaldo cortado
    // sin aviso es peor que no tener respaldo.
    const [products, candidates, settings] = await Promise.all([
      fetchAllRows<ProductBackupRow>(
        (from, to) =>
          admin
            .from('products')
            .select(PRODUCT_COLUMNS.join(', '))
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
      ),
      fetchAllRows<CandidateBackupRow>(
        (from, to) =>
          admin
            .from('product_candidates')
            .select(CANDIDATE_COLUMNS.join(', '))
            .eq('status', 'pending_review')
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
      ),
      fetchAllRows<{ key: string; value: unknown; updated_at: string | null }>(
        (from, to) =>
          admin
            .from('site_settings')
            .select('key, value, updated_at')
            .order('key', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
      ),
    ]);

    const readError = products.error ?? candidates.error ?? settings.error;
    if (readError) {
      return finish(false, { error: `No se pudo leer la base: ${readError.message}` }, readError.message);
    }

    const date = chileDateKey(new Date());
    const total = products.rows.length;
    const withMeliLa = products.rows.filter((p) => isMeliLaUrl(p.affiliate_url ?? '')).length;
    const withoutLink = products.rows.filter((p) => !p.affiliate_url?.trim()).length;

    const productWord = total === 1 ? 'producto' : 'productos';
    const subject = `ComparaTech · Respaldo semanal de links (${total} ${productWord})`;
    const lines = [
      `Respaldo del ${date}.`,
      `${total} ${productWord} (${withMeliLa} con link meli.la, ${withoutLink} sin link guardado).`,
      `${candidates.rows.length} ${candidates.rows.length === 1 ? 'candidato pendiente' : 'candidatos pendientes'}.`,
      '',
      'Guarda este correo: si algún día se pierden los links de afiliado, los adjuntos sirven para recuperarlos sin volver a generarlos a mano en la Central de Afiliados.',
    ];

    const sent = await sendEmail({
      to,
      subject,
      text: lines.join('\n'),
      html: `<!doctype html><html lang="es"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6;">
${lines.map((l) => (l ? `<p style="margin:0 0 8px;">${escapeHtml(l)}</p>` : '')).join('\n')}
</body></html>`,
      attachments: [
        { filename: `productos-${date}.csv`, content: toBase64(toCsv(PRODUCT_COLUMNS, products.rows)) },
        { filename: `candidatos-pendientes-${date}.csv`, content: toBase64(toCsv(CANDIDATE_COLUMNS, candidates.rows)) },
        {
          filename: `configuracion-${date}.json`,
          content: toBase64(JSON.stringify(settings.rows, null, 2)),
        },
      ],
    });

    const summary = {
      clics_borrados: await pruneOldClicks(admin),
      productos: total,
      con_meli_la: withMeliLa,
      sin_link: withoutLink,
      candidatos_pendientes: candidates.rows.length,
      configuraciones: settings.rows.length,
      destinatarios: to.length,
    };
    if (!sent.ok) return finish(false, { ...summary, error: sent.error }, `correo: ${sent.error}`);
    return finish(true, summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finish(false, { error: message }, message);
  }
}
