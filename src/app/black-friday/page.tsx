import Link from 'next/link';
import type { Metadata } from 'next';
import { CalendarDays, TrendingDown } from 'lucide-react';
import { getDealsWithStats } from '@/lib/queries/deals';
import { getCatalogProducts } from '@/lib/queries/products';
import { getSiteCategories } from '@/lib/queries/site-categories';
import { BLACK_FRIDAY, blackFridayPhase, blackFridayPicks, daysUntilBlackFriday, dealsByCategory } from '@/lib/black-friday';
import { itemListJsonLd } from '@/lib/category-listing';
import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';
import { SITE_URL } from '@/lib/site';
import { ProductGrid } from '@/components/product/ProductGrid';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';

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
  const [{ deals, stats }, catalog, siteCategories] = await Promise.all([
    getDealsWithStats(),
    getCatalogProducts(),
    getSiteCategories(),
  ]);
  const { dropped, lowest, drops } = blackFridayPicks(deals, stats, now);
  const categories = dealsByCategory(deals, siteCategories);
  const phase = blackFridayPhase(now);
  const days = daysUntilBlackFriday(now);

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
              el vendedor.
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
              Libre. Si compras con nuestro link, ComparaTech recibe una comisión sin costo extra para ti.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
