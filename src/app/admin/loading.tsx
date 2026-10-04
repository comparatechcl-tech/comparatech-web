/**
 * Mientras carga una sección del admin. Las páginas leen la base (y a veces
 * Mercado Libre) antes de mostrar nada: sin esto, tocar una pestaña en el
 * teléfono no da señal de que algo está pasando.
 */
export default function AdminLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="h-7 w-48 animate-pulse rounded-md bg-surface2" />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-surface2" />
        ))}
      </div>
    </div>
  );
}
