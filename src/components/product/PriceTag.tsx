import { formatCLP, formatDiscountPct } from '@/lib/format';

export function PriceTag({
  price,
  originalPrice,
  hideDiscount = false,
}: {
  price: number;
  originalPrice: number | null;
  /**
   * Las tarjetas muestran el descuento como distintivo sobre la foto
   * (DealBadge): repetirlo acá le quita una línea al precio en el celular.
   */
  hideDiscount?: boolean;
}) {
  const discount = formatDiscountPct(price, originalPrice);

  // flex-wrap: en la grilla de dos columnas del celular (~163 px por tarjeta)
  // precio, precio tachado y -X% no caben en una línea, y la tarjeta tiene
  // overflow-hidden: sin wrap el -X% quedaba cortado.
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-heading text-xl font-bold text-fg">
        {formatCLP(price)}
      </span>
      {originalPrice && discount && (
        <>
          <span className="text-sm text-muted line-through">
            {formatCLP(originalPrice)}
          </span>
          {!hideDiscount && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
              -{discount}%
            </span>
          )}
        </>
      )}
    </div>
  );
}
