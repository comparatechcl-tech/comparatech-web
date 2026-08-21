'use client';

import { useState, useTransition } from 'react';
import { ProductCandidate } from '@/lib/types';
import { CandidateCard } from './CandidateCard';
import { rejectCandidates } from './actions';

export function CandidatesList({ candidates }: { candidates: ProductCandidate[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = candidates.filter((c) => !hidden.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((c) => c.id))));
  }

  function handleBulkReject() {
    setError(null);
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await rejectCandidates(ids);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setHidden((prev) => new Set([...prev, ...ids]));
      setSelected(new Set());
    });
  }

  if (visible.length === 0) {
    return <p className="text-sm text-muted">No hay candidatos pendientes por ahora.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface2 px-4 py-2.5">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={selected.size > 0 && selected.size === visible.length}
            onChange={toggleAll}
            className="h-4 w-4 accent-accent"
          />
          {selected.size > 0 ? `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}` : 'Seleccionar todos'}
        </label>
        <button
          onClick={handleBulkReject}
          disabled={selected.size === 0 || isPending}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Rechazar seleccionados
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {visible.map((c) => (
        <CandidateCard key={c.id} candidate={c} selected={selected.has(c.id)} onToggleSelect={() => toggle(c.id)} />
      ))}
    </div>
  );
}
