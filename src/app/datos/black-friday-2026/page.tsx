import Link from 'next/link';
import type { Metadata } from 'next';
import { CalendarDays } from 'lucide-react';
import { getThermometer } from '@/lib/queries/black-friday-thermometer';
import { getCatalogProducts } from '@/lib/queries/products';
import { BLACK_FRIDAY, daysUntilBlackFriday } from '@/lib/black-friday';
import {
  BASELINE_WINDOWS,
  CHANGE_PCT,
  EVENT_WINDOWS,
  MIN_CATEGORY_MEASURED,
  MIN_REF_DAYS,
  THERMOMETER_PATH,
  asOfLabel,
  averageChange,
  perHundred,
  rangeLabel,
  shareLabel,
  thermometerPhase,
  type OutcomeItem,
  type PreLiveSummary,
  type ThermometerSummary,
  type WindowSummary,
} from '@/lib/black-friday-thermometer';
import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';
import { CONTACT_EMAIL } from '@/lib/contact';
import { getCategoryInfo } from '@/lib/categories';
import { formatCLP } from '@/lib/format';
import { shortProductName } from '@/lib/text';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';

const { year } = BLACK_FRIDAY;
const TITLE = `Black Friday ${year}: ¿bajaron de verdad los precios?`;
const DESCRIPTION = `Termómetro del Black Friday ${year} en Chile: con nuestro historial de precios de Mercado Libre medimos qué bajó de verdad, qué subió antes y cuánto bajaron las ofertas.`;

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: THERMOMETER_PATH },
  openGraph: { type: 'website', siteName: 'ComparaTech', locale: 'es_CL', url: THERMOMETER_PATH, title: TITLE, description: DESCRIPTION },
};

// El resumen se rehace como mucho cada hora (lib/queries/black-friday-thermometer).
export const revalidate = 3600;

const EVENT_LABEL = rangeLabel(EVENT_WINDOWS.eventStart, EVENT_WINDOWS.eventEnd, true);
const REF_LABEL = rangeLabel(EVENT_WINDOWS.refStart, EVENT_WINDOWS.refEnd);
const PRE_LABEL = rangeLabel(EVENT_WINDOWS.refEnd, EVENT_WINDOWS.eventStart);

/**
 * El termómetro del Black Friday 2026 (SEO etapa 3): qué bajó de verdad
 * según el historial propio. El método y las cuentas están en
 * lib/black-friday-thermometer; acá solo se dicen.
 *
 * Cambia sola con la fecha: antes explica cómo se va a medir y muestra la
 * prueba con un fin de semana normal (y, desde el 22 de noviembre, lo que ya
 * subió); el viernes 27 a las 8:00 sale el dato preliminar y el martes 1 de
 * diciembre, el balance.
 *
 * Solo hechos del historial: nada de "mejor precio" ni de si conviene
 * comprar. El "% de descuento" lo informa el vendedor y se presenta como lo
 * que es. Si cambia el método, se cambian juntos el módulo, esta página y el
 * kit de prensa.
 */
