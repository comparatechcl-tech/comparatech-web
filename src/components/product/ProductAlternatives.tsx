import Link from 'next/link';
import { Scale } from 'lucide-react';
import { Product } from '@/lib/types';
import { ProductGrid } from './ProductGrid';
import { shortProductName } from '@/lib/text';

/**
 * Alternativas a la venta en la ficha.
 *
 * Quien llega a una ficha ya decidió qué tipo de producto quiere; si este no
 * lo convence (o hoy no está a la venta), lo siguiente es otro del mismo
 * tipo y precio parecido. Mercado Libre paga la comisión de cualquier
 * compra de la misma categoría dentro de las 24 h siguientes al clic, así
 * que cada alternativa es otra oportunidad de que la visita termine en
 * venta.
 *
 * `highlight` es para la ficha sin vendedores: ahí las alternativas son lo
 * principal de la página.
 */
export function ProductAlternatives({
  alternatives,
  title,
  highlight = false,
  compareFromSlug,
}: {
  alternatives: Product[];
  title: string;
  highlight?: boolean;
  /**
   * Slug del producto de la ficha, si se puede abrir en el comparador. Con
   * él se ofrece "Compáralo con" para las dos alternativas más cercanas.
   */
  compareFromSlug?: string;
}) {
  if (alternatives.length === 0) return null;

  const fromSlug = compareFromSlug ?? '';
  const toCompare = fromSlug ? alternatives.slice(0, 2) : [];

  return (
    <section
      aria-labelledby="alternativas"
      className={
        highlight
          ? 'mt-8 rounded-2xl border border-accent/40 bg-accent/5 p-4 sm:p-6'
          : 'mt-12'
      }
    >
      <h2 id="alternativas" className="mb-4 font-heading text-lg font-semibold sm:text-xl">
        {title}
      </h2>
      <ProductGrid products={alternatives} placement="alternativas" />

      {toCompare.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-medium text-fg">Compáralo con</p>
          <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {toCompare.map((alt) => (
              <li key={alt.id}>
                <Link
                  href={`/comparador?a=${encodeURIComponent(fromSlug)}&b=${encodeURIComponent(alt.slug)}`}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm text-muted transition hover:border-accent/40 hover:text-fg"
                >
                  <Scale size={15} className="shrink-0 text-accent" aria-hidden />
                  {shortProductName(alt.name, 45)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
