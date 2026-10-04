'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EyeOff } from 'lucide-react';
import { setProductHidden } from '../productos/actions';

/**
 * Oculta un producto en pausa desde la lista compacta de Problemas. Ocultar
 * y no borrar: el link de afiliado queda guardado y se puede reponer desde
 * Productos si Mercado Libre vuelve a tener vendedor.
 */
export function HideButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await setProductHidden(productId, true);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-fg transition hover:border-accent/50 disabled:opacity-50"
      >
        <EyeOff size={13} aria-hidden />
        {isPending ? 'Ocultando…' : 'Ocultar'}
      </button>
      {error && <p className="max-w-40 text-right text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
