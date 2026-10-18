import Link from 'next/link';
import type { Metadata } from 'next';
import { CalendarDays, Eye, TrendingDown, TrendingUp } from 'lucide-react';
import { getDealsWithStats } from '@/lib/queries/deals';
import { getCatalogProducts } from '@/lib/queries/products';
import { getSiteCategories } from '@/lib/queries/site-categories';
import { getWatchList } from '@/lib/queries/black-friday-thermometer';
import { BLACK_FRIDAY, blackFridayPhase, blackFridayPicks, daysUntilBlackFriday, dealsByCategory } from '@/lib/black-friday';
import {
  EVENT_WINDOWS,
  THERMOMETER_PATH,
  rangeLabel,
  thermometerPhase,
  type WatchItem,
} from '@/lib/black-friday-thermometer';
import { itemListJsonLd } from '@/lib/category-listing';
import { GUIDES, guidePath } from '@/lib/guides';
import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';
import { formatCLP } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import { ProductGrid } from '@/components/product/ProductGrid';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { DropChip } from '@/components/product/DealBadge';

const { year } = BLACK_FRIDAY;

export const metadata: Metadata = {
  // Entero, sin "| ComparaTech": con él pasaba de los 60 caracteres que muestra Google.
  title: { absolute: `Black Friday ${year} Chile: precios de tecnología con historial` },
  description: `Black Friday ${year} en Chile, ${BLACK_FRIDAY.label}. Ofertas de tecnología en Mercado Libre con el historial de precios para ver si el descuento es de verdad.`,
  alternates: { canonical: '/black-friday' },
};

// Las listas salen del historial y de las ofertas del día: se rearman cada 5 minutos.
export const revalidate = 300;

/**
 * Black Friday (SEO etapa 2, punto 3). Dirección fija sin año: ver
 * lib/black-friday, donde están las fechas de cada año.
 *
 * Lo que aporta frente a las listas de ofertas de todos lados es el
 * historial propio: qué bajó de verdad según lo que el sitio registró, qué
 * está en el precio más bajo que se le ha visto y cómo revisarlo uno mismo.
 * No dice si conviene comprar ni promete precios: solo lo que se registró.
 */
