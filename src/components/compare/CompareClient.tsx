'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { CheckCircle2 } from 'lucide-react';
import { formatCLP } from '@/lib/format';
import { AffiliateButton } from '@/components/product/AffiliateButton';
import mlImageLoader from '@/lib/ml-image-loader';
import {
  betterSpec,
  compareListUrl,
  compareOptionsForB,
  compareProductUrl,
  defaultComparePair,
  groupByType,
  sharedSpecKeys,
  topSeller,
  type CompareCandidate,
  type CompareDetail,
  type CompareList,
} from '@/lib/compare';

interface CompareProps {
  /** El par con que abre la página: viene escrito en el HTML. */
  initial: { a: CompareDetail; b: CompareDetail };
  /** Categorías con productos, en el orden del sitio. */
  categories: { slug: string; name: string; count: number }[];
}

/** Lo que muestra la tabla. B falta solo si A no tiene con quién compararse. */
interface Pair {
  a: CompareDetail;
  b: CompareDetail | null;
}

/**
 * Lo que dicen los selectores. Va un paso adelante de la tabla mientras
 * llegan los datos del par elegido.
 */
interface Selection {
  category: string;
  a: string;
  b: string;
  showAll: boolean;
}

const SELECT_CLASS =
  'w-full min-w-0 truncate rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-fg transition focus:border-accent focus:outline-none';

/**
 * Comparador de /comparador.
 *
 * Lee ?a= y ?b= con useSearchParams dentro de un <Suspense>: así la página
 * se genera estática (con la comparación por defecto en el HTML, que es lo
 * que ve Google) y el navegador cambia al par del link al cargar. Antes leer
 * searchParams en el servidor obligaba a consultar Supabase en cada visita.
 *
 * La página trae solo ese par. Antes traía el catálogo entero con sus specs
 * para armar cualquier comparación acá, y pesaba más con cada producto
 * nuevo. Ahora se elige una categoría a la vez: su lista (lo justo para los
 * selectores) y las specs de cada producto elegido se piden a
 * /comparador/datos la primera vez que hacen falta, y se guardan.
 */
export function CompareClient(props: CompareProps) {
  return (
    <Suspense fallback={<CompareView {...props} />}>
      <CompareFromUrl {...props} />
    </Suspense>
  );
}

function CompareFromUrl(props: CompareProps) {
  const params = useSearchParams();
  const a = params?.get('a') ?? undefined;
  const b = params?.get('b') ?? undefined;
  // La key reinicia la selección si se navega a otro par sin salir de la página.
  return <CompareView key={`${a ?? ''}|${b ?? ''}`} {...props} linked={{ a, b }} />;
}