export default async function TermometroBlackFridayPage() {
  const now = Date.now();
  const [summary, catalog] = await Promise.all([getThermometer(now), getCatalogProducts()]);
  const phase = summary?.phase ?? thermometerPhase(now);
  const tracked = catalog.length.toLocaleString('es-CL');
  const event = summary?.event ?? null;
  const baseline = summary?.baseline ?? null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <Breadcrumbs
        items={[
          { name: 'Inicio', href: '/' },
          { name: 'Black Friday', href: '/black-friday' },
          { name: `Termómetro ${year}` },
        ]}
      />

      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
        <CalendarDays size={13} aria-hidden /> <Badge phase={phase} summary={summary} now={now} />
      </span>
      <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Termómetro del Black Friday {year}</h1>

      {phase === 'antes' ? (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Vamos a medir con nuestro historial de precios qué bajó de verdad en el Black Friday {year} en Mercado Libre:
          cuántos productos quedaron bajo el precio que tenían las semanas anteriores, cuáles subieron antes del evento y
          cuánto bajaron de verdad las ofertas. El primer dato sale el viernes 27 de noviembre en la mañana y el balance, el
          martes 1 de diciembre.
          {now >= EVENT_WINDOWS.eventStart && ' El Black Friday ya empezó: el primer dato sale hoy a las 8:00.'}
        </p>
      ) : event ? (
        <EventLead phase={phase} event={event} baseline={baseline} asOf={summary!.asOf} />
      ) : (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Estamos actualizando el dato. Vuelve a mirar en unos minutos.
        </p>
      )}

      {event && <EventResults event={event} baseline={baseline} phase={phase} />}

      {phase === 'antes' && summary?.preLive && <PreLive preLive={summary.preLive} baseline={baseline} />}

      {phase === 'antes' && baseline && <BaselinePreview baseline={baseline} />}

      <section aria-labelledby="metodo" className="mt-10">
        <h2 id="metodo" className="mb-3 scroll-mt-24 font-heading text-lg font-semibold">
          Cómo lo medimos
        </h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Seguimos el precio de {tracked} productos de tecnología y hogar en Mercado Libre Chile: el que muestra primero la
            ficha de cada uno, revisado varias veces al día. Cada cambio queda anotado.
          </li>
          <li>
            <strong className="font-medium text-fg">Precio habitual:</strong> el que más tiempo rigió {REF_LABEL}. La semana{' '}
            {PRE_LABEL} queda fuera, porque ahí un precio puede subir para que el del evento parezca una baja.
          </li>
          <li>
            <strong className="font-medium text-fg">Precio del Black Friday:</strong> el más bajo que se mantuvo al menos 6
            horas {EVENT_LABEL}. Un precio que duró menos no cuenta.
          </li>
          <li>
            <strong className="font-medium text-fg">Bajó de verdad:</strong> quedó {CHANGE_PCT}% o más bajo su precio
            habitual. No cuenta si en esas semanas ya había estado a ese precio (o menos) un cuarto del tiempo o más: es un
            precio que va y vuelve, como cuando dos vendedores se turnan la ficha.
          </li>
          <li>
            <strong className="font-medium text-fg">Subió antes:</strong> {PRE_LABEL} estuvo al menos un día {CHANGE_PCT}% o
            más sobre su precio habitual.
          </li>
          <li>
            <strong className="font-medium text-fg">Descuento mostrado:</strong> el porcentaje que muestra la publicación, que
            calcula el vendedor sobre un precio que él mismo informa. Contamos como oferta lo que muestra {MIN_DEAL_DISCOUNT}% o
            más.
          </li>
          <li>
            Cada producto cuenta una vez, aunque tenga varios colores. Entran los que tienen al menos {MIN_REF_DAYS} días de
            precio en las semanas de referencia y estuvieron a la venta en el evento.
          </li>
          <li>
            Para comparar, medimos lo mismo en un fin de semana sin evento:{' '}
            {rangeLabel(BASELINE_WINDOWS.eventStart, BASELINE_WINDOWS.eventEnd, true)}, con su propio precio habitual (
            {rangeLabel(BASELINE_WINDOWS.refStart, BASELINE_WINDOWS.refEnd)}).
          </li>
        </ol>
      </section>

      <section aria-labelledby="usar" className="mt-10 max-w-3xl">
        <h2 id="usar" className="mb-2 font-heading text-lg font-semibold">
          Usar estos datos
        </h2>
        <p className="text-sm leading-relaxed text-muted">
          Puedes citar estas cifras mencionando a ComparaTech, con un link a esta página. ¿Eres periodista y necesitas más
          detalle? Escríbenos a{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>

      <p className="mt-8 max-w-3xl text-xs leading-relaxed text-muted">
        Los precios son los que muestra Mercado Libre y pueden cambiar en cualquier momento. Solo seguimos vendedores con
        reputación verde. Las ofertas de hoy, con su historial, están en{' '}
        <Link href="/black-friday" className="text-accent hover:underline">
          Black Friday {year}
        </Link>
        , y qué significa cada etiqueta, en{' '}
        <Link href="/como-funciona" className="text-accent hover:underline">
          Cómo funciona
        </Link>
        .
      </p>
    </div>
  );
}

