/**
 * Las fichas de otras tiendas enlazadas a productos del sitio (tabla
 * store_offers, migración 0022): qué se guarda después de cada lectura, qué
 * toca leer y qué se le muestra a la gente.
 *
 * Las decisiones son puras; al final van las lecturas y escrituras de la
 * tabla. Sin la migración aplicada, todo responde "no disponible" y el sitio
 * sigue igual.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { PRICE_REFERENCE_MS } from '@/lib/price-freshness';
import { cleanStoreUrl, getStore, paysCommission, storeProductUrl } from '@/lib/stores';
import type { StoreRead } from '@/lib/store-reader';

export type OfferStatus = 'activo' | 'sin_stock' | 'error' | 'pausado';

export interface StoreOfferRow {
  id: number;
  product_id: string;
  /** La clave de la tienda (lib/stores). */
  store: string;
  /** La dirección limpia de la ficha. */
  url: string;
  /** El código del producto en la tienda; elige la versión donde una ficha trae varias. */
  external_id: string | null;
  title: string | null;
  seller: string | null;
  price: number | null;
  /** Cuándo se vio ese precio. */
  checked_at: string | null;
  /** Cuándo se intentó leer por última vez. */
  tried_at: string | null;
  status: OfferStatus;
  /** Lecturas fallidas seguidas. */
  fail_count: number;
  last_error: string | null;
  created_at: string;
}

export const OFFER_COLUMNS =
  'id, product_id, store, url, external_id, title, seller, price, checked_at, tried_at, status, fail_count, last_error, created_at';

const HOUR_MS = 3_600_000;

/**
 * Cada cuánto se vuelve a leer una ficha que se leyó bien: dos veces al día.
 * Así el precio guardado nunca tiene mucho más de medio día.
 */
export const READ_EVERY_MS = 11 * HOUR_MS;
/** Una lectura que falló se reintenta antes, pero no en la pasada siguiente. */
export const RETRY_FAILED_MS = 3.5 * HOUR_MS;
/** Una ficha que ya quedó en 'error' se prueba una vez al día, por si volvió. */
export const RETRY_ERROR_MS = 22 * HOUR_MS;
/** Fallas seguidas con las que una ficha deja de mostrarse (tres días a dos lecturas diarias). */
export const MAX_FAILS = 6;
/** Una ficha que la tienda ya no tiene deja de mostrarse antes. */
const MAX_FAILS_GONE = 2;

type ReadState = Pick<StoreOfferRow, 'status' | 'fail_count' | 'external_id'>;

export interface OfferPatch {
  price?: number;
  title?: string | null;
  seller?: string | null;
  external_id?: string | null;
  checked_at?: string;
  tried_at: string;
  status: OfferStatus;
  fail_count: number;
  last_error: string | null;
}

/**
 * Lo que se guarda después de leer (o de no poder leer) una ficha. Puro.
 *
 * Una lectura fallida no borra el precio: sigue mostrándose con su fecha
 * hasta que las fallas seguidas pasan el tope. Una ficha en pausa sigue en
 * pausa pase lo que pase: la pausó una persona.
 */
export function offerPatchAfterRead(offer: ReadState, read: StoreRead, now: Date): OfferPatch {
  const at = now.toISOString();
  const paused = offer.status === 'pausado';
  if (read.ok) {
    return {
      price: read.value.price,
      title: read.value.title,
      seller: read.value.seller,
      // El código con que se enlazó manda: es el que dice qué versión es.
      external_id: offer.external_id ?? read.value.sku,
      checked_at: at,
      tried_at: at,
      status: paused ? 'pausado' : read.value.available ? 'activo' : 'sin_stock',
      fail_count: 0,
      last_error: null,
    };
  }
  const fails = offer.fail_count + 1;
  const broken = fails >= (read.reason === 'no_existe' ? MAX_FAILS_GONE : MAX_FAILS);
  return {
    tried_at: at,
    status: paused ? 'pausado' : broken ? 'error' : offer.status,
    fail_count: fails,
    last_error: `${read.reason}: ${read.detail}`.slice(0, 300),
  };
}

/** ¿Toca leer esta ficha en la pasada de ahora? Puro. */
export function dueForRead(offer: Pick<StoreOfferRow, 'status' | 'fail_count' | 'tried_at'>, now: number): boolean {
  if (offer.status === 'pausado') return false;
  const tried = offer.tried_at ? Date.parse(offer.tried_at) : NaN;
  if (!Number.isFinite(tried)) return true;
  const every = offer.status === 'error' ? RETRY_ERROR_MS : offer.fail_count > 0 ? RETRY_FAILED_MS : READ_EVERY_MS;
  return now - tried >= every;
}

const BLOCK_RE = /^(bloqueada|robots):/;

/**
 * Las tiendas que están bloqueando la lectura: todas sus fichas llevan el
 * tope de fallas seguidas y la última fue un bloqueo. A esas no se les pide
 * nada más hasta que una persona lo decida ("Leer de nuevo" en el admin):
 * no se insiste contra un bloqueo. Puro.
 */
export function blockingStores(offers: Pick<StoreOfferRow, 'store' | 'status' | 'fail_count' | 'last_error'>[]): Set<string> {
  const byStore = new Map<string, boolean>();
  for (const offer of offers) {
    if (offer.status === 'pausado') continue;
    const blocked = offer.fail_count >= MAX_FAILS && BLOCK_RE.test(offer.last_error ?? '');
    byStore.set(offer.store, (byStore.get(offer.store) ?? true) && blocked);
  }
  return new Set([...byStore].filter(([, blocked]) => blocked).map(([store]) => store));
}

