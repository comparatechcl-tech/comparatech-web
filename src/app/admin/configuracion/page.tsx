import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { expectedAffiliateParams, readAffiliateSettingsWithDate } from '@/lib/settings';
import { readAttributionTest } from '@/lib/admin-settings';
import { directAffiliateUrl, isMeliLaUrl } from '@/lib/outbound';
import { AffiliateSettingsForm } from './AffiliateSettingsForm';
import { AttributionTestForm } from './AttributionTestForm';

export const dynamic = 'force-dynamic';

const ATTRIBUTION_LABELS = {
  pendiente: { text: 'Pendiente', tone: 'bg-amber-500/15 text-amber-400' },
  confirmada: { text: 'Confirmada', tone: 'bg-accent/15 text-accent' },
  fallida: { text: 'No apareció', tone: 'bg-red-500/15 text-red-400' },
} as const;

function formatChile(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default async function ConfiguracionPage() {
  const admin = getSupabaseAdmin();
  const env = expectedAffiliateParams();

  const [{ settings, updatedAt }, attribution, activeRes, sampleRes] = await Promise.all([
    readAffiliateSettingsWithDate(admin),
    readAttributionTest(admin),
    admin
      ? admin
          .from('products')
          .select('affiliate_url, ml_product_id, link_target_product_id')
          .eq('is_active', true)
          .eq('is_hidden', false)
      : Promise.resolve({ data: null, error: null }),
    // Un producto real para armar el link de prueba: el más barato activo,
    // así la compra de verificación cuesta lo menos posible.
    admin
      ? admin
          .from('products')
          .select('name, price, ml_product_id, affiliate_url')
          .eq('is_active', true)
          .eq('is_hidden', false)
          .not('ml_product_id', 'is', null)
          .order('price', { ascending: true })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Si la consulta falla se muestra '—' y no 0: un cero diría que todo está
  // bien cuando en realidad no se sabe.
  type ActiveRow = { affiliate_url: string; ml_product_id: string | null; link_target_product_id: string | null };
  const active = activeRes.error || !activeRes.data ? null : (activeRes.data as ActiveRow[]);
  const activeCount = active ? active.length : null;
  const withoutBackup = active ? active.filter((p) => !isMeliLaUrl(p.affiliate_url ?? '')).length : null;
  // Activos solo gracias a los links directos: su meli.la lleva a otra ficha.
  const mismatched = active
    ? active.filter((p) => p.link_target_product_id && p.link_target_product_id !== p.ml_product_id).length
    : null;

  const sample = sampleRes.data;
  const testUrl = sample ? directAffiliateUrl(sample.ml_product_id, settings) : null;
  const attributionLabel = ATTRIBUTION_LABELS[attribution.test.status];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-heading text-2xl font-bold text-fg">Configuración</h1>
        <Link href="/admin/actividad" className="text-sm font-medium text-accent hover:underline">
          Ver historial de cambios
        </Link>
      </div>

      <section className="mt-8 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-fg">Modo de links</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Botón &quot;Ver en Mercado Libre&quot;</dt>
            <dd className="mt-0.5 font-medium text-fg">
              {settings.directLinks ? 'Directos a la ficha' : 'meli.la (generados a mano)'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Último cambio</dt>
            <dd className="mt-0.5 text-fg">{formatChile(updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">matt_word</dt>
            <dd className="mt-0.5 break-all font-mono text-fg">
              {settings.word ?? '—'}
              {env.word && <span className="ml-2 font-sans text-xs text-muted">(fijado en AFFILIATE_WORD)</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Prueba de atribución</dt>
            <dd className="mt-1">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${attributionLabel.tone}`}>
                {attributionLabel.text}
              </span>
            </dd>
          </div>
        </dl>

        <p className="mt-4 rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-fg">
          Productos sin link meli.la de respaldo: <strong>{withoutBackup ?? '—'}</strong>
          {withoutBackup !== null && withoutBackup > 0 && (
            <>
              {' · '}
              <Link href="/admin/problemas#sin-respaldo" className="font-medium text-accent hover:underline">
                Ver cuáles
              </Link>
            </>
          )}
          <span className="mt-0.5 block text-xs text-muted">
            Son productos activos cuyo link guardado no es un meli.la. Si los links directos se apagan o dejan de
            pagar comisión, estos botones no tienen un link generado por la cuenta al cual volver.
          </span>
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-fg">Links de afiliado directos</h2>
        <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            Hoy cada link es un <code className="text-fg">meli.la</code> generado a mano. Esos links abren primero el
            perfil de afiliado y el comprador tiene que tocar <em>&quot;Ir a producto&quot;</em> para llegar a la ficha:
            un clic de más, y una página intermedia que a veces muestra otro precio.
          </p>
          <p>
            Un link directo lleva a la ficha de una vez, con los mismos parámetros que identifican a la cuenta en todos
            sus links (<code className="text-fg">matt_word</code> y <code className="text-fg">matt_tool</code>). Además,
            permitiría aprobar productos sin generar cada link a mano.
          </p>
          {attribution.test.status !== 'confirmada' && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-400">
              Mercado Libre no documenta si atribuye la comisión a un link armado así. Antes de encenderlo, comprueba
              la atribución y anota el resultado más abajo.
            </p>
          )}
        </div>

        <AffiliateSettingsForm
          initial={settings}
          locked={{ word: env.word, tool: env.tool }}
          activeCount={activeCount}
          mismatchCount={mismatched}
          attributionConfirmed={attribution.test.status === 'confirmada'}
        />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-fg">Prueba de atribución</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sirve para saber si Mercado Libre paga comisión por los clics en un link directo. Mientras no esté
          confirmada, encender los links directos pide una confirmación extra.
        </p>

        {testUrl && sample ? (
          <div className="mt-4 rounded-lg border border-border bg-surface2 p-3">
            <p className="text-xs text-muted">
              Link de prueba · {sample.name} · ${sample.price.toLocaleString('es-CL')} (el más barato del catálogo)
            </p>
            <a
              href={testUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-xs font-medium text-accent hover:underline"
            >
              {testUrl}
            </a>
          </div>
        ) : (
          <p className="mt-4 text-xs text-amber-400">
            Para armar el link de prueba faltan matt_word y matt_tool. Se completan solos al guardar o aprobar
            cualquier link meli.la, o puedes escribirlos arriba.
          </p>
        )}

        {attribution.available ? (
          <AttributionTestForm initial={attribution.test} />
        ) : (
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            Aplica la migración 0013 en Supabase para guardar el resultado de la prueba.
          </p>
        )}
      </section>
    </main>
  );
}
