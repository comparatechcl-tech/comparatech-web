/**
 * Precios revisados a mano (admin: "Precios de hoy").
 *
 * Desde el 23-11-2026 Mercado Libre no entrega precios a esta aplicación, y
 * el dueño no puede revisarlos todos los días. Lo que sí puede, cuando tiene
 * un rato, es abrir la ficha de los productos que más se abren, mirar el
 * precio y confirmarlo o corregirlo. Eso queda como el precio de hoy
 * (lib/price-freshness: 12 horas), entra al historial igual que un cambio
 * que hubiera visto la revisión automática, y deja al producto listo para
 * las historias y los videos.
 *
 * Lo que una persona ve en la ficha es el precio y, si lo hay, el precio
 * tachado. No se le pide nada más, así que no se guarda nada más: de la
 * oferta (quién vende, envío, garantía) no se afirma nada, y `offer_info`
 * queda con la marca `source: 'manual'` para que el sitio no lo muestre
 * (isManualPrice en lib/price-freshness).
 *
 * Puro: decide qué cambia; quien escribe es la acción del admin, con
 * applyPricing, igual que el refresco.
 */

import type { InactiveReason } from '@/lib/inactive-reasons';
import type { PricedProduct, PricingOutcome } from '@/lib/pricing';
import { MANUAL_PRICE_SOURCE } from '@/lib/price-freshness';
import type { OfferInfo } from '@/lib/types';

/** Lo que queda en offer_info: nada afirmado de la oferta, y la marca de que lo revisó una persona. */
export const MANUAL_OFFER_INFO: OfferInfo = {
  free_shipping: false,
  is_full: false,
  sold_by_ml: false,
  official_store: false,
  warranty: null,
  offers_count: null,
  is_lowest: null,
  source: MANUAL_PRICE_SOURCE,
};

/** Las columnas de precio son integer de Postgres; ningún producto del sitio pasa de esto. */
const MAX_PRICE = 99_999_999;

/**
 * Desde cuánto un cambio respecto del precio guardado se pregunta antes de
 * guardar: menos de la mitad o más del doble casi siempre es un dígito de
 * más o de menos.
 */
const BIG_DROP = 0.5;
const BIG_RISE = 2;
/** Un precio tachado de más del triple (67% de descuento o más) también se pregunta. */
const BIG_LIST = 3;

function pesos(n: number): string {
  return `$${Math.round(n).toLocaleString('es-CL')}`;
}

/**
 * "545.337", "$ 545.337" o "545337" → 545337. Vacío es null (no hay precio
 * tachado); cualquier otra cosa que no sea un monto entero es undefined.
 */
export function parsePesos(raw: unknown): number | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 && raw <= MAX_PRICE ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const clean = trimmed.replace(/^\$\s*/, '').replace(/[.\s]/g, '');
  if (!/^\d{1,9}$/.test(clean)) return undefined;
  const value = Number(clean);
  return value > 0 && value <= MAX_PRICE ? value : undefined;
}

export interface ManualPriceInput {
  price: number;
  /** El precio tachado que muestra la ficha, o null si no muestra ninguno. */
  listPrice: number | null;
}

export type ManualPriceCheck =
  | {
      ok: true;
      input: ManualPriceInput;
      /** Algo llama la atención: se guarda solo si la persona confirma. null si no hay nada que preguntar. */
      confirm: string | null;
    }
  | { ok: false; error: string };

/**
 * Revisa lo que escribió la persona contra el precio guardado. No decide si
 * el precio es cierto (eso lo vio ella en la ficha): atrapa lo que suele ser
 * un error de tipeo.
 */
export function checkManualPrice(storedPrice: number, rawPrice: unknown, rawList: unknown): ManualPriceCheck {
  const price = parsePesos(rawPrice);
  if (price === null) return { ok: false, error: 'Escribe el precio que muestra Mercado Libre.' };
  if (price === undefined) {
    return { ok: false, error: 'Ese precio no se entiende. Escríbelo solo con números, por ejemplo 545337.' };
  }
  const listPrice = parsePesos(rawList);
  if (listPrice === undefined) {
    return { ok: false, error: 'El precio tachado no se entiende. Escríbelo solo con números, o deja el cuadro vacío.' };
  }
  if (listPrice !== null && listPrice <= price) {
    return {
      ok: false,
      error: 'El precio tachado tiene que ser mayor que el precio de hoy. Si la ficha no muestra uno, deja el cuadro vacío.',
    };
  }

  const warnings: string[] = [];
  if (storedPrice > 0 && (price < storedPrice * BIG_DROP || price > storedPrice * BIG_RISE)) {
    warnings.push(`El precio guardado era ${pesos(storedPrice)} y escribiste ${pesos(price)}: es un cambio muy grande.`);
  }
  if (listPrice !== null && listPrice > price * BIG_LIST) {
    warnings.push(`El precio tachado (${pesos(listPrice)}) es más del triple del precio de hoy.`);
  }
  return {
    ok: true,
    input: { price, listPrice },
    confirm: warnings.length > 0 ? `${warnings.join(' ')} Revisa que no sobre ni falte un dígito.` : null,
  };
}

