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

  const { data, error } = await supabase
    .from('products')
    .select('*')
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
    .single();

  if (error || !data) return null;
  return data as Product;
}

export async function getProductsByCategory(category: string): Promise<Product[]> {
  const all = await getAllProducts();
  return all.filter((p) => p.category === category);
}

// Muestra lo más nuevo del catálogo (ya viene ordenado por created_at desc
// desde getAllProducts). No filtra por is_featured: los productos recién
// aprobados desde /admin/candidatos deben verse en el Home de inmediato,
// no quedar invisibles hasta marcarlos a mano como destacados.
export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  const all = await getAllProducts();
  return all.slice(0, limit);
}
