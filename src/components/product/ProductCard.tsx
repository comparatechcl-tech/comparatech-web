import Image from 'next/image';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Product } from '@/lib/types';
import { getCategoryInfo } from '@/lib/queries/categories';
import { PriceTag } from './PriceTag';
import { AffiliateButton } from './AffiliateButton';

export function ProductCard({ product }: { product: Product }) {
  const categoryName = getCategoryInfo(product.category)?.name ?? product.category;
  const specBadges = Object.values(product.specs)
    .filter((v): v is string => typeof v === 'string' && v.length <= 16)
    .slice(0, 3);

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow">
      <Link href={`/producto/${product.slug}`} className="flex flex-1 flex-col">
        <div className="relative aspect-square w-full overflow-hidden bg-surface2">
          {product.is_featured && (
            <span className="absolute left-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-bg">
              <Sparkles size={11} /> Recomendado
            </span>
          )}
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 768px) 50vw, 25vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {categoryName}
          </span>
          <h3 className="line-clamp-2 font-heading text-sm font-medium text-white transition group-hover:text-accent">
            {product.name}
          </h3>
          {specBadges.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {specBadges.map((v) => (
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
          </div>
        </div>
      </Link>
      <div className="px-4 pb-4">
        <AffiliateButton href={product.affiliate_url} className="w-full text-xs" />
      </div>
    </div>
  );
}
