/**
 * La pasada que vuelve a leer el precio de las fichas de otras tiendas
 * enlazadas a productos del sitio (tabla store_offers).
 *
 * Lee de a una, con una pausa entre pedidos a la misma tienda, y solo lo que
 * toca (lib/store-offers: dueForRead). No insiste: si una tienda responde con
 * un bloqueo, no se le pide nada más en esa pasada; y si todas sus fichas ya
 * acumularon bloqueos, no se le pide nada hasta que una persona lo decida.
 *
 * La llama /api/cron/tiendas. `deps` existe para las pruebas: ahí no hay red.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getStore, type StoreInfo } from '@/lib/stores';
import { readRobots, readStorePrice, type RobotsRead, type StoreRead } from '@/lib/store-reader';
import {
  blockingStores,
  dueForRead,
  offerPatchAfterRead,
  patchOffer,
  readAllOffers,
  type StoreOfferRow,
} from '@/lib/store-offers';

export const STORES_JOB = 'tiendas';

/** Pausa entre dos pedidos a la misma tienda. */
const PAUSE_MS = 1200;
/** Lo que alcanza a leer una pasada: el resto queda para la siguiente (corren cada 2 horas). */
const DEFAULT_LIMIT = 60;
const DEFAULT_BUDGET_MS = 100_000;

export interface SyncOptions {
  now: Date;
  /** false: lee y decide, pero no guarda nada (modo prueba). */
  write: boolean;
  limit?: number;
  budgetMs?: number;
}

export interface SyncDeps {
  readRobots: (store: StoreInfo) => Promise<RobotsRead>;
  readStorePrice: (url: string, robotsTxt: string, options: { sku?: string | null }) => Promise<StoreRead>;
  wait: (ms: number) => Promise<void>;
  /** El reloj, para el tope de tiempo de la pasada. */
  clock: () => number;
}

const REAL_DEPS: SyncDeps = {
  readRobots: (store) => readRobots(store),
  readStorePrice: (url, robotsTxt, options) => readStorePrice(url, robotsTxt, options),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock: () => Date.now(),
};

export interface SyncDetail {
  id: number;
  tienda: string;
  /** 'igual', 'cambio', 'sin_stock', o el motivo de la falla. */
  resultado: string;
  antes: number | null;
  precio: number | null;
}

export interface SyncSummary {
  ok: boolean;
  prueba: boolean;
  /** Falta correr la migración 0022: no hay nada que leer. */
  falta_tabla?: true;
  error?: string;
  enlazadas: number;
  tocaba: number;
  leidas: number;
  cambiaron: number;
  fallaron: number;
  /** Quedaron para la pasada siguiente (por el tope de cantidad o de tiempo). */
  pendientes: number;
  /** Tiendas a las que no se les pidió nada, o se les dejó de pedir, y por qué. */
  detenidas: Record<string, string>;
  detalle: SyncDetail[];
}

export interface SyncResult {
  summary: SyncSummary;
  /** Productos cuya ficha del sitio cambió a la vista (otro precio, o una tienda que aparece o desaparece). */
  changedProductIds: string[];
}

function emptySummary(write: boolean): SyncSummary {
  return { ok: true, prueba: !write, enlazadas: 0, tocaba: 0, leidas: 0, cambiaron: 0, fallaron: 0, pendientes: 0, detenidas: {}, detalle: [] };
}

const visible = (status: string, price: number | null) => status === 'activo' && price !== null;

