'use client';

// Componente de cliente porque <Image loader={...}> recibe una función, y
// una función no puede pasar de un componente de servidor a uno de cliente
// (next/image lo es). Todo lo que importa la tarjeta es código puro.
import Image from 'next/image';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Product } from '@/lib/types';
import { getCategoryInfo } from '@/lib/queries/categories';
import { PriceTag } from './PriceTag';
import { AffiliateButton } from './AffiliateButton';
import { buyUrl } from '@/lib/outbound';
import { specBadges } from '@/lib/spec-badges';
import mlImageLoader from '@/lib/ml-image-loader';
import type { Placement } from '@/lib/clicks';

/**
 * Lo mínimo que la tarjeta lee de la oferta ganadora. Se declara acá y no
 * se importa el tipo completo para que la tarjeta compile aunque el
 * producto todavía no traiga ese dato (columna nueva, se llena con el cron).
 */
type CardOfferInfo = { free_shipping?: boolean | null; is_full?: boolean | null };

/** Un solo chip, el que más pesa al decidir: envío gratis gana a Full. */
function offerChip(offer: CardOfferInfo | null | undefined): string | null {
  if (!offer) return null;
  if (offer.free_shipping === true) return 'Envío gratis';
  if (offer.is_full === true) return 'Full';
  return null;
}

/**
 * La tarjeta es de cliente, así que todo lo que recibe queda escrito en el
 * HTML. La descripción (larga, y la tarjeta no la muestra) se deja fuera:
 * ProductGrid la quita antes de pasar cada producto.
 */
export type CardProduct = Omit<Product, 'description'>;

export function ProductCard({ product, placement }: { product: CardProduct; placement?: Placement }) {
  const categoryName = getCategoryInfo(product.category)?.name ?? product.category;
  const badges = specBadges(product.specs);
  const chip = offerChip((product as CardProduct & { offer_info?: CardOfferInfo | null }).offer_info);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow">
      <Link href={`/producto/${product.slug}`} className="flex flex-1 flex-col">
        <div className="relative aspect-square w-full overflow-hidden bg-white">
          {product.is_featured && (
            <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-ink">
              <Sparkles size={11} /> Recomendado
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
          {badges.length > 0 && (
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
            <PriceTag price={product.price} originalPrice={product.original_price} />
            {chip && (
              <span className="mt-1.5 inline-flex rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {chip}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="px-4 pb-4">
        <AffiliateButton
          href={buyUrl(product)}
          productId={product.id}
          productName={product.name}
          placement={placement}
          className="w-full text-xs"
        />
      </div>
    </div>
  );
}
