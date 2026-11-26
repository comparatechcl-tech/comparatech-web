import { formatCLP, formatDayMonth } from '@/lib/format';
import type { PublicStoreOffer } from '@/lib/store-offers';
import { StoreLink } from '@/components/product/StoreLink';

/**
 * "Precio en otras tiendas": lo que publican otras tiendas para el mismo
 * producto, cada precio con el día en que se revisó.
 *
 * La fecha va siempre y nunca dice "hoy": la página se guarda armada, y una
 * fecha es cierta se lea cuando se lea. Sin "mejor precio" ni "más barato":
 * la lista va de menor a mayor y cada quien compara.
 *
 * Sin ofertas no dibuja nada.
 */
export function StoreOffers({ offers, productId }: { offers: PublicStoreOffer[]; productId: string }) {
  if (offers.length === 0) return null;
  return (
    <section aria-labelledby="otras-tiendas" className="mt-10">
      <h2 id="otras-tiendas" className="mb-3 font-heading text-lg font-semibold">
        Precio en otras tiendas
      </h2>
      <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {offers.map((offer) => (
          <li key={offer.store} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="font-heading font-semibold text-fg">{offer.storeName}</p>
              {offer.seller && <p className="mt-0.5 truncate text-xs text-muted">Vendido por {offer.seller}</p>}
            </div>
            <div className="text-right">
              <p className="font-heading text-lg font-bold text-fg">{formatCLP(offer.price)}</p>
              <p className="text-xs text-muted">Precio revisado el {formatDayMonth(offer.checkedAt)}</p>
            </div>
            <StoreLink
              href={offer.url}
              productId={productId}
              store={offer.store}
              storeName={offer.storeName}
              className="w-full sm:w-auto"
            />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        Es el precio que cada tienda publica en su sitio, sin descuentos por medio de pago ni costo de envío. Puede
        haber cambiado: el de hoy está en la tienda.
      </p>
    </section>
  );
}
