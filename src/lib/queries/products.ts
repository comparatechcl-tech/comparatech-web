import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { getSupabase } from '@/lib/supabase/client';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { Product } from '@/lib/types';
import { getAffiliateSettings } from '@/lib/settings';
import { resolveOutboundUrl } from '@/lib/outbound';
import { normalizeName } from '@/lib/text';
import { pickAlternatives } from '@/lib/search';
import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';

/**
 * Capa de acceso a datos de productos, siempre desde la tabla `products`.
 *
 * Ya no hay datos de ejemplo: si faltan las variables de Supabase, falla.
 * Antes caía a un catálogo inventado, y un deploy con las variables mal
 * puestas habría publicado productos falsos con links que no llevan a
 * ninguna compra. Si una regeneración falla, Next sigue sirviendo la última
 * versión buena de cada página.
 */

/**
 * Las columnas que usan las tarjetas, la ficha y el JSON-LD. Nada de
 * select('*'): los productos terminan como props de componentes de cliente
 * (tarjetas, comparador), y todo lo que se lee queda escrito en el HTML. Ahí
 * no tienen nada que hacer seller_id, rrss_status ni el motivo interno por el
 * que un producto salió del sitio.
 */
const BASE_COLUMNS = [
  'id',
  'slug',
  'name',
  'brand',
  'category',
  'price',
  'original_price',
  'image_url',
  'affiliate_url',
  'description',
  'specs',
  'seller_reputation',
  'seller_sales_count',
  'is_featured',
  'is_active',
  'is_hidden',
  'ml_product_id',
  'ml_domain_id',
  'ml_family_id',
  'created_at',
  'price_checked_at',
].join(',');

/** Lo mismo más las columnas de una migración que puede no estar aplicada. */
const EXTENDED_COLUMNS = `${BASE_COLUMNS},offer_info,ml_root_category`;

/**
 * Solo para decidir qué mostrar en una ficha fuera de venta. Se leen en el
 * servidor y nunca se pasan a un componente de cliente.
 */
const STATUS_COLUMNS = 'inactive_reason,inactive_since';

/**
 * Combinaciones a probar, de la más completa a la mínima. offer_info y
 * ml_root_category llegan con una migración y deleted_at con otra; cualquiera
 * puede aplicarse antes que la otra, y el sitio tiene que seguir en pie
 * mientras tanto (ver lib/supabase/errors).
 */
const SCHEMA_TIERS = [
  { columns: EXTENDED_COLUMNS, excludeDeleted: true },
  { columns: EXTENDED_COLUMNS, excludeDeleted: false },
  { columns: BASE_COLUMNS, excludeDeleted: true },
  { columns: BASE_COLUMNS, excludeDeleted: false },
] as const;

/**
 * La combinación que funcionó se recuerda un rato, para no hacer consultas
 * fallidas en cada lectura. Pasado ese rato se vuelve a probar la completa,
 * por si la migración ya se aplicó.
 */
const TIER_RETRY_MS = 10 * 60 * 1000;
let knownTier = 0;
let knownTierUntil = 0;

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

async function selectWithFallback(
  run: (columns: string, excludeDeleted: boolean) => PromiseLike<QueryResult>
): Promise<QueryResult> {
  const start = Date.now() < knownTierUntil ? knownTier : 0;
  let result: QueryResult = { data: null, error: { message: 'sin consulta' } };
  for (let i = start; i < SCHEMA_TIERS.length; i++) {
    const tier = SCHEMA_TIERS[i];
    result = await run(tier.columns, tier.excludeDeleted);
    if (result.error && isMissingSchemaError(result.error)) continue;
    if (!result.error && i > 0) {
      knownTier = i;
      knownTierUntil = Date.now() + TIER_RETRY_MS;
    }
    return result;
  }
  return result;
}

function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase no configurado');
  return supabase;
}

/**
 * La lectura del catálogo, compartida entre todas las páginas por 60
 * segundos (o hasta que algo invalide la etiqueta 'catalog'). Sin esto cada
 * página que se regenera vuelve a pedir la tabla completa a Supabase.
 */
