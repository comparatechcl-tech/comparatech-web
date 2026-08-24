import Link from 'next/link';
import Image from 'next/image';
import { Product } from '@/lib/types';
import { formatCLP } from '@/lib/format';

/**
 * Otras variantes (colores) del mismo producto.
 *
 * Los listados muestran una sola tarjeta por familia, quedándose con la más
 * barata. Sin este bloque, las demás quedarían inalcanzables desde el sitio:
 * que los Redmi Buds rosados cuesten $300 menos no significa que nadie quiera
 * los negros.
 */
export function VariantLinks({ variants }: { variants: Product[] }) {
  if (variants.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="mb-3 font-heading text-lg font-semibold">
        Otras versiones de este producto
      </h2>
      <div className="flex flex-wrap gap-3">
        {variants.map((v) => (
          <Link
            key={v.id}
            href={`/producto/${v.slug}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 transition hover:border-accent/40"
          >
            <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-surface2">
              <Image src={v.image_url} alt="" fill sizes="48px" className="object-cover" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">
                {variantLabel(v)}
              </span>
              <span className="block text-sm font-semibold text-accent">
                {formatCLP(v.price)}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * Entre variantes lo único que cambia suele ser el color, así que ese es el
 * mejor rótulo. Los nombres completos de ML miden 76-90 caracteres y son casi
 * idénticos entre sí, así que no distinguen nada.
 */
function variantLabel(product: Product): string {
  const color = product.specs?.Color;
  return typeof color === 'string' && color.trim() ? color : product.name;
}
