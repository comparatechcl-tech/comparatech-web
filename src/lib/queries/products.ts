import { cache } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { MOCK_PRODUCTS } from '@/lib/mock-data';
import { Product } from '@/lib/types';
import { getAffiliateSettings } from '@/lib/settings';
import { resolveOutboundUrl } from '@/lib/outbound';
import { stripDiacritics } from '@/lib/text';

/**
 * Capa de acceso a datos de productos. Si Supabase está configurado (env
 * vars presentes), lee desde la tabla `products`. Si no, sirve los datos
 * mock — así el sitio queda funcional desde el primer día sin bloquear el
 * desarrollo del resto de las páginas a la espera de credenciales.
 */

/**
 * `cache` hace que el layout y la página compartan una sola lectura por
 * render: antes cada sección (menú, ofertas, recién agregados) volvía a
 * pedir el catálogo completo.
 */
const fetchActiveProducts = cache(async (): Promise<Product[]> => {
  const supabase = getSupabase();
  if (!supabase) return MOCK_PRODUCTS;

  // is_active lo maneja el cron (el vendedor dejó de ofrecer el producto);
  // is_hidden es una decisión humana desde /admin/productos. Para el sitio
  // público las dos significan lo mismo: no se muestra.
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .eq('is_hidden', false)
    .order('created_at', { ascending: false });

  // Con Supabase configurado, un error NO puede caer a los datos de ejemplo:
  // el sitio publicaría productos inventados con links que no llevan a
  // ninguna parte. Fallar es mejor — durante una regeneración, Next sigue
  // sirviendo la última versión buena de la página.
  if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`);
  return (data ?? []) as Product[];
});

function withOutbound(products: Product[], settings: Awaited<ReturnType<typeof getAffiliateSettings>>) {
  return products.map((p) => ({ ...p, outbound_url: resolveOutboundUrl(p, settings) }));
}

export async function getAllProducts(): Promise<Product[]> {
  const [products, settings] = await Promise.all([fetchActiveProducts(), getAffiliateSettings()]);
  return withOutbound(products, settings);
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return MOCK_PRODUCTS.find((p) => p.slug === slug) ?? null;
  }

  const [{ data, error }, settings] = await Promise.all([
    supabase
      .from('products')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
      .eq('is_hidden', false)
      .maybeSingle(),
    getAffiliateSettings(),
  ]);

  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`);
  if (!data) return null;
  return withOutbound([data as Product], settings)[0];
}

/**
 * Nombre comparable: sin tildes, mayúsculas ni puntuación. Mercado Libre a
 * veces tiene el mismo artículo en fichas de catálogo distintas —había tres
 * "Audifonos Bluetooth Inalámbricos Blik Air500 Blanco", cada una con su
 * propia ficha y su propia familia—, y por familia no se detectan.
 */
function normalizedName(name: string): string {
  return stripDiacritics(name.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Deja el más barato de cada grupo, respetando el orden original. */
function keepCheapestBy(products: Product[], keyOf: (p: Product) => string): Product[] {
  const best = new Map<string, Product>();
  for (const product of products) {
    const key = keyOf(product);
    const current = best.get(key);
    if (!current || product.price < current.price) best.set(key, product);
  }
  const chosen = new Set(best.values());
  return products.filter((p) => chosen.has(p));
}

/**
 * Deja una sola tarjeta por producto real.
 *
 * El prospector trae cada color como un producto separado: había dos "Silla
 * Gamer Vidita GX2000" idénticas en el home y dos audífonos Sleve Pulse ANC
 * al mismo precio. Primero se agrupa por familia de ML (`parent_id`, que
 * comparten los colores del mismo modelo) y después por nombre, para atrapar
 * el mismo artículo publicado en fichas distintas.
 *
 * Se muestra el más barato de cada grupo, que es el que le sirve a quien
 * compara precios. Ante el mismo precio gana el más reciente.
 */
export function collapseVariants(products: Product[]): Product[] {
  const byFamily = keepCheapestBy(products, (p) => p.ml_family_id || p.id);
  return keepCheapestBy(byFamily, (p) => normalizedName(p.name));
}

/** Catálogo para listados: una tarjeta por producto real, sin variantes repetidas. */
export async function getCatalogProducts(): Promise<Product[]> {
  return collapseVariants(await getAllProducts());
}

/**
 * Las otras versiones del mismo producto (otros colores, u otras fichas del
 * mismo artículo), para ofrecerlas en la ficha. Sin esto, colapsar los
 * listados escondería opciones reales: que los Redmi Buds rosados sean más
 * baratos no significa que alguien no quiera los negros.
 */
export async function getSiblingVariants(product: Product): Promise<Product[]> {
  const all = await getAllProducts();
  const name = normalizedName(product.name);
  return all.filter(
    (p) =>
      p.id !== product.id &&
      ((product.ml_family_id && p.ml_family_id === product.ml_family_id) ||
        normalizedName(p.name) === name)
  );
}

export async function getProductsByCategory(category: string): Promise<Product[]> {
  const all = await getCatalogProducts();
  return all.filter((p) => p.category === category);
}

// Muestra lo más nuevo del catálogo (ya viene ordenado por created_at desc
// desde getAllProducts). No filtra por is_featured: los productos recién
// aprobados desde /admin/candidatos deben verse en el Home de inmediato,
// no quedar invisibles hasta marcarlos a mano como destacados.
export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  const all = await getCatalogProducts();
  return all.slice(0, limit);
}

/**
 * Descuento mínimo para que un producto entre a la sección de ofertas.
 *
 * Bajo esto no vale la pena promocionarlo: un 5% no mueve a nadie a comprar
 * y llenaría la sección de ruido. Con el catálogo actual, 20% deja fuera lo
 * marginal y conserva las rebajas que sí llaman la atención.
 */
export const MIN_DEAL_DISCOUNT = 20;

/** Porcentaje de descuento respecto al precio de lista. 0 si no hay rebaja. */
export function discountPercent(product: Product): number {
  if (!product.original_price || product.original_price <= product.price) return 0;
  return Math.round((1 - product.price / product.original_price) * 100);
}

/** Cuánto se ahorra en pesos. Es lo que más pesa al armar un post. */
export function savingsAmount(product: Product): number {
  if (!product.original_price || product.original_price <= product.price) return 0;
  return product.original_price - product.price;
}

/**
 * Productos en oferta, de mayor a menor descuento.
 *
 * El descuento es el del ganador de la caja de compra contra su precio de
 * lista, ambos informados por Mercado Libre — no una etiqueta puesta a mano.
 */
export async function getDeals(minDiscount = MIN_DEAL_DISCOUNT): Promise<Product[]> {
  const all = await getCatalogProducts();
  return all
    .filter((p) => discountPercent(p) >= minDiscount)
    .sort((a, b) => discountPercent(b) - discountPercent(a));
}
