'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { AffiliateButton } from '@/components/product/AffiliateButton';
import { buyUrl } from '@/lib/outbound';
import mlImageLoader from '@/lib/ml-image-loader';
import {
  betterSpec,
  compareOptionsForB,
  defaultComparePair,
  groupByCategory,
  sharedSpecKeys,
  topSeller,
  type CompareCandidate,
} from '@/lib/compare';

/** Lo que la tabla usa de cada producto. La descripción no viaja al navegador. */
export type CompareProduct = CompareCandidate &
  Pick<Product, 'id' | 'price' | 'image_url' | 'specs' | 'affiliate_url' | 'outbound_url' | 'ml_product_id'>;

const SELECT_CLASS =
  'w-full min-w-0 truncate rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-fg transition focus:border-accent focus:outline-none';

/**
 * Comparador de /comparador.
 *
 * Lee ?a= y ?b= con useSearchParams dentro de un <Suspense>: así la página
 * se genera estática (con la comparación por defecto en el HTML, que es lo
 * que ve Google) y el navegador cambia al par del link al cargar. Antes leer
 * searchParams en el servidor obligaba a consultar Supabase en cada visita.
 */
export function CompareClient({ products }: { products: CompareProduct[] }) {
  return (
    <Suspense fallback={<CompareView products={products} />}>
      <CompareFromUrl products={products} />
    </Suspense>
  );
}

function CompareFromUrl({ products }: { products: CompareProduct[] }) {
  const params = useSearchParams();
  const a = params?.get('a') ?? undefined;
  const b = params?.get('b') ?? undefined;
  // La key reinicia la selección si se navega a otro par sin salir de la página.
  return <CompareView key={`${a ?? ''}|${b ?? ''}`} products={products} initialSlugA={a} initialSlugB={b} />;
}

function GroupedOptions({ products }: { products: CompareProduct[] }) {
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

/** Selección inicial: la del link si existe; si no, el par por defecto. */
function initialSelection(products: CompareProduct[], slugA?: string, slugB?: string) {
  const find = (slug?: string) => (slug ? products.find((p) => p.slug === slug) : undefined);
  const [defaultA, defaultB] = defaultComparePair(products);
  const linkedA = find(slugA);
  const a = linkedA ?? find(defaultA);
  const linkedB = find(slugB);

  if (linkedB && linkedB.slug !== a?.slug) {
    // Un link puede comparar productos de tipos distintos (se eligieron con
    // "Ver todos"): se respeta y la lista B parte mostrando todo.
    const { options } = compareOptionsForB(products, a, false);
    return { a: a?.slug ?? '', b: linkedB.slug, showAll: !options.some((p) => p.slug === linkedB.slug) };
  }
  if (!linkedA) return { a: defaultA, b: defaultB, showAll: false };

  // Link con solo ?a=: se le busca el rival más vendido de su mismo tipo.
  const { options } = compareOptionsForB(products, linkedA, false);
  return { a: linkedA.slug, b: topSeller(options)?.slug ?? '', showAll: false };
}

function CompareView({
  products,
  initialSlugA,
  initialSlugB,
}: {
  products: CompareProduct[];
  initialSlugA?: string;
  initialSlugB?: string;
}) {
  const initial = useMemo(
    () => initialSelection(products, initialSlugA, initialSlugB),
    [products, initialSlugA, initialSlugB]
  );
  const [slugA, setSlugA] = useState(initial.a);
  const [slugB, setSlugB] = useState(initial.b);
  const [showAll, setShowAll] = useState(initial.showAll);

  const a = products.find((p) => p.slug === slugA);
  const b = products.find((p) => p.slug === slugB);
  const { options: optionsB, restricted } = compareOptionsForB(products, a, showAll);

  const specKeys = useMemo(() => (a && b ? sharedSpecKeys(a.specs, b.specs) : []), [a, b]);

  function changeA(slug: string) {
    setSlugA(slug);
    // Si B ya no es del mismo tipo que el nuevo A, pasa al más vendido de
    // ese tipo: así nunca queda armada una comparación parlante vs. celular.
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
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Producto A"
          value={slugA}
          onChange={(e) => changeA(e.target.value)}
          className={SELECT_CLASS}
        >
          <GroupedOptions products={products} />
        </select>
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

      {a && b && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border">
          <div className="grid grid-cols-2 divide-x divide-border">
            {[a, b].map((p) => (
              <div key={p.id} className="flex flex-col items-center gap-3 bg-surface p-5 text-center sm:p-6">
                <div className="relative h-20 w-20 overflow-hidden rounded-xl bg-white sm:h-28 sm:w-28">
                  <Image
                    loader={mlImageLoader}
                    src={p.image_url}
                    alt={p.name}
                    fill
                    sizes="112px"
                    className="object-contain"
                  />
                </div>
                <p className="line-clamp-2 font-heading text-sm font-medium text-fg">{p.name}</p>
                <p
                  className={`font-heading text-lg font-bold sm:text-xl ${
                    p.price <= Math.min(a.price, b.price) ? 'text-accent' : 'text-fg'
                  }`}
                >
                  {formatCLP(p.price)}
                </p>
                <AffiliateButton
                  href={buyUrl(p)}
                  productId={p.id}
                  productName={p.name}
                  placement="comparador"
                  className="w-full text-xs sm:text-sm"
                />
              </div>
            ))}
          </div>

          {specKeys.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <tbody>
                  {specKeys.map((key, i) => {
                    const va = a.specs[key];
                    const vb = b.specs[key];
                    const winner = betterSpec(key, va, vb);
                    const aWins = winner === 'a';
                    const bWins = winner === 'b';

                    return (
                      <tr key={key} className={i % 2 === 0 ? 'bg-surface2' : 'bg-surface'}>
                        <td
                          className={`px-4 py-2.5 text-center ${
                            aWins ? 'font-semibold text-accent' : 'text-fg'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {aWins && <CheckCircle2 size={13} className="shrink-0" />}
                            {va}
                          </span>
                        </td>
                        <th scope="row" className="px-3 py-2.5 text-center text-xs font-normal text-muted">
                          {key}
                        </th>
                        <td
                          className={`px-4 py-2.5 text-center ${
                            bWins ? 'font-semibold text-accent' : 'text-fg'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {vb}
                            {bWins && <CheckCircle2 size={13} className="shrink-0" />}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="bg-surface2 px-4 py-4 text-center text-sm text-muted">
              Estos dos productos no tienen especificaciones en común para comparar.
            </p>
          )}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        Destacamos en cyan el precio más bajo y, cuando más es mejor (batería,
        RAM, almacenamiento, potencia, autonomía y resistencia IP), el valor
        más alto. Solo mostramos las especificaciones que tienen los dos
        productos — revisa igual cuál característica te importa más antes de
        decidir.
      </p>
    </div>
  );
}