const readCatalogCached = unstable_cache(
  async (): Promise<Product[]> => {
    const supabase = requireSupabase();

    // is_active lo maneja el cron (el vendedor dejó de ofrecer el producto);
    // is_hidden es una decisión humana desde /admin/productos. Para los
    // listados las dos significan lo mismo: no se muestra.
    const { data, error } = await selectWithFallback((columns, excludeDeleted) => {
      let query = supabase.from('products').select(columns).eq('is_active', true).eq('is_hidden', false);
      if (excludeDeleted) query = query.is('deleted_at', null);
      return query.order('created_at', { ascending: false });
    });

    // Un error no puede terminar publicado como un catálogo vacío: fallar
    // deja a Next sirviendo la última versión buena.
    if (error) throw new Error(`No se pudo leer el catálogo: ${error.message}`);
    return (data ?? []) as Product[];
  },
  ['catalog-v1'],
  { revalidate: 60, tags: ['catalog'] }
);

/**
 * `cache` hace que el layout y la página compartan una sola lectura por
 * render: antes cada sección (menú, ofertas, recién agregados) volvía a
 * pedir el catálogo completo.
 */
const fetchActiveProducts = cache(() => readCatalogCached());

function withOutbound(products: Product[], settings: Awaited<ReturnType<typeof getAffiliateSettings>>) {
  return products.map((p) => ({ ...p, outbound_url: resolveOutboundUrl(p, settings) }));
}

export async function getAllProducts(): Promise<Product[]> {
  const [products, settings] = await Promise.all([fetchActiveProducts(), getAffiliateSettings()]);
  return withOutbound(products, settings);
}

/**
 * Un producto visible, esté o no a la venta hoy.
 *
 * Cuando un producto queda sin vendedor, su ficha sigue recibiendo visitas
 * desde Google y desde links compartidos. Responder 404 tira ese tráfico;
 * mostrar la ficha con alternativas lo aprovecha, porque Mercado Libre paga
 * la comisión de cualquier compra de la misma categoría dentro de las 24 h.
 * Lo oculto a mano (is_hidden) y lo borrado sí quedan fuera.
 *
 * Trae además inactive_reason e inactive_since, que la página usa en el
 * servidor para elegir el aviso: no se pasan a componentes de cliente.
 */
export const getProductBySlugAnyStatus = cache(async (slug: string): Promise<Product | null> => {
  const supabase = requireSupabase();

  const [{ data, error }, settings] = await Promise.all([
    selectWithFallback((columns, excludeDeleted) => {
      let query = supabase
        .from('products')
        .select(`${columns},${STATUS_COLUMNS}`)
        .eq('slug', slug)
        .eq('is_hidden', false);
      if (excludeDeleted) query = query.is('deleted_at', null);
      return query.maybeSingle();
    }),
    getAffiliateSettings(),
  ]);

  if (error) throw new Error(`No se pudo leer el producto: ${error.message}`);
  if (!data) return null;
  return withOutbound([data as Product], settings)[0];
});

/** Un producto publicado (activo y visible), o null. */
export async function getProductBySlug(slug: string): Promise<Product | null> {
  const product = await getProductBySlugAnyStatus(slug);
  return product?.is_active ? product : null;
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
  return keepCheapestBy(byFamily, (p) => normalizeName(p.name));
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
  const name = normalizeName(product.name);
  return all.filter(
    (p) =>
      p.id !== product.id &&
      ((product.ml_family_id && p.ml_family_id === product.ml_family_id) ||
        normalizeName(p.name) === name)
  );
}

/**
 * Productos a la venta que compiten por la misma compra (ver
 * pickAlternatives en lib/search). Salen del catálogo colapsado para no
 * ofrecer el mismo parlante en tres colores como si fueran tres opciones.
 */
export async function getAlternatives(product: Product, limit = 6): Promise<Product[]> {
  return pickAlternatives(product, await getCatalogProducts(), limit);
}

export async function getProductsByCategory(category: string): Promise<Product[]> {
  const all = await getCatalogProducts();
  return all.filter((p) => p.category === category);
}

/**
 * Descuento mínimo para que un producto entre a la sección de ofertas.
 *
 * Bajo esto no vale la pena promocionarlo: un 5% no mueve a nadie a comprar
 * y llenaría la sección de ruido. Con el catálogo actual, 20% deja fuera lo
 * marginal y conserva las rebajas que sí llaman la atención.
 *
 * El valor vive en lib/deal-rank, que también usan las tarjetas (componentes
 * de cliente, que no pueden importar este módulo).
 */
export { MIN_DEAL_DISCOUNT };

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