function Badge({ phase, summary, now }: { phase: string; summary: ThermometerSummary | null; now: number }) {
  const when = `${BLACK_FRIDAY.label.replace(/^del /, 'Del ')} de ${year}`;
  if (phase === 'balance') return <>Balance · {when}</>;
  if (phase === 'preliminar') return <>Dato preliminar{summary ? ` · precios hasta ${asOfLabel(summary.asOf)}` : ''}</>;
  if (now >= EVENT_WINDOWS.eventStart) return <>{when} · primer dato a las 8:00</>;
  const days = daysUntilBlackFriday(now);
  return (
    <>
      {when} · {days === 1 ? 'falta 1 día' : `faltan ${days} días`}
    </>
  );
}

function EventLead({
  phase,
  event,
  baseline,
  asOf,
}: {
  phase: string;
  event: WindowSummary;
  baseline: WindowSummary | null;
  asOf: number;
}) {
  const share = shareLabel(event.dropped, event.measured);
  const normal = baseline ? ` En un fin de semana sin evento fue ${shareLabel(baseline.dropped, baseline.measured)}.` : '';
  return phase === 'preliminar' ? (
    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
      El Black Friday {year} va en curso. Con los precios hasta {asOfLabel(asOf)}: de{' '}
      {event.measured.toLocaleString('es-CL')} productos que seguimos en Mercado Libre, {share} bajó de verdad ({CHANGE_PCT}%
      o más bajo su precio de las semanas anteriores).{normal} El dato cambia mientras dure el evento; el balance sale el
      martes 1 de diciembre.
    </p>
  ) : (
    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
      Balance del Black Friday {year} en Mercado Libre, {EVENT_LABEL}: de {event.measured.toLocaleString('es-CL')} productos
      de tecnología y hogar que seguimos, {share} bajó de verdad ({CHANGE_PCT}% o más bajo su precio de las semanas
      anteriores).{normal}
    </p>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-heading text-3xl font-semibold text-fg">{value}</p>
      {note && <p className="mt-1 text-xs leading-relaxed text-muted">{note}</p>}
    </div>
  );
}

function changeWords(avg: number | null, subject: 'bajaron' | 'bajó'): string {
  if (avg === null) return '';
  const { direction, pct } = averageChange(avg);
  if (direction === 'igual') return subject === 'bajaron' ? 'quedaron igual en promedio' : 'quedó igual en promedio';
  if (direction === 'bajo') return `${subject} en promedio ${pct}%`;
  return `${subject === 'bajaron' ? 'subieron' : 'subió'} en promedio ${pct}%`;
}

