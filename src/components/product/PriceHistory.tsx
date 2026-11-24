import Link from 'next/link';
import { getPriceHistoryCached } from '@/lib/queries/price-history';
import {
  BUSY_CHANGES_48H,
  chartPaths,
  heldLabel,
  priceStatement,
  referenceStatement,
  summarizeHistory,
  vsAverage,
  type HistoryEnd,
  type PriceHistorySummary,
} from '@/lib/price-chart';
import { formatCLP, formatDayMonth, formatFullDate, formatFullDateTime } from '@/lib/format';
import { priceState } from '@/lib/price-freshness';

/** El lienzo del gráfico; en pantalla se estira al ancho disponible. */
const WIDTH = 600;
const HEIGHT = 160;

/** "04/11": para los ejes del gráfico, donde no cabe más. */
const day = (t: number) => formatDayMonth(new Date(t).toISOString());
/** "04-11-2026": para los textos, que tienen que entenderse sin saber qué día se leen. */
const fullDay = (t: number) => formatFullDate(t);
/** "17-10-2026 21:30", en hora de Chile: la del registro del historial. */
const fullDayTime = (t: number) => {
  const when = formatFullDateTime(t);
  return when ? `${when.date} ${when.time}` : '';
};

/**
 * "Historial de precios" de la ficha: cómo se movió el precio desde que el
 * sitio lo sigue (ver lib/price-chart), con el gráfico, el promedio y los
 * últimos cambios. Todo es lo que anotó el sitio: no se dice si conviene
 * comprar, solo lo que pasó.
 *
 * Fuera de venta, el historial termina cuando dejó de venderse y el precio
 * de la tarjeta es el último que se vio, no el de hoy. Lo mismo si el precio
 * no se revisó hoy (lib/price-freshness): termina en la última revisión, y
 * nada dice "hoy" ni "los últimos 30 días".
 *
 * Componente de servidor, sin JavaScript en el navegador: el gráfico es un
 * SVG y los números son texto, que es lo que lee Google.
 */
export async function PriceHistory({
  productId,
  name,
  price,
  checkedAt,
  soldOutSince,
}: {
  productId: string;
  name: string;
  price: number;
  /** Cuándo se revisó el precio (price_checked_at): con eso se arma la frase del precio de hoy. */
  checkedAt?: string | null;
  /** Desde cuándo está fuera de venta (inactive_since): el historial termina ahí. */
  soldOutSince?: string | null;
}) {
  const now = Date.now();
  const soldOutAt = soldOutSince ? Date.parse(soldOutSince) : NaN;
  const soldOut = Number.isFinite(soldOutAt) && soldOutAt <= now;
  // A la venta, pero con el precio sin revisar hoy: lo que se sabe llega hasta esa revisión.
  const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
  const frozen = !soldOut && priceState(checkedAt, now) !== 'hoy';
  if (frozen && !Number.isFinite(checkedMs)) return null;
  const end: HistoryEnd = soldOut ? 'fuera_de_venta' : frozen ? 'ultima_revision' : 'hoy';
  const history = await getPriceHistoryCached(productId);
  const summary = history ? summarizeHistory(history, soldOut ? soldOutAt : frozen ? checkedMs : now) : null;
  if (!summary) return null;

  // El precio en una frase con fechas completas (lib/price-chart). Fuera de venta no hay.
  const statement =
    end === 'hoy'
      ? priceStatement(price, checkedAt, summary, now)
      : end === 'ultima_revision'
        ? referenceStatement(price, checkedAt, summary)
        : null;
  const since = fullDay(summary.trackedSince);
  const until =
    end === 'fuera_de_venta'
      ? ` hasta el ${fullDay(summary.end)}, cuando dejó de estar a la venta`
      : end === 'ultima_revision'
        ? ` hasta el ${fullDay(summary.end)}, la última vez que lo revisamos`
        : '';
  const neverChanged = summary.recent.length === 1;
  const lead = neverChanged
    ? end === 'hoy'
      ? `El precio de ${name} en Mercado Libre no ha cambiado desde el ${since}, cuando empezamos a seguirlo.`
      : `El precio de ${name} en Mercado Libre no cambió desde el ${since}${until}.`
    : `Así se movió el precio de ${name} en Mercado Libre desde el ${since}${until}. Lo anotamos cada vez que lo ${
        end === 'ultima_revision' ? 'vimos' : 'vemos'
      } cambiar.`;

  return (
    <section aria-labelledby="historial-de-precios" className="mt-10">
      <h2 id="historial-de-precios" className="mb-2 font-heading text-lg font-semibold">
        Historial de precios
      </h2>
      {statement && <p className="mb-2 text-sm leading-relaxed text-fg">{statement}</p>}
      <p className="text-sm leading-relaxed text-muted">{lead}</p>

      <PriceChart summary={summary} price={price} end={end} />
      {!neverChanged && <Numbers summary={summary} price={price} end={end} />}
      {end === 'hoy' && summary.changes48h >= BUSY_CHANGES_48H && (
        <p className="mt-3 text-xs text-muted">
          El precio cambia seguido: {summary.changes48h} veces en las últimas 48 horas. Revisa el de Mercado Libre
          antes de comprar.
        </p>
      )}
      {!neverChanged && <Changes summary={summary} end={end} />}
      <p className="mt-3 text-xs text-muted">
        <Link href="/como-funciona#historial" className="hover:text-accent hover:underline">
          Cómo armamos este historial
        </Link>
      </p>
    </section>
  );
}

