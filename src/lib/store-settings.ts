import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Si las fichas del sitio muestran el precio de otras tiendas. Se guarda en
 * site_settings (clave 'stores'), que es de lectura pública: acá solo va un
 * sí o un no.
 *
 * Apagado mientras no exista la fila: enlazar tiendas en el admin no cambia
 * nada en el sitio hasta que el dueño lo encienda en /admin/tiendas.
 */

export interface StoreSettings {
  /** Mostrar el bloque "Precio en otras tiendas" en las fichas. */
  show: boolean;
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = { show: false };

const KEY = 'stores';

function parse(value: unknown): StoreSettings {
  const v = (value ?? {}) as Partial<StoreSettings>;
  return { show: v.show === true };
}

/** Nunca lanza: ante cualquier problema, apagado. */
export async function readStoreSettings(client: SupabaseClient | null): Promise<StoreSettings> {
  if (!client) return DEFAULT_STORE_SETTINGS;
  try {
    const { data, error } = await client.from('site_settings').select('value').eq('key', KEY).maybeSingle();
    if (error || !data) return DEFAULT_STORE_SETTINGS;
    return parse((data as { value: unknown }).value);
  } catch {
    return DEFAULT_STORE_SETTINGS;
  }
}

/** Para las páginas públicas: una sola lectura por página armada. */
export const getStoreSettings = cache(() => readStoreSettings(getSupabase()));

export async function writeStoreSettings(
  admin: SupabaseClient,
  next: StoreSettings
): Promise<{ ok: true; previous: StoreSettings } | { ok: false; error: string }> {
  const previous = await readStoreSettings(admin);
  const { error } = await admin
    .from('site_settings')
    .upsert({ key: KEY, value: { show: next.show === true }, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  return { ok: true, previous };
}
