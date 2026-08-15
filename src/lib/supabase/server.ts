import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente admin (service role) — SOLO se usa en route handlers server-side
 * (ej. /api/catalog-sync) para escribir en la tabla products. Nunca importar
 * este archivo desde un componente cliente.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
