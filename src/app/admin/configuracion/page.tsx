import { getSupabaseAdmin } from '@/lib/supabase/server';
import { readAffiliateSettings } from '@/lib/settings';
import { directAffiliateUrl } from '@/lib/outbound';
import { AffiliateSettingsForm } from './AffiliateSettingsForm';

export const dynamic = 'force-dynamic';

export default async function ConfiguracionPage() {
  const admin = getSupabaseAdmin();
  const settings = await readAffiliateSettings(admin);

  // Un producto real para armar el link de prueba: el más barato activo, así
  // la compra de verificación cuesta lo menos posible.
  const { data: sample } = admin
    ? await admin
        .from('products')
        .select('name, price, ml_product_id, affiliate_url')
        .eq('is_active', true)
        .eq('is_hidden', false)
        .not('ml_product_id', 'is', null)
        .order('price', { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const testUrl = sample ? directAffiliateUrl(sample.ml_product_id, settings) : null;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Configuración</h1>

      <section className="mt-8 rounded-xl border border-border bg-surface p-5">
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
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-amber-400">
            Mercado Libre no documenta si atribuye la comisión a un link armado así. Antes de encenderlo, compruébalo
            con una compra real siguiendo los pasos de abajo.
          </p>
        </div>

        <AffiliateSettingsForm initial={settings} />
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-fg">Cómo comprobar que la comisión se registra</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Abre el link de prueba desde un celular <strong className="text-fg">que no tenga iniciada la sesión</strong>{' '}
            de la cuenta afiliada (de otra persona, idealmente).
          </li>
          <li>Compra el producto. Usamos el más barato del catálogo para que la prueba cueste poco.</li>
          <li>
            Al día siguiente revisa la Central de Afiliados: la venta debería aparecer como pendiente. Si aparece, la
            atribución funciona y puedes encender los links directos con tranquilidad.
          </li>
          <li>Si no aparece en 48 horas, deja el interruptor apagado: los links meli.la siguen funcionando igual.</li>
        </ol>

        {testUrl && sample ? (
          <div className="mt-4 rounded-lg border border-border bg-surface2 p-3">
            <p className="text-xs text-muted">
              Link de prueba · {sample.name} · ${sample.price.toLocaleString('es-CL')}
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
      </section>
    </main>
  );
}
