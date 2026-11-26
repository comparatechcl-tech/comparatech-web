/**
 * Clics hacia otras tiendas (bloque "Precio en otras tiendas" de la ficha).
 *
 * Van aparte de los clics hacia Mercado Libre (lib/clicks, tabla
 * outbound_clicks): esos se comparan con la Central de Afiliados y no deben
 * mezclarse con nada más. Estos se guardan en store_clicks (migración 0022).
 *
 * Sin imports del servidor: lo usan el botón (cliente) y /api/e (servidor).
 */

import { MAX_CLICK_BODY_BYTES, normalizeSrc } from '@/lib/clicks';

export interface StoreClickBody {
  productId: string;
  /** La clave de la tienda (lib/stores). Quien lo recibe revisa que exista. */
  store: string;
  src: string | null;
  mobile: boolean;
}

/** Tope de clics hacia otras tiendas por día: muy por encima del tráfico real. */
export const MAX_STORE_CLICKS_PER_DAY = 5_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORE_KEY_RE = /^[a-z]{2,20}$/;

/** sessionStorage: marca de "este producto en esta tienda ya se contó en esta sesión". */
export function storeClickDedupKey(productId: string, store: string): string {
  return `ct_tienda_${store}_${productId}`;
}

/** El cuerpo que manda el botón de una tienda: lleva `t` (la tienda) en vez de `s`. */
export function storeClickPayload(productId: string, store: string, src: string | null, mobile: boolean): string {
  return JSON.stringify({ p: productId, t: store, src, mob: mobile });
}

/**
 * Valida el cuerpo que manda el botón de una tienda. Devuelve null si no es
 * un clic hacia una tienda bien formado (por ejemplo, si es un clic hacia
 * Mercado Libre, que no trae `t`).
 */
export function parseStoreClickBody(text: string): StoreClickBody | null {
  if (typeof text !== 'string' || !text || text.length > MAX_CLICK_BODY_BYTES) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const body = data as Record<string, unknown>;
  if (typeof body.t !== 'string' || !STORE_KEY_RE.test(body.t)) return null;
  if (typeof body.p !== 'string' || !UUID_RE.test(body.p)) return null;
  return { productId: body.p.toLowerCase(), store: body.t, src: normalizeSrc(body.src), mobile: body.mob === true };
}
