import Image from 'next/image';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { Product } from '@/lib/types';
import { REASON_LABELS, reasonInfo } from '@/lib/inactive-reasons';
import { readAffiliateSettings } from '@/lib/settings';
import { resolveOutboundUrl } from '@/lib/outbound';
import mlImageLoader from '@/lib/ml-image-loader';
import {
  actionNeededIds,
  chileDaysSince,
  findDuplicateLinkGroups,
  lacksBackupLink,
  needsNewLink,
  pointsToOtherProduct,
  readProductStatRows,
} from '@/lib/admin-stats';
import { ProductAdminCard } from '../productos/ProductAdminCard';
import { BulkLinkPanel } from '../BulkLinkPanel';
import { RecheckAllButton } from './RecheckAllButton';
import { HideButton } from './HideButton';

export const dynamic = 'force-dynamic';

/** En pausa por más de esto, probablemente ya no vuelva: se sugiere ocultarlo. */
const STALE_PAUSE_DAYS = 14;

/**
 * Productos con algo que resolver, separados por lo que hay que hacer.
 *
 * El correo diario avisaba "47 con problema" sin distinguir, y no había
 * dónde resolverlos. La mayoría se arregla sola —Mercado Libre se quedó un
 * rato sin vendedor para esa ficha—; lo que de verdad pierde comisión son
 * los links que llevan a otro producto, los repetidos y los productos sin
 * un meli.la de respaldo. Esos van arriba; los que vuelven solos, plegados
 * al final.
 */
