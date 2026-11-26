'use server';

/**
 * Acciones de "Otras tiendas" (/admin/tiendas): enlazar un producto del sitio
 * con su ficha en otra tienda, volver a leerla, pausarla, quitarla, y decidir
 * si el sitio muestra esos precios.
 *
 * Leer una ficha es un pedido a la tienda, identificándose y respetando su
 * robots.txt (lib/store-reader). Nada de esto le pide algo a Mercado Libre.
 *
 * Solo el sitio publicado escribe (isProductionRuntime). En el PC del dueño o
 * en una copia de prueba las acciones leen y responden qué guardarían, sin
 * tocar la base: `test: true`.
 */

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { isProductionRuntime } from '@/lib/runtime-env';
import { cleanStoreUrl, getStore, isStoreSku, skuFromStoreUrl, type StoreInfo } from '@/lib/stores';
import { searchStore, type SearchHit, type StoreRead, type StoreVariant } from '@/lib/store-reader';
import { readFicha, robotsFor } from '@/lib/store-read-cache';
import { OFFER_COLUMNS, offerPatchAfterRead, patchOffer, removeOffer, saveOffer, type StoreOfferRow } from '@/lib/store-offers';
import { writeStoreSettings } from '@/lib/store-settings';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
type Fail = { ok: false; error: string };

const NO_ADMIN: Fail = { ok: false, error: 'La base no está configurada en este servidor.' };
const MISSING_TABLE = 'Falta correr la migración 0022 en Supabase: sin ella no hay dónde guardar.';

// ---------------------------------------------------------------------------
// El producto del sitio

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  price: number;
  is_hidden: boolean;
}

async function readProduct(admin: Admin, productId: string): Promise<ProductRow | null> {
  if (!UUID_RE.test(productId)) return null;
  const { data, error } = await admin.from('products').select('id, slug, name, price, is_hidden').eq('id', productId).maybeSingle();
  return error ? null : ((data as ProductRow | null) ?? null);
}

function refreshProduct(slug: string) {
  // El precio de otra tienda solo se ve en la ficha de ese producto.
  revalidatePath(`/producto/${slug}`);
  revalidatePath('/admin/tiendas');
}

// ---------------------------------------------------------------------------
// Revisar y enlazar

export interface FichaPreview {
  store: string;
  storeName: string;
  url: string;
  title: string | null;
  price: number;
  sku: string | null;
  seller: string | null;
  available: boolean;
  /** Cosas que conviene mirar antes de guardar. */
  warnings: string[];
}

export type ReviewResult =
  | { ok: true; preview: FichaPreview }
  /** La ficha trae varias versiones: hay que elegir una. */
  | { ok: false; variants: StoreVariant[]; store: string; storeName: string; url: string }
  | Fail;

function readError(read: StoreRead & { ok: false }, store: StoreInfo): string {
  switch (read.reason) {
    case 'bloqueada':
      return `${store.name} no dejó leer la ficha (${read.detail}). No insisto: prueba más tarde.`;
    case 'no_existe':
      return `Esa ficha ya no existe en ${store.name}.`;
    case 'robots':
      return read.detail;
    case 'sin_precio':
      return read.detail;
    case 'error':
      return `No pude leer la ficha de ${store.name} (${read.detail}). Prueba de nuevo en un rato.`;
    default:
      return read.detail;
  }
}

function warningsFor(product: ProductRow, value: { price: number; seller: string | null; available: boolean }, store: StoreInfo): string[] {
  const warnings: string[] = [];
  if (product.price > 0 && (value.price < product.price * 0.5 || value.price > product.price * 2)) {
    warnings.push(
      'El precio es muy distinto al que el sitio tiene de Mercado Libre: revisa que sea el mismo producto (y no un accesorio, un pack u otra capacidad).'
    );
  }
  if (value.seller && value.seller.toLowerCase() !== store.name.toLowerCase()) {
    warnings.push(`Lo vende ${value.seller} dentro de ${store.name}, no ${store.name} directamente.`);
  }
  if (!value.available) warnings.push(`${store.name} dice que no tiene stock: se guarda, pero no se muestra hasta que vuelva.`);
  return warnings;
}

type Inspected =
  | { ok: true; store: StoreInfo; url: string; sku: string | null; read: StoreRead & { ok: true } }
  | { ok: false; result: ReviewResult };

