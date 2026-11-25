'use client';

import { useState, useTransition } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { formatCLP, formatDayMonth } from '@/lib/format';
import { markUnavailable, saveManualPrice } from './actions';

/**
 * La lista de "Precios de hoy": una tarjeta por producto, con el link limpio a
 * su ficha, el precio guardado y los dos cuadros (precio y precio tachado).
 * Cada tarjeta guarda por separado: se puede dejar a medias y seguir otro día.
 */

export interface PriceItem {
  id: string;
  name: string;
  brand: string | null;
  image: string;
  price: number;
  /** El precio tachado guardado, de la última revisión (sirve de referencia, no se rellena solo). */
  listPrice: number | null;
  checkedAt: string | null;
  /** El precio ya es de hoy (revisado en las últimas 12 horas). */
  today: boolean;
  /** A la venta en el sitio; false si está en pausa. */
  active: boolean;
  clicks: number;
  /** La ficha en Mercado Libre, sin parámetros de afiliado: mirar no cuenta como clic. */
  mlUrl: string;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'saved'; text: string }
  | { kind: 'gone' }
  | { kind: 'error'; text: string }
  | { kind: 'confirm'; text: string };

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const INPUT =
  'min-h-11 w-full rounded-md border border-border bg-surface2 px-3 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none';

const timeFmt = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });

function PriceCard({ item, onDone }: { item: PriceItem; onDone: () => void }) {
  const [price, setPrice] = useState(String(item.price));
  const [list, setList] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  const done = status.kind === 'saved' || status.kind === 'gone';

  function save(confirmed: boolean) {
    startTransition(async () => {
      try {
        const res = await saveManualPrice(item.id, price, list, confirmed);
        if (res.ok) {
          const parts = [`Guardado como precio de hoy a las ${timeFmt.format(new Date(res.checkedAt))}: ${formatCLP(res.price)}`];
          if (res.listPrice) parts.push(`tachado ${formatCLP(res.listPrice)}`);
          if (res.reactivated) parts.push('volvió al sitio');
          setStatus({ kind: 'saved', text: `${parts.join(', ')}.` });
          onDone();
        } else if ('confirm' in res) {
          setStatus({ kind: 'confirm', text: res.confirm });
        } else {
          setStatus({ kind: 'error', text: res.error });
        }
      } catch {
        setStatus({ kind: 'error', text: 'No se pudo guardar. Revisa la conexión e intenta de nuevo.' });
      }
    });
  }

  function gone() {
    startTransition(async () => {
      try {
        const res = await markUnavailable(item.id);
        if (res.ok) {
          setStatus({ kind: 'gone' });
          onDone();
        } else {
          setStatus({ kind: 'error', text: res.error });
        }
      } catch {
        setStatus({ kind: 'error', text: 'No se pudo guardar. Revisa la conexión e intenta de nuevo.' });
      }
    });
  }

  return (
    <li className={`rounded-xl border border-border bg-surface p-3 sm:p-4 ${done ? 'opacity-70' : ''}`}>
      <div className="flex gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura del admin: no pasa por el optimizador. */}
        <img src={item.image} alt="" className="h-16 w-16 shrink-0 rounded-md bg-white object-contain" loading="lazy" />
        <div className="min-w-0 flex-1">
          {item.brand && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{item.brand}</p>}
          <p className="text-sm font-semibold leading-snug text-fg">{item.name}</p>
          <p className="mt-1 text-xs text-muted">
            Guardado: <strong className="text-fg">{formatCLP(item.price)}</strong>
            {item.checkedAt ? (item.today ? ' · revisado hoy' : ` · del ${formatDayMonth(item.checkedAt)}`) : ' · sin fecha'}
            {' · '}
            {item.clicks} {item.clicks === 1 ? 'clic' : 'clics'} en 30 días
            {!item.active && <span className="text-amber-400"> · en pausa</span>}
          </p>
        </div>
      </div>

      <a
        href={item.mlUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${BUTTON} mt-3 w-full border border-border text-fg hover:border-accent sm:w-auto`}
      >
        <ExternalLink size={15} className="shrink-0" aria-hidden /> Ver en Mercado Libre
      </a>

      {!done && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            Precio de hoy
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${INPUT} mt-1`}
              aria-label={`Precio de hoy de ${item.name}`}
            />
          </label>
          <label className="block text-xs text-muted">
            Precio tachado (solo si la ficha lo muestra)
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={list}
              onChange={(e) => setList(e.target.value)}
              placeholder={item.listPrice ? `Antes mostraba ${formatCLP(item.listPrice)}` : 'Vacío si no hay'}
              className={`${INPUT} mt-1`}
              aria-label={`Precio tachado de ${item.name}`}
            />
          </label>
        </div>
      )}

      {status.kind === 'confirm' && (
        <div role="alert" className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          <p>{status.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => save(true)} className={`${BUTTON} bg-amber-400 text-ink`}>
              Sí, está bien: guardar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setStatus({ kind: 'idle' })}
              className={`${BUTTON} border border-border text-fg`}
            >
              Corregir
            </button>
          </div>
        </div>
      )}
      {status.kind === 'error' && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {status.text}
        </p>
      )}
      {status.kind === 'saved' && (
        <p role="status" className="mt-3 flex items-start gap-1.5 text-sm text-accent">
          <Check size={16} className="mt-0.5 shrink-0" aria-hidden /> {status.text}
        </p>
      )}
      {status.kind === 'gone' && (
        <p role="status" className="mt-3 text-sm text-muted">
          Anotado: ya no se vende. Quedó en pausa en el sitio.
        </p>
      )}

      {!done && status.kind !== 'confirm' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => save(false)}
            className={`${BUTTON} flex-1 bg-accent text-ink hover:bg-accent/90 sm:flex-none`}
          >
            {pending && <Loader2 size={16} className="animate-spin" aria-hidden />}
            Guardar precio de hoy
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={gone}
            className={`${BUTTON} border border-border text-muted hover:text-fg`}
          >
            Ya no se vende
          </button>
        </div>
      )}
    </li>
  );
}

export function PriceList({ items }: { items: PriceItem[] }) {
  const [doneCount, setDoneCount] = useState(0);

  if (items.length === 0) {
    return (
      <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
        No hay productos con clics en los últimos 30 días.
      </p>
    );
  }

  return (
    <>
      {doneCount > 0 && (
        <p role="status" className="mt-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-fg">
          Llevas {doneCount} {doneCount === 1 ? 'producto revisado' : 'productos revisados'} en esta visita.
        </p>
      )}
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <PriceCard key={item.id} item={item} onDone={() => setDoneCount((n) => n + 1)} />
        ))}
      </ul>
    </>
  );
}
