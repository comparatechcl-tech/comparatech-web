'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { recheckProducts } from '@/lib/actions/catalog-admin';

/** Consulta Mercado Libre ahora mismo por todos los productos fuera del sitio. */
export function RecheckAllButton() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      const result = await recheckProducts();
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      const { reactivados, revisados } = result.summary;
      setMessage(
        reactivados > 0
          ? `Listo: ${reactivados} de ${revisados} volvieron a publicarse.`
          : `Revisados ${revisados}: ninguno está disponible todavía.`
      );
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
      <button
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-accent/90 disabled:opacity-50"
      >
        <RefreshCw size={15} className={isPending ? 'animate-spin' : ''} />
        {isPending ? 'Revisando en Mercado Libre…' : 'Revisar todos ahora'}
      </button>
      {message && <p className="text-xs text-muted">{message}</p>}
    </div>
  );
}
