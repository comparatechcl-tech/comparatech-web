'use client';

// Componente de cliente por lo mismo que ProductCard: <Image loader={...}>
// recibe una función, y una función no cruza de servidor a cliente.
import Image from 'next/image';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';
import { buyUrl } from '@/lib/outbound';
import mlImageLoader from '@/lib/ml-image-loader';
import { discountOf, type ConfirmedDrop } from '@/lib/deal-rank';
import { AffiliateButton } from './AffiliateButton';
import { DealBadge, DropChip } from './DealBadge';

/**
 * La mejor oferta del momento, en el encabezado de la portada.
 *
 * Ese espacio lo ocupaba una ilustración: linda, pero no vendía nada, y en
 * un notebook empujaba la primera oferta fuera del primer pantallazo. Ahora
 * lo primero que se ve al entrar es un producto real con su precio y su
 * botón de compra.
 */
export function DealSpotlight({
  product,
  drop,
  dropDate,
  dealsCount,
}: {
  product: Omit<Product, 'description'>;
  /** Baja comprobada con el historial propio, si la hay. */
  drop?: ConfirmedDrop | null;
  /**
   * Desde cuándo rige la baja, ya escrito ("6 oct"). Lo arma el servidor: si
   * la fecha se formateara acá, servidor y navegador podrían escribirla
   * distinto y React avisaría de una diferencia al hidratar.
   */
  dropDate?: string | null;
  /** Cuántas ofertas hay en total, para el link a /ofertas. */
  dealsCount: number;
}) {
  const discount = discountOf(product);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-surface2/80 p-5 shadow-[0_30px_80px_-40px_rgba(0,212,255,0.55)]">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-accent">
          <Flame size={15} aria-hidden /> Oferta destacada
        </span>
        <DealBadge discount={discount} className="!px-2.5 !py-1.5 !text-sm" />
      </div>

      <Link href={`/producto/${product.slug}`} className="group mt-4 flex gap-4">
        <div className="relative h-36 w-36 shrink-0 overflow-hidden rounded-2xl bg-white">
          <Image
            loader={mlImageLoader}
            src={product.image_url}
            alt={product.name}
            fill
            sizes="144px"
            priority
            className="object-contain p-2 transition duration-300 group-hover:scale-105"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <h2 className="line-clamp-3 font-heading text-base font-semibold leading-snug text-fg transition group-hover:text-accent">
            {product.name}
          </h2>
          <p className="mt-auto pt-2 font-heading text-3xl font-extrabold leading-none text-fg">
            {formatCLP(product.price)}
          </p>
          {product.original_price && discount > 0 && (
            <p className="mt-1 text-sm text-muted">
              Antes <span className="line-through">{formatCLP(product.original_price)}</span>
            </p>
          )}
          {drop && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <DropChip amount={drop.amount} />
              {dropDate && <>desde el {dropDate}</>}
            </p>
          )}
        </div>
      </Link>

      <div className="mt-4 flex items-center gap-4">
        <AffiliateButton
          href={buyUrl(product)}
          productId={product.id}
          productName={product.name}
          placement="home-ofertas"
          className="flex-1 text-sm"
        />
        <Link href="/ofertas" className="shrink-0 text-sm font-medium text-accent hover:underline">
          {dealsCount === 1 ? 'Ver la oferta →' : `Ver las ${dealsCount} ofertas →`}
        </Link>
      </div>
      <p className="mt-3 text-[11px] leading-snug text-muted">
        Descuento sobre el precio de lista informado en Mercado Libre.
      </p>
    </div>
  );
}
