import { Product } from '@/lib/types';
import { reputationLabel } from '@/lib/format';

export function ProductSpecsTable({ product }: { product: Product }) {
  const entries = Object.entries(product.specs);

  return (
    <table className="w-full overflow-hidden rounded-lg border border-border text-sm">
      <tbody>
        {entries.map(([key, value], i) => (
          <tr key={key} className={i % 2 === 0 ? 'bg-surface' : 'bg-surface2'}>
            <td className="px-4 py-2 text-muted">{key}</td>
            <td className="px-4 py-2 text-right font-medium text-white">{value}</td>
          </tr>
        ))}
        <tr className="bg-surface2">
          <td className="px-4 py-2 text-muted">Vendedor</td>
          <td className="px-4 py-2 text-right font-medium text-white">
            {reputationLabel(product.seller_reputation)} ·{' '}
            {product.seller_sales_count.toLocaleString('es-CL')} ventas
          </td>
        </tr>
      </tbody>
    </table>
  );
}
