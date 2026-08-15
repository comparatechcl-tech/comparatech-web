import Image from 'next/image';
import Link from 'next/link';
import { Product } from '@/lib/types';
import { PriceTag } from './PriceTag';

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/producto/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent/50"
    >
      <div className="relative aspect-square w-full bg-surface2">
        <Image
          src={product.image_url}
          alt={product.name}
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className="object-cover"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="text-xs uppercase tracking-wide text-muted">
          {product.brand}
        </span>
        <h3 className="line-clamp-2 font-heading text-sm font-medium text-white group-hover:text-accent">
          {product.name}
        </h3>
        <div className="mt-auto pt-2">
          <PriceTag price={product.price} originalPrice={product.original_price} />
        </div>
      </div>
    </Link>
  );
}
