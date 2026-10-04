/**
 * Acceso a los endpoints de catálogo de Mercado Libre que alimentan la
 * prospección diaria.
 *
 * Todo va con `client_credentials` (ver getMlToken): el token dura 6 horas y
 * no necesita refresh. Es la diferencia con el escenario de Make, que usaba
 * `refresh_token` y terminaba pegándole al límite de ML
 * ("Rate limiter grant_type refresh_token was exceeded").
 */

import { fetchWithTimeout } from '@/lib/ml-enrichment';

const API = 'https://api.mercadolibre.com';

/**
 * Categorías raíz que se recorren. Qué tipos de producto se aceptan dentro
 * de ellas lo define el mapa de dominios de lib/categories.
 */
export const ROOT_CATEGORIES = [
  'MLC1051', // Celulares y Telefonía
  'MLC1648', // Computación
  'MLC1000', // Electrónica, Audio y Video
  'MLC1574', // Hogar y Muebles
  'MLC5726', // Electrodomésticos
  'MLC1144', // Consolas y Videojuegos
  'MLC1039', // Cámaras y Accesorios
];

export interface MlSaleTerm {
  id: string;
  value_name: string | null;
}

/**
 * Una oferta de /products/{id}/items. Fuera de precio y vendedor, todo es
 * opcional: ML no siempre manda todos los campos y lo que falte no puede
 * inventarse (ver offerInfoFrom en lib/pricing).
 */
export interface MlOffer {
  item_id: string;
  seller_id: number;
  price: number;
  original_price: number | null;
  category_id?: string | null;
  condition?: string | null;
  international_delivery_mode?: string | null;
  shipping?: { free_shipping?: boolean | null; logistic_type?: string | null } | null;
  /** Texto libre: "Garantía de fábrica: 2 años". */
  warranty?: string | null;
  sale_terms?: MlSaleTerm[] | null;
  official_store_id?: number | null;
  tags?: string[] | null;
}

export interface MlSeller {
  id: number;
  nickname: string | null;
  levelId: string;
  salesCount: number;
}

/**
 * Ejecuta `fn` sobre todos los items con un tope de tareas en paralelo.
 *
 * La prospección hace cientos de llamadas a ML y la función de Vercel tiene
 * un techo de 60 segundos: en serie no alcanza, y sin tope ML empieza a
 * responder 429.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Errores de ML por endpoint desde que arrancó el proceso. Sirve para ver en
 * la respuesta del cron si ML está devolviendo 429 o 5xx, en vez de
 * enterarse por los productos que quedan sin revisar.
 */
const errorCounts = new Map<string, number>();

export function mlErrorCounts(): Record<string, number> {
  return Object.fromEntries(errorCounts);
}

/** "/products/MLC123/items" → "/products/:id/items", para agrupar los errores. */
function endpointOf(url: string): string {
  try {
    return new URL(url).pathname
      .split('/')
      .map((part) => (/^[A-Z]{3}\d+$/.test(part) || /^\d+$/.test(part) ? ':id' : part))
      .join('/');
  } catch {
    return url;
  }
}

function countError(url: string) {
  const key = endpointOf(url);
  errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Entre 500 y 1500 ms, al azar: así las tareas en paralelo no reintentan todas juntas. */
function retryDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));
}

/**
 * GET autenticado a ML con un reintento ante 429, 5xx o falla de red. Esos
 * errores casi siempre son pasajeros, y un producto sin revisar por un
 * tropiezo queda con el precio viejo hasta la corrida siguiente. Más de un
 * reintento no vale la pena: el cron tiene 45 segundos y, si ML sigue
 * saturado, insistir solo empeora el 429.
 *
 * Devuelve null si la red falla las dos veces. Un 404 no cuenta como error:
 * varios endpoints lo usan para decir "no hay nada".
 */
async function fetchMl(url: string, token: string, timeoutMs: number): Promise<Response | null> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
    } catch {
      res = null;
    }
    if (res && (res.ok || res.status === 404)) return res;

    countError(url);
    const retryable = res === null || isRetryable(res.status);
    if (!retryable || attempt === 1) break;
    await retryDelay();
  }
  return res;
}

