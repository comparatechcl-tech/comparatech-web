import { getSupabase } from '@/lib/supabase/client';
import { MOCK_PRODUCTS } from '@/lib/mock-data';
import { Product } from '@/lib/types';

/**
 * Capa de acceso a datos de productos. Si Supabase está configurado (env
 * vars presentes), lee desde la tabla `products`. Si no, sirve los datos
 * mock — así el sitio queda funcional desde el primer día sin bloquear el
 * desarrollo del resto de las páginas a la espera de credenciales.
 */

export async function getAllProducts(): Promise<Product[]> {
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

  if (error || !data) return MOCK_PRODUCTS;
  return data as Product[];
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const supabase = getSupabase();
  if (!supabase) {
    return MOCK_PRODUCTS.find((p) => p.slug === slug) ?? null;
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('slug', slug)
    .eq('is_active', true)
    .eq('is_hidden', false)
    .single();

  if (error || !data) return null;
  return data as Product;
}

/**
 * Clave con la que se agrupan las variantes de un mismo producto. ML entrega
 * `parent_id` (guardado como ml_family_id) y todos los colores del mismo
 * modelo lo comparten. Un producto sin familia —cargado a mano, o subido
 * antes de que existiera la columna— es su propio grupo, así que nunca se
 * pierde nada por no tener el dato.
 */
function variantKey(product: Product): string {
  return product.ml_family_id || product.id;
}

/**
 * Deja una sola tarjeta por producto real.
 *
 * El prospector trae cada color como un producto separado: había dos "Silla
 * Gamer Vidita GX2000" idénticas en el home y dos audífonos Sleve Pulse ANC
 * al mismo precio. De 11 productos publicados, 10 eran pares de variantes.
 *
 * Se muestra la más barata de cada familia, que es la que le sirve a quien
 * compara precios — y en 3 de 5 familias los colores costaban distinto. Ante
 * el mismo precio gana la más reciente, que es como venían ordenadas.
 */
export function collapseVariants(products: Product[]): Product[] {
  const bestByFamily = new Map<string, Product>();

  for (const product of products) {
    const key = variantKey(product);
    const current = bestByFamily.get(key);
    if (!current || product.price < current.price) {
      bestByFamily.set(key, product);
    }
  }

  // Respeta el orden en que venían los productos, quedándose con el
  // representante elegido de cada familia.
  const chosen = new Set(bestByFamily.values());
  return products.filter((p) => chosen.has(p));
}

/** Catálogo para listados: una tarjeta por producto real, sin variantes repetidas. */
export async function getCatalogProducts(): Promise<Product[]> {
  return collapseVariants(await getAllProducts());
}

/**
 * Las otras variantes del mismo producto (otros colores), para ofrecerlas en
 * la ficha. Sin esto, colapsar los listados escondería opciones reales: que
 * los Redmi Buds rosados sean más baratos no significa que alguien no quiera
 * los negros.
 */
export async function getSiblingVariants(product: Product): Promise<Product[]> {
  if (!product.ml_family_id) return [];

  const all = await getAllProducts();
  return all.filter(
    (p) => p.id !== product.id && p.ml_family_id === product.ml_family_id
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
 * Todos cumplen ya las reglas del Programa de Afiliados por venir del mismo
 * catálogo: vendedor con reputación verde y link generado a mano.
 */
export async function getDeals(minDiscount = MIN_DEAL_DISCOUNT): Promise<Product[]> {
  const all = await getCatalogProducts();
  return all
    .filter((p) => discountPercent(p) >= minDiscount)
    .sort((a, b) => discountPercent(b) - discountPercent(a));
}
