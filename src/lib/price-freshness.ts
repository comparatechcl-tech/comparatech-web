/**
 * Qué se puede decir de un precio guardado, según cuándo se revisó.
 *
 * Desde el 23-11-2026 Mercado Libre no entrega precios a esta aplicación
 * (ver winnersGate en lib/ml-catalog), así que el precio de cada producto es
 * el de su última revisión y nada más. Un precio sin revisar hoy no se
 * muestra como si fuera el de hoy: va con su fecha, sin descuento, envío ni
 * vendedor (eso también cambia), y el botón manda a ver el precio de hoy en
 * Mercado Libre. Pasado un mes ya ni sirve de referencia y no se muestra.
 *
 * Si un precio vuelve a revisarse (ML reabre la consulta, u otra fuente), el
 * producto vuelve solo al estado 'hoy'.
 *
 * Sin imports del servidor: lo usan también componentes de cliente.
 */
import { formatDayMonth } from '@/lib/format';

const HOUR_MS = 3_600_000;

/**
 * Hasta cuándo un precio revisado cuenta como el de hoy. La revisión normal
 * es cada hora: con 12 horas sin revisar ya no se puede decir que ese precio
 * es el de hoy, y en días de ofertas menos.
 */
export const PRICE_TODAY_MS = 12 * HOUR_MS;

/** Hasta cuándo un precio revisado se muestra como referencia, con su fecha. */
export const PRICE_REFERENCE_MS = 30 * 24 * HOUR_MS;

export type PriceState =
  /** Revisado en las últimas 12 horas: se muestra como siempre. */
  | 'hoy'
  /** Revisado hace más de 12 horas y menos de un mes: se muestra con su fecha. */
  | 'referencia'
  /** Nunca revisado, o hace más de un mes: no se muestra un precio. */
  | 'sin_precio';

export function priceState(checkedAt: string | null | undefined, now: number = Date.now()): PriceState {
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  // Una fecha "del futuro" por más que un desfase de relojes no dice cuándo se revisó.
  if (!Number.isFinite(checked) || checked > now + 5 * 60_000) return 'sin_precio';
  const age = now - checked;
  if (age <= PRICE_TODAY_MS) return 'hoy';
  return age <= PRICE_REFERENCE_MS ? 'referencia' : 'sin_precio';
}

/**
 * ¿El precio se revisó hace `maxAgeMs` o menos? Para las reglas que exigen
 * algo más reciente que "hoy": una historia o un video se suben con el precio
 * escrito, y ahí el plazo es de horas (lib/social: maxPriceAgeMs).
 */
export function priceCheckedWithin(
  checkedAt: string | null | undefined,
  maxAgeMs: number,
  now: number = Date.now()
): boolean {
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  return Number.isFinite(checked) && checked <= now + 5 * 60_000 && now - checked <= maxAgeMs;
}

/**
 * ¿Algún precio cambió de estado entre `since` y `now` (dejó de ser el de hoy,
 * o dejó de servir de referencia)? Las páginas se guardan armadas y solo se
 * vuelven a armar cuando alguien las pide después de vencidas: sin borrarlas
 * en ese momento, una ficha poco visitada seguiría diciendo "hoy" días después.
 */
export function priceStateChangedSince(
  checkedAts: (string | null | undefined)[],
  since: number,
  now: number = Date.now()
): boolean {
  return checkedAts.some((checkedAt) => {
    const checked = checkedAt ? Date.parse(checkedAt) : NaN;
    // Sin fecha, o revisado después de `since`: no cambió por el paso del tiempo.
    if (!Number.isFinite(checked) || checked > since) return false;
    return priceState(checkedAt, since) !== priceState(checkedAt, now);
  });
}

/** La revisión de precio más reciente entre varios productos; null si ninguno tiene una fecha válida. */
export function latestPriceCheck(products: { price_checked_at?: string | null }[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const p of products) {
    const t = p.price_checked_at ? Date.parse(p.price_checked_at) : NaN;
    if (Number.isFinite(t) && t > latestMs) {
      latestMs = t;
      latest = p.price_checked_at ?? null;
    }
  }
  return latest;
}

/**
 * ¿Hay precios revisados hoy en esta lista? Sin ninguno, una página no puede
 * hablar de "hoy": ni ofertas del día, ni bajas, ni mediciones.
 */
export function hasPricesToday(products: { price_checked_at?: string | null }[], now: number = Date.now()): boolean {
  return priceState(latestPriceCheck(products), now) === 'hoy';
}

/** "23/11": el día de la última revisión, para acompañar un precio de referencia. */
export function priceDateLabel(checkedAt: string): string {
  return formatDayMonth(checkedAt);
}

/** Lo que dice el botón de compra según el estado del precio. `short` para las tarjetas, donde no cabe más. */
export function buyLabel(state: PriceState, short = false): string {
  if (state === 'hoy') return 'Ver en Mercado Libre';
  return short ? 'Ver precio de hoy' : 'Ver precio de hoy en Mercado Libre';
}

type OfferFields = {
  price_checked_at?: string | null;
  original_price: number | null;
  offer_info?: unknown;
};

/**
 * El producto tal como se puede mostrar hoy. Con el precio sin revisar hoy se
 * quitan el precio de lista (y con él, el descuento) y los datos de la oferta
 * ganadora (envío, tienda, garantía): eran de ese día y nadie sabe si siguen.
 * El precio queda, para ordenar y para mostrarlo con su fecha.
 */
export function withoutStaleOffer<T extends OfferFields>(product: T, now: number = Date.now()): T {
  if (priceState(product.price_checked_at, now) === 'hoy') return product;
  if (product.original_price === null && (product.offer_info === null || product.offer_info === undefined)) return product;
  return { ...product, original_price: null, ...('offer_info' in product ? { offer_info: null } : {}) };
}
