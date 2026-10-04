'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';

/**
 * Error dentro de una sección del admin. Deja las pestañas a la vista (el
 * layout sigue en pie) para poder pasar a otra sección mientras tanto.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // Queda en los logs de Vercel con el digest que también ve el servidor.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 text-center">
      <h1 className="font-heading text-xl font-bold text-fg">No pudimos cargar esta sección.</h1>
      <p className="mt-2 text-sm text-muted">
        Suele ser la base de datos o Mercado Libre que no respondieron a tiempo. Prueba de nuevo en unos segundos.
      </p>
      <button
        type="button"
        onClick={() =>
          // reset() solo vuelve a pintar lo que ya llegó al navegador; el
          // error vino del servidor, así que hay que volver a pedirle la página.
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
        className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-accent/90"
      >
        <RotateCw size={15} aria-hidden />
        Reintentar
      </button>
    </div>
  );
}
