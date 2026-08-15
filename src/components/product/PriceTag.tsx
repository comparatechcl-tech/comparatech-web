import { formatCLP, formatDiscountPct } from '@/lib/format';

export function PriceTag({
  price,
  originalPrice,
}: {
  price: number;
  originalPrice: number | null;
}) {
  const discount = formatDiscountPct(price, originalPrice);

  return (
    <div className="flex items-center gap-2">
      <span className="font-heading text-xl font-bold text-white">
        {formatCLP(price)}
      </span>
      {originalPrice && discount && (
        <>
          <span className="text-sm text-muted line-through">
            {formatCLP(originalPrice)}
          </span>
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
            -{discount}%
          </span>
        </>
      )}
    </div>
  );
}
