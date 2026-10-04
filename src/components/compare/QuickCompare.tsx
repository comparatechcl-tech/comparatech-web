'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import {
  compareOptionsForB,
  defaultComparePair,
  groupByCategory,
  topSeller,
  type CompareCandidate,
} from '@/lib/compare';

const SELECT_CLASS =
  'w-full min-w-0 flex-1 truncate rounded-xl border border-border bg-surface2 px-4 py-3 text-sm font-medium text-fg transition focus:border-accent focus:outline-none';

/** Opciones agrupadas por categoría: con todo el catálogo no se encontraba nada. */
function GroupedOptions({ products }: { products: CompareCandidate[] }) {
  return (
    <>
      {groupByCategory(products).map((g) => (
        <optgroup key={g.slug} label={g.label}>
          {g.items.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/**
 * Recibe solo lo necesario para elegir (no el producto completo): la home
 * le pasa todo el catálogo y cada campo de más viaja en el HTML.
 */
export function QuickCompare({ products }: { products: CompareCandidate[] }) {
  const router = useRouter();
  const [initialA, initialB] = useMemo(() => defaultComparePair(products), [products]);
  const [slugA, setSlugA] = useState(initialA);
  const [slugB, setSlugB] = useState(initialB);
  const [showAll, setShowAll] = useState(false);

  const a = products.find((p) => p.slug === slugA);
  const { options: optionsB, restricted } = compareOptionsForB(products, a, showAll);

  function changeA(slug: string) {
    setSlugA(slug);
    // Si B ya no es del mismo tipo que el nuevo A, se reemplaza por el más
    // vendido de ese tipo en vez de dejar una comparación sin sentido.
    const next = products.find((p) => p.slug === slug);
    const { options } = compareOptionsForB(products, next, showAll);
    if (!options.some((p) => p.slug === slugB)) setSlugB(topSeller(options)?.slug ?? '');
  }

  function toggleShowAll(checked: boolean) {
    setShowAll(checked);
    if (!checked) {
      const { options } = compareOptionsForB(products, a, false);
      if (!options.some((p) => p.slug === slugB)) setSlugB(topSeller(options)?.slug ?? '');
    }
  }

  return (
    <div className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
      <h2 className="font-heading text-2xl font-bold">Comparador rápido</h2>
      <p className="mt-1.5 text-muted">
        Elige dos productos y compara sus especificaciones y precios al instante.
      </p>

      <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <select
          aria-label="Producto A"
          value={slugA}
          onChange={(e) => changeA(e.target.value)}
          className={SELECT_CLASS}
        >
          <GroupedOptions products={products} />
        </select>

        <span className="flex h-10 w-10 shrink-0 items-center justify-center self-center rounded-full border border-border bg-surface2 text-accent">
          <ArrowLeftRight size={16} />
        </span>

        <select
          aria-label="Producto B"
          value={slugB}
          onChange={(e) => setSlugB(e.target.value)}
          className={SELECT_CLASS}
        >
          <GroupedOptions products={optionsB} />
        </select>
      </div>

      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={showAll || !restricted}
          disabled={!showAll && !restricted}
          onChange={(e) => toggleShowAll(e.target.checked)}
          className="accent-accent"
        />
        Ver todos los productos
      </label>

      <button
        onClick={() =>
          router.push(`/comparador?a=${encodeURIComponent(slugA)}&b=${encodeURIComponent(slugB)}`)
        }
        disabled={!slugA || !slugB}
        className="mt-5 block w-full rounded-xl bg-gradient-to-r from-blue to-accent py-3.5 text-center font-heading text-sm font-semibold text-ink transition hover:opacity-90 disabled:opacity-40 sm:w-auto sm:px-8"
      >
        Comparar productos →
      </button>
    </div>
  );
}
