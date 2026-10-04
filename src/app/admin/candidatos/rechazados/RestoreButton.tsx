'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { restoreCandidates } from '../actions';

/** Devuelve un rechazado o vencido a la cola de revisión. */
export function RestoreButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await restoreCandidates([id]);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.ids.length === 0) {
          setError('Ya no estaba rechazado.');
          return;
        }
        setState('done');
        router.refresh();
      } catch {
        setError('No se pudo recuperar. Intenta de nuevo.');
      }
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || state === 'done'}
        className="min-h-11 rounded-md border border-border px-3 py-2 text-xs font-medium text-fg transition hover:border-accent/50 disabled:opacity-50"
      >
        {isPending ? 'Recuperando…' : state === 'done' ? '✓ De vuelta en la cola' : 'Recuperar'}
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
