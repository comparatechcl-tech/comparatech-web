import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null | undefined;

/**
 * Cliente público (anon key) para lecturas server-side de datos de catálogo.
 * Devuelve null si aún no se configuraron las variables de entorno de
 * Supabase. Ya no hay datos de ejemplo: en ese caso las lecturas del
 * catálogo (lib/queries/products.ts) fallan a propósito.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  cached = url && anonKey ? createClient(url, anonKey) : null;
  return cached;
}
