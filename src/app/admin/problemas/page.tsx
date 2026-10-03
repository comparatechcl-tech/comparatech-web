import { getSupabaseAdmin } from '@/lib/supabase/server';
import { Product } from '@/lib/types';
import { REASON_LABELS } from '@/lib/inactive-reasons';
import { readAffiliateSettings } from '@/lib/settings';
import { resolveOutboundUrl } from '@/lib/outbound';
import { ProductAdminCard } from '../productos/ProductAdminCard';
import { RecheckAllButton } from './RecheckAllButton';

export const dynamic = 'force-dynamic';

/**
 * Productos que están fuera del sitio, separados por lo que hay que hacer.
 *
 * El correo diario avisaba "47 con problema" sin distinguir, y no había
 * dónde resolverlos. La mayoría se arregla sola —Mercado Libre se quedó un
 * rato sin vendedor para esa ficha—; solo los links que llevan a otro
 * producto necesitan que alguien haga algo. Esta vista separa ambos casos.
 */
export default async function ProblemasPage() {
  const admin = getSupabaseAdmin();
  const products: Product[] = admin
    ? ((
        await admin
          .from('products')
          .select('*')
          .eq('is_active', false)
          .eq('is_hidden', false)
          .order('inactive_since', { ascending: false, nullsFirst: false })
      ).data ?? [])
    : [];

  const settings = await readAffiliateSettings(admin);
  for (const p of products) p.outbound_url = resolveOutboundUrl(p, settings);

  const needsLink = products.filter((p) => p.inactive_reason === 'link_otro_producto');
  const paused = products.filter((p) => p.inactive_reason !== 'link_otro_producto');

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Productos fuera del sitio</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {products.length === 0
              ? 'No hay ninguno: todo el catálogo está publicado.'
              : `${products.length} en total. Los que están en pausa vuelven solos cuando Mercado Libre vuelve a tener vendedor; solo los que necesitan link nuevo requieren que hagas algo.`}
          </p>
        </div>
        {products.length > 0 && <RecheckAllButton />}
      </div>

      {needsLink.length > 0 && (
        <section className="mt-10">
          <h2 className="font-heading text-lg font-semibold text-fg">
            Necesitan un link nuevo ({needsLink.length})
          </h2>
          <p className="mt-1 text-sm text-muted">{REASON_LABELS.link_otro_producto.detail}</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Toca <strong className="text-fg">abrir la ficha en ML</strong> en el producto.</li>
            <li>Genera el link de afiliado desde esa ficha.</li>
            <li>Pégalo y toca <strong className="text-fg">Guardar y publicar</strong>: se verifica y queda publicado al momento.</li>
          </ol>
          <div className="mt-5 flex flex-col gap-4">
            {needsLink.map((p) => (
              <ProductAdminCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {paused.length > 0 && (
        <section className="mt-12">
          <h2 className="font-heading text-lg font-semibold text-fg">
            En pausa automática ({paused.length})
          </h2>
          <p className="mt-1 text-sm text-muted">
            No necesitan nada: el sistema revisa Mercado Libre cada 30 minutos y los vuelve a publicar apenas
            corresponda. Si no quieres esperar, usa <strong className="text-fg">Revisar ahora</strong>. Si un producto ya
            no te interesa, puedes ocultarlo o eliminarlo.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            {paused.map((p) => (
              <ProductAdminCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
