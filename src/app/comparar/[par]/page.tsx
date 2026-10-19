import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getModelHistories, getModelVersions } from '@/lib/queries/models';
import { getCategoryInfo } from '@/lib/queries/categories';
import {
  COMPARISONS,
  comparisonPath,
  comparisonSlug,
  comparisonTitle,
  getComparison,
  priceGapText,
  shortModelName,
  specRows,
} from '@/lib/comparisons';
import { modelPath, versionCapacity, type ModelDef } from '@/lib/models';
import { lowestSeries } from '@/lib/model-history';
import { summarizeHistory, type PriceHistorySummary } from '@/lib/price-chart';
import { formatCLP, formatDayMonth } from '@/lib/format';
import { truncateAtWord } from '@/lib/text';
import { dropsById } from '@/lib/deal-rank';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { ProductGrid } from '@/components/product/ProductGrid';
import { PriceChart } from '@/components/product/PriceHistory';
import type { Product } from '@/lib/types';
import type { PricePoint } from '@/lib/deals';

/**
 * Una comparación "X vs Y" entre dos modelos con página (ver lib/comparisons):
 * el precio de hoy de cada uno, el más bajo que registramos, cómo se movió y
 * las diferencias de la ficha técnica de Mercado Libre. No dice cuál conviene.
 */

type Params = Promise<{ par: string }>;

/** Son pocas (la lista de lib/comparisons): se arman todas en el despliegue. */
export function generateStaticParams() {
  return COMPARISONS.map((c) => ({ par: comparisonSlug(c) }));
}

/** Una comparación que no está en la lista no tiene página. */
export const dynamicParams = false;

// Como las páginas de modelo: los precios se revisan cada 30 minutos.
export const revalidate = 300;

const day = (t: number) => formatDayMonth(new Date(t).toISOString());

async function load(par: string) {
  const found = getComparison(par);
  if (!found) return null;
  const [va, vb] = await Promise.all([getModelVersions(found.a.slug), getModelVersions(found.b.slug)]);
  if (!va || !vb) return null;
  return { ...found, va, vb };
}

/** Desde cuánto está hoy un modelo (su versión a la venta de menor precio). */
const fromPrice = (onSale: Product[]) => (onSale.length > 0 ? Math.min(...onSale.map((p) => p.price)) : null);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { par } = await params;
  const data = await load(par);
  if (!data) return {};
  const { comparison, a, b, va, vb } = data;
  const fromA = fromPrice(va.onSale);
  const fromB = fromPrice(vb.onSale);
  const title = comparisonTitle(a, b);
  const prices = fromA !== null && fromB !== null ? `: desde ${formatCLP(fromA)} y ${formatCLP(fromB)} hoy en Mercado Libre` : '';
  const description = truncateAtWord(
    `${shortModelName(a)} vs ${shortModelName(b)} en Chile${prices}. El precio más bajo que registramos y las diferencias de su ficha técnica.`,
    155,
  );
  const url = comparisonPath(comparison);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', siteName: 'ComparaTech', locale: 'es_CL', url, title, description },
  };
}

/** El historial del precio más bajo entre las versiones de un modelo (lib/model-history). */
function lowestOf(versions: Product[], histories: Map<string, PricePoint[] | null>, now: number): PriceHistorySummary | null {
  const series = lowestSeries(
    versions.map((p) => ({
      id: p.id,
      history: histories.get(p.id) ?? null,
      price: p.price,
      createdAt: p.created_at,
      checkedAt: p.price_checked_at,
      onSale: p.is_active,
      soldOutSince: p.inactive_since,
    })),
    now,
  );
  return series ? summarizeHistory(series.points, now) : null;
}