export async function syncStoreOffers(admin: SupabaseClient, options: SyncOptions, deps: SyncDeps = REAL_DEPS): Promise<SyncResult> {
  const summary = emptySummary(options.write);
  const changed = new Set<string>();
  const nowMs = options.now.getTime();
  const limit = options.limit ?? DEFAULT_LIMIT;
  const deadline = deps.clock() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  const all = await readAllOffers(admin);
  if (!all.available) {
    if (all.missing) return { summary: { ...summary, falta_tabla: true }, changedProductIds: [] };
    return { summary: { ...summary, ok: false, error: all.error }, changedProductIds: [] };
  }
  summary.enlazadas = all.rows.length;

  const blocking = blockingStores(all.rows);
  const due = all.rows
    .filter((offer) => dueForRead(offer, nowMs))
    // Primero lo que lleva más tiempo sin intentarse; lo nunca intentado, antes que todo.
    .sort((a, b) => (a.tried_at ? Date.parse(a.tried_at) : 0) - (b.tried_at ? Date.parse(b.tried_at) : 0));
  summary.tocaba = due.length;

  const robots = new Map<string, string>();
  const lastRequest = new Map<string, number>();
  let taken = 0;

  for (const offer of due) {
    const store = getStore(offer.store);
    if (!store || store.price !== 'ficha') {
      // Una tienda que salió de la lista, o cuyo precio no se lee de la ficha: no se pide.
      continue;
    }
    if (summary.detenidas[store.key]) continue;
    if (blocking.has(store.key)) {
      summary.detenidas[store.key] = 'Viene bloqueando la lectura: no se le pide nada hasta que se decida en el admin.';
      continue;
    }
    if (taken >= limit || deps.clock() >= deadline) {
      summary.pendientes += 1;
      continue;
    }

    if (!robots.has(store.key)) {
      const read = await deps.readRobots(store);
      if (!read.ok) {
        summary.detenidas[store.key] = `No se pudo leer su robots.txt (${read.detail}): no se le pide nada en esta pasada.`;
        continue;
      }
      robots.set(store.key, read.txt);
      lastRequest.set(store.key, deps.clock());
    }

    const since = deps.clock() - (lastRequest.get(store.key) ?? 0);
    if (lastRequest.has(store.key) && since < PAUSE_MS) await deps.wait(PAUSE_MS - since);

    taken += 1;
    const read: StoreRead = await deps.readStorePrice(offer.url, robots.get(store.key) ?? '', { sku: offer.external_id });
    lastRequest.set(store.key, deps.clock());
    summary.leidas += 1;

    const patch = offerPatchAfterRead(offer, read, options.now);
    const newPrice = patch.price ?? offer.price;
    const priceChanged = read.ok && offer.price !== read.value.price;
    if (priceChanged || visible(offer.status, offer.price) !== visible(patch.status, newPrice)) changed.add(offer.product_id);
    if (priceChanged) summary.cambiaron += 1;
    if (!read.ok) summary.fallaron += 1;
    summary.detalle.push({
      id: offer.id,
      tienda: store.key,
      resultado: !read.ok ? read.reason : patch.status === 'sin_stock' ? 'sin_stock' : priceChanged ? 'cambio' : 'igual',
      antes: offer.price,
      precio: read.ok ? read.value.price : null,
    });

    if (options.write) {
      const saved = await patchOffer(admin, offer.id, patch);
      if (!saved.ok) {
        summary.ok = false;
        summary.error = saved.error;
        break;
      }
    }

    // Un bloqueo es de la tienda entera: no se sigue probando con sus otras fichas.
    if (!read.ok && (read.reason === 'bloqueada' || read.reason === 'robots')) {
      summary.detenidas[store.key] = `Respondió con un bloqueo (${read.detail}): no se le pide nada más en esta pasada.`;
    }
  }

  // Lo que quedó sin leer de una tienda detenida a mitad de pasada no es "pendiente": no se va a pedir.
  return { summary, changedProductIds: options.write ? [...changed] : [] };
}

/** Las direcciones del sitio de esos productos, para volver a armar sus fichas. Nunca lanza. */
export async function slugsOf(admin: SupabaseClient, productIds: string[]): Promise<string[]> {
  const slugs: string[] = [];
  try {
    for (let i = 0; i < productIds.length; i += 100) {
      const { data, error } = await admin
        .from('products')
        .select('slug')
        .in('id', productIds.slice(i, i + 100));
      if (error) break;
      for (const row of (data ?? []) as { slug: string | null }[]) if (row.slug) slugs.push(row.slug);
    }
  } catch {
    // Sin las direcciones, las fichas se vuelven a armar solas a las 2 horas.
  }
  return slugs;
}
