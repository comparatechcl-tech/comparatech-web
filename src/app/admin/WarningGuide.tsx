import { WARNING_GLOSSARY, type WarningKind } from '@/lib/social/warning-help';

/**
 * "¿Qué significa cada aviso?": la lista completa de los "Ojo" que puede
 * traer una tarjeta de /admin/historias o /admin/videos, plegada para que no
 * ocupe la pantalla. Sin estado: se abre y se cierra sola (details).
 *
 * `omit` saca los avisos que esa pestaña nunca muestra (Videos no muestra un
 * video sin historial de precios), para no explicar algo que no va a aparecer.
 */

const KIND_TITLES: Record<WarningKind, string> = {
  precio: 'Del precio',
  vendedor: 'Del vendedor',
  oferta: 'De la oferta',
  otro: 'Otros',
};
const KIND_ORDER = Object.keys(KIND_TITLES) as WarningKind[];

export function WarningGuide({ omit = [], className = 'mt-2' }: { omit?: readonly string[]; className?: string }) {
  const glossary = WARNING_GLOSSARY.filter((entry) => omit.indexOf(entry.example) < 0);
  return (
    <details className={`${className} rounded-xl border border-border bg-surface px-4 py-2 text-sm`}>
      {/* El resumen es lo que se toca: alto de dedo. */}
      <summary className="flex min-h-11 cursor-pointer items-center font-medium text-accent">
        ¿Qué significa cada aviso?
      </summary>
      <div className="mt-2 flex flex-col gap-4 pb-2">
        {KIND_ORDER.map((kind) => {
          const entries = glossary.filter((entry) => entry.kind === kind);
          if (entries.length === 0) return null;
          return (
            <div key={kind}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{KIND_TITLES[kind]}</h3>
              <dl className="mt-1 flex flex-col gap-2">
                {entries.map((entry) => (
                  <div key={entry.example}>
                    {/* Sin "Ojo:" adelante: así no se confunde con el aviso de una tarjeta. */}
                    <dt className="text-xs font-medium text-amber-400">&quot;{entry.example}&quot;</dt>
                    <dd className="mt-0.5 text-xs leading-snug text-muted">
                      {entry.meaning} <span className="text-fg">{entry.whatToDo}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </details>
  );
}
