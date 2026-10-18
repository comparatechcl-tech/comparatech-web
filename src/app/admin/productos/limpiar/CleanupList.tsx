'use client';

import { useState, useTransition } from 'react';
import Image from 'next/image';
import { formatCLP } from '@/lib/format';
import mlImageLoader from '@/lib/ml-image-loader';
import { reasonText, type CleanupItem, type CleanupView } from '@/lib/catalog-cleanup';
import { removeProducts, restoreProducts } from './actions';

const BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50';

const EMPTY: Record<CleanupView, string> = {
  sugeridos: 'No hay nada para sugerir: el catálogo está limpio.',
  recientes: 'No se agregó nada en los últimos 7 días.',
  pausa: 'Nada lleva tantos días en pausa.',
  comision: 'Nada deja tan poca comisión.',
  colores: 'No hay colores repetidos.',
  tipo: 'No hay productos de este tipo.',
};

const dateFmt = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: 'numeric', month: 'short' });

/** Una fila: se toca entera para elegirla (con el pulgar, un checkbox chico era difícil). */
export function CleanupRowCard({
  item,
  selected,
  onToggle,
  view,
}: {
  item: CleanupItem;
  selected: boolean;
  onToggle: () => void;
  view: CleanupView;
}) {
  return (
    <li
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a, input')) return;
        onToggle();
      }}
      className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
        selected ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-accent/40'
      }`}
    >
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white">
        <Image
          loader={mlImageLoader}
          src={item.imageUrl}
          alt=""
          width={56}
          height={56}
          className="h-14 w-14 object-contain"
        />
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Elegir ${item.name}`}
          className="absolute left-1 top-1 h-4 w-4 accent-accent"
        />
      </div>
      <div className="min-w-0 flex-1">
        <a
          href={`/producto/${item.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="line-clamp-2 text-sm font-medium leading-snug text-fg hover:underline"
        >
          {item.name}
        </a>
        <p className="mt-0.5 text-xs text-muted">
          {formatCLP(item.price)} · {item.typeLabel} · comisión ~{formatCLP(item.commission)}
          {view === 'recientes' && ` · agregado el ${dateFmt.format(new Date(item.createdAt))}`}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-medium">
          {item.reasons.map((r) => (
            <span key={r} className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400">
              {reasonText(item, r)}
            </span>
          ))}
          {item.pausedDays !== null && !item.reasons.includes('pausa_larga') && (
            <span className="rounded-full border border-border px-2 py-0.5 text-muted">En pausa</span>
          )}
          {item.keep && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-accent">{item.keep}</span>}
        </div>
      </div>
    </li>
  );
}

export function CleanupList({ items, total, view }: { items: CleanupItem[]; total: number; view: CleanupView }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [lastBatch, setLastBatch] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = items.filter((i) => !hidden.has(i.id));
  const allSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  function toggle(id: string) {
    setConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function remove() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const ids = [...selected];
    setConfirming(false);
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeProducts(ids);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setHidden((current) => new Set([...current, ...result.ids]));
        setSelected(new Set());
        setLastBatch(result.ids);
        setMessage(
          `Sacaste ${result.ids.length} ${result.ids.length === 1 ? 'producto' : 'productos'} del sitio.`
        );
      } catch {
        setError('No se pudo sacar. Revisa la conexión e intenta de nuevo.');
      }
    });
  }

  function undo() {
    const ids = lastBatch;
    setError(null);
    startTransition(async () => {
      try {
        const result = await restoreProducts(ids);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setHidden((current) => new Set([...current].filter((id) => !result.ids.includes(id))));
        setLastBatch([]);
        setMessage(`Repuse ${result.ids.length} ${result.ids.length === 1 ? 'producto' : 'productos'} en el sitio.`);
      } catch {
        setError('No se pudo reponer. Búscalos en Productos → Eliminados.');
      }
    });
  }

  return (
    <div className="mt-4 pb-24">
      {message && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm text-fg">
          <span>{message}</span>
          {lastBatch.length > 0 && (
            <button type="button" onClick={undo} disabled={pending} className={`${BUTTON} border border-border text-fg`}>
              Deshacer
            </button>
          )}
        </div>
      )}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {visible.length === 0 ? (
        <p className="text-sm text-muted">{EMPTY[view]}</p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              {total > items.length ? `Mostrando ${items.length} de ${total}` : `${visible.length} productos`}
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setSelected(allSelected ? new Set() : new Set(visible.map((i) => i.id)));
              }}
              className="min-h-11 px-2 font-medium text-accent"
            >
              {allSelected ? 'Quitar selección' : `Seleccionar todos (${visible.length})`}
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {visible.map((item) => (
              <CleanupRowCard
                key={item.id}
                item={item}
                view={view}
                selected={selected.has(item.id)}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </ul>
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 p-3 backdrop-blur">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
            <span className="text-sm text-fg">
              {selected.size} {selected.size === 1 ? 'elegido' : 'elegidos'}
            </span>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className={`${BUTTON} ${confirming ? 'bg-red-500 text-white' : 'bg-accent text-ink hover:bg-accent/90'}`}
            >
              {pending
                ? 'Sacando…'
                : confirming
                  ? `¿Sacar ${selected.size}? Toca de nuevo`
                  : 'Sacar del sitio'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
