import { Product } from '@/lib/types';
import type { Placement } from '@/lib/clicks';
import type { ConfirmedDrop } from '@/lib/deal-rank';
import { ProductCard } from './ProductCard';

/**
 * `placement` dice desde qué sección salen los clics de estas tarjetas. Sin
 * él, el botón lo deduce de la ruta (no distingue dos grillas de la misma
 * página, como ofertas y nuevos en la portada).
 *
 * `drops` trae las bajas de precio comprobadas, por id de producto (ver
 * lib/deal-rank). Solo las pasan las páginas que leen el historial.
 */
export function ProductGrid({
  products,
  placement,
  drops,
}: {
  products: Product[];
  placement?: Placement;
  drops?: Record<string, ConfirmedDrop>;
}) {
  if (products.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        No encontramos productos con esos filtros por ahora.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map(({ description: _description, ...card }) => (
        // Sin la descripción: la tarjeta no la usa y, como es componente de
        // cliente, viajaría completa en el HTML de cada página.
        <ProductCard key={card.id} product={card} placement={placement} drop={drops?.[card.id]} />
      ))}
    </div>
  );
}