function ProductSelect({
  label,
  value,
  valueName,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  /** Nombre del elegido, por si no está entre las opciones. */
  valueName: string;
  options: CompareCandidate[];
  disabled: boolean;
  onChange: (slug: string) => void;
}) {
  const listed = options.some((p) => p.slug === value);
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={SELECT_CLASS}
    >
      {/* El elegido no está en la lista mientras esta llega, ni cuando un
          link trae un producto de otra categoría. */}
      {!listed && <option value={value}>{valueName}</option>}
      {groupByType(options).map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function CompareView({
  initial,
  categories,
  linked,
}: CompareProps & {
  /** Lo que pide la dirección. Sin esto es la vista fija del HTML y no carga nada. */
  linked?: { a?: string; b?: string };
}) {
  const [selection, setSelection] = useState<Selection>({
    category: initial.a.category,
    a: initial.a.slug,
    b: initial.b.slug,
    showAll: false,
  });
  const [shown, setShown] = useState<Pair>(initial);
  // Productos de la categoría elegida; null mientras no llegan.
  const [list, setList] = useState<CompareCandidate[] | null>(null);
  // El chip que se tocó, hasta que llega su lista: mientras tanto se sigue
  // viendo la categoría anterior, atenuada.
  const [wantedCategory, setWantedCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  // Lo ya pedido: volver a un producto o a una categoría no pide nada.
  const [cache] = useState(() => ({
    lists: new Map<string, CompareCandidate[]>(),
    details: new Map<string, CompareDetail>([
      [initial.a.slug, initial.a],
      [initial.b.slug, initial.b],
    ]),
  }));
  const run = useRef(0);
  const retry = useRef<() => void>(() => {});

  async function loadList(category: string): Promise<CompareCandidate[]> {
    const cached = cache.lists.get(category);
    if (cached) return cached;
    const res = await fetch(compareListUrl(category));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as CompareList;
    if (!Array.isArray(data.items)) throw new Error('respuesta inesperada');
    cache.lists.set(category, data.items);
    return data.items;
  }

  /** null si el producto no está en el catálogo (o el slug no es válido). */
  async function loadDetail(slug: string): Promise<CompareDetail | null> {
    const cached = cache.details.get(slug);
    if (cached) return cached;
    const res = await fetch(compareProductUrl(slug));
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = (await res.json()) as CompareDetail;
    if (typeof detail.slug !== 'string' || typeof detail.specs !== 'object' || detail.specs === null) {
      throw new Error('respuesta inesperada');
    }
    cache.details.set(slug, detail);
    return detail;
  }

  /**
   * Corre una carga y deja en `status` cómo va. Solo cuenta la última que
   * se pidió: si mientras tanto se eligió otra cosa, la anterior se descarta.
   * `dims` es false cuando lo que se carga no cambia la tabla.
   */
  function attempt(task: (alive: () => boolean) => Promise<void>, dims = true) {
    const id = ++run.current;
    const alive = () => run.current === id;
    retry.current = () => attempt(task, dims);
    setStatus(dims ? 'loading' : 'idle');
    task(alive).then(
      () => {
        if (alive()) setStatus('idle');
      },
      () => {
        if (alive()) setStatus('error');
      }
    );
  }

  useEffect(() => {
    if (!linked) return;
    attempt(async (alive) => {
      const [linkedA, linkedB] = await Promise.all([
        linked.a ? loadDetail(linked.a) : null,
        // Un link con el mismo producto dos veces es un link con solo ?a=.
        linked.b && linked.b !== linked.a ? loadDetail(linked.b) : null,
      ]);
      if (!alive()) return;

      // Un slug que no existe cae al par por defecto, como antes.
      const a = linkedA ?? initial.a;
      const fromLink = linkedB && linkedB.slug !== a.slug ? linkedB : null;
      // undefined: el link trae solo ?a= y hay que buscarle un rival.
      let b: CompareDetail | null | undefined = fromLink ?? (linkedA ? undefined : initial.b);

      // Con el par completo, la tabla no espera a la lista de los selectores.
      if (b) {
        setSelection({ category: a.category, a: a.slug, b: b.slug, showAll: false });
        setShown({ a, b });
        setStatus('idle');
      }

      const items = await loadList(a.category);
      const { options } = compareOptionsForB(items, a, false);
      if (b === undefined) {
        // El más vendido de su mismo tipo.
        const rival = topSeller(options);
        b = rival ? await loadDetail(rival.slug) : null;
      }
      if (!alive()) return;

      setList(items);
      setSelection({
        category: a.category,
        a: a.slug,
        b: b?.slug ?? '',
        // Un link puede comparar productos de tipos distintos: se respeta y
        // la lista B parte mostrando todo.
        showAll: fromLink !== null && !options.some((p) => p.slug === fromLink.slug),
      });
      setShown({ a, b });
    }, Boolean(linked.a || linked.b));

    return () => {
      // Al salir, lo que siga en camino ya no cuenta.
      run.current++;
    };
    // Solo al montar: la key de CompareFromUrl crea otra vista si cambia el link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Muestra otro par de la categoría que ya está en pantalla. */
  function select(next: Selection) {
    setSelection(next);
    setWantedCategory(null);

    const a = cache.details.get(next.a);
    const b = next.b ? cache.details.get(next.b) : null;
    if (a && b !== undefined) {
      run.current++;
      setStatus('idle');
      setShown({ a, b });
      return;
    }

    attempt(async (alive) => {
      const [loadedA, loadedB] = await Promise.all([loadDetail(next.a), next.b ? loadDetail(next.b) : null]);
      // La lista decía que estaban: si ya no, es un error y se puede reintentar.
      if (!loadedA || (next.b && !loadedB)) throw new Error('producto no disponible');
      if (alive()) setShown({ a: loadedA, b: loadedB });
    });
  }

  function pickCategory(category: string) {
    if (category === selection.category) {
      // Volver al chip de lo que se ve cancela un cambio que venía en camino.
      if (!wantedCategory) return;
      setWantedCategory(null);
      if (list) {
        run.current++;
        setStatus('idle');
      } else {
        // El cambio había interrumpido la carga de esta lista: se retoma.
        attempt(async (alive) => {
          const items = await loadList(category);
          if (alive()) setList(items);
        }, false);
      }
      return;
    }

    setWantedCategory(category);
    attempt(async (alive) => {
      const items = await loadList(category);
      // Abre con los dos más vendidos del tipo con más productos.
      const [slugA, slugB] = defaultComparePair(items);
      const [a, b] = await Promise.all([loadDetail(slugA), slugB !== slugA ? loadDetail(slugB) : null]);
      if (!a) throw new Error('categoría sin productos');
      if (!alive()) return;

      setList(items);
      setSelection({ category, a: a.slug, b: b?.slug ?? '', showAll: false });
      setShown({ a, b });
      setWantedCategory(null);
    });
  }

  // El A elegido, con su tipo. Si no viene en la lista se usa su ficha.
  const optionA = list?.find((p) => p.slug === selection.a) ?? cache.details.get(selection.a) ?? shown.a;
  const { options: optionsB, restricted } = compareOptionsForB(list ?? [], optionA, selection.showAll);

  function changeA(slug: string) {
    if (!list) return;
    // Si B ya no es del mismo tipo que el nuevo A, pasa al más vendido de
    // ese tipo: así nunca queda armada una comparación parlante vs. celular.
    const next = list.find((p) => p.slug === slug);
    const { options } = compareOptionsForB(list, next, selection.showAll);
    const b = options.some((p) => p.slug === selection.b) ? selection.b : (topSeller(options)?.slug ?? '');
    select({ ...selection, a: slug, b });
  }

  function toggleShowAll(checked: boolean) {
    if (!list) return;
    let b = selection.b;
    if (!checked) {
      const { options } = compareOptionsForB(list, optionA, false);
      if (!options.some((p) => p.slug === b)) b = topSeller(options)?.slug ?? '';
    }
    select({ ...selection, showAll: checked, b });
  }

  const nameOf = (slug: string) =>
    list?.find((p) => p.slug === slug)?.name ?? cache.details.get(slug)?.name ?? '';
  const activeCategory = wantedCategory ?? selection.category;
  const categoryName = categories.find((c) => c.slug === selection.category)?.name;
  const loading = status === 'loading';
  // La tabla todavía es la del par anterior.
  const stale = loading || selection.a !== shown.a.slug || selection.b !== (shown.b?.slug ?? '');

  return (
    <div>
      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex gap-2" role="group" aria-label="Categoría a comparar">
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => pickCategory(c.slug)}
              aria-pressed={activeCategory === c.slug}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                activeCategory === c.slug
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface text-muted hover:border-accent/40 hover:text-fg'
              }`}
            >
              {c.name} <span className="text-[10px] opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <ProductSelect
          label="Producto A"
          value={selection.a}
          valueName={nameOf(selection.a)}
          options={list ?? []}
          disabled={!list}
          onChange={changeA}
        />
        <ProductSelect
          label="Producto B"
          value={selection.b}
          valueName={nameOf(selection.b)}
          options={optionsB}
          disabled={!list}
          onChange={(slug) => select({ ...selection, b: slug })}
        />
      </div>

      <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={list !== null && (selection.showAll || !restricted)}
          disabled={!list || (!selection.showAll && !restricted)}
          onChange={(e) => toggleShowAll(e.target.checked)}
          className="accent-accent"
        />
        Ver todos los productos{categoryName ? ` de ${categoryName}` : ''}
      </label>

      <p role="status" className="sr-only">
        {loading ? 'Cargando comparación…' : ''}
      </p>

      {status === 'error' && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted">
          No pudimos cargar los productos.
          <button
            type="button"
            onClick={() => retry.current()}
            className="min-h-9 rounded-full border border-accent/40 px-4 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10"
          >
            Reintentar
          </button>
        </div>
      )}

      <CompareTable pair={shown} busy={loading} stale={stale} />

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

function CompareTable({ pair: { a, b }, busy, stale }: { pair: Pair; busy: boolean; stale: boolean }) {
  const specKeys = useMemo(() => (b ? sharedSpecKeys(a.specs, b.specs) : []), [a, b]);

  if (!b) {
    return (
      <p className="mt-6 rounded-2xl border border-border bg-surface2 px-4 py-4 text-center text-sm text-muted">
        No hay otro producto en esta categoría para comparar con este.
      </p>
    );
  }

  return (
    <div
      aria-busy={busy}
      className={`mt-6 overflow-hidden rounded-2xl border border-border transition-opacity ${
        stale ? 'opacity-50' : ''
      }`}
    >
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
              href={p.href}
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
  );
}
