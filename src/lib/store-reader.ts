/**
 * Lee el precio que una tienda publica en la ficha de un producto, y los
 * resultados de su buscador.
 *
 * Solo tiendas marcadas 'ficha' en lib/stores: las que no prohíben en sus
 * términos que un programa lea sus páginas ni lo bloquean. El programa se
 * identifica con su nombre (USER_AGENT), respeta el robots.txt de cada tienda
 * y no insiste: una respuesta de bloqueo se anota y se deja ahí. Nunca se
 * disfraza de navegador ni usa proxies; si una tienda empieza a bloquear, deja
 * de leerse.
 *
 * El precio sale de los datos estructurados de la ficha (JSON-LD de
 * schema.org, tipo Product), que la tienda publica justamente para que los
 * programas lo lean. Siempre es el precio publicado para cualquiera, en
 * pesos: nunca el que exige la tarjeta de la tienda u otro medio de pago
 * (ver parisSellingPrice).
 *
 * El análisis es puro; solo las funciones `read…` salen a la red.
 */

import { cleanStoreUrl, type StoreInfo } from '@/lib/stores';

/** Cómo se presenta el programa ante cada tienda. */
export const USER_AGENT = 'ComparaTechBot/1.0 (+https://www.comparatech.cl/como-funciona)';
/** El nombre con que una tienda puede darle reglas propias en su robots.txt. */
const ROBOTS_TOKEN = 'comparatechbot';

const TIMEOUT_MS = 15_000;
/** Las fichas de Paris pesan cerca de 2 MB y su buscador, 4,6 MB. Más que esto no se lee. */
const MAX_BYTES = 10_000_000;
/** Las columnas de precio son integer de Postgres; ningún producto del sitio pasa de esto. */
const MAX_PRICE = 99_999_999;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Datos estructurados

const LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

type Json = Record<string, unknown>;

function isType(node: Json, wanted: string): boolean {
  const type = node['@type'];
  return type === wanted || (Array.isArray(type) && type.includes(wanted));
}

interface LdNode {
  node: Json;
  /** Si el nodo es parte de una lista de resultados (ItemList): no es "el" producto de la página. */
  inList: boolean;
}

/** Todos los nodos de los bloques JSON-LD de la página, también los que van dentro de @graph, mainEntity o una lista. */
function ldNodes(html: string): LdNode[] {
  const found: LdNode[] = [];
  const visit = (value: unknown, depth: number, inList: boolean) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, inList);
      return;
    }
    const node = value as Json;
    const listed = inList || isType(node, 'ItemList');
    found.push({ node, inList });
    visit(node['@graph'], depth + 1, listed);
    visit(node.mainEntity, depth + 1, listed);
    visit(node.itemListElement, depth + 1, true);
    visit(node.item, depth + 1, listed);
  };
  for (const match of String(html ?? '').matchAll(LD_RE)) {
    try {
      visit(JSON.parse(match[1]), 0, false);
    } catch {
      // Un bloque mal formado no impide leer los demás.
    }
  }
  return found;
}

/** 699990, "699990", "699990.00" o "699.990" → 699990. Lo que no es un monto entero en pesos, null. */
function pesos(raw: unknown): number | null {
  let value: number;
  if (typeof raw === 'number') value = raw;
  else if (typeof raw === 'string') {
    const text = raw.trim();
    if (/^\d+(\.\d{1,2})?$/.test(text)) value = Number(text);
    else if (/^\d{1,3}(\.\d{3})+$/.test(text)) value = Number(text.replace(/\./g, ''));
    else return null;
  } else return null;
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  // Un precio con decimales de verdad no es un precio en pesos chilenos.
  if (Math.abs(value - rounded) > 0.001) return null;
  return rounded > 0 && rounded <= MAX_PRICE ? rounded : null;
}

const GONE_RE = /OutOfStock|SoldOut|Discontinued/i;

