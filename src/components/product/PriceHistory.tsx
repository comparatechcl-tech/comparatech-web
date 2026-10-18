import Link from 'next/link';
import { getPriceHistoryCached } from '@/lib/queries/price-history';
import {
  BUSY_CHANGES_48H,
  chartPaths,
  heldLabel,
  summarizeHistory,
  vsAverage,
  type PriceHistorySummary,
} from '@/lib/price-chart';
import { formatCLP, formatDayMonth, formatDayMonthTime } from '@/lib/format';

/** El lienzo del gráfico; en pantalla se estira al ancho disponible. */
const WIDTH = 600;
const HEIGHT = 160;

const day = (t: number) => formatDayMonth(new Date(t).toISOString());

/**
 * "Historial de precios" de la ficha: cómo se movió el precio desde que el
 * sitio lo sigue (ver lib/price-chart), con el gráfico, el promedio y los
 * últimos cambios. Todo es lo que anotó el sitio: no se dice si conviene
 * comprar, solo lo que pasó.
 *
 * Fuera de venta, el historial termina cuando dejó de venderse y el precio
 * de la tarjeta es el último que se vio, no el de hoy.
 *
 * Componente de servidor, sin JavaScript en el navegador: el gráfico es un
 * SVG y los números son texto, que es lo que lee Google.
 */
export async function PriceHistory({
  productId,
  name,
  price,
  soldOutSince,
}: {
  productId: string;
  name: string;
  price: number;
  /** Desde cuándo está fuera de venta (inactive_since): el historial termina ahí. */
  soldOutSince?: string | null;
}) {
  const soldOutAt = soldOutSince ? Date.parse(soldOutSince) : NaN;
  const soldOut = Number.isFinite(soldOutAt) && soldOutAt <= Date.now();
  const history = await getPriceHistoryCached(productId);
  const summary = history ? summarizeHistory(history, soldOut ? soldOutAt : Date.now()) : null;
  if (!summary) return null;

  const since = day(summary.trackedSince);
  const until = soldOut ? ` hasta el ${day(summary.end)}, cuando dejó de estar a la venta` : '';
  const neverChanged = summary.recent.length === 1;
  const lead = neverChanged
    ? soldOut
      ? `El precio de ${name} en Mercado Libre no cambió desde el ${since}${until}.`
      : `El precio de ${name} en Mercado Libre no ha cambiado desde el ${since}, cuando empezamos a seguirlo.`
    : `Así se movió el precio de ${name} en Mercado Libre desde el ${since}${until}. Lo anotamos cada vez que lo vemos cambiar.`;

  return (
    <section aria-labelledby="historial-de-precios" className="mt-10">
      <h2 id="historial-de-precios" className="mb-2 font-heading text-lg font-semibold">
        Historial de precios
      </h2>
      <p className="text-sm leading-relaxed text-muted">{lead}</p>

      <PriceChart summary={summary} price={price} soldOut={soldOut} />
      {!neverChanged && <Numbers summary={summary} price={price} soldOut={soldOut} />}
      {!soldOut && summary.changes48h >= BUSY_CHANGES_48H && (
        <p className="mt-3 text-xs text-muted">
          El precio cambia seguido: {summary.changes48h} veces en las últimas 48 horas. Revisa el de Mercado Libre
          antes de comprar.
        </p>
      )}
      {!neverChanged && <Changes summary={summary} soldOut={soldOut} />}
      <p className="mt-3 text-xs text-muted">
        <Link href="/como-funciona#historial" className="hover:text-accent hover:underline">
          Cómo armamos este historial
        </Link>
      </p>
    </section>
  );
}