/** Lo que tiene que venir del producto para decidir. */
export type ManualPriceProduct = Pick<
  PricedProduct,
  | 'id'
  | 'ml_product_id'
  | 'price'
  | 'original_price'
  | 'seller_id'
  | 'winner_item_id'
  | 'is_active'
  | 'inactive_reason'
  | 'inactive_since'
>;

/**
 * Un producto en pausa por su link (lleva a otra ficha) no vuelve al sitio
 * por revisar su precio: eso se arregla en Problemas.
 */
export function canValidateByHand(product: Pick<ManualPriceProduct, 'is_active' | 'inactive_reason'>): boolean {
  return product.is_active || product.inactive_reason !== 'link_otro_producto';
}

/**
 * Lo que cambia al guardar un precio revisado a mano: el precio y el tachado
 * si son otros, la hora de revisión, y offer_info con la marca. Un producto
 * que estaba en pausa por no tener vendedor vuelve al sitio: la persona
 * acaba de verlo a la venta.
 *
 * Al historial va solo si cambió el precio o el tachado, como en la revisión
 * automática (decide en lib/pricing), sin vendedor: no se sabe quién vende.
 */
export function manualPriceOutcome(product: ManualPriceProduct, input: ManualPriceInput, now: string): PricingOutcome {
  const patch: Record<string, unknown> = { price_checked_at: now, offer_info: MANUAL_OFFER_INFO };
  if (input.price !== product.price) patch.price = input.price;
  if (input.listPrice !== (product.original_price ?? null)) patch.original_price = input.listPrice;
  const priceChanged = 'price' in patch || 'original_price' in patch;

  const reactivated = !product.is_active;
  if (reactivated) patch.is_active = true;
  if (product.inactive_reason) patch.inactive_reason = null;
  if (product.inactive_since) patch.inactive_since = null;

  return {
    id: product.id,
    result: 'activo',
    patch,
    priceChanged,
    reactivated,
    deactivated: false,
    ...(priceChanged
      ? {
          observation: {
            product_id: product.id,
            ml_product_id: product.ml_product_id,
            price: input.price,
            original_price: input.listPrice,
            seller_id: null,
            winner_item_id: null,
            observed_at: now,
          },
        }
      : {}),
    // Solo si el producto ya tuvo un ganador revisado: es la misma regla de la
    // revisión automática para la fila de partida del historial.
    ...(priceChanged && product.price > 0 && product.winner_item_id
      ? {
          previous: {
            product_id: product.id,
            ml_product_id: product.ml_product_id,
            price: product.price,
            original_price: product.original_price ?? null,
            seller_id: product.seller_id ?? null,
            winner_item_id: product.winner_item_id ?? null,
          },
        }
      : {}),
  };
}

/** Lo que la lista de "Precios de hoy" lee de cada producto. */
export interface ValidationRow {
  id: string;
  slug: string;
  name: string;
  brand: string | null;
  image_url: string;
  price: number;
  original_price: number | null;
  price_checked_at: string | null;
  ml_product_id: string | null;
  is_active: boolean;
  is_hidden: boolean;
  inactive_reason: InactiveReason | null;
  deleted_at?: string | null;
}

/**
 * En qué orden conviene revisar: primero lo que más se abre en Mercado Libre
 * desde el sitio (ahí están las ventas) y, a igual cantidad de clics, lo que
 * lleva más tiempo sin revisarse. Fuera lo oculto, lo eliminado y lo que no
 * tiene ficha: nada de eso se muestra o se puede mirar. Puro.
 */
export function rankForValidation(
  rows: ValidationRow[],
  clicks: ReadonlyMap<string, number>
): { row: ValidationRow; clicks: number }[] {
  const checked = (row: ValidationRow) => {
    const ms = row.price_checked_at ? Date.parse(row.price_checked_at) : NaN;
    return Number.isFinite(ms) ? ms : -Infinity;
  };
  return rows
    .filter((row) => !row.is_hidden && !row.deleted_at && Boolean(row.ml_product_id))
    .map((row) => ({ row, clicks: clicks.get(row.id) ?? 0 }))
    .sort(
      (a, b) =>
        b.clicks - a.clicks || checked(a.row) - checked(b.row) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0)
    );
}

/**
 * La persona abrió la ficha y el producto ya no se vende: queda en pausa,
 * igual que cuando la revisión automática no encontraba vendedor.
 */
export function manualUnavailableOutcome(product: ManualPriceProduct, now: string): PricingOutcome {
  const patch: Record<string, unknown> = { price_checked_at: now };
  if (product.is_active) patch.is_active = false;
  if (product.inactive_reason !== 'sin_ganador') patch.inactive_reason = 'sin_ganador';
  if (product.is_active || !product.inactive_since) patch.inactive_since = now;
  return {
    id: product.id,
    result: 'sin_ganador',
    patch,
    priceChanged: false,
    reactivated: false,
    deactivated: product.is_active,
  };
}