async function inspect(rawUrl: string, rawSku: string | null | undefined): Promise<Inspected> {
  const clean = cleanStoreUrl(String(rawUrl ?? ''));
  if (!clean) {
    return {
      ok: false,
      result: { ok: false, error: 'Ese link no es la ficha de un producto en una tienda que el sitio pueda leer. Por ahora: Paris y MacOnline.' },
    };
  }
  const { store, url } = clean;
  if (store.price !== 'ficha') {
    return {
      ok: false,
      result: {
        ok: false,
        error:
          store.price === 'api'
            ? `El precio de ${store.name} va a llegar por su conexión oficial de afiliados: falta conectarla.`
            : `${store.name} no permite en sus términos leer sus páginas con programas. Su precio solo puede entrar por su programa de afiliados.`,
      },
    };
  }
  const sku = isStoreSku(rawSku) ? rawSku : skuFromStoreUrl(String(rawUrl ?? ''));
  const read = await readFicha(url, store, sku);
  if (read.ok) return { ok: true, store, url, sku, read };
  if (read.reason === 'varias_versiones' && read.variants?.length) {
    return { ok: false, result: { ok: false, variants: read.variants, store: store.key, storeName: store.name, url } };
  }
  return { ok: false, result: { ok: false, error: readError(read, store) } };
}

/** Lee la ficha de la tienda y muestra qué dice, sin guardar nada. */
export async function reviewStoreLink(productId: string, rawUrl: string, rawSku?: string | null): Promise<ReviewResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return NO_ADMIN;
  const product = await readProduct(admin, productId);
  if (!product) return { ok: false, error: 'Ese producto ya no existe en el sitio.' };

  const found = await inspect(rawUrl, rawSku);
  if (!found.ok) return found.result;
  const { store, url, read } = found;
  return {
    ok: true,
    preview: {
      store: store.key,
      storeName: store.name,
      url,
      title: read.value.title,
      price: read.value.price,
      sku: read.value.sku,
      seller: read.value.seller,
      available: read.value.available,
      warnings: warningsFor(product, read.value, store),
    },
  };
}

export type LinkResult = { ok: true; test: boolean; price: number; storeName: string } | Fail;

/** Enlaza el producto con esa ficha: guarda el precio leído y, desde ahí, la pasada automática lo mantiene. */
export async function linkStoreOffer(productId: string, rawUrl: string, rawSku?: string | null): Promise<LinkResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return NO_ADMIN;
  const product = await readProduct(admin, productId);
  if (!product) return { ok: false, error: 'Ese producto ya no existe en el sitio.' };

  const found = await inspect(rawUrl, rawSku);
  if (!found.ok) {
    const result = found.result;
    if ('variants' in result) return { ok: false, error: 'Esa ficha trae varias versiones: elige una antes de guardar.' };
    return result.ok ? { ok: false, error: 'No pude leer la ficha.' } : result;
  }
  const { store, url, read } = found;
  // La versión elegida, o el código que trae la ficha: con él se vuelve a encontrar mañana.
  const sku = found.sku ?? read.value.sku;

  if (!isProductionRuntime()) return { ok: true, test: true, price: read.value.price, storeName: store.name };

  const saved = await saveOffer(admin, {
    product_id: product.id,
    store: store.key,
    url,
    external_id: sku,
    title: read.value.title,
    seller: read.value.seller,
    price: read.value.price,
    checked_at: new Date().toISOString(),
    status: read.value.available ? 'activo' : 'sin_stock',
    created_by: actor,
  });
  if (!saved.ok) return { ok: false, error: saved.missing ? MISSING_TABLE : `No se pudo guardar: ${saved.error}` };

  await logAdminEvent(admin, {
    actor,
    action: 'tienda_enlazar',
    target: product.id,
    after: { nombre: product.name, tienda: store.name, precio: read.value.price, url },
  });
  refreshProduct(product.slug);
  return { ok: true, test: false, price: read.value.price, storeName: store.name };
}

// ---------------------------------------------------------------------------
// Buscar en la tienda

export type SearchResult = { ok: true; storeName: string; hits: SearchHit[] } | Fail;