/** El gráfico del historial. Lo usa también la página de cada modelo (ModelPriceHistory). */
export function PriceChart({ summary, price, soldOut }: { summary: PriceHistorySummary; price: number; soldOut: boolean }) {
  const { line, area, averageY } = chartPaths(summary, WIDTH, HEIGHT);
  const flat = summary.min === summary.max;
  const label = flat
    ? `Precio sin cambios desde el ${day(summary.trackedSince)}: ${formatCLP(summary.max)}.`
    : `Precio entre ${formatCLP(summary.min)} y ${formatCLP(summary.max)} desde el ${day(summary.start)}; ${
        soldOut ? 'último' : 'hoy'
      } ${formatCLP(price)}.`;

  return (
    <figure className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex gap-3">
        {/* Los montos van en HTML y no dentro del SVG: el SVG se estira y deformaría la letra. */}
        <div
          aria-hidden
          className={`flex w-[4.5rem] shrink-0 flex-col py-[11px] text-right text-[11px] text-muted ${
            flat ? 'justify-center' : 'justify-between'
          }`}
        >
          <span>{formatCLP(summary.max)}</span>
          {!flat && <span>{formatCLP(summary.min)}</span>}
        </div>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={label}
          className="h-40 w-full min-w-0 text-accent"
        >
          <path d={area} fill="currentColor" fillOpacity={0.12} />
          {!flat && (
            <line
              x1={0}
              x2={WIDTH}
              y1={averageY}
              y2={averageY}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              className="text-muted"
            />
          )}
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div aria-hidden className="mt-1 flex justify-between pl-[5.25rem] text-[11px] text-muted">
        <span>{day(summary.start)}</span>
        <span>{soldOut ? day(summary.end) : 'Hoy'}</span>
      </div>
      {!flat && (
        <figcaption className="mt-2 text-xs text-muted">
          La línea punteada es el promedio {averageWhen(summary, soldOut)}.
        </figcaption>
      )}
    </figure>
  );
}

/** "de los últimos 30 días", o desde el primer registro si hay menos. */
function averageWhen(summary: PriceHistorySummary, soldOut: boolean): string {
  if (summary.averageFrom <= summary.trackedSince) return `desde el ${day(summary.trackedSince)}`;
  return soldOut ? 'de sus últimos 30 días a la venta' : 'de los últimos 30 días';
}

function Numbers({ summary, price, soldOut }: { summary: PriceHistorySummary; price: number; soldOut: boolean }) {
  const diff = vsAverage(price, summary.average);
  const held = heldLabel(summary.minHeldMs);
  const items = [
    soldOut
      ? { term: 'Último precio', value: formatCLP(price), note: 'Hoy no está a la venta' }
      : {
          term: 'Hoy',
          value: formatCLP(price),
          note: diff === 0 ? 'Igual al promedio' : `${Math.abs(diff)}% ${diff < 0 ? 'bajo' : 'sobre'} el promedio`,
        },
    { term: `Promedio ${averageWhen(summary, soldOut)}`, value: formatCLP(summary.average) },
    {
      term: 'Más bajo registrado',
      value: formatCLP(summary.min),
      note: `El ${day(summary.minAt)}${held ? `, ${held}` : ''}`,
    },
    { term: 'Más alto registrado', value: formatCLP(summary.max) },
  ];

  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

function Changes({ summary, soldOut }: { summary: PriceHistorySummary; soldOut: boolean }) {
  const when =
    summary.averageFrom <= summary.trackedSince
      ? `desde el ${day(summary.trackedSince)}`
      : soldOut
        ? 'en sus últimos 30 días a la venta'
        : 'en los últimos 30 días';

  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-medium text-accent">
        Ver los últimos cambios de precio ({summary.changes === 1 ? '1 cambio' : `${summary.changes} cambios`} {when})
      </summary>
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-muted">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">Fecha</th>
            <th scope="col" className="py-1.5 pr-3 font-medium">Precio</th>
            <th scope="col" className="py-1.5 font-medium">Cambio</th>
          </tr>
        </thead>
        <tbody>
          {summary.recent.map((row) => (
            <tr key={row.at} className="border-t border-border">
              <td className="py-1.5 pr-3 text-muted">{formatDayMonthTime(new Date(row.at).toISOString())}</td>
              <td className="py-1.5 pr-3 font-medium text-fg">{formatCLP(row.price)}</td>
              <td className={`py-1.5 ${row.diff !== null && row.diff < 0 ? 'text-accent' : 'text-muted'}`}>
                {row.diff === null ? 'Primer registro' : `${row.diff < 0 ? '−' : '+'}${formatCLP(Math.abs(row.diff))}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
