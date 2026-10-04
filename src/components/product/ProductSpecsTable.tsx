import { Product } from '@/lib/types';
import { reputationLabel } from '@/lib/format';

/**
 * `hideSeller`: en la ficha de un producto en pausa no se muestra el
 * vendedor guardado. Ahí el aviso dice que no hay un vendedor confiable, y
 * una fila "Reputación verde" al lado se contradecía con él.
 */
export function ProductSpecsTable({ product, hideSeller = false }: { product: Product; hideSeller?: boolean }) {
  const entries = Object.entries(product.specs ?? {});
  if (hideSeller && entries.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <table className="w-full text-sm">
        <tbody>
          {entries.map(([key, value], i) => (
            <tr key={key} className={i % 2 === 0 ? 'bg-surface' : 'bg-surface2'}>
              <td className="px-4 py-2.5 text-muted">{key}</td>
              <td className="px-4 py-2.5 text-right font-medium text-fg">{value}</td>
            </tr>
          ))}
          {!hideSeller && (
            <tr className="bg-surface2">
              <td className="px-4 py-2.5 text-muted">Vendedor</td>
              <td className="px-4 py-2.5 text-right font-medium text-fg">
                {reputationLabel(product.seller_reputation)} ·{' '}
                {product.seller_sales_count.toLocaleString('es-CL')} ventas
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
