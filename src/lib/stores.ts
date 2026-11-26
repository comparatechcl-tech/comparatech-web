/**
 * Las otras tiendas cuyo precio el sitio puede mostrar junto al de Mercado
 * Libre, y cómo se trata cada una.
 *
 * Desde el 23-11-2026 Mercado Libre no entrega precios a la aplicación. Para
 * que el sitio siga comparando, se suman tiendas por tres caminos permitidos
 * (revisados el 25-11-2026; ver el informe del dueño en _local/estrategia):
 *
 *  - 'ficha': la tienda no prohíbe en sus términos que un programa lea sus
 *    páginas ni lo bloquea, y publica el precio en los datos estructurados de
 *    la ficha. Se lee una vez al día, identificándose (lib/store-reader).
 *  - 'api': la tienda entrega los precios por su conexión oficial para
 *    afiliados (AliExpress).
 *  - 'manual': los términos de la tienda prohíben leer sus páginas con
 *    programas (Samsung, Xiaomi). Su precio solo entra por el catálogo de su
 *    programa de afiliados, si lo ofrece, o escrito a mano.
 *
 * Una tienda que bloquea a los programas (Falabella, Ripley, Lider…) no está
 * en esta lista y no se agrega: no se pasa por encima de un bloqueo.
 *
 * Una tienda entra como 'ficha' solo después de revisar una ficha suya de
 * verdad: que el precio de sus datos sea el que paga cualquiera. Paris y
 * MacOnline se revisaron el 26-11-2026. WOM, abc.cl y Bip también dejan leer,
 * pero falta esa revisión (en WOM el precio depende del plan): no están.
 *
 * Puro y sin imports del servidor: lo usan el admin y las fichas.
 */

export type PriceSource = 'ficha' | 'api' | 'manual';

export interface StoreInfo {
  /** La clave que se guarda en la base (store_offers.store). */
  key: string;
  /** El nombre como se muestra. */
  name: string;
  /** Los dominios de sus fichas. Un link de otro dominio no es de esta tienda. */
  hosts: readonly string[];
  /** Cómo se sabe su precio. */
  price: PriceSource;
  /** El programa por el que paga comisión, si tiene uno abierto a ComparaTech. */
  affiliate: { network: 'awin'; merchantId: number } | { network: 'aliexpress' } | null;
  /** Dónde buscar un producto en la tienda, para encontrar su ficha. */
  searchUrl?: (query: string) => string;
  /**
   * Para las tiendas que publican varias versiones (colores, capacidades) en
   * una sola ficha: la dirección que abre esa versión, y cómo sacar la versión
   * de una dirección pegada.
   */
  variantUrl?: (url: string, sku: string) => string;
  skuFromUrl?: (url: URL) => string | null;
}

const q = (query: string) => encodeURIComponent(query.trim());

/** Un código de producto de tienda: letras, números y pocos signos. Va dentro de una dirección. */
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]{1,39}$/;

export function isStoreSku(value: unknown): value is string {
  return typeof value === 'string' && SKU_RE.test(value);
}

export const STORES: readonly StoreInfo[] = [
  {
    key: 'paris',
    name: 'Paris',
    hosts: ['www.paris.cl', 'paris.cl'],
    price: 'ficha',
    affiliate: { network: 'awin', merchantId: 124148 },
    searchUrl: (query) => `https://www.paris.cl/search/?q=${q(query)}`,
  },
  {
    key: 'maconline',
    name: 'MacOnline',
    hosts: ['www.maconline.com', 'maconline.com'],
    price: 'ficha',
    affiliate: null,
    // Una sola ficha por modelo (/products/iphone-17), con todas sus versiones.
    variantUrl: (url, sku) => `${url}#default_sku=${sku}`,
    skuFromUrl: (url) => {
      const sku = /(?:^#|&)default_sku=([^&]+)/.exec(url.hash)?.[1];
      if (!sku) return null;
      try {
        const decoded = decodeURIComponent(sku);
        return isStoreSku(decoded) ? decoded : null;
      } catch {
        return null;
      }
    },
  },
  {
    key: 'samsung',
    name: 'Samsung',
    hosts: ['www.samsung.com', 'samsung.com', 'shop.samsung.com'],
    price: 'manual',
    affiliate: { network: 'awin', merchantId: 112750 },
  },
  {
    key: 'xiaomi',
    name: 'Xiaomi',
    hosts: ['www.mi.com', 'mi.com'],
    price: 'manual',
    affiliate: { network: 'awin', merchantId: 127169 },
  },
  {
    key: 'aliexpress',
    name: 'AliExpress',
    hosts: ['www.aliexpress.com', 'aliexpress.com', 'es.aliexpress.com'],
    price: 'api',
    affiliate: { network: 'aliexpress' },
  },
];

const BY_KEY = new Map(STORES.map((store) => [store.key, store]));

export function getStore(key: string | null | undefined): StoreInfo | null {
  return (key && BY_KEY.get(key)) || null;
}

/**
 * De qué tienda es una dirección, o null si no es de ninguna de la lista.
 * Solo http(s), sin usuario ni puerto raro: lo que llega acá lo pega una
 * persona en el admin y después se le pide a ese servidor.
 */
export function storeForUrl(raw: string): { store: StoreInfo; url: URL } | null {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) return null;
  const host = url.hostname.toLowerCase();
  const store = STORES.find((s) => s.hosts.includes(host));
  return store ? { store, url } : null;
}

/**
 * La dirección limpia de una ficha: https, sin parámetros de seguimiento ni
 * ancla. Es la que se guarda y la que se lee. null si no es de una tienda de
 * la lista o no parece la ficha de un producto (la portada, por ejemplo).
 */
export function cleanStoreUrl(raw: string): { store: StoreInfo; url: string } | null {
  const found = storeForUrl(raw);
  if (!found) return null;
  const { store, url } = found;
  if (url.pathname === '/' || url.pathname === '') return null;
  // Samsung Chile vive bajo /cl/: una ficha de otro país no sirve.
  if (store.key === 'samsung' && !url.pathname.toLowerCase().startsWith('/cl/')) return null;
  if (store.key === 'xiaomi' && !url.pathname.toLowerCase().startsWith('/cl/')) return null;
  return { store, url: `https://${url.hostname.toLowerCase()}${url.pathname}` };
}

/** Si la tienda paga comisión por algún programa. */
export function paysCommission(store: StoreInfo): boolean {
  return store.affiliate !== null;
}

/** La versión (código) que trae una dirección pegada, si la tienda la pone en la dirección. */
export function skuFromStoreUrl(raw: string): string | null {
  const found = storeForUrl(raw);
  return found?.store.skuFromUrl?.(found.url) ?? null;
}

/**
 * La dirección a la que se manda a la persona: la ficha limpia y, en las
 * tiendas de una ficha por modelo, la versión exacta. Sin parámetros de
 * afiliado: eso lo agrega lib/store-links.
 */
export function storeProductUrl(store: StoreInfo, url: string, sku: string | null | undefined): string {
  return store.variantUrl && isStoreSku(sku) ? store.variantUrl(url, sku) : url;
}
