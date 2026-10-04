'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import {
  SORT_OPTIONS,
  type CandidateFacets,
  type CandidateFilters as Filters,
  type CandidateSort,
  type FacetOption,
} from '@/lib/candidate-sort';

const BASE_PATH = '/admin/candidatos';

type Key = 'cat' | 'precio' | 'desc' | 'ingreso' | 'q' | 'orden';

/**
 * Filtros de la cola, guardados en la URL: así sobreviven a "Siguiente
 * tanda" y a recargar la página, y un link a la vista filtrada se puede
 * guardar o compartir.
 */
export function CandidateFilters({
  facets,
  filters,
  sort,
}: {
  facets: CandidateFacets;
  filters: Filters;
  sort: CandidateSort;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? '');

  /** Cambiar un filtro vuelve a la primera página: la página actual podría no existir. */
  function hrefWith(key: Key, value: string | undefined): string {
    const params = new URLSearchParams();
    const current: Record<Key, string | undefined> = {
      cat: filters.cat,
      precio: filters.precio,
      desc: filters.desc,
      ingreso: filters.ingreso,
      q: filters.q,
      orden: sort === 'valor' ? undefined : sort,
    };
    current[key] = value;
    for (const [k, v] of Object.entries(current)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  }

  function submitSearch(value: string) {
    router.push(hrefWith('q', value.trim() || undefined), { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch(q);
          }}
          className="relative flex-1"
        >
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nombre, marca o MLC…"
            aria-label="Buscar candidatos"
            className="min-h-11 w-full rounded-md border border-border bg-surface2 py-2 pl-9 pr-9 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
          />
          {filters.q && (
            <button
              type="button"
              onClick={() => {
                setQ('');
                submitSearch('');
              }}
              aria-label="Borrar búsqueda"
              className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-muted hover:text-fg"
            >
              <X size={15} />
            </button>
          )}
        </form>
        <select
          value={sort}
          onChange={(e) => router.push(hrefWith('orden', e.target.value === 'valor' ? undefined : e.target.value), { scroll: false })}
          aria-label="Ordenar candidatos"
          className="min-h-11 rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <ChipRow label="Categoría" options={facets.cat} active={filters.cat} href={(v) => hrefWith('cat', v)} />
      <ChipRow label="Precio" options={facets.precio} active={filters.precio} href={(v) => hrefWith('precio', v)} />
      <ChipRow label="Descuento" options={facets.desc} active={filters.desc} href={(v) => hrefWith('desc', v)} />
      <ChipRow label="Ingreso" options={facets.ingreso} active={filters.ingreso} href={(v) => hrefWith('ingreso', v)} />
    </div>
  );
}

function ChipRow({
  label,
  options,
  active,
  href,
}: {
  label: string;
  options: FacetOption[];
  active: string | undefined;
  href: (value: string | undefined) => string;
}) {
  // Una opción sin resultados no sirve de nada, salvo que sea la elegida
  // (hay que poder verla para sacarla).
  const shown = options.filter((o) => o.count > 0 || o.value === active);
  if (shown.length === 0) return null;

  const chip = (selected: boolean) =>
    `inline-flex min-h-9 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
      selected ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-semibold text-fg">{label}:</span>
      <Link href={href(undefined)} scroll={false} className={chip(!active)}>
        Todos
      </Link>
      {shown.map((o) => (
        <Link
          key={o.value}
          href={href(o.value === active ? undefined : o.value)}
          scroll={false}
          className={chip(o.value === active)}
        >
          {o.label}
          <span className="text-[10px] opacity-70">{o.count}</span>
        </Link>
      ))}
    </div>
  );
}
