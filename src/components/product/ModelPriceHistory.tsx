import Link from 'next/link';
import { PriceChart } from '@/components/product/PriceHistory';
import { BUSY_CHANGES_48H, heldLabel, summarizeHistory, vsAverage, type PriceHistorySummary } from '@/lib/price-chart';
import { effectiveHistory, lowestSeries, sourceAt, type VersionHistory } from '@/lib/model-history';
import { versionLabel, type ModelDef } from '@/lib/models';
import { formatCLP, formatDayMonth } from '@/lib/format';
import type { PricePoint } from '@/lib/deals';
import type { Product } from '@/lib/types';

const day = (t: number) => formatDayMonth(new Date(t).toISOString());

/** "de los últimos 30 días", o desde el primer registro si hay menos. */
function averageWhen(summary: PriceHistorySummary): string {
  return summary.averageFrom <= summary.trackedSince ? `desde el ${day(summary.trackedSince)}` : 'de los últimos 30 días';
}

interface Row {
  product: Product;
  label: string;
  /** El historial de esa versión, solo; null si no hay o no se pudo leer. */
  summary: PriceHistorySummary | null;
  /** No se pudo leer su historial (no es lo mismo que no tenerlo). */
  unread: boolean;
}

/**
 * "Historial de precios" de una página de modelo: el gráfico del precio más
 * bajo entre sus versiones (lib/model-history), con el mismo dibujo que la
 * ficha (PriceChart), y una tabla con el precio de hoy y el más bajo que se
 * registró de cada versión. Solo hechos: no dice si conviene comprar.
 *
 * Componente de servidor, sin JavaScript en el navegador.
 */
export function ModelPriceHistory({
  model,
  versions,
  histories,
  now,
}: {
  model: ModelDef;
  /** A la venta primero, después las que hoy no tienen vendedor. */
  versions: Product[];
  histories: Map<string, PricePoint[] | null>;
  now: number;
}) {
  const inputs: VersionHistory[] = versions.map((p) => ({
    id: p.id,
    history: histories.get(p.id) ?? null,
    price: p.price,
    createdAt: p.created_at,
    checkedAt: p.price_checked_at,
    onSale: p.is_active,
    soldOutSince: p.inactive_since,
  }));
  const series = lowestSeries(inputs, now);
  const summary = series ? summarizeHistory(series.points, now) : null;

  const rows: Row[] = versions.map((product, i) => {
    const history = effectiveHistory(inputs[i]);
    const soldOutAt = product.inactive_since ? Date.parse(product.inactive_since) : NaN;
    const end = product.is_active || !Number.isFinite(soldOutAt) ? now : Math.min(soldOutAt, now);
    return {
      product,
      label: versionLabel(model, product),
      summary: history && history.length > 0 ? summarizeHistory(history, end) : null,
      unread: history === null,
    };
  });
  if (!summary && rows.every((r) => !r.summary)) return null;

  const onSalePrices = versions.filter((p) => p.is_active).map((p) => p.price);
  const today = onSalePrices.length > 0 ? Math.min(...onSalePrices) : null;
  const labelOf = (id: string | null) => rows.find((r) => r.product.id === id)?.label ?? null;

  return (
    <section aria-labelledby="historial-de-precios" className="mt-12 max-w-4xl">
      <h2 id="historial-de-precios" className="mb-2 scroll-mt-24 font-heading text-lg font-semibold">
        Historial de precios
      </h2>

      {summary && series && today !== null && (
        <>
          <p className="text-sm leading-relaxed text-muted">
            {summary.recent.length === 1
              ? `El precio más bajo entre las versiones de ${model.name} a la venta no ha cambiado desde el ${day(
                  summary.trackedSince,
                )}, cuando empezamos a seguirlo.`
              : `El gráfico muestra el precio más bajo entre las versiones de ${model.name} a la venta en cada momento, desde el ${day(
                  summary.trackedSince,
                )}. Lo anotamos cada vez que lo vemos cambiar.`}
          </p>
          <PriceChart summary={summary} price={today} soldOut={false} />
          {summary.recent.length > 1 && (
            <Numbers summary={summary} today={today} minLabel={labelOf(sourceAt(series, summary.minAt))} />
          )}
          {summary.changes48h >= BUSY_CHANGES_48H && (
            <p className="mt-3 text-xs text-muted">
              El precio más bajo cambió {summary.changes48h} veces en las últimas 48 horas. Revisa el de Mercado Libre
              antes de comprar.
            </p>
          )}
        </>
      )}

      <VersionTable rows={rows} />

      <p className="mt-3 text-xs text-muted">
        <Link href="/como-funciona#historial" className="hover:text-accent hover:underline">
          Cómo armamos este historial
        </Link>
      </p>
    </section>
  );
}

function Numbers({ summary, today, minLabel }: { summary: PriceHistorySummary; today: number; minLabel: string | null }) {
  const diff = vsAverage(today, summary.average);
  // Si el más bajo es el de hoy, no terminó: "por unas 3 horas" haría creer que ya pasó.
  const ongoing = summary.stretches[summary.stretches.length - 1]?.price === summary.min;
  const held = ongoing ? null : heldLabel(summary.minHeldMs);
  const when = ongoing ? `Sigue hoy, desde el ${day(summary.minAt)}` : `El ${day(summary.minAt)}${held ? `, ${held}` : ''}`;
  const items = [
    {
      term: 'Hoy, desde',
      value: formatCLP(today),
      note: diff === 0 ? 'Igual al promedio' : `${Math.abs(diff)}% ${diff < 0 ? 'bajo' : 'sobre'} el promedio`,
    },
    { term: `Promedio ${averageWhen(summary)}`, value: formatCLP(summary.average) },
    {
      term: 'Más bajo registrado',
      value: formatCLP(summary.min),
      note: `${when}${minLabel ? ` (${minLabel})` : ''}`,
    },
  ];

  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <div key={item.term} className="rounded-xl border border-border bg-surface p-3">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{item.term}</dt>
          <dd className="mt-1 font-heading text-base font-semibold text-fg">{item.value}</dd>
          {item.note && <dd className="mt-0.5 text-xs text-muted">{item.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** El precio de cada versión y el más bajo que le registramos, con el link a su ficha. */
function VersionTable({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-sm">
        <caption className="mb-2 text-left text-xs text-muted">Cada versión, con el precio más bajo que le registramos.</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              Versión
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Hoy
            </th>
            <th scope="col" className="py-2 font-medium">
              Más bajo registrado
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ product, label, summary, unread }) => (
            <tr key={product.id} className="border-t border-border align-top">
              <th scope="row" className="py-2 pr-3 font-normal">
                <Link href={`/producto/${product.slug}`} prefetch={false} className="text-fg hover:text-accent hover:underline">
                  {label}
                </Link>
              </th>
              <td className="py-2 pr-3">
                {product.is_active ? (
                  <span className="font-medium text-fg">{formatCLP(product.price)}</span>
                ) : (
                  <span className="text-muted">Sin vendedor hoy (último {formatCLP(product.price)})</span>
                )}
              </td>
              <td className="py-2 text-muted">
                {summary ? (
                  <>
                    <span className="font-medium text-fg">{formatCLP(summary.min)}</span>{' '}
                    <span className="block text-xs">el {day(summary.minAt)}</span>
                  </>
                ) : unread ? (
                  '—'
                ) : (
                  // Salió de venta antes de que empezáramos a anotar su precio.
                  'Sin registro'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