export default async function ProblemasPage() {
  const admin = getSupabaseAdmin();
  const now = new Date();

  const [read, settings] = await Promise.all([
    readProductStatRows<Product>(admin, '*'),
    readAffiliateSettings(admin),
  ]);
  const products = read.data ?? [];
  for (const p of products) p.outbound_url = resolveOutboundUrl(p, settings);

  const needsLink = products.filter(needsNewLink);
  const duplicates = findDuplicateLinkGroups(products);
  const noBackup = products.filter(lacksBackupLink);
  const otherTarget = products.filter((p) => p.is_active && pointsToOtherProduct(p));
  const paused = products
    .filter((p) => !p.is_active && !needsNewLink(p))
    // Los más antiguos primero: son los candidatos a ocultar.
    .sort((a, b) => (a.inactive_since ?? '').localeCompare(b.inactive_since ?? ''));
  const actionCount = actionNeededIds(products).size;
  const inactiveCount = products.filter((p) => !p.is_active).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Problemas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {read.error
              ? '—'
              : actionCount === 0
                ? `Nada requiere acción.${paused.length > 0 ? ` Hay ${paused.length} en pausa automática que vuelven solos.` : ''}`
                : `${actionCount} ${actionCount === 1 ? 'producto requiere' : 'productos requieren'} acción: cada uno es un clic que hoy puede no estar pagando comisión.`}
          </p>
        </div>
        {inactiveCount > 0 && <RecheckAllButton />}
      </div>

      {read.error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Error al leer la base de datos: {read.error}. Los números pueden estar incompletos.
        </div>
      )}

      {!read.error && (
        <nav aria-label="Secciones" className="mt-6 flex flex-wrap gap-2 text-xs">
          <Anchor href="#necesitan-link" label="Link nuevo" count={needsLink.length} />
          <Anchor href="#repetidos" label="Repetidos" count={duplicates.reduce((n, g) => n + g.products.length, 0)} />
          <Anchor href="#sin-respaldo" label="Sin respaldo" count={noBackup.length} />
          <Anchor href="#otra-ficha" label="Link a otra ficha" count={otherTarget.length} />
          <Anchor href="#en-pausa" label="En pausa" count={paused.length} quiet />
        </nav>
      )}

      {needsLink.length > 0 && (
        <section id="necesitan-link" className="mt-10 scroll-mt-16">
          <h2 className="font-heading text-lg font-semibold text-fg">Necesitan link nuevo ({needsLink.length})</h2>
          <p className="mt-1 text-sm text-muted">{REASON_LABELS.link_otro_producto.detail}</p>
          <div className="mt-4">
            <BulkLinkPanel
              mode="republicar"
              items={needsLink.flatMap((p) =>
                p.ml_product_id ? [{ id: p.id, name: p.name, mlProductId: p.ml_product_id }] : []
              )}
            />
          </div>
          <p className="mt-4 text-xs text-muted">
            También puedes hacerlo de a uno: <strong className="text-fg">abrir la ficha en ML</strong>, generar el link
            ahí, pegarlo en el producto y tocar <strong className="text-fg">Guardar y publicar</strong>.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {needsLink.map((p) => (
              <ProductAdminCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {duplicates.length > 0 && (
        <section id="repetidos" className="mt-12 scroll-mt-16">
          <h2 className="font-heading text-lg font-semibold text-fg">Links repetidos ({duplicates.length})</h2>
          <p className="mt-1 text-sm text-muted">
            Estos productos comparten el mismo link de afiliado, así que al menos uno lleva al comprador a la ficha
            equivocada. Genera el link de nuevo desde la ficha de cada producto que no corresponda y tócalo en{' '}
            <strong className="text-fg">Guardar y publicar</strong>.
          </p>
          <div className="mt-5 flex flex-col gap-6">
            {duplicates.map((g) => (
              <div key={g.url} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 sm:p-4">
                <p className="break-all text-xs text-amber-400">
                  Mismo link en {g.products.length} productos: <span className="text-fg">{g.url}</span>
                </p>
                <div className="mt-3 flex flex-col gap-4">
                  {g.products.map((p) => (
                    <ProductAdminCard key={p.id} product={p} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {noBackup.length > 0 && (
        <section id="sin-respaldo" className="mt-12 scroll-mt-16">
          <h2 className="font-heading text-lg font-semibold text-fg">
            Sin link meli.la de respaldo ({noBackup.length})
          </h2>
          <p className="mt-1 text-sm text-muted">
            Están publicados sin un link meli.la guardado. Si los links directos se apagan o Mercado Libre no los
            atribuye, estos productos no tienen un link que pague comisión. Genera el meli.la y guárdalo.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            {noBackup.map((p) => (
              <ProductAdminCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {otherTarget.length > 0 && (
        <section id="otra-ficha" className="mt-12 scroll-mt-16">
          <h2 className="font-heading text-lg font-semibold text-fg">
            Activos con link a otra ficha ({otherTarget.length})
          </h2>
          <p className="mt-1 text-sm text-muted">
            La última revisión encontró que el link abre una ficha distinta a la publicada (a veces es otro color del
            mismo modelo). Ábrelo como comprador: si lleva al producto equivocado, genera el link de nuevo.
          </p>
          <div className="mt-5 flex flex-col gap-4">
            {otherTarget.map((p) => (
              <ProductAdminCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {paused.length > 0 && (
        <section id="en-pausa" className="mt-12 scroll-mt-16">
          <details className="group rounded-xl border border-border bg-surface">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
              <span className="font-heading text-base font-semibold text-fg">
                En pausa automática ({paused.length}): no necesitan nada
              </span>
              <span className="text-xs text-muted group-open:hidden">Ver</span>
              <span className="hidden text-xs text-muted group-open:inline">Ocultar lista</span>
            </summary>
            <p className="border-t border-border px-4 py-3 text-xs text-muted">
              El sistema revisa Mercado Libre cada 30 minutos y los vuelve a publicar apenas corresponda. Si no quieres
              esperar, usa <strong className="text-fg">Revisar todos ahora</strong>. Si llevan mucho tiempo en pausa,
              puedes ocultarlos.
            </p>
            <ul className="divide-y divide-border border-t border-border">
              {paused.map((p) => {
                const days = chileDaysSince(p.inactive_since, now);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white">
                      {p.image_url && (
                        // La URL se arma acá con el loader de ML: pasarle la
                        // función a <Image> desde un componente de servidor no
                        // se puede (es un componente de cliente).
                        <Image
                          unoptimized
                          src={mlImageLoader({ src: p.image_url, width: 80 })}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 object-contain"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm text-fg">{p.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {reasonInfo(p.inactive_reason).title}
                        {days !== null && ` · desde hace ${days} ${days === 1 ? 'día' : 'días'}`}
                      </p>
                      {days !== null && days > STALE_PAUSE_DAYS && (
                        <p className="mt-0.5 text-xs text-amber-400">Considera ocultarlo</p>
                      )}
                    </div>
                    <HideButton productId={p.id} />
                  </li>
                );
              })}
            </ul>
          </details>
        </section>
      )}
    </main>
  );
}

function Anchor({ href, label, count, quiet = false }: { href: string; label: string; count: number; quiet?: boolean }) {
  if (count === 0) return null;
  return (
    <a
      href={href}
      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium transition ${
        quiet
          ? 'border-border bg-surface text-muted hover:text-fg'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:border-amber-400'
      }`}
    >
      {label} <span className="font-bold">{count}</span>
    </a>
  );
}