export default async function BlackFridayPage() {
  const now = Date.now();
  const [{ deals, stats }, catalog, siteCategories, watch] = await Promise.all([
    getDealsWithStats(),
    getCatalogProducts(),
    getSiteCategories(),
    // Del lunes 23 al lunes 30 de noviembre; fuera de esas fechas no lee nada.
    getWatchList(now),
  ]);
  const { dropped, lowest, drops } = blackFridayPicks(deals, stats, now);
  const categories = dealsByCategory(deals, siteCategories);
  const phase = blackFridayPhase(now);
  const days = daysUntilBlackFriday(now);
  const thermometer = thermometerPhase(now);

  const lead =
    phase === 'antes'
      ? `El Black Friday ${year} en Chile es ${BLACK_FRIDAY.label}, según sus organizadores. Ese fin de semana muchas ofertas van a decir 40% o 60% de descuento: acá vas a poder ver si el precio de verdad bajó, porque seguimos el precio de ${catalog.length.toLocaleString('es-CL')} productos de tecnología y hogar en Mercado Libre desde octubre.`
      : phase === 'durante'
        ? `El Black Friday ${year} está en curso, hasta el lunes 30 de noviembre. Estas son las ofertas de tecnología y hogar en Mercado Libre que de verdad bajaron, según el precio que registramos los días anteriores.`
        : `El Black Friday ${year} fue ${BLACK_FRIDAY.label}. Seguimos registrando los precios de ${catalog.length.toLocaleString('es-CL')} productos en Mercado Libre: estas son las bajas de hoy.`;

  const listed = dropped.length > 0 ? dropped : lowest;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {listed.length > 0 && (
        <script
          type="application/ld+json"
          // Ya viene con '<' escapado (ver itemListJsonLd).
          dangerouslySetInnerHTML={{ __html: itemListJsonLd(listed, SITE_URL, `Black Friday ${year}`) }}
        />
      )}
      <Breadcrumbs items={[{ name: 'Inicio', href: '/' }, { name: 'Black Friday' }]} />

      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
        <CalendarDays size={13} aria-hidden /> {BLACK_FRIDAY.label.replace(/^del /, 'Del ')} de {year}
        {phase === 'antes' && <> · {days === 1 ? 'falta 1 día' : `faltan ${days} días`}</>}
        {phase === 'durante' && <> · en curso</>}
      </span>
      <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Black Friday {year} en Mercado Libre</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{lead}</p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
        <Link href={THERMOMETER_PATH} className="font-medium text-accent hover:underline">
          Termómetro del Black Friday {year}
        </Link>
        {thermometer === 'antes'
          ? ': cómo vamos a medir qué bajó de verdad.'
          : thermometer === 'preliminar'
            ? ': el dato preliminar de qué está bajando de verdad.'
            : ': el balance de qué bajó de verdad.'}
      </p>

      {watch.length > 0 && <WatchSection items={watch} inEvent={phase === 'durante'} />}

      <section aria-labelledby="bajaron" className="mt-10">
        <h2 id="bajaron" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <TrendingDown size={18} className="text-accent" aria-hidden /> Bajaron de precio según nuestro registro
        </h2>
        <p className="mb-4 mt-1 max-w-3xl text-sm text-muted">
          Ofertas con {MIN_DEAL_DISCOUNT}% o más de descuento cuyo precio de hoy es menor que el que registramos antes.
          El chip &quot;Bajó&quot; dice cuánto.
        </p>
        {dropped.length > 0 ? (
          <ProductGrid products={dropped} placement="black-friday" drops={drops} eagerImages={4} />
        ) : (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
            Hoy no registramos bajas de precio en las ofertas. Los precios se actualizan varias veces al día.
          </p>
        )}
      </section>

      {lowest.length > 0 && (
        <section aria-labelledby="mas-bajo" className="mt-10">
          <h2 id="mas-bajo" className="font-heading text-lg font-semibold">
            En el precio más bajo que les hemos visto
          </h2>
          <p className="mb-4 mt-1 max-w-3xl text-sm text-muted">
            Ofertas que hoy están en el precio más bajo desde que las seguimos (al menos una semana), y que antes
            estuvieron más caras.
          </p>
          <ProductGrid products={lowest} placement="black-friday" />
        </section>
      )}

      {categories.length > 0 && (
        <section aria-labelledby="por-categoria" className="mt-10">
          <h2 id="por-categoria" className="mb-3 font-heading text-lg font-semibold">
            Ofertas por categoría
          </h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/categoria/${c.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
                >
                  {c.name}
                  <span className="text-xs text-muted">
                    {c.count} {c.count === 1 ? 'oferta' : 'ofertas'}
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/ofertas"
                className="inline-flex items-center rounded-full border border-accent/40 px-3.5 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/10"
              >
                Todas las ofertas
              </Link>
            </li>
          </ul>
        </section>
      )}

      {GUIDES.length > 0 && (
        <section aria-labelledby="guias" className="mt-10">
          <h2 id="guias" className="mb-3 font-heading text-lg font-semibold">
            Guías de compra
          </h2>
          <ul className="flex flex-wrap gap-2">
            {GUIDES.map((g) => (
              <li key={g.slug}>
                <Link
                  href={guidePath(g.slug)}
                  className="inline-flex items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
                >
                  {g.heading}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="descuento-real" className="mt-10 max-w-3xl">
        <h2 id="descuento-real" className="mb-3 font-heading text-lg font-semibold">
          Cómo saber si un descuento es de verdad
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            El porcentaje de descuento lo calcula cada vendedor en Mercado Libre, sobre un precio que él mismo informa.
            Por eso un producto puede tener &quot;50% de descuento&quot; todo el año.
          </li>
          <li>
            Mira el historial de precios en la ficha del producto: si el precio de hoy está igual a su promedio de los
            últimos 30 días, no bajó.
          </li>
          <li>Compáralo con el más bajo registrado: la ficha dice cuándo fue y cuánto duró.</li>
          <li>
            Si el precio cambia muchas veces en pocas horas (pasa cuando dos vendedores se turnan la venta), revisa el
            de Mercado Libre antes de comprar.
          </li>
          <li>Fíjate en el vendedor: en ComparaTech solo aparecen vendedores con reputación verde.</li>
        </ol>
      </section>

      <section aria-labelledby="preguntas" className="mt-10 max-w-3xl">
        <h2 id="preguntas" className="mb-3 font-heading text-lg font-semibold">
          Preguntas frecuentes
        </h2>
        <dl className="space-y-4 text-sm leading-relaxed">
          <div>
            <dt className="font-medium text-fg">¿Cuándo es el Black Friday {year} en Chile?</dt>
            <dd className="mt-1 text-muted">
              {BLACK_FRIDAY.label.replace(/^del /, 'Del ')} de {year}, desde las 00:00 del viernes, según los
              organizadores de Black Friday Chile. Cada tienda define sus propias ofertas y horarios.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">¿Qué significa &quot;Bajó $X&quot;?</dt>
            <dd className="mt-1 text-muted">
              Que el precio de hoy es menor que el que nosotros mismos registramos antes. No es el descuento que informa
              el vendedor.{' '}
              <Link href="/como-funciona#etiquetas" className="text-accent hover:underline">
                Qué significa cada etiqueta
              </Link>
              .
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">¿Cada cuánto se actualizan los precios?</dt>
            <dd className="mt-1 text-muted">
              Varias veces al día. El precio que vale es el que muestra Mercado Libre al momento de comprar.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-fg">¿ComparaTech vende los productos?</dt>
            <dd className="mt-1 text-muted">
              No. Mostramos el precio que tienen en Mercado Libre y cómo se ha movido; la compra se hace en Mercado
              Libre.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/**
 * "Lo que vamos a vigilar" (del 23 al 26 de noviembre) y "Lo que estamos
 * vigilando" (durante el evento): los modelos muy buscados (lib/models) con
 * el precio de hoy de su versión de menor precio y el precio habitual del
 * termómetro. Las etiquetas salen solo si el historial las confirma
 * (lib/black-friday-thermometer, buildWatchList).
 */
function WatchSection({ items, inEvent }: { items: WatchItem[]; inEvent: boolean }) {
  const reference = rangeLabel(EVENT_WINDOWS.refStart, EVENT_WINDOWS.refEnd);
  return (
    <section aria-labelledby="vigilar" className="mt-10">
      <h2 id="vigilar" className="flex items-center gap-2 font-heading text-lg font-semibold">
        <Eye size={18} className="text-accent" aria-hidden /> {inEvent ? 'Lo que estamos vigilando' : 'Lo que vamos a vigilar'}
      </h2>
      <p className="mb-4 mt-1 max-w-3xl text-sm text-muted">
        Productos muy buscados, con su precio de hoy y el precio habitual que tuvieron {reference}.
        {!inEvent && ' En el Black Friday vas a ver acá si bajan de verdad.'}
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li key={item.path}>
            <Link
              href={item.path}
              prefetch={false}
              className="flex h-full flex-col gap-1 rounded-xl border border-border bg-surface p-4 transition hover:border-accent/40"
            >
              <span className="font-medium text-fg">{item.name}</span>
              <span className="text-sm text-fg">
                Desde {formatCLP(item.price)}{' '}
                <span className="text-xs text-muted">
                  hoy · {item.versions} {item.versions === 1 ? 'versión' : 'versiones'}
                </span>
              </span>
              {item.note && (
                <span className="text-xs text-muted">
                  Precio habitual {reference}: {formatCLP(item.note.habitual)}
                </span>
              )}
              {item.note?.roseBefore && (
                <span className="inline-flex w-fit items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                  <TrendingUp size={12} strokeWidth={2.4} aria-hidden />
                  Subió antes del Black Friday
                </span>
              )}
              {item.note?.belowPct != null && (
                <span className="inline-flex w-fit items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  <TrendingDown size={12} strokeWidth={2.4} aria-hidden />
                  {item.note.belowPct}% bajo su precio habitual
                </span>
              )}
              {item.drop && <DropChip amount={item.drop.amount} className="w-fit" />}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
