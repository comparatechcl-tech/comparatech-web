import { BadgeCheck, ShieldCheck, Store, Tag, Truck, Zap, type LucideIcon } from 'lucide-react';
import type { OfferInfo, Product } from '@/lib/types';

/**
 * Señales de confianza de la oferta ganadora.
 *
 * Muestra SOLO lo que Mercado Libre confirmó en la última revisión de
 * precio (ver offerInfoFrom en lib/pricing). Nada de "llega mañana" ni
 * "el mejor precio" sin comprobar: un chip falso le quita credibilidad a
 * todos los demás, y prometer algo que ML no informa va contra las reglas
 * del Programa de Afiliados.
 *
 * Sin estado ni hooks: sirve tanto en la ficha como en las tarjetas.
 */

interface Chip {
  key: string;
  label: string;
  Icon: LucideIcon;
}

/**
 * offer_info es jsonb: si viene de una versión anterior o a medio escribir,
 * cada campo se valida por separado en vez de confiar en la forma.
 */
function readOfferInfo(value: unknown): Partial<OfferInfo> | null {
  return value && typeof value === 'object' ? (value as Partial<OfferInfo>) : null;
}

/** "Garantía de fábrica: 2 años" queda igual; "12 meses" pasa a "Garantía: 12 meses". */
function warrantyLabel(text: string): string {
  return /^garant[ií]a/i.test(text) ? text : `Garantía: ${text}`;
}

function buildChips(product: Product): Chip[] {
  const info = readOfferInfo(product.offer_info);
  const chips: Chip[] = [];

  if (info?.free_shipping === true) chips.push({ key: 'envio', label: 'Envío gratis', Icon: Truck });
  // "Full" dice cómo se despacha, no cuándo llega: no se promete rapidez.
  if (info?.is_full === true) chips.push({ key: 'full', label: 'Enviado con Full', Icon: Zap });

  if (info?.sold_by_ml === true) {
    chips.push({ key: 'tienda', label: 'Vendido por Mercado Libre', Icon: Store });
  } else if (info?.official_store === true) {
    chips.push({ key: 'tienda', label: 'Tienda oficial', Icon: Store });
  }

  if (typeof info?.warranty === 'string' && info.warranty.trim()) {
    chips.push({ key: 'garantia', label: warrantyLabel(info.warranty.trim()), Icon: ShieldCheck });
  }

  const offers = info?.offers_count;
  if (info?.is_lowest === true && typeof offers === 'number' && offers >= 2) {
    chips.push({
      key: 'mejor-precio',
      // Solo se compara contra las otras ofertas de la misma ficha de ML.
      label: `Precio más bajo de las ${offers.toLocaleString('es-CL')} ofertas de esta ficha`,
      Icon: Tag,
    });
  }

  if (product.seller_reputation === 'verde' && product.seller_sales_count > 0) {
    chips.push({
      key: 'vendedor',
      label: `Vendedor reputación verde · ${product.seller_sales_count.toLocaleString('es-CL')} ventas`,
      Icon: BadgeCheck,
    });
  }

  return chips;
}

export function TrustChips({ product, compact = false }: { product: Product; compact?: boolean }) {
  const all = buildChips(product);

  // En las tarjetas cabe uno solo, y lo que más pesa al decidir es el envío.
  const chips = compact ? all.filter((c) => c.key === 'envio' || c.key === 'full').slice(0, 1) : all;
  if (chips.length === 0) return null;

  return (
    <ul className={`flex flex-wrap gap-1.5 ${compact ? '' : 'mt-3'}`} aria-label="Datos de la oferta">
      {chips.map(({ key, label, Icon }) => (
        <li
          key={key}
          className={`inline-flex items-center gap-1 rounded-full border border-border bg-surface text-fg ${
            compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Icon size={compact ? 11 : 13} className="shrink-0 text-accent" aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  );
}