interface OfferRead {
  price: number;
  available: boolean;
  seller: string | null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Las ofertas de un producto: una, varias, o un rango (AggregateOffer). De un
 * rango salen sus dos puntas: si son distintas, la ficha tiene más de un
 * precio y quien llama no elige ninguno.
 */
function offersOf(raw: unknown): OfferRead[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const offers: OfferRead[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const offer = item as Json;
    // Sin moneda no se sabe si son pesos: no se toma.
    if (offer.priceCurrency !== 'CLP') continue;
    const available = !GONE_RE.test(String(offer.availability ?? ''));
    const seller = offer.seller && typeof offer.seller === 'object' ? text((offer.seller as Json).name) : null;
    for (const amount of [offer.price, offer.lowPrice, offer.highPrice]) {
      if (amount === undefined || amount === null || amount === '') continue;
      const price = pesos(amount);
      if (price !== null) offers.push({ price, available, seller });
    }
  }
  return offers;
}

// ---------------------------------------------------------------------------
// Paris: qué precio es cuál

/**
 * Paris publica en los datos estructurados de la ficha hasta tres precios sin
 * decir cuál es cuál: el normal, el de oferta y el que exige pagar con la
 * Tarjeta Cencosud (revisado el 26-11-2026). El precio para cualquiera es el
 * de oferta y, si no hay oferta, el normal; el de la tarjeta nunca.
 *
 * Los nombres vienen en la misma página, en los datos del producto:
 * "prices":{"regular":…,"offer":…,"paymentMethod":…}. También lo dice la
 * marca data-cnstrc-item-price del bloque del precio. Se usan los dos: si se
 * contradicen, o el resultado no es uno de los precios de los datos
 * estructurados, no se toma ninguno.
 */
function parisSellingPrice(html: string, candidates: readonly number[]): number | null {
  const named = parisNamedPrices(html);
  if (named === 'ambiguo') return null;
  const marks = new Set<number>();
  for (const match of html.matchAll(/data-cnstrc-item-price="(\d{1,9})"/g)) marks.add(Number(match[1]));
  const marked = marks.size === 1 ? [...marks][0] : null;

  const fromNames = named ? (named.offer ?? named.regular) : null;
  if (fromNames !== null && marked !== null && fromNames !== marked) return null;
  const price = fromNames ?? marked;
  return price !== null && candidates.includes(price) ? price : null;
}

interface ParisPrices {
  regular: number;
  offer: number | null;
}

const PARIS_PRICES_RE = /\\?"prices\\?":\{\\?"regular\\?":/g;

/** Los precios con nombre de la ficha de Paris. 'ambiguo' si la página trae más de un juego distinto (versiones). */
function parisNamedPrices(html: string): ParisPrices | 'ambiguo' | null {
  const sets = new Map<string, ParisPrices>();
  for (const match of html.matchAll(PARIS_PRICES_RE)) {
    // Los datos van dentro de un texto de JavaScript, con las comillas escapadas.
    const slice = html.slice(match.index, match.index + 6000).replace(/\\"/g, '"');
    const start = slice.indexOf('{');
    let depth = 0;
    let end = -1;
    for (let i = start; i < slice.length; i += 1) {
      if (slice[i] === '{') depth += 1;
      else if (slice[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (start < 0 || end < 0) continue;
    let raw: Json;
    try {
      raw = JSON.parse(slice.slice(start, end)) as Json;
    } catch {
      continue;
    }
    const amount = (entry: unknown): number | null => {
      const value = entry && typeof entry === 'object' ? ((entry as Json).value as Json | undefined) : undefined;
      if (!value || value.currencyCode !== 'CLP' || value.fractionDigits !== 0) return null;
      return pesos(value.centAmount);
    };
    const regular = amount(raw.regular);
    if (regular === null) continue;
    const prices: ParisPrices = { regular, offer: raw.offer ? amount(raw.offer) : null };
    // Una oferta que no se pudo leer no se reemplaza por el precio normal.
    if (raw.offer && prices.offer === null) return 'ambiguo';
    sets.set(`${prices.regular}/${prices.offer}`, prices);
  }
  if (sets.size === 0) return null;
  return sets.size === 1 ? [...sets.values()][0] : 'ambiguo';
}

/** Tiendas que publican varios precios por ficha y cómo saber cuál es el de cualquiera. */
const PRICE_PICKERS: Record<string, (html: string, candidates: readonly number[]) => number | null> = {
  paris: parisSellingPrice,
};

// ---------------------------------------------------------------------------
// La ficha

export interface StorePrice {
  /** El nombre como lo publica la tienda. */
  title: string | null;
  price: number;
  sku: string | null;
  /** Quién lo vende, si la tienda lo dice (Paris y otras venden también productos de terceros). */
  seller: string | null;
  /** false si la tienda dice que no lo tiene. */
  available: boolean;
}

/** Una de las versiones (color, capacidad) de una ficha que trae varias. */
export interface StoreVariant {
  title: string | null;
  sku: string;
  /** null si esa versión trae más de un precio. */
  price: number | null;
}

export type ProductParse =
  | { ok: true; value: StorePrice }
  /**
   * 'sin_datos': la página no trae un producto con precio en pesos (o ya no trae la versión pedida).
   * 'varios_precios': el producto trae más de un precio y no se sabe cuál es el de cualquiera.
   * 'es_lista': no es la ficha de un producto sino una página de resultados o una categoría.
   */
  | { ok: false; reason: 'sin_datos' | 'varios_precios' | 'es_lista' }
  /** La ficha es de varias versiones (colores, capacidades): hay que decir cuál. */
  | { ok: false; reason: 'varias_versiones'; variants: StoreVariant[] };

/**
 * El producto de una ficha, según sus datos estructurados. Puro.
 *
 * Solo vale el producto propio de la página. Los que vienen dentro de una
 * lista (una búsqueda, una categoría, "también te puede interesar") no son la
 * ficha: tomar el primero de una lista le pondría a un producto el precio de
 * otro.
 *
 * `sku` elige la versión cuando la ficha trae varias (MacOnline publica todas
 * las capacidades y colores de un iPhone en una sola página).
 */
export function parseStoreProduct(store: StoreInfo, html: string, sku?: string | null): ProductParse {
  const page = String(html ?? '');
  const nodes = ldNodes(page);
  const versions = new Map<string, { node: Json; offers: OfferRead[] }>();
  for (const { node, inList } of nodes) {
    if (inList || !isType(node, 'Product')) continue;
    const offers = offersOf(node.offers);
    if (offers.length === 0) continue;
    const key = (text(node.sku) ?? '').toLowerCase();
    const known = versions.get(key);
    if (known) known.offers.push(...offers);
    else versions.set(key, { node, offers });
  }
  if (versions.size === 0) {
    const listed = nodes.some(({ node, inList }) => inList && isType(node, 'Product'));
    return { ok: false, reason: listed ? 'es_lista' : 'sin_datos' };
  }

  const priceOf = (offers: OfferRead[]): number | null => {
    const prices = [...new Set(offers.map((o) => o.price))];
    if (prices.length === 1) return prices[0];
    const picked = PRICE_PICKERS[store.key]?.(page, prices) ?? null;
    return picked !== null && prices.includes(picked) ? picked : null;
  };

  const wanted = text(sku)?.toLowerCase() ?? null;
  let chosen: { node: Json; offers: OfferRead[] } | undefined;
  if (wanted) {
    chosen = versions.get(wanted);
    // La versión guardada ya no está en la ficha: no se toma otra en su lugar.
    if (!chosen) return { ok: false, reason: 'sin_datos' };
  } else if (versions.size === 1) {
    chosen = [...versions.values()][0];
  } else {
    const variants: StoreVariant[] = [];
    for (const [key, version] of versions) {
      // Sin código no hay cómo volver a encontrar esa versión mañana.
      if (!key) continue;
      variants.push({ title: text(version.node.name), sku: text(version.node.sku)!, price: priceOf(version.offers) });
    }
    return variants.length > 0 ? { ok: false, reason: 'varias_versiones', variants: variants.slice(0, 60) } : { ok: false, reason: 'varios_precios' };
  }

  const price = priceOf(chosen.offers);
  if (price === null) return { ok: false, reason: 'varios_precios' };
  const offer = chosen.offers.find((o) => o.price === price) ?? chosen.offers[0];
  return {
    ok: true,
    value: {
      title: text(chosen.node.name),
      price,
      sku: text(chosen.node.sku),
      seller: offer.seller,
      available: chosen.offers.some((o) => o.available),
    },
  };
}

export interface SearchHit {
  title: string;
  /** La dirección limpia de la ficha en la tienda. */
  url: string;
  /** El precio que muestra el buscador: solo orienta. El que se guarda sale siempre de la ficha. */
  price: number | null;
  sku: string | null;
}

/** Los resultados de la página de búsqueda de una tienda (lista ItemList de schema.org). Puro. */
export function parseSearchResults(html: string, store: StoreInfo, max = 12): SearchHit[] {
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const { node, inList } of ldNodes(html)) {
    if (!inList || !isType(node, 'Product')) continue;
    const clean = cleanStoreUrl(String(node.url ?? ''));
    const title = text(node.name);
    if (!clean || clean.store.key !== store.key || !title || seen.has(clean.url)) continue;
    seen.add(clean.url);
    const prices = [...new Set(offersOf(node.offers).map((o) => o.price))];
    hits.push({ title, url: clean.url, price: prices.length === 1 ? prices[0] : null, sku: text(node.sku) });
    if (hits.length >= max) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// robots.txt

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

/** Convierte un patrón de robots.txt ("/buscar*", "/*.pdf$") en una expresión regular. */
function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/**
 * ¿El robots.txt deja a este programa pedir esa ruta? Usa el grupo con su
 * nombre si existe y, si no, el de todos ("*"). Gana la regla más específica
 * (la más larga); a igual largo, la que permite. Sin reglas, se puede. Puro.
 */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const groups = new Map<string, RobotsRule[]>();
  let agents: string[] = [];
  let inRules = false;
  for (const raw of String(robotsTxt ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      // Varias líneas User-agent seguidas comparten las reglas que vienen después.
      if (inRules) {
        agents = [];
        inRules = false;
      }
      agents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
    } else if (field === 'allow' || field === 'disallow') {
      inRules = true;
      // "Disallow:" vacío significa "todo permitido": no agrega regla.
      if (!value) continue;
      for (const agent of agents) groups.get(agent)?.push({ allow: field === 'allow', pattern: value });
    }
  }

  const rules = groups.get(ROBOTS_TOKEN) ?? groups.get('*') ?? [];
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!ruleRegex(rule.pattern).test(path)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export type RobotsRead =
  | { ok: true; txt: string }
  /** No se pudo saber qué permite la tienda: ante la duda, no se lee. */
  | { ok: false; detail: string };

/** El robots.txt de una tienda. Sin archivo (404), todo está permitido. Nunca lanza. */
export async function readRobots(store: StoreInfo, fetchImpl: Fetch = fetch): Promise<RobotsRead> {
  try {
    const res = await fetchImpl(`https://${store.hosts[0]}/robots.txt`, {
      headers: { 'user-agent': USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) return { ok: true, txt: '' };
    if (!res.ok) return { ok: false, detail: `robots.txt respondió ${res.status}` };
    const txt = await readCapped(res);
    return txt === null ? { ok: false, detail: 'robots.txt llegó cortado' } : { ok: true, txt: txt.slice(0, 500_000) };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'no respondió' };
  }
}

// ---------------------------------------------------------------------------
// Lectura

export type ReadFailure =
  /** La dirección no es de una tienda de la lista. */
  | 'no_es_tienda'
  /** Es de una tienda cuyo precio no se lee de la ficha (sus términos no lo permiten, o va por su conexión oficial). */
  | 'no_se_lee'
  /** El robots.txt de la tienda no deja pedir esa página. */
  | 'robots'
  /** La tienda respondió con un bloqueo (403, 429, verificación). No se insiste. */
  | 'bloqueada'
  /** La ficha ya no existe. */
  | 'no_existe'
  /** La página no trae un precio en pesos que se pueda tomar. */
  | 'sin_precio'
  /** La ficha es de varias versiones y no se dijo cuál. */
  | 'varias_versiones'
  /** Red, tiempo, o una respuesta que no es una página. */
  | 'error';

export type StoreRead =
  | { ok: true; store: StoreInfo; url: string; value: StorePrice }
  | { ok: false; reason: ReadFailure; detail: string; variants?: StoreVariant[] };

/** Cuántas redirecciones dentro de la misma tienda se siguen (de paris.cl a www.paris.cl, por ejemplo). */
const MAX_REDIRECTS = 3;

/**
 * Pide una página de la tienda. Las redirecciones se siguen a mano y solo
 * dentro de los dominios de esa tienda: este programa nunca le pide nada a un
 * servidor que no esté en la lista, lo mande quien lo mande.
 */
async function fetchPage(
  store: StoreInfo,
  url: string,
  fetchImpl: Fetch
): Promise<{ ok: true; html: string } | { ok: false; reason: ReadFailure; detail: string }> {
  let current = url;
  let res: Response;
  for (let hop = 0; ; hop += 1) {
    try {
      res = await fetchImpl(current, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : 'no respondió' };
    }
    if (res.status < 300 || res.status >= 400) break;

    const location = res.headers.get('location');
    if (!location || hop >= MAX_REDIRECTS) return { ok: false, reason: 'error', detail: 'la tienda redirige sin llegar a la ficha' };
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return { ok: false, reason: 'error', detail: 'la tienda redirigió a una dirección no válida' };
    }
    // A otro sitio (una página de verificación, por ejemplo) no se va.
    if (next.protocol !== 'https:' || next.port || !store.hosts.includes(next.hostname.toLowerCase())) {
      return { ok: false, reason: 'bloqueada', detail: 'la tienda redirigió a otro sitio' };
    }
    // A la portada: la ficha dejó de existir.
    if (next.pathname === '/' && new URL(current).pathname !== '/') {
      return { ok: false, reason: 'no_existe', detail: 'la tienda redirige esa ficha a su portada' };
    }
    current = next.toString();
  }
  if (res.status === 404 || res.status === 410) return { ok: false, reason: 'no_existe', detail: `la tienda respondió ${res.status}` };
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) {
    return { ok: false, reason: 'bloqueada', detail: `la tienda respondió ${res.status}` };
  }
  if (!res.ok) return { ok: false, reason: 'error', detail: `la tienda respondió ${res.status}` };
  const html = await readCapped(res);
  if (html === null) return { ok: false, reason: 'error', detail: 'la página se cortó o es más grande de lo esperado' };
  return { ok: true, html };
}

/**
 * El cuerpo de la respuesta, hasta MAX_BYTES. Se lee de a pedazos y se corta
 * al pasar el tope: el sitio corre con poca memoria y una respuesta enorme no
 * puede tumbarlo. null si se cortó, falló o pasó el tope.
 */
async function readCapped(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) return null;
  try {
    if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export interface ReadOptions {
  /** La versión a leer cuando la ficha trae varias (el código que la tienda le da). */
  sku?: string | null;
  fetchImpl?: Fetch;
}

/**
 * Lee el precio de una ficha. `robotsTxt` es el robots.txt de esa tienda, ya
 * leído (readRobots): quien llama lo pide una vez por tienda y por pasada.
 * Nunca lanza y nunca reintenta.
 */
export async function readStorePrice(rawUrl: string, robotsTxt: string, options: ReadOptions = {}): Promise<StoreRead> {
  const clean = cleanStoreUrl(rawUrl);
  if (!clean) return { ok: false, reason: 'no_es_tienda', detail: 'Esa dirección no es la ficha de un producto en una tienda de la lista.' };
  const { store, url } = clean;
  if (store.price !== 'ficha') {
    return {
      ok: false,
      reason: 'no_se_lee',
      detail:
        store.price === 'api'
          ? `El precio de ${store.name} llega por su conexión oficial, no leyendo la ficha.`
          : `Los términos de ${store.name} no permiten leer sus páginas con programas.`,
    };
  }
  if (!robotsAllows(robotsTxt, new URL(url).pathname)) {
    return { ok: false, reason: 'robots', detail: `El robots.txt de ${store.name} no deja leer esa página.` };
  }

  const page = await fetchPage(store, url, options.fetchImpl ?? fetch);
  if (!page.ok) return page;
  const parsed = parseStoreProduct(store, page.html, options.sku);
  if (parsed.ok) return { ok: true, store, url, value: parsed.value };
  if (parsed.reason === 'varias_versiones') {
    return {
      ok: false,
      reason: 'varias_versiones',
      detail: 'La ficha es de varias versiones (colores o capacidades): hay que elegir una.',
      variants: parsed.variants,
    };
  }
  return {
    ok: false,
    reason: 'sin_precio',
    detail:
      parsed.reason === 'varios_precios'
        ? 'La ficha trae más de un precio y no se pudo saber cuál es el que vale para cualquiera.'
        : parsed.reason === 'es_lista'
          ? 'Esa dirección es una lista de productos (una búsqueda o una categoría), no la ficha de uno.'
          : options.sku
            ? 'La ficha ya no trae esa versión del producto con un precio en pesos.'
            : 'La ficha no trae un precio en pesos en sus datos.',
  };
}

export type SearchRead = { ok: true; hits: SearchHit[] } | { ok: false; reason: ReadFailure; detail: string };

/** Busca un producto en la tienda (solo las que tienen buscador legible). Nunca lanza y nunca reintenta. */
export async function searchStore(store: StoreInfo, query: string, robotsTxt: string, fetchImpl: Fetch = fetch): Promise<SearchRead> {
  if (store.price !== 'ficha' || !store.searchUrl) {
    return { ok: false, reason: 'no_se_lee', detail: `No hay buscador que se pueda leer en ${store.name}.` };
  }
  const url = store.searchUrl(query.slice(0, 120));
  const parsed = new URL(url);
  if (!robotsAllows(robotsTxt, `${parsed.pathname}${parsed.search}`)) {
    return { ok: false, reason: 'robots', detail: `El robots.txt de ${store.name} no deja leer su buscador.` };
  }
  const page = await fetchPage(store, url, fetchImpl);
  if (!page.ok) return page;
  return { ok: true, hits: parseSearchResults(page.html, store) };
}
