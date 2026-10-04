'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCw } from 'lucide-react';

/**
 * Error al cargar una página (normalmente Supabase o Mercado Libre que no
 * respondieron a tiempo). En vez de la pantalla genérica de Next, un aviso
 * en español con dos salidas: reintentar y las ofertas, que casi siempre
 * vienen de la caché y cargan igual.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Queda en los logs de Vercel con el digest que también ve el servidor.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">
        Tuvimos un problema al cargar esta página
      </h1>
      <p className="mt-3 text-muted">
        Suele ser algo pasajero. Prueba de nuevo en unos segundos o revisa las ofertas de hoy.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          <RotateCw size={15} aria-hidden />
          Reintentar
        </button>
        <Link
          href="/ofertas"
          className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-fg transition hover:border-accent/40"
        >
          Ver ofertas de hoy
        </Link>
      </div>
    </div>
  );
}
