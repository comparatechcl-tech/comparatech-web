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

/**
 * matt_word y matt_tool de la cuenta ComparaTech, fijados en las variables
 * de entorno AFFILIATE_WORD y AFFILIATE_TOOL. Cambiarlos en Vercel exige
 * acceso a la cuenta y un redespliegue; cambiarlos en la base, solo la clave
 * del admin. Con esto fijado, nadie puede desviar las comisiones desde el
 * admin, ni por error ni a propósito. Null si no están definidos.
 */
export function expectedAffiliateParams(): { word: string | null; tool: string | null } {
  return {
    word: process.env.AFFILIATE_WORD?.trim() || null,
    tool: process.env.AFFILIATE_TOOL?.trim() || null,
  };
}

function parseAffiliate(value: unknown): AffiliateSettings {
  const v = (value ?? {}) as Partial<AffiliateSettings>;
  const env = expectedAffiliateParams();
  return {
    // Lo fijado en el entorno manda sobre lo guardado: así un valor viejo o
    // cambiado a mano en la tabla no termina en los links directos.
    word: env.word ?? (typeof v.word === 'string' && v.word.trim() ? v.word.trim() : null),
    tool: env.tool ?? (typeof v.tool === 'string' && v.tool.trim() ? v.tool.trim() : null),
    directLinks: v.directLinks === true,
  };
}

export async function readAffiliateSettings(
  client: SupabaseClient | null
): Promise<AffiliateSettings> {
  return (await readAffiliateSettingsWithDate(client)).settings;
}

/** Lo mismo, con la fecha del último cambio (para /admin/configuracion). */
export async function readAffiliateSettingsWithDate(
  client: SupabaseClient | null
): Promise<{ settings: AffiliateSettings; updatedAt: string | null }> {
  if (!client) return { settings: parseAffiliate(null), updatedAt: null };
  const { data, error } = await client
    .from('site_settings')
    .select('value, updated_at')
    .eq('key', 'affiliate')
    .maybeSingle();
  if (error || !data) return { settings: parseAffiliate(null), updatedAt: null };
  return { settings: parseAffiliate(data.value), updatedAt: (data.updated_at as string | null) ?? null };
}

/**
 * Para las páginas públicas. `cache` evita releer la tabla en cada
 * componente que la necesita dentro de un mismo render.
 */
export const getAffiliateSettings = cache(() => readAffiliateSettings(getSupabase()));

export type WriteAffiliateResult =
  | { ok: true; settings: AffiliateSettings; previous: AffiliateSettings }
  | { ok: false; error: string };

export async function writeAffiliateSettings(
  admin: SupabaseClient,
  next: Partial<AffiliateSettings>
): Promise<WriteAffiliateResult> {
  const env = expectedAffiliateParams();
  if (env.word && next.word !== undefined && next.word !== env.word) {
    return { ok: false, error: 'El matt_word está fijado en las variables de entorno (AFFILIATE_WORD).' };
  }
  if (env.tool && next.tool !== undefined && next.tool !== env.tool) {
    return { ok: false, error: 'El matt_tool está fijado en las variables de entorno (AFFILIATE_TOOL).' };
  }

  const current = await readAffiliateSettings(admin);
  const merged = { ...current, ...next };
  const { error } = await admin
    .from('site_settings')
    .upsert({ key: 'affiliate', value: merged, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  return { ok: true, settings: merged, previous: current };
}

/**
 * Guarda matt_word/matt_tool la primera vez que se leen de un link real, para
 * no tener que copiarlos a mano. No pisa valores ya configurados, y si el
 * entorno fija los valores, solo acepta esos: un link de otra cuenta que se
 * cuele no puede terminar definiendo a quién se le paga.
 */
export async function rememberAffiliateParams(
  admin: SupabaseClient,
  word: string | null,
  tool: string | null
): Promise<void> {
  if (!word || !tool) return;
  const env = expectedAffiliateParams();
  if (env.word && word !== env.word) return;
  if (env.tool && tool !== env.tool) return;

  const current = await readAffiliateSettings(admin);
  if (current.word && current.tool) return;
  await writeAffiliateSettings(admin, { word: current.word ?? word, tool: current.tool ?? tool });
}