/** Lo que la ficha del sitio muestra de otra tienda. Solo datos que ya son públicos. */
export interface PublicStoreOffer {
  store: string;
  storeName: string;
  price: number;
  /** Cuándo se vio ese precio: va siempre junto al precio. */
  checkedAt: string;
  /** La ficha en la tienda, sin parámetros de afiliado (los agrega lib/store-links si corresponde). */
  url: string;
  /** Quién lo vende, solo si no es la tienda misma. */
  seller: string | null;
  /** Si la tienda tiene un programa de afiliados (no dice que el link ya lo use). */
  commission: boolean;
}

type PublicRow = Pick<StoreOfferRow, 'store' | 'url' | 'external_id' | 'seller' | 'price' | 'checked_at' | 'status'>;

/**
 * Las ofertas que se pueden mostrar: de una tienda de la lista, activas, con
 * precio y con una fecha que todavía sirve de referencia (un mes, como los
 * precios de Mercado Libre). Ordenadas de menor a mayor precio. Puro.
 */
export function publicStoreOffers(rows: PublicRow[], now: number = Date.now()): PublicStoreOffer[] {
  const offers: PublicStoreOffer[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const store = getStore(row.store);
    if (!store || row.status !== 'activo' || seen.has(store.key)) continue;
    if (typeof row.price !== 'number' || !Number.isInteger(row.price) || row.price <= 0) continue;
    const checked = row.checked_at ? Date.parse(row.checked_at) : NaN;
    if (!Number.isFinite(checked) || checked > now + 5 * 60_000 || now - checked > PRICE_REFERENCE_MS) continue;
    // La dirección guardada tiene que seguir siendo de esa tienda: es un link que se le muestra a la gente.
    const clean = cleanStoreUrl(row.url);
    if (!clean || clean.store.key !== store.key) continue;
    seen.add(store.key);
    const seller = row.seller?.trim() || null;
    offers.push({
      store: store.key,
      storeName: store.name,
      price: row.price,
      checkedAt: row.checked_at as string,
      url: storeProductUrl(store, clean.url, row.external_id),
      seller: seller && seller.toLowerCase() !== store.name.toLowerCase() ? seller : null,
      commission: paysCommission(store),
    });
  }
  return offers.sort((a, b) => a.price - b.price || a.storeName.localeCompare(b.storeName));
}

// ---------------------------------------------------------------------------
// La tabla

type DbError = { code?: string; message: string } | null;

export type OffersRead =
  | { available: true; rows: StoreOfferRow[] }
  /** `missing`: falta correr la migración 0022. */
  | { available: false; missing: boolean; error: string };

const PAGE_SIZE = 1000;
const MAX_ROWS = 20_000;

/** Todas las fichas enlazadas, de a páginas (Supabase corta en 1.000 filas sin avisar). Nunca lanza. */
export async function readAllOffers(admin: SupabaseClient): Promise<OffersRead> {
  const rows: StoreOfferRow[] = [];
  try {
    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data, error } = (await admin
        .from('store_offers')
        .select(OFFER_COLUMNS)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)) as { data: unknown; error: DbError };
      if (error) return { available: false, missing: isMissingSchemaError(error), error: error.message };
      const batch = (data ?? []) as StoreOfferRow[];
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (err) {
    return { available: false, missing: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { available: true, rows };
}

/**
 * Cuántas fichas hay enlazadas; null si la tabla no existe todavía o no se
 * pudo contar. Para no anotar pasadas vacías mientras no hay nada que leer.
 */
export async function countOffers(admin: SupabaseClient): Promise<number | null> {
  try {
    const { count, error } = await admin.from('store_offers').select('id', { count: 'exact', head: true });
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}

export type OfferWrite = { ok: true } | { ok: false; missing: boolean; error: string };

function writeResult(error: DbError): OfferWrite {
  return error ? { ok: false, missing: isMissingSchemaError(error), error: error.message } : { ok: true };
}

export interface NewOffer {
  product_id: string;
  store: string;
  url: string;
  external_id: string | null;
  title: string | null;
  seller: string | null;
  price: number;
  checked_at: string;
  status: OfferStatus;
  created_by: string;
}

/**
 * Enlaza (o vuelve a enlazar) un producto con su ficha en una tienda: una
 * fila por producto y tienda. Al volver a enlazar se parte de cero: sin
 * fallas anotadas.
 */
export async function saveOffer(admin: SupabaseClient, offer: NewOffer): Promise<OfferWrite> {
  const { error } = await admin.from('store_offers').upsert(
    { ...offer, tried_at: offer.checked_at, fail_count: 0, last_error: null },
    { onConflict: 'product_id,store' }
  );
  return writeResult(error);
}

export async function patchOffer(admin: SupabaseClient, id: number, patch: Partial<OfferPatch>): Promise<OfferWrite> {
  const { error } = await admin.from('store_offers').update(patch).eq('id', id);
  return writeResult(error);
}

export async function removeOffer(admin: SupabaseClient, id: number): Promise<OfferWrite> {
  const { error } = await admin.from('store_offers').delete().eq('id', id);
  return writeResult(error);
}
