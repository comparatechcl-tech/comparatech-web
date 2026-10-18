import Link from 'next/link';
import type { TypeChip } from '@/lib/category-listing';

/**
 * Los filtros de un tipo que hoy tienen productos (lib/listing-filters):
 * "Smart TV 55 pulgadas", "Smart TV Samsung". Van en la página del tipo y en
 * las filtradas, para que Google y quien navega lleguen a ellas.
 */
export function FilterLinks({
  chips,
  hrefOf,
  label,
  active,
  all,
}: {
  chips: TypeChip[];
  hrefOf: (slug: string) => string;
  /** "Por tamaño y marca", "Por marca". */
  label: string;
  /** El filtro de la página, si es una filtrada. */
  active?: string;
  /** El chip para volver a todos ("Todos los televisores"), solo en las filtradas. */
  all?: { href: string; label: string };
}) {
  if (chips.length === 0) return null;
  return (
    <nav aria-label={label} className="-mx-4 mt-5 overflow-x-auto px-4">
      <ul className="flex items-center gap-2">
        <li className="shrink-0 text-xs text-muted">{label}:</li>
        {all && (
          <li>
            <Link href={all.href} className={chipClass(false)}>
              {all.label}
            </Link>
          </li>
        )}
        {chips.map((c) => (
          <li key={c.slug}>
            <Link
              href={hrefOf(c.slug)}
              aria-current={active === c.slug ? 'page' : undefined}
              className={chipClass(active === c.slug)}
            >
              {c.label}
              <span className="text-[10px] opacity-70">{c.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function chipClass(active: boolean): string {
  return `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
    active
      ? 'border-accent bg-accent/10 text-accent'
      : 'border-border bg-surface text-muted hover:border-accent/40 hover:text-fg'
  }`;
}