async function getJson(url: string, token: string, timeoutMs = 8000): Promise<unknown | null> {
  const res = await fetchMl(url, token, timeoutMs);
  if (!res?.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Subcategorías de una categoría raíz.
 *
 * Se consultan en vivo en vez de dejarlas escritas a mano: ML reorganiza su
 * árbol cada tanto, y una lista fija terminaría apuntando a categorías que
 * ya no existen.
 */
export async function getSubcategories(rootId: string, token: string): Promise<string[]> {
  const data = (await getJson(`${API}/categories/${rootId}`, token)) as
    | { children_categories?: { id: string }[] }
    | null;

  const children = (data?.children_categories ?? []).map((c) => c.id).filter(Boolean);
  // Una raíz sin hijos igual sirve como fuente por sí misma.
  return children.length > 0 ? children : [rootId];
}

/**
 * Productos destacados de una categoría con su posición en el ranking de ML
 * (1 = el primero). Devuelve vacío si ML no tiene destacados para esa
 * categoría (responde 404 en varias).
 *
 * La posición importa: lo que ML destaca arriba es lo que más se vende, y es
 * la mejor señal disponible para decidir qué revisar primero.
 */
export async function getHighlightedProducts(
  categoryId: string,
  token: string
): Promise<{ id: string; position: number }[]> {
  const data = (await getJson(`${API}/highlights/MLC/category/${categoryId}`, token)) as
    | { content?: { id: string; type: string; position?: number }[] }
    | null;

  return (data?.content ?? [])
    .map((c, index) => ({
      id: c?.id,
      type: c?.type,
      // Si ML no manda la posición, el orden de la lista es el ranking.
      position: typeof c?.position === 'number' ? c.position : index + 1,
    }))
    .filter((c): c is { id: string; type: string; position: number } => c.type === 'PRODUCT' && !!c.id)
    .map((c) => ({ id: c.id, position: c.position }));
}

/** Compatibilidad con quienes solo necesitan los ids. */
export async function getHighlightedProductIds(
  categoryId: string,
  token: string
): Promise<string[]> {
  return (await getHighlightedProducts(categoryId, token)).map((c) => c.id);
}

/**
 * Raíz de cada categoría ya consultada. El árbol de ML casi no cambia y el
 * catálogo comparte pocas categorías, así que basta una consulta por
 * proceso. Los fallos no se guardan, para reintentar en la próxima.
 */
const rootCache = new Map<string, string>();

/**
 * Categoría raíz (path_from_root[0]) de una categoría de ML. Es la que define
 * la comisión de afiliado (ver lib/commission). null si ML no respondió.
 */
export async function getRootCategory(categoryId: string, token: string): Promise<string | null> {
  if (!categoryId) return null;
  const cached = rootCache.get(categoryId);
  if (cached) return cached;

  const data = (await getJson(`${API}/categories/${categoryId}`, token)) as
    | { path_from_root?: { id?: string }[] }
    | null;

  const root = data?.path_from_root?.[0]?.id ?? null;
  if (root) rootCache.set(categoryId, root);
  return root;
}

export async function getProduct(productId: string, token: string): Promise<unknown | null> {
  return getJson(`${API}/products/${productId}`, token);
}

export type WinnersResult =
  /** total: cuántas ofertas tiene la ficha (paging.total), aunque no vengan todas. */
  | { status: 'ok'; offers: MlOffer[]; total: number }
  | { status: 'no_winner' }
  | { status: 'error'; detail: string };

/**
 * Ofertas que compiten por la caja de compra de un producto de catálogo, en
 * el orden en que ML las rankea. La primera es la que ve el comprador al
 * abrir la ficha /p/{id}: es el precio que corresponde publicar.
 *
 * Distingue dos casos que antes se trataban igual, y que explicaban buena
 * parte de los productos caídos:
 *  - 404 "No winners found": ML no tiene ganador ahora mismo. Ocurre y se
 *    revierte solo; el producto queda en pausa, no muerto.
 *  - cualquier otro error (red, 5xx, 429): no dice nada sobre el producto.
 *    El cron anterior lo interpretaba como "la oferta desapareció" y
 *    desactivaba el producto por un tropiezo de la API.
 */
export async function getWinners(productId: string, token: string): Promise<WinnersResult> {
  try {
    const res = await fetchMl(`${API}/products/${productId}/items`, token, 8000);
    if (!res) return { status: 'error', detail: 'fallo de red' };
    if (res.status === 404) return { status: 'no_winner' };
    if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` };

    const data = (await res.json()) as { results?: MlOffer[]; paging?: { total?: number } };
    const offers = (data.results ?? []).filter(
      (o) => o && typeof o.price === 'number' && o.price > 0 && o.seller_id
    );
    const total =
      typeof data.paging?.total === 'number' && data.paging.total >= offers.length
        ? data.paging.total
        : offers.length;
    return offers.length > 0 ? { status: 'ok', offers, total } : { status: 'no_winner' };
  } catch (e) {
    return { status: 'error', detail: e instanceof Error ? e.message : 'fallo de red' };
  }
}

/**
 * Reputación de varios vendedores de una sola vez. `/users?ids=` acepta
 * lotes, así que un producto con 17 ofertas no cuesta 17 llamadas.
 */
export async function getSellers(
  sellerIds: number[],
  token: string
): Promise<Map<number, MlSeller>> {
  const unique = [...new Set(sellerIds)].filter(Boolean);
  const batches: number[][] = [];
  for (let i = 0; i < unique.length; i += 20) batches.push(unique.slice(i, i + 20));

  const byId = new Map<number, MlSeller>();

  await mapWithConcurrency(batches, 4, async (batch) => {
    const data = (await getJson(`${API}/users?ids=${batch.join(',')}`, token)) as
      | {
          code: number;
          body?: {
            id: number;
            nickname?: string;
            seller_reputation?: { level_id?: string; transactions?: { total?: number } };
          };
        }[]
      | null;

    for (const entry of data ?? []) {
      const body = entry?.body;
      if (entry?.code !== 200 || !body?.id) continue;
      byId.set(body.id, {
        id: body.id,
        nickname: body.nickname ?? null,
        levelId: String(body.seller_reputation?.level_id ?? ''),
        salesCount: body.seller_reputation?.transactions?.total ?? 0,
      });
    }
  });

  return byId;
}

export function isGreenSeller(seller: MlSeller | undefined): boolean {
  return !!seller && seller.levelId.includes('green');
}

/** Primera imagen del producto, que es la que ML muestra en su propia ficha. */
export function firstPictureUrl(mlProduct: unknown): string | null {
  const pictures = (mlProduct as { pictures?: { url?: string }[] })?.pictures ?? [];
  return pictures[0]?.url ?? null;
}
