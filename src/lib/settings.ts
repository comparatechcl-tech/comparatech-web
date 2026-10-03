import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';

/**
 * Configuración editable desde /admin/configuracion, guardada en la tabla
 * site_settings. Vive en la base de datos y no en variables de entorno para
 * poder cambiarla sin pasar por Vercel ni redesplegar.
 *
 * La tabla es de lectura pública: aquí solo van datos que ya son públicos.
 */

export interface AffiliateSettings {
  /** Parámetro matt_word de los links de la cuenta afiliada. */
  word: string | null;
  /** Parámetro matt_tool de los links de la cuenta afiliada. */
  tool: string | null;
  /**
   * Si el botón "Ver en Mercado Libre" va directo a la ficha (true) o al
   * link meli.la generado a mano (false). Apagado por defecto: que ML
   * atribuya la comisión a un link directo no está documentado y hay que
   * comprobarlo con una compra real antes de encenderlo.
   */
  directLinks: boolean;
}

export const DEFAULT_AFFILIATE_SETTINGS: AffiliateSettings = {
  word: null,
  tool: null,
  directLinks: false,
};

function parseAffiliate(value: unknown): AffiliateSettings {
  const v = (value ?? {}) as Partial<AffiliateSettings>;
  return {
    word: typeof v.word === 'string' && v.word.trim() ? v.word.trim() : null,
    tool: typeof v.tool === 'string' && v.tool.trim() ? v.tool.trim() : null,
    directLinks: v.directLinks === true,
  };
}

export async function readAffiliateSettings(
  client: SupabaseClient | null
): Promise<AffiliateSettings> {
  if (!client) return DEFAULT_AFFILIATE_SETTINGS;
  const { data, error } = await client
    .from('site_settings')
    .select('value')
    .eq('key', 'affiliate')
    .maybeSingle();
  if (error || !data) return DEFAULT_AFFILIATE_SETTINGS;
  return parseAffiliate(data.value);
}

/**
 * Para las páginas públicas. `cache` evita releer la tabla en cada
 * componente que la necesita dentro de un mismo render.
 */
export const getAffiliateSettings = cache(() => readAffiliateSettings(getSupabase()));

export async function writeAffiliateSettings(
  admin: SupabaseClient,
  next: Partial<AffiliateSettings>
): Promise<{ ok: true; settings: AffiliateSettings } | { ok: false; error: string }> {
  const current = await readAffiliateSettings(admin);
  const merged = { ...current, ...next };
  const { error } = await admin
    .from('site_settings')
    .upsert({ key: 'affiliate', value: merged, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  return { ok: true, settings: merged };
}

/**
 * Guarda matt_word/matt_tool la primera vez que se leen de un link real, para
 * no tener que copiarlos a mano. No pisa valores ya configurados.
 */
export async function rememberAffiliateParams(
  admin: SupabaseClient,
  word: string | null,
  tool: string | null
): Promise<void> {
  if (!word || !tool) return;
  const current = await readAffiliateSettings(admin);
  if (current.word && current.tool) return;
  await writeAffiliateSettings(admin, { word: current.word ?? word, tool: current.tool ?? tool });
}
