'use client';

// Componente de cliente por lo mismo que ProductCard: <Image loader={...}>
// recibe una función, y una función no cruza de servidor a cliente.
import Image from 'next/image';
import Link from 'next/link';
import { Product } from '@/lib/types';
import { formatCLP, formatDiscountPct } from '@/lib/format';
import { buyUrl } from '@/lib/outbound';
import mlImageLoader from '@/lib/ml-image-loader';
import { AffiliateButton } from './AffiliateButton';
import { DealBadge, DropChip } from './DealBadge';
import type { Placement } from '@/lib/clicks';
import type { ConfirmedDrop } from '@/lib/deal-rank';

/**
 * Franja horizontal de ofertas para el celular.
 *
 * En la grilla de dos columnas la primera oferta quedaba bajo el pliegue, y
 * el precio con su "-X%" no cabía en una tarjeta de media pantalla. Acá
 * cada tarjeta es angosta, con el descuento sobre la foto y el precio en su
 * propia línea, para que en 375 px se vea al menos una oferta completa
 * apenas carga la portada. Asomar la segunda tarjeta invita a deslizar.
 */
export function DealStrip({
  products,
  placement,
  drops,
}: {
  // Sin la descripción, que la franja no usa (ver page.tsx).
  products: Omit<Product, 'description'>[];
  placement?: Placement;
  /** Bajas comprobadas con el historial propio, por id (lib/deal-rank). */
  drops?: Record<string, ConfirmedDrop>;
}) {
  return (
    <ul className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2">
      {products.map((p) => {
        const discount = formatDiscountPct(p.price, p.original_price);
        const drop = drops?.[p.id];
        return (
          <li
            key={p.id}
            className="flex w-40 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border bg-surface"
          >
            <Link href={`/producto/${p.slug}`} className="flex flex-1 flex-col">
              <div className="relative aspect-square w-full bg-white">
                {discount && <DealBadge discount={discount} className="absolute left-2 top-2 z-10" />}
                <Image
                  loader={mlImageLoader}
                  src={p.image_url}
                  alt={p.name}
                  fill
                  sizes="160px"
                  className="object-contain p-1"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <h3 className="line-clamp-2 text-xs font-medium text-fg">{p.name}</h3>
                <p className="mt-auto font-heading text-base font-bold text-fg">{formatCLP(p.price)}</p>
                {p.original_price && discount && (
                  <p className="text-[11px] text-muted line-through">{formatCLP(p.original_price)}</p>
                )}
                {drop && <DropChip amount={drop.amount} className="mt-0.5 w-fit" />}
              </div>
            </Link>
            <div className="px-3 pb-3">
              <AffiliateButton
                href={buyUrl(p)}
                productId={p.id}
                productName={p.name}
                placement={placement}
                label="Ver en ML"
                className="w-full text-xs"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