/** El gráfico del historial. Lo usa también la página de cada modelo (ModelPriceHistory). */
export function PriceChart({ summary, price, end }: { summary: PriceHistorySummary; price: number; end: HistoryEnd }) {
  const { line, area, averageY } = chartPaths(summary, WIDTH, HEIGHT);
  const flat = summary.min === summary.max;
  const label = flat
    ? `Precio sin cambios ${end === 'hoy' ? 'desde' : 'entre'} el ${day(summary.trackedSince)}${
        end === 'hoy' ? '' : ` y el ${day(summary.end)}`
      }: ${formatCLP(summary.max)}.`
    : `Precio entre ${formatCLP(summary.min)} y ${formatCLP(summary.max)} desde el ${day(summary.start)}; ${
        end === 'hoy' ? 'hoy' : `el ${day(summary.end)},`
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
        <span>{end === 'hoy' ? 'Hoy' : day(summary.end)}</span>
      </div>
      {!flat && (
        <figcaption className="mt-2 text-xs text-muted">
          La línea punteada es el promedio {averageWhen(summary, end)}.
        </figcaption>
      )}
    </figure>
  );
}

/** "de los últimos 30 días", o desde el primer registro si hay menos. */
function averageWhen(summary: PriceHistorySummary, end: HistoryEnd): string {
  if (summary.averageFrom <= summary.trackedSince) return `desde el ${day(summary.trackedSince)}`;
  if (end === 'fuera_de_venta') return 'de sus últimos 30 días a la venta';
  return end === 'ultima_revision' ? `de los 30 días hasta el ${day(summary.end)}` : 'de los últimos 30 días';
}

function Numbers({ summary, price, end }: { summary: PriceHistorySummary; price: number; end: HistoryEnd }) {
  const diff = vsAverage(price, summary.average);
  const held = heldLabel(summary.minHeldMs);
  const vsAverageNote = diff === 0 ? 'Igual al promedio' : `${Math.abs(diff)}% ${diff < 0 ? 'bajo' : 'sobre'} el promedio`;
  const items = [
    end === 'fuera_de_venta'
      ? { term: 'Último precio', value: formatCLP(price), note: 'Hoy no está a la venta' }
      : end === 'ultima_revision'
        ? { term: `El ${day(summary.end)}`, value: formatCLP(price), note: vsAverageNote }
        : { term: 'Hoy', value: formatCLP(price), note: vsAverageNote },
    { term: `Promedio ${averageWhen(summary, end)}`, value: formatCLP(summary.average) },
    {
      term: 'Más bajo registrado',
      value: formatCLP(summary.min),
      note: `El ${fullDay(summary.minAt)}${held ? `, ${held}` : ''}`,
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

function Changes({ summary, end }: { summary: PriceHistorySummary; end: HistoryEnd }) {
  const when =
    summary.averageFrom <= summary.trackedSince
      ? `desde el ${day(summary.trackedSince)}`
      : end === 'fuera_de_venta'
        ? 'en sus últimos 30 días a la venta'
        : end === 'ultima_revision'
          ? `en los 30 días hasta el ${day(summary.end)}`
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
              <td className="py-1.5 pr-3 text-muted">{fullDayTime(row.at)}</td>
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
