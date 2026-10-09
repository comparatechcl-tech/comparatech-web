'use client';

import { useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import type { Placement } from '@/lib/clicks';
import { HOT_DEAL_DISCOUNT } from '@/lib/deal-rank';
import {
  ALL_DEALS,
  DEALS_PAGE,
  appendDealsBatch,
  dealsBatchUrl,
  dealsFilterKey,
  type DealsBatch,
  type DealsFilter,
  type LoadedDeals,
} from '@/lib/deals-listing';
import { ProductCard } from './ProductCard';

/**
 * Las ofertas con filtros por categoría.
 *
 * Con cientos de ofertas en una sola grilla, quien buscaba un monitor tenía
 * que pasar por parlantes y lavadoras para encontrarlo. Los filtros no
 * cambian la URL, así que la página sigue saliendo de caché.
 *
 * La página trae solo la primera tanda (antes traía todas las ofertas para
 * filtrarlas acá, y pesaba 700 KB). Las tandas siguientes y las de cada
 * filtro se piden a /ofertas/lote la primera vez que hacen falta, y se
 * guardan: volver a un filtro ya visto no pide nada.
 */
export function DealsBrowser({
  initial,
  categories,
  hotCount,
  placement,
}: {
  /** Primera tanda sin filtros: primero las bajas comprobadas, después por descuento. */
  initial: DealsBatch;
  /** Categorías con ofertas, en el orden del sitio. */
  categories: { slug: string; name: string; count: number }[];
  /** Cuántas ofertas hay de HOT_DEAL_DISCOUNT % o más. */
  hotCount: number;
  placement?: Placement;
}) {
  const [lists, setLists] = useState<Record<string, LoadedDeals>>(() => ({
    [dealsFilterKey(ALL_DEALS)]: appendDealsBatch(undefined, initial, 0),
  }));
  // El filtro elegido en los chips y el de la lista que está en pantalla.
  // Difieren mientras llega la primera tanda de un filtro nuevo: hasta
  // entonces se sigue viendo la lista anterior, atenuada.
  const [wanted, setWanted] = useState<DealsFilter>(ALL_DEALS);
  const [shown, setShown] = useState<DealsFilter>(ALL_DEALS);
  const [status, setStatus] = useState<Record<string, 'loading' | 'error'>>({});
  const wantedKey = useRef(dealsFilterKey(ALL_DEALS));
  const inFlight = useRef(new Set<string>());

  async function load(filter: DealsFilter, offset: number) {
    const key = dealsFilterKey(filter);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setStatus((all) => ({ ...all, [key]: 'loading' }));
    try {
      const res = await fetch(dealsBatchUrl(filter, offset));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const batch = (await res.json()) as DealsBatch;
      if (!Array.isArray(batch.items) || typeof batch.total !== 'number') throw new Error('respuesta inesperada');
      setLists((all) => ({ ...all, [key]: appendDealsBatch(all[key], batch, offset) }));
      setStatus(({ [key]: _done, ...rest }) => rest);
      // Si mientras tanto se eligió otro filtro, esta lista queda guardada
      // pero no se muestra.
      if (wantedKey.current === key) setShown(filter);
    } catch {
      setStatus((all) => ({ ...all, [key]: 'error' }));
    } finally {
      inFlight.current.delete(key);
    }
  }

  function pick(filter: DealsFilter) {
    const key = dealsFilterKey(filter);
    wantedKey.current = key;
    setWanted(filter);
    if (lists[key]) setShown(filter);
    else void load(filter, 0);
  }

  const shownKey = dealsFilterKey(shown);
  const list = lists[shownKey];
  const switching = dealsFilterKey(wanted) !== shownKey;
  const switchFailed = switching && status[dealsFilterKey(wanted)] === 'error';
  const waiting = switching && !switchFailed;
  const moreStatus = status[shownKey];

  const chip = (active: boolean) =>
    `inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
      active
        ? 'border-accent bg-accent/10 text-accent'
        : 'border-border bg-surface text-muted hover:border-accent/40 hover:text-fg'
    }`;

  return (
    <div>
      <div className="-mx-4 mb-6 overflow-x-auto px-4">
        <div className="flex gap-2" role="group" aria-label="Filtrar ofertas">
          <button
            type="button"
            onClick={() => pick({ ...wanted, category: null })}
            aria-pressed={!wanted.category}
            className={chip(!wanted.category)}
          >
            Todas <span className="text-[10px] opacity-70">{initial.total}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => pick({ ...wanted, category: wanted.category === c.slug ? null : c.slug })}
              aria-pressed={wanted.category === c.slug}
              className={chip(wanted.category === c.slug)}
            >
              {c.name} <span className="text-[10px] opacity-70">{c.count}</span>
            </button>
          ))}
          {hotCount > 0 && (
            <button
              type="button"
              onClick={() => pick({ ...wanted, hot: !wanted.hot })}
              aria-pressed={wanted.hot}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                wanted.hot
                  ? 'border-orange-500 bg-orange-500/15 text-orange-600 dark:text-orange-400'
                  : 'border-border bg-surface text-muted hover:border-orange-500/50 hover:text-fg'
              }`}
            >
              <Flame size={13} aria-hidden /> {HOT_DEAL_DISCOUNT}% o más{' '}
              <span className="text-[10px] opacity-70">{hotCount}</span>
            </button>
          )}
        </div>
      </div>

      <p role="status" className="sr-only">
        {waiting ? 'Cargando ofertas…' : ''}
      </p>

      {switchFailed && (
        <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted">
          No pudimos cargar esas ofertas.
          <button
            type="button"
            onClick={() => void load(wanted, 0)}
            className="min-h-9 rounded-full border border-accent/40 px-4 py-1.5 text-xs font-semibold text-accent transition hover:bg-accent/10"
          >
            Reintentar
          </button>
        </div>
      )}

      {list.items.length === 0 ? (
        <p className="py-12 text-center text-muted">No hay ofertas con esos filtros por ahora.</p>
      ) : (
        <div
          aria-busy={waiting}
          className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 lg:grid-cols-4 ${
            waiting ? 'opacity-50' : ''
          }`}
        >
          {list.items.map((p) => (
            <ProductCard key={p.id} product={p} placement={placement} />
          ))}
        </div>
      )}

      {list.more && !switching && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => void load(shown, list.next)}
            disabled={moreStatus === 'loading'}
            className="min-h-11 rounded-full border border-accent/40 px-6 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-60"
          >
            {moreStatus === 'loading'
              ? 'Cargando…'
              : `Ver ${Math.min(DEALS_PAGE, list.total - list.next)} ofertas más`}
          </button>
          {moreStatus === 'error' && (
            <p role="alert" className="text-xs text-muted">
              No pudimos cargar más ofertas. Toca el botón para reintentar.
            </p>
          )}
          <p className="text-xs text-muted">
            Mostrando {list.items.length} de {list.total}
          </p>
        </div>
      )}
    </div>
  );
}
