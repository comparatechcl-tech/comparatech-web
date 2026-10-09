'use client';

// Componente de cliente porque <Image loader={...}> recibe una función, y
// una función no puede pasar de un componente de servidor a uno de cliente
// (next/image lo es). Todo lo que importa la tarjeta es código puro.
import Image from 'next/image';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { getCategoryInfo } from '@/lib/queries/categories';
import { PriceTag } from './PriceTag';
import { DealBadge, DropChip } from './DealBadge';
import { AffiliateButton } from './AffiliateButton';
import { dealTier, discountOf } from '@/lib/deal-rank';
import type { CardProduct } from '@/lib/card-product';
import mlImageLoader from '@/lib/ml-image-loader';
import type { Placement } from '@/lib/clicks';

/**
 * La tarjeta es de cliente, así que todo lo que recibe queda escrito en el
 * HTML. Por eso no recibe el producto entero sino un CardProduct, con las
 * insignias, el chip de envío y el link de compra ya resueltos en el
 * servidor (ver lib/card-product).
 */
export function ProductCard({
  product,
  placement,
}: {
  product: CardProduct;
  placement?: Placement;
}) {
  const categoryName = getCategoryInfo(product.category)?.name ?? product.category;
  const { badges, chip } = product;
  const dropAmount = product.drop_amount ?? 0;
  const discount = discountOf(product);
  const isDeal = dealTier(discount) !== null;

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow">
      <Link href={`/producto/${product.slug}`} className="flex flex-1 flex-col">
        <div className="relative aspect-square w-full overflow-hidden bg-white">
          {/* El descuento a la izquierda, que es donde parte la lectura; la
              marca de destacado pasa a la derecha para no taparlo. */}
          {isDeal && <DealBadge discount={discount} className="absolute left-2.5 top-2.5 z-10" />}
          {product.is_featured && (
            <span
              className={`absolute top-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-ink ${
                isDeal ? 'right-2.5' : 'left-2.5'
              }`}
            >
              <Sparkles size={11} /> Destacado
            </span>
          )}
          <Image
            loader={mlImageLoader}
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-contain transition duration-300 group-hover:scale-105"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {categoryName}
          </span>
          <h3 className="line-clamp-2 font-heading text-sm font-medium text-fg transition group-hover:text-accent">
            {product.name}
          </h3>
          {badges && badges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {badges.map((v) => (
                <span
                  key={v}
                  className="rounded-md border border-border bg-surface2 px-1.5 py-0.5 text-[10px] text-muted"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
          <div className="mt-auto pt-2">
            <PriceTag price={product.price} originalPrice={product.original_price} hideDiscount={isDeal} />
            {(dropAmount > 0 || chip) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {dropAmount > 0 && <DropChip amount={dropAmount} />}
                {chip && (
                  <span className="inline-flex rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                    {chip}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Link>
      <div className="px-4 pb-4">
        <AffiliateButton
          href={product.href}
          productId={product.id}
          productName={product.name}
          placement={placement}
          className="w-full text-xs"
        />
      </div>
    </div>
  );
}
