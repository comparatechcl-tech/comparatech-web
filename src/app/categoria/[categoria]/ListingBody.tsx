import Link from 'next/link';
import { CATEGORY_PAGE, SORT_OPTIONS, type SortOrder, type TypeChip } from '@/lib/category-listing';
import type { Product } from '@/lib/types';
import { ProductGrid } from '@/components/product/ProductGrid';
import { PendingLabel } from '@/components/layout/PendingLabel';

/**
 * Lo que comparten la página de una categoría y la de un tipo: los chips de
 * tipo, el orden, la grilla y "ver más". Componente de servidor: las
 * funciones que arman los links no viajan al navegador.
 */
export function ListingBody({
  chips,
  activeType,
  allHref,
  typeHref,
  sortHref,
  orden,
  shown,
  total,
  moreHref,
}: {
  chips: TypeChip[];
  /** El tipo de la página; undefined en la de la categoría. */
  activeType?: string;
  /** El chip "Todos": la página de la categoría. */
  allHref: string;
  typeHref: (slug: string) => string;
  sortHref: (order: SortOrder) => string;
  orden: SortOrder;
  shown: Product[];
  total: number;
  /** La siguiente tanda, o null si ya se ve todo. */
  moreHref: string | null;
}) {
  const remaining = total - shown.length;
  return (
    <>
      <div className="mt-6 flex flex-col gap-3">
        {chips.length > 0 && (
          <nav aria-label="Filtrar por tipo" className="-mx-4 overflow-x-auto px-4">
            <ul className="flex gap-2">
              <li>
                <Link href={allHref} aria-current={!activeType ? 'page' : undefined} className={chipClass(!activeType)}>
                  Todos
                </Link>
              </li>
              {chips.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={typeHref(c.slug)}
                    aria-current={activeType === c.slug ? 'page' : undefined}
                    className={chipClass(activeType === c.slug)}
                  >
                    {c.label}
                    <span className="text-[10px] opacity-70">{c.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <nav aria-label="Ordenar productos" className="-mx-4 overflow-x-auto px-4">
          <ul className="flex items-center gap-2">
            <li className="shrink-0 text-xs text-muted">Ordenar por:</li>
            {SORT_OPTIONS.map((o) => (
              <li key={o.value}>
                <Link
                  href={sortHref(o.value)}
                  aria-current={orden === o.value ? 'page' : undefined}
                  className={chipClass(orden === o.value)}
                >
                  {o.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mt-6">
        <ProductGrid products={shown} placement="categoria" eagerImages={4} />
      </div>

      {moreHref && remaining > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          {/* Un link y no un botón: funciona sin JavaScript y los buscadores
              pueden seguirlo. `replace` y `scroll={false}` hacen que los
              productos nuevos aparezcan debajo sin mover la página ni sumar
              un paso al botón "atrás". */}
          <Link
            href={moreHref}
            replace
            scroll={false}
            prefetch={false}
            className="inline-flex min-h-11 items-center rounded-full border border-accent/40 px-6 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/10"
          >
            <PendingLabel>
              Ver {Math.min(CATEGORY_PAGE, remaining)} {remaining === 1 ? 'producto' : 'productos'} más
            </PendingLabel>
          </Link>
          <p className="text-xs text-muted">
            Mostrando {shown.length} de {total}
          </p>
        </div>
      )}
    </>
  );
}

function chipClass(active: boolean): string {
  // whitespace-nowrap: el chip va dentro de un <li>, que es el que se achica
  // cuando la fila no cabe. Sin esto, un nombre de varias palabras ("Lectores
  // de código de barras") se partía en tres líneas en vez de deslizarse.
  return `inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
    active
      ? 'border-accent bg-accent/10 text-accent'
      : 'border-border bg-surface text-muted hover:border-accent/40 hover:text-fg'
  }`;
}

/** La dirección con ?orden= y ?pagina=, sin los valores por defecto. */
export function listingHref(path: string, orden: SortOrder, pagina = 1): string {
  const qs = new URLSearchParams();
  if (orden !== 'relevancia') qs.set('orden', orden);
  if (pagina > 1) qs.set('pagina', String(pagina));
  const query = qs.toString();
  return `${path}${query ? `?${query}` : ''}`;
}
