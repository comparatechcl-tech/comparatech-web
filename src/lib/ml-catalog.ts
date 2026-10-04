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

export interface MlOffer {
  item_id: string;
  seller_id: number;
  price: number;
  original_price: number | null;
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

async function getJson(url: string, token: string, timeoutMs = 8000): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
    if (!res.ok) return null;
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
 * IDs de producto destacados de una categoría. Devuelve vacío si ML no tiene
 * destacados para esa categoría (responde 404 en varias).
 */
export async function getHighlightedProductIds(
  categoryId: string,
  token: string
): Promise<string[]> {
  const data = (await getJson(`${API}/highlights/MLC/category/${categoryId}`, token)) as
    | { content?: { id: string; type: string }[] }
    | null;

  return (data?.content ?? []).filter((c) => c.type === 'PRODUCT' && c.id).map((c) => c.id);
}

export async function getProduct(productId: string, token: string): Promise<unknown | null> {
  return getJson(`${API}/products/${productId}`, token);
}

export type WinnersResult =
  | { status: 'ok'; offers: MlOffer[] }
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
    const res = await fetchWithTimeout(
      `${API}/products/${productId}/items`,
      { headers: { Authorization: `Bearer ${token}` } },
      8000
    );
    if (res.status === 404) return { status: 'no_winner' };
    if (!res.ok) return { status: 'error', detail: `HTTP ${res.status}` };

    const data = (await res.json()) as { results?: MlOffer[] };
    const offers = (data.results ?? []).filter(
      (o) => o && typeof o.price === 'number' && o.price > 0 && o.seller_id
    );
    return offers.length > 0 ? { status: 'ok', offers } : { status: 'no_winner' };
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