/** Las capacidades a la venta de un modelo: "256 GB, 512 GB y 2 TB". */
function capacities(onSale: Product[]): string | null {
  const list = [...new Set(onSale.map((p) => versionCapacity(p.specs)).filter((c): c is string => Boolean(c)))];
  const gb = (c: string) => parseFloat(c) * (/tb/i.test(c) ? 1024 : 1);
  list.sort((x, y) => gb(x) - gb(y));
  if (list.length === 0) return null;
  return list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} y ${list[list.length - 1]}`;
}

export default async function CompararPage({ params }: { params: Params }) {
  const { par } = await params;
  const data = await load(par);
  if (!data) notFound();
  const { a, b, va, vb } = data;
  const versionsA = [...va.onSale, ...va.paused];
  const versionsB = [...vb.onSale, ...vb.paused];
  if (versionsA.length + versionsB.length === 0) notFound();

  const now = Date.now();
  const [ha, hb] = await Promise.all([getModelHistories(versionsA), getModelHistories(versionsB)]);
  const fromA = fromPrice(va.onSale);
  const fromB = fromPrice(vb.onSale);
  const lowA = lowestOf(versionsA, ha.histories, now);
  const lowB = lowestOf(versionsB, hb.histories, now);
  const nameA = shortModelName(a);
  const nameB = shortModelName(b);

  // Una tarjeta por modelo: su versión a la venta de menor precio.
  const cards = [va.onSale[0], vb.onSale[0]].filter((p): p is Product => Boolean(p));
  const drops = dropsById(cards, new Map([...ha.stats, ...hb.stats]), now);

  const category = (versionsA[0] ?? versionsB[0]).category;
  const categoryName = getCategoryInfo(category)?.name ?? category;

  const rows: { label: string; a: string | null; b: string | null }[] = [
    { label: 'Precio hoy, desde', a: fromA !== null ? formatCLP(fromA) : 'Sin vendedor hoy', b: fromB !== null ? formatCLP(fromB) : 'Sin vendedor hoy' },
    {
      label: 'Más bajo registrado',
      a: lowA ? `${formatCLP(lowA.min)} (el ${day(lowA.minAt)})` : null,
      b: lowB ? `${formatCLP(lowB.min)} (el ${day(lowB.minAt)})` : null,
    },
    { label: 'Capacidades a la venta', a: capacities(va.onSale), b: capacities(vb.onSale) },
    ...specRows(a, b),
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Breadcrumbs
        items={[
          { name: 'Inicio', href: '/' },
          { name: categoryName, href: `/categoria/${category}` },
          { name: `${nameA} vs ${nameB}` },
        ]}
      />
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">
        {nameA} vs {nameB}
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
        {priceGapText(a, b, fromA, fromB)} Revisamos los precios varias veces al día.
      </p>

      {cards.length > 0 && (
        <section aria-labelledby="precio-hoy" className="mt-8">
          <h2 id="precio-hoy" className="mb-4 font-heading text-lg font-semibold">
            Precio de hoy
          </h2>
          <div className="max-w-xl">
            <ProductGrid products={cards} placement="comparador" drops={drops} eagerImages={2} />
          </div>
        </section>
      )}

      <section aria-labelledby="diferencias" className="mt-10">
        <h2 id="diferencias" className="mb-1 font-heading text-lg font-semibold">
          Diferencias
        </h2>
        <p className="mb-4 text-xs text-muted">
          Los precios son los de Mercado Libre; los datos técnicos, los de la ficha de cada modelo en Mercado Libre.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  <span className="sr-only">Dato</span>
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold text-fg">
                  <Link href={modelPath(a.slug)} className="hover:text-accent hover:underline">
                    {nameA}
                  </Link>
                </th>
                <th scope="col" className="py-2 font-semibold text-fg">
                  <Link href={modelPath(b.slug)} className="hover:text-accent hover:underline">
                    {nameB}
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const differs = row.a !== null && row.b !== null && row.a !== row.b;
                return (
                  <tr key={row.label} className="border-t border-border align-top">
                    <th scope="row" className="py-2 pr-3 text-xs font-medium text-muted">
                      {row.label}
                    </th>
                    <td className={`py-2 pr-3 ${differs ? 'font-semibold text-fg' : 'text-fg'}`}>{row.a ?? <span className="text-muted">Sin dato</span>}</td>
                    <td className={`py-2 ${differs ? 'font-semibold text-fg' : 'text-fg'}`}>{row.b ?? <span className="text-muted">Sin dato</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {(lowA || lowB) && (
        <section aria-labelledby="historial" className="mt-10">
          <h2 id="historial" className="mb-1 font-heading text-lg font-semibold">
            Cómo se movió el precio
          </h2>
          <p className="mb-2 text-sm text-muted">El precio más bajo entre las versiones a la venta de cada uno, desde que lo seguimos.</p>
          <div className="grid gap-6 md:grid-cols-2">
            <ModelChart model={a} name={nameA} summary={lowA} today={fromA} />
            <ModelChart model={b} name={nameB} summary={lowB} today={fromB} />
          </div>
        </section>
      )}

      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted">
        Los precios pueden cambiar en cualquier momento: el que vale es el que ves al comprar en Mercado Libre. Solo
        mostramos vendedores con reputación verde.
      </p>
    </div>
  );
}

function ModelChart({
  model,
  name,
  summary,
  today,
}: {
  model: ModelDef;
  name: string;
  summary: PriceHistorySummary | null;
  today: number | null;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg">
        <Link href={modelPath(model.slug)} className="hover:text-accent hover:underline">
          {name}
        </Link>
      </h3>
      {summary && today !== null ? (
        <PriceChart summary={summary} price={today} soldOut={false} />
      ) : (
        <p className="mt-2 text-sm text-muted">Todavía no hay historial que mostrar.</p>
      )}
      <p className="mt-2 text-xs">
        <Link href={modelPath(model.slug)} className="font-medium text-accent hover:underline">
          Todas las versiones de {name} y su historial
        </Link>
      </p>
    </div>
  );
}
