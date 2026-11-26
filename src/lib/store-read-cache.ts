/**
 * Lo ya pedido a una tienda en este proceso, para no repetirle pedidos desde
 * el admin: su robots.txt vale una hora, y una ficha leída vale cinco minutos
 * (entre "Revisar" y "Guardar" no se le pide dos veces).
 *
 * La pasada automática (lib/store-sync) no usa esto: lee cada ficha una vez
 * y pide el robots.txt una vez por pasada.
 */

import type { StoreInfo } from '@/lib/stores';
import { readRobots, readStorePrice, type StoreRead } from '@/lib/store-reader';

const ROBOTS_TTL_MS = 60 * 60 * 1000;
const READ_TTL_MS = 5 * 60 * 1000;
const MAX_READS = 200;

const robotsCache = new Map<string, { at: number; txt: string }>();
const readCache = new Map<string, { at: number; read: StoreRead & { ok: true } }>();

/** Solo para las pruebas. */
export function clearStoreReadCache(): void {
  robotsCache.clear();
  readCache.clear();
}

export type RobotsFor = { ok: true; txt: string } | { ok: false; error: string };

/** El robots.txt de la tienda. Si no se pudo leer, no se guarda: se pregunta de nuevo la próxima vez. */
export async function robotsFor(store: StoreInfo): Promise<RobotsFor> {
  const known = robotsCache.get(store.key);
  if (known && Date.now() - known.at < ROBOTS_TTL_MS) return { ok: true, txt: known.txt };
  const read = await readRobots(store);
  if (!read.ok) {
    return {
      ok: false,
      error: `No pude leer qué permite ${store.name} (su robots.txt ${read.detail}). Ante la duda no leo su ficha: prueba más tarde.`,
    };
  }
  robotsCache.set(store.key, { at: Date.now(), txt: read.txt });
  return { ok: true, txt: read.txt };
}

/**
 * Lee la ficha, o entrega lo leído hace menos de cinco minutos. `fresh` pide
 * siempre a la tienda ("Leer de nuevo"). Solo se guardan las lecturas buenas.
 */
export async function readFicha(url: string, store: StoreInfo, sku: string | null, fresh = false): Promise<StoreRead> {
  const key = `${url}|${sku ?? ''}`;
  const known = readCache.get(key);
  if (!fresh && known && Date.now() - known.at < READ_TTL_MS) return known.read;
  const robots = await robotsFor(store);
  // Sin saber qué permite la tienda, no se le pide la ficha.
  if (!robots.ok) return { ok: false, reason: 'robots', detail: robots.error };
  const read = await readStorePrice(url, robots.txt, { sku });
  if (read.ok) {
    if (readCache.size >= MAX_READS) readCache.clear();
    readCache.set(key, { at: Date.now(), read });
  }
  return read;
}
