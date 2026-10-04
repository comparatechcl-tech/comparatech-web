import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente admin (service role) — SOLO se usa server-side (crons, admin y
 * sus acciones) para escribir en la base. Se salta las reglas de RLS, así
 * que la clave nunca puede llegar al navegador: 'server-only' hace fallar
 * el build si un componente cliente llega a importar este archivo.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}
