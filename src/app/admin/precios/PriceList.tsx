'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ExternalLink, Loader2, Undo2 } from 'lucide-react';
import { formatCLP, formatDayMonth } from '@/lib/format';
import { markUnavailable, saveManualPrice, undoManualPrice } from './actions';

/**
 * La lista de "Precios de hoy": una tarjeta por producto, con el link limpio a
 * su ficha, el precio guardado y los dos cuadros (precio y precio tachado).
 * Cada tarjeta guarda por separado: se puede dejar a medias y seguir otro día.
 *
 * Se usa desde el teléfono, y ahí un toque de más guarda lo que no se quería:
 * por eso lo guardado se puede deshacer en la misma tarjeta, y después de
 * guardar una los botones de las demás quedan un momento sin responder (la
 * tarjeta se achica y la de abajo sube justo bajo el dedo).
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
  /** El precio de hoy lo guardó una persona en esta pestaña: se puede deshacer. */
  manualToday: boolean;
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
  | { kind: 'undone'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'confirm'; text: string };

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';
const INPUT =
  'min-h-11 w-full rounded-md border border-border bg-surface2 px-3 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none';

/** Cuánto quedan sin responder los botones de las otras tarjetas después de guardar una. */
const LOCK_MS = 1500;

const timeFmt = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit' });

/** Lo escrito en un cuadro como número, para comparar los dos; 0 si está vacío o no es un monto. */
function amount(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function PriceCard({ item, locked, onDone }: { item: PriceItem; locked: boolean; onDone: () => void }) {
  const router = useRouter();
  // Parte vacío a propósito: con el precio guardado ya escrito, el de hoy terminaba en el cuadro del tachado.
  const [price, setPrice] = useState('');
  const [list, setList] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();
  // Guardado en esta visita, o de antes (hoy): en los dos casos se puede deshacer.
  const [undoable, setUndoable] = useState(item.manualToday);
  const done = status.kind === 'saved' || status.kind === 'gone';
  const busy = pending || locked;
  // Los dos cuadros al revés: el precio de hoy escrito abajo y el viejo arriba.
  const swapped = amount(list) > 0 && amount(list) < amount(price);

  function save(confirmed: boolean) {
    startTransition(async () => {
      try {
        const res = await saveManualPrice(item.id, price, list, confirmed);
        if (res.ok) {
          const parts = [`Guardado como precio de hoy a las ${timeFmt.format(new Date(res.checkedAt))}: ${formatCLP(res.price)}`];
          if (res.listPrice) parts.push(`tachado ${formatCLP(res.listPrice)}`);
          if (res.reactivated) parts.push('volvió al sitio');
          setStatus({ kind: 'saved', text: `${parts.join(', ')}.` });
          setUndoable(true);
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
          setUndoable(true);
          onDone();
        } else {
          setStatus({ kind: 'error', text: res.error });
        }
      } catch {
        setStatus({ kind: 'error', text: 'No se pudo guardar. Revisa la conexión e intenta de nuevo.' });
      }
    });
  }

  /** Deja el producto como estaba antes del último guardado y vuelve a mostrar los cuadros. */
  function undo() {
    startTransition(async () => {
      try {
        const res = await undoManualPrice(item.id);
        if (res.ok) {
          setPrice('');
          setList('');
          setUndoable(false);
          setStatus({
            kind: 'undone',
            text: `Deshecho: el sitio volvió a ${formatCLP(res.price)}${
              res.checkedAt ? `, del ${formatDayMonth(res.checkedAt)}` : ''
            }. Escribe el precio correcto y guarda de nuevo.`,
          });
          // El encabezado de la tarjeta se arma en el servidor: se vuelve a leer.
          router.refresh();
        } else {
          setStatus({ kind: 'error', text: res.error });
        }
      } catch {
        setStatus({ kind: 'error', text: 'No se pudo deshacer. Revisa la conexión e intenta de nuevo.' });
      }
    });
  }

  return (
    <li className={`rounded-xl border border-border bg-surface p-3 sm:p-4 ${done ? 'opacity-80' : ''}`}>
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
          <div>
            <label className="block text-xs text-muted">
              Precio de hoy (el número grande de la ficha)
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${INPUT} mt-1`}
              placeholder="Escríbelo aquí"
              aria-label={`Precio de hoy de ${item.name}`}
            />
            </label>
            {/* Fuera de la etiqueta: tocarlo no debe abrir el teclado. */}
            <button
              type="button"
              onClick={() => setPrice(String(item.price))}
              className="mt-1.5 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-xs font-medium text-fg hover:border-accent"
            >
              Sigue igual: {formatCLP(item.price)}
            </button>
          </div>
          <label className="block text-xs text-muted">
            Precio tachado (el gris sobre el precio; vacío si no hay)
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

      {!done && swapped && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          <p>
            El precio tachado no puede ser menor que el de hoy. Si {formatCLP(amount(list))} es lo que cuesta hoy, va en el
            primer cuadro.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPrice(String(amount(list)));
              setList('');
              setStatus({ kind: 'idle' });
            }}
            className={`${BUTTON} mt-2 bg-amber-400 text-ink`}
          >
            {formatCLP(amount(list))} es el precio de hoy
          </button>
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
      {status.kind === 'undone' && (
        <p role="status" className="mt-3 text-sm text-fg">
          {status.text}
        </p>
      )}

      {!done && status.kind !== 'confirm' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || swapped || amount(price) === 0}
            onClick={() => save(false)}
            className={`${BUTTON} flex-1 bg-accent text-ink hover:bg-accent/90 sm:flex-none`}
          >
            {pending && <Loader2 size={16} className="animate-spin" aria-hidden />}
            Guardar precio de hoy
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={gone}
            className={`${BUTTON} border border-border text-muted hover:text-fg`}
          >
            Ya no se vende
          </button>
        </div>
      )}

      {undoable && status.kind !== 'confirm' && (
        <button
          type="button"
          disabled={pending}
          onClick={undo}
          className={`${BUTTON} mt-3 w-full border border-border text-fg hover:border-accent sm:w-auto`}
        >
          {pending && done ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Undo2 size={16} aria-hidden />}
          {done ? 'Me equivoqué: deshacer y corregir' : 'Deshacer lo que guardé hoy'}
        </button>
      )}
    </li>
  );
}

export function PriceList({ items }: { items: PriceItem[] }) {
  const [doneCount, setDoneCount] = useState(0);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!locked) return;
    const timer = setTimeout(() => setLocked(false), LOCK_MS);
    return () => clearTimeout(timer);
  }, [locked]);

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
          <PriceCard
            key={item.id}
            item={item}
            locked={locked}
            onDone={() => {
              setDoneCount((n) => n + 1);
              setLocked(true);
            }}
          />
        ))}
      </ul>
    </>
  );
}