function EventResults({ event, baseline, phase }: { event: WindowSummary; baseline: WindowSummary | null; phase: string }) {
  const [dropped, flat, pricier] = perHundred([event.dropped, event.flat, event.pricier]);
  const normal = (value: string) => (baseline ? `fin de semana sin evento: ${value}` : undefined);
  const offersReal = event.offersRealAvg !== null ? averageChange(event.offersRealAvg) : null;

  return (
    <>
      <section aria-labelledby="resultado" className="mt-8">
        <h2 id="resultado" className="sr-only">
          Resultado
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile
            label="Bajó de verdad"
            value={shareLabel(event.dropped, event.measured)}
            note={[
              `${event.dropped.toLocaleString('es-CL')} de ${event.measured.toLocaleString('es-CL')} productos`,
              baseline && normal(shareLabel(baseline.dropped, baseline.measured)),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          <Tile
            label="Subió la semana antes"
            value={shareLabel(event.roseBefore, event.measured)}
            note={[
              `${PRE_LABEL.replace(/^del /, 'Del ')}; ${event.roseThenDropped.toLocaleString('es-CL')} de ellos "bajaron" en el evento sin quedar bajo su precio habitual`,
              baseline && normal(shareLabel(baseline.roseBefore, baseline.measured)),
            ]
              .filter(Boolean)
              .join(' · ')}
          />
          {event.offers > 0 && event.offersAnnouncedAvg !== null && offersReal && (
            <Tile
              label={
                offersReal.direction === 'bajo'
                  ? 'Las ofertas bajaron en promedio'
                  : offersReal.direction === 'subio'
                    ? 'Las ofertas subieron en promedio'
                    : 'Las ofertas, en promedio'
              }
              value={offersReal.direction === 'igual' ? 'igual' : `${offersReal.pct}%`}
              note={`contra su precio habitual, aunque mostraban en promedio ${Math.round(event.offersAnnouncedAvg)}% de descuento (${event.offers.toLocaleString('es-CL')} ofertas de ${MIN_DEAL_DISCOUNT}% o más)`}
            />
          )}
        </div>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted">
          De cada 100 productos, {dropped} {dropped === 1 ? 'bajó' : 'bajaron'} de verdad, {flat} {flat === 1 ? 'quedó' : 'quedaron'}{' '}
          igual y {pricier} {pricier === 1 ? 'estuvo' : 'estuvieron'} más caros que su precio habitual durante todo el
          evento.
          {baseline && baseline.offersRealAvg !== null && baseline.offersAnnouncedAvg !== null && (
            <>
              {' '}
              En el fin de semana sin evento, las ofertas mostraban en promedio {Math.round(baseline.offersAnnouncedAvg)}% de
              descuento y, contra su precio habitual, {changeWords(baseline.offersRealAvg, 'bajaron')}.
            </>
          )}
        </p>
      </section>

      {event.byCategory.length > 0 && <CategoryTable event={event} />}

      {event.topDrops.length > 0 && (
        <ItemSection
          id="bajas"
          title="Las bajas más grandes"
          intro={`Productos de ${formatCLP(10_000)} o más que bajaron de verdad${phase === 'preliminar' ? ' hasta ahora' : ''}, de mayor a menor baja.`}
          items={event.topDrops}
          render={(i) => (
            <>
              precio habitual {formatCLP(i.habitual)} → {formatCLP(i.eventPrice)} en el Black Friday (
              {Math.round(i.realPct)}% menos)
              {i.announcedPct > 0 && <>; la publicación mostraba {i.announcedPct}% de descuento</>}
            </>
          )}
        />
      )}

      {event.roseThenDroppedItems.length > 0 && (
        <ItemSection
          id="subieron-antes"
          title={<>Subieron antes y en el Black Friday &quot;bajaron&quot;</>}
          intro="Para quien miró el precio esa semana parecía una baja; contra su precio habitual, no lo fue."
          items={event.roseThenDroppedItems}
          render={(i) => (
            <>
              precio habitual {formatCLP(i.habitual)} · {PRE_LABEL} subió a {formatCLP(i.prePrice ?? i.habitual)} · en el
              Black Friday {formatCLP(i.eventPrice)}
            </>
          )}
        />
      )}
    </>
  );
}

function CategoryTable({ event }: { event: WindowSummary }) {
  return (
    <section aria-labelledby="categorias" className="mt-10">
      <h2 id="categorias" className="font-heading text-lg font-semibold">
        Por categoría
      </h2>
      <p className="mb-3 mt-1 max-w-3xl text-sm text-muted">
        Categorías con {MIN_CATEGORY_MEASURED} o más productos medidos. En sus ofertas, el descuento que mostraban y cuánto
        cambió de verdad el precio, en promedio.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th scope="col" rowSpan={2} className="px-2 py-2 align-bottom font-medium sm:px-3">
                Categoría
              </th>
              {/* En el teléfono no cabe: el conteo está en el texto de arriba. */}
              <th scope="col" rowSpan={2} className="hidden px-3 py-2 text-right align-bottom font-medium sm:table-cell">
                Medidos
              </th>
              <th scope="col" rowSpan={2} className="px-2 py-2 text-right align-bottom font-medium sm:px-3">
                Bajó de verdad
              </th>
              <th scope="colgroup" colSpan={2} className="px-2 pt-2 text-center font-medium sm:px-3">
                Sus ofertas
              </th>
            </tr>
            <tr>
              <th scope="col" className="px-2 pb-2 text-right font-medium sm:px-3">
                Descuento mostrado
              </th>
              <th scope="col" className="px-2 pb-2 text-right font-medium sm:px-3">
                Cambio real
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {event.byCategory.map((c) => {
              const real = c.offersRealAvg !== null ? averageChange(c.offersRealAvg) : null;
              return (
                <tr key={c.slug} className="border-t border-border">
                  <th scope="row" className="px-2 py-2 font-medium text-fg sm:px-3">
                    {c.name}
                  </th>
                  <td className="hidden px-3 py-2 text-right text-muted sm:table-cell">{c.measured.toLocaleString('es-CL')}</td>
                  <td className="px-2 py-2 text-right text-fg sm:px-3">{shareLabel(c.dropped, c.measured)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-muted sm:px-3">
                    {c.offersAnnouncedAvg !== null ? `${Math.round(c.offersAnnouncedAvg)}%` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right text-muted sm:px-3">
                    {real === null ? '—' : real.direction === 'igual' ? 'igual' : `${real.direction === 'bajo' ? 'bajó' : 'subió'} ${real.pct}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ItemSection({
  id,
  title,
  intro,
  items,
  render,
}: {
  id: string;
  title: React.ReactNode;
  intro: string;
  items: OutcomeItem[];
  render: (item: OutcomeItem) => React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-heading text-lg font-semibold">
        {title}
      </h2>
      <p className="mb-3 mt-1 max-w-3xl text-sm text-muted">{intro}</p>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.slug} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
            <Link href={`/producto/${i.slug}`} prefetch={false} className="font-medium text-fg hover:text-accent">
              {shortProductName(i.name)}
            </Link>
            <span className="text-xs text-muted"> · {getCategoryInfo(i.category)?.name ?? i.category}</span>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{render(i)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PreLive({ preLive, baseline }: { preLive: PreLiveSummary; baseline: WindowSummary | null }) {
  return (
    <section aria-labelledby="semana-antes" className="mt-10">
      <h2 id="semana-antes" className="font-heading text-lg font-semibold">
        La semana antes
      </h2>
      <p className="mb-3 mt-1 max-w-3xl text-sm leading-relaxed text-muted">
        Desde el sábado 21 de noviembre, {shareLabel(preLive.roseBefore, preLive.measured)} de los productos (
        {preLive.roseBefore.toLocaleString('es-CL')} de {preLive.measured.toLocaleString('es-CL')}) ya estuvo al menos un día{' '}
        {CHANGE_PCT}% o más sobre su precio habitual.
        {baseline && (
          <>
            {' '}
            En la semana antes del fin de semana sin evento fue {shareLabel(baseline.roseBefore, baseline.measured)}.
          </>
        )}
      </p>
      {preLive.items.length > 0 && (
        <ul className="space-y-2">
          {preLive.items.map((i) => (
            <li key={i.slug} className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
              <Link href={`/producto/${i.slug}`} prefetch={false} className="font-medium text-fg hover:text-accent">
                {shortProductName(i.name)}
              </Link>
              <span className="text-xs text-muted"> · {getCategoryInfo(i.category)?.name ?? i.category}</span>
              <p className="mt-0.5 text-xs text-muted">
                precio habitual {formatCLP(i.habitual)} → estuvo en {formatCLP(i.prePrice)} (
                {Math.round(((i.prePrice - i.habitual) / i.habitual) * 100)}% más)
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BaselinePreview({ baseline }: { baseline: WindowSummary }) {
  const [dropped, flat, pricier] = perHundred([baseline.dropped, baseline.flat, baseline.pricier]);
  const official = baseline.windows.eventStart === BASELINE_WINDOWS.eventStart;
  const label = rangeLabel(baseline.windows.eventStart, baseline.windows.eventEnd, true);
  return (
    <section aria-labelledby="normal" className="mt-10">
      <h2 id="normal" className="font-heading text-lg font-semibold">
        Así se ve un fin de semana sin evento
      </h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
        Probamos la regla con el fin de semana {label}: de {baseline.measured.toLocaleString('es-CL')} productos, {dropped} de
        cada 100 {dropped === 1 ? 'bajó' : 'bajaron'} de verdad, {flat} {flat === 1 ? 'quedó' : 'quedaron'} igual y {pricier}{' '}
        {pricier === 1 ? 'estuvo' : 'estuvieron'} más caros que su precio habitual.
        {baseline.offersAnnouncedAvg !== null && baseline.offersRealAvg !== null && (
          <>
            {' '}
            Las ofertas mostraban en promedio {Math.round(baseline.offersAnnouncedAvg)}% de descuento; contra su precio
            habitual, {changeWords(baseline.offersRealAvg, 'bajaron')}.
          </>
        )}{' '}
        {official
          ? 'Con este fin de semana vamos a comparar el Black Friday.'
          : 'Cada semana se actualiza con el último fin de semana, hasta el del 13 al 16 de noviembre, que es con el que vamos a comparar el Black Friday.'}
      </p>
    </section>
  );
}
