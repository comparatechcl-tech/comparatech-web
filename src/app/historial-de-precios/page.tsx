import Link from 'next/link';
import type { Metadata } from 'next';
import { History, Search, TrendingDown } from 'lucide-react';
import { getDealsWithStats } from '@/lib/queries/deals';
import { getCatalogProducts } from '@/lib/queries/products';
import { blackFridayPicks } from '@/lib/black-friday';
import { itemListJsonLd } from '@/lib/category-listing';
import { MIN_DROP_PCT } from '@/lib/deal-rank';
import { MODELS, modelPath, versionsOf } from '@/lib/models';
import { SITE_URL } from '@/lib/site';
import { ProductGrid } from '@/components/product/ProductGrid';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { RealDiscountTips } from '@/components/product/RealDiscountTips';

export const metadata: Metadata = {
  // Lo aprueba el dueño. Entero: con "| ComparaTech" cabe en los 60 caracteres que muestra Google.
  title: { absolute: 'Historial de precios de Mercado Libre Chile | ComparaTech' },
  description:
    'Busca un producto de tecnología o del hogar y mira cómo cambió su precio en Mercado Libre: gráfico, promedio de 30 días y el más bajo registrado.',
  alternates: { canonical: '/historial-de-precios' },
};

// Las bajas y los precios más bajos salen del historial y de las ofertas del día: se rearman cada 5 minutos.
export const revalidate = 300;

/**
 * "Historial de precios de Mercado Libre" (SEO etapa 2, punto 2): responde
 * la búsqueda de quien quiere saber si un precio de Mercado Libre bajó de
 * verdad. Lo propio es el registro: un buscador que lleva a la ficha (donde
 * está el gráfico), las páginas por modelo, lo que bajó y lo que está en su
 * precio más bajo, y cómo se arma ese registro. No dice si conviene comprar.
 */
export default async function HistorialDePreciosPage() {
  const now = Date.now();
  const [{ deals, stats }, catalog] = await Promise.all([getDealsWithStats(), getCatalogProducts()]);
  const { dropped, lowest, drops } = blackFridayPicks(deals, stats, now);
  const models = MODELS.filter((m) => versionsOf(m, catalog).length > 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {dropped.length > 0 && (
        <script
          type="application/ld+json"
          // Ya viene con '<' escapado (ver itemListJsonLd).
          dangerouslySetInnerHTML={{ __html: itemListJsonLd(dropped, SITE_URL, 'Bajaron de precio según nuestro registro') }}
        />
      )}
      <Breadcrumbs items={[{ name: 'Inicio', href: '/' }, { name: 'Historial de precios' }]} />

      <h1 className="font-heading text-2xl font-bold sm:text-3xl">Historial de precios de Mercado Libre</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
        Para saber si un descuento es real, sirve ver cómo cambió el precio en el tiempo. Revisamos varias veces al día
        el precio de {catalog.length.toLocaleString('es-CL')} productos de tecnología y hogar en Mercado Libre y
        guardamos cada cambio: en la ficha de cada uno está su gráfico, el promedio de los últimos 30 días y el precio
        más bajo registrado.
      </p>

      <form action="/buscar" method="get" role="search" className="mt-6 flex max-w-xl gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            name="q"
            aria-label="Busca un producto"
            placeholder="Ej.: iPhone 17, PS5, smart TV 55"
            autoComplete="off"
            enterKeyHint="search"
            required
            className="min-h-11 w-full rounded-xl border border-border bg-surface2 py-2 pl-9 pr-3 text-sm text-fg placeholder:text-muted transition focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-ink transition hover:bg-accent/90"
        >
          Buscar
        </button>
      </form>
      <p className="mt-2 max-w-xl text-xs text-muted">
        Busca entre los productos que seguimos. Abre uno y baja hasta &quot;Historial de precios&quot;.
      </p>

      {models.length > 0 && (
        <section aria-labelledby="por-modelo" className="mt-10">
          <h2 id="por-modelo" className="mb-1 flex items-center gap-2 font-heading text-lg font-semibold">
            <History size={18} className="text-accent" aria-hidden /> Historial por modelo
          </h2>
          <p className="mb-3 max-w-3xl text-sm text-muted">
            Todas las versiones de un modelo juntas, con el precio más bajo entre ellas en cada momento.
          </p>
          <ul className="flex flex-wrap gap-2">
            {models.map((m) => (
              <li key={m.slug}>
                <Link
                  href={modelPath(m.slug)}
                  className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-fg transition hover:border-accent/40 hover:text-accent"
                >
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="bajaron" className="mt-10">
        <h2 id="bajaron" className="flex items-center gap-2 font-heading text-lg font-semibold">
          <TrendingDown size={18} className="text-accent" aria-hidden /> Bajaron de precio según nuestro registro
        </h2>
        <p className="mb-4 mt-1 max-w-3xl text-sm text-muted">
          Ofertas cuyo precio de hoy es menor que el que registramos antes. El chip &quot;Bajó&quot; dice cuánto.
        </p>
        {dropped.length > 0 ? (
          <ProductGrid products={dropped} placement="historial" drops={drops} eagerImages={4} />
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
          <ProductGrid products={lowest} placement="historial" />
        </section>
      )}

      <RealDiscountTips />

      <section aria-labelledby="como-se-arma" className="mt-10 max-w-3xl">
        <h2 id="como-se-arma" className="mb-3 font-heading text-lg font-semibold">
          Cómo armamos el historial
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Revisamos el precio de cada producto varias veces al día y guardamos cada cambio. Los primeros registros son
            de octubre de 2026.
          </li>
          <li>
            El precio que guardamos es el que aparece en la ficha de Mercado Libre, del vendedor con reputación verde que
            la gana en ese momento.
          </li>
          <li>
            &quot;Bajó $X&quot; sale solo cuando el precio de hoy es {MIN_DROP_PCT}% o más menor que el que registramos
            antes, ese precio anterior duró al menos un día y no es un precio que va y vuelve.
          </li>
          <li>
            Solo hay historial de los productos de nuestro catálogo, que se arma solo con lo más vendido y lo más
            buscado en Mercado Libre.{' '}
            <Link href="/como-funciona" className="text-accent hover:underline">
              Cómo funciona ComparaTech
            </Link>
            .
          </li>
        </ul>
      </section>

      <section aria-labelledby="preguntas" className="mt-10 max-w-3xl">
        <h2 id="preguntas" className="mb-3 font-heading text-lg font-semibold">
          Preguntas frecuentes
        </h2>
        <dl className="space-y-4 text-sm leading-relaxed">
          <div>
            <dt className="font-medium text-fg">¿Dónde veo el historial de un producto?</dt>
            <dd className="mt-1 text-muted">
              En su ficha en ComparaTech, en la sección &quot;Historial de precios&quot;: un gráfico de los últimos 90
              días, el promedio de 30 días, el más alto y el más bajo registrados, y los últimos cambios.
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
            <dt className="font-medium text-fg">¿Puedo ver el historial de cualquier producto de Mercado Libre?</dt>
            <dd className="mt-1 text-muted">
              Solo de los que seguimos. Si buscas uno y no aparece, todavía no está en nuestro catálogo.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
