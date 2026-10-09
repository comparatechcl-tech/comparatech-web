'use client';

import { useState } from 'react';
import { Flame } from 'lucide-react';
import type { Placement } from '@/lib/clicks';
import { HOT_DEAL_DISCOUNT, discountOf, type ConfirmedDrop } from '@/lib/deal-rank';
import { ProductCard, type CardProduct } from './ProductCard';

/**
 * Cuántas ofertas se muestran de entrada y con cada "ver más". Con las 325
 * de una vez la página pesaba demasiado en un teléfono, que es de donde
 * llega casi todo el tráfico de redes.
 */
const PAGE = 48;

/**
 * Las ofertas con filtros por categoría.
 *
 * Con cientos de ofertas en una sola grilla, quien buscaba un monitor tenía
 * que pasar por parlantes y lavadoras para encontrarlo. Los filtros son de
 * cliente (no cambian la URL ni vuelven al servidor): la página sigue
 * saliendo de caché.
 */
export function DealsBrowser({
  products,
  categories,
  drops,
  placement,
}: {
  /** Ya ordenadas: primero las bajas comprobadas, después por descuento. */
  products: CardProduct[];
  /** Categorías con ofertas, en el orden del sitio. */
  categories: { slug: string; name: string; count: number }[];
  drops?: Record<string, ConfirmedDrop>;
  placement?: Placement;
}) {
  const [category, setCategory] = useState<string | null>(null);
  const [onlyHot, setOnlyHot] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const hotCount = products.filter((p) => discountOf(p) >= HOT_DEAL_DISCOUNT).length;
  const matching = products.filter(
    (p) => (!category || p.category === category) && (!onlyHot || discountOf(p) >= HOT_DEAL_DISCOUNT)
  );
  const shown = matching.slice(0, limit);

  /** Al cambiar un filtro se vuelve al comienzo de la lista. */
  function pickCategory(slug: string | null) {
    setCategory(slug);
    setLimit(PAGE);
  }
  function toggleHot() {
    setOnlyHot((v) => !v);
    setLimit(PAGE);
  }

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
          <button type="button" onClick={() => pickCategory(null)} aria-pressed={!category} className={chip(!category)}>
            Todas <span className="text-[10px] opacity-70">{products.length}</span>
          </button>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => pickCategory(category === c.slug ? null : c.slug)}
              aria-pressed={category === c.slug}
              className={chip(category === c.slug)}
            >
              {c.name} <span className="text-[10px] opacity-70">{c.count}</span>
            </button>
          ))}
          {hotCount > 0 && (
            <button
              type="button"
              onClick={toggleHot}
              aria-pressed={onlyHot}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                onlyHot
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

      {shown.length === 0 ? (
        <p className="py-12 text-center text-muted">No hay ofertas con esos filtros por ahora.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => (
            <ProductCard key={p.id} product={p} placement={placement} drop={drops?.[p.id]} />
          ))}
        </div>
      )}

      {matching.length > shown.length && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            className="min-h-11 rounded-full border border-accent/40 px-6 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/10"
          >
            Ver {Math.min(PAGE, matching.length - shown.length)} ofertas más
          </button>
          <p className="text-xs text-muted">
            Mostrando {shown.length} de {matching.length}
          </p>
        </div>
      )}
    </div>
  );
}