/** Busca el producto en una tienda con buscador legible (Paris) y muestra sus resultados. Un pedido. */
export async function searchInStore(storeKey: string, rawQuery: string): Promise<SearchResult> {
  await requireAdmin();
  const store = getStore(storeKey);
  if (!store || store.price !== 'ficha' || !store.searchUrl) return { ok: false, error: 'En esa tienda no se puede buscar desde acá: pega el link de la ficha.' };
  const query = String(rawQuery ?? '')
    .replace(/[^\p{L}\p{N} +.\-/"']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (query.length < 3) return { ok: false, error: 'Escribe al menos 3 letras para buscar.' };

  const robots = await robotsFor(store);
  if (!robots.ok) return { ok: false, error: robots.error };
  const result = await searchStore(store, query, robots.txt);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'bloqueada'
          ? `${store.name} no dejó usar su buscador (${result.detail}). No insisto: pega el link de la ficha.`
          : `No pude buscar en ${store.name} (${result.detail}).`,
    };
  }
  return { ok: true, storeName: store.name, hits: result.hits.slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Las fichas ya enlazadas

async function readOffer(admin: Admin, offerId: number): Promise<{ row: StoreOfferRow | null; missing: boolean }> {
  if (!Number.isInteger(offerId) || offerId <= 0) return { row: null, missing: false };
  const { data, error } = await admin.from('store_offers').select(OFFER_COLUMNS).eq('id', offerId).maybeSingle();
  if (error) return { row: null, missing: true };
  return { row: (data as unknown as StoreOfferRow | null) ?? null, missing: false };
}

export type RereadResult = { ok: true; test: boolean; price: number | null; message: string } | Fail;

/** Vuelve a leer ahora la ficha de la tienda. Es también la forma de probar de nuevo una tienda que venía bloqueando. */
export async function rereadOffer(offerId: number): Promise<RereadResult> {
  await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return NO_ADMIN;
  const { row } = await readOffer(admin, offerId);
  if (!row) return { ok: false, error: 'Esa ficha ya no está enlazada.' };
  const store = getStore(row.store);
  if (!store || store.price !== 'ficha') return { ok: false, error: 'El precio de esa tienda no se lee de la ficha.' };

  const result = await readFicha(row.url, store, row.external_id, true);
  const patch = offerPatchAfterRead(row, result, new Date());
  const message = result.ok
    ? result.value.available
      ? `${store.name} dice $${result.value.price.toLocaleString('es-CL')}.`
      : `${store.name} dice que no tiene stock.`
    : readError(result, store);

  if (!isProductionRuntime()) return { ok: true, test: true, price: result.ok ? result.value.price : row.price, message };

  const saved = await patchOffer(admin, row.id, patch);
  if (!saved.ok) return { ok: false, error: `No se pudo guardar: ${saved.error}` };
  const product = await readProduct(admin, row.product_id);
  if (product) refreshProduct(product.slug);
  return { ok: true, test: false, price: result.ok ? result.value.price : row.price, message };
}

export type SimpleResult = { ok: true; test: boolean } | Fail;

/** Pausa una ficha (no se muestra ni se lee) o la reanuda. */
export async function setOfferPaused(offerId: number, paused: boolean): Promise<SimpleResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return NO_ADMIN;
  const { row } = await readOffer(admin, offerId);
  if (!row) return { ok: false, error: 'Esa ficha ya no está enlazada.' };
  if (!isProductionRuntime()) return { ok: true, test: true };

  // Al reanudar parte de cero: sin fallas anotadas y lista para leerse en la pasada siguiente.
  const { error } = await admin
    .from('store_offers')
    .update(paused ? { status: 'pausado' } : { status: 'activo', fail_count: 0, last_error: null, tried_at: null })
    .eq('id', row.id);
  if (error) return { ok: false, error: `No se pudo guardar: ${error.message}` };

  const product = await readProduct(admin, row.product_id);
  await logAdminEvent(admin, {
    actor,
    action: 'tienda_pausar',
    target: row.product_id,
    after: { nombre: product?.name ?? null, tienda: getStore(row.store)?.name ?? row.store, pausada: paused },
  });
  if (product) refreshProduct(product.slug);
  return { ok: true, test: false };
}

/** Quita el enlace: el producto deja de mostrar esa tienda y la ficha no se lee más. */
export async function unlinkOffer(offerId: number): Promise<SimpleResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return NO_ADMIN;
  const { row } = await readOffer(admin, offerId);
  if (!row) return { ok: false, error: 'Esa ficha ya no está enlazada.' };
  if (!isProductionRuntime()) return { ok: true, test: true };

  const removed = await removeOffer(admin, row.id);
  if (!removed.ok) return { ok: false, error: `No se pudo quitar: ${removed.error}` };
  const product = await readProduct(admin, row.product_id);
  await logAdminEvent(admin, {
    actor,
    action: 'tienda_quitar',
    target: row.product_id,
    before: { nombre: product?.name ?? null, tienda: getStore(row.store)?.name ?? row.store, precio: row.price, url: row.url },
  });
  if (product) refreshProduct(product.slug);
  return { ok: true, test: false };
}

// ---------------------------------------------------------------------------
// Mostrar o no en el sitio

/** Enciende o apaga el bloque "Precio en otras tiendas" de las fichas del sitio. */
export async function setStoresVisible(show: boolean): Promise<SimpleResult> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return NO_ADMIN;
  if (!isProductionRuntime()) return { ok: true, test: true };

  const saved = await writeStoreSettings(admin, { show: show === true });
  if (!saved.ok) return { ok: false, error: `No se pudo guardar: ${saved.error}` };
  await logAdminEvent(admin, { actor, action: 'tiendas_mostrar', before: { mostrar: saved.previous.show }, after: { mostrar: show === true } });
  // Todas las fichas: en cualquiera puede aparecer o desaparecer el bloque.
  revalidatePath('/producto/[slug]', 'page');
  // "Cómo funciona" explica las otras tiendas solo cuando se muestran.
  revalidatePath('/como-funciona');
  revalidatePath('/admin/tiendas');
  return { ok: true, test: false };
}
