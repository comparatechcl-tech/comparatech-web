import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { readAffiliateSettings, type AffiliateSettings } from '@/lib/settings';

/**
 * Configuración privada del admin (tabla admin_private_settings, migración
 * 0013). A diferencia de site_settings, que es de lectura pública, esta
 * tabla no tiene policies: solo la lee el servidor con la service role.
 *
 * Por ahora guarda el resultado de la prueba de atribución de los links
 * directos: hasta que alguien compruebe que Mercado Libre paga comisión por
 * un clic directo, encenderlos puede dejar de pagar sin que nada avise.
 */

export type AttributionStatusValue = 'pendiente' | 'confirmada' | 'fallida';

export interface AttributionStatus {
  status: AttributionStatusValue;
  clickedAt?: string;
  purchasedAt?: string;
  orderRef?: string;
  notes?: string;
  updatedAt?: string;
}

export const ATTRIBUTION_KEY = 'attribution_test';

const STATUSES = new Set<AttributionStatusValue>(['pendiente', 'confirmada', 'fallida']);

export function isAttributionStatus(value: unknown): value is AttributionStatusValue {
  return typeof value === 'string' && STATUSES.has(value as AttributionStatusValue);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseAttribution(value: unknown, updatedAt: unknown): AttributionStatus {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    status: isAttributionStatus(v.status) ? v.status : 'pendiente',
    clickedAt: text(v.clickedAt),
    purchasedAt: text(v.purchasedAt),
    orderRef: text(v.orderRef),
    notes: text(v.notes),
    updatedAt: text(updatedAt),
  };
}

/**
 * Lo mismo que readAttributionStatus, diciendo además si la tabla existe:
 * sin la migración, el formulario de la prueba no tiene dónde guardar.
 */
export async function readAttributionTest(
  admin: SupabaseClient | null
): Promise<{ available: boolean; test: AttributionStatus }> {
  if (!admin) return { available: false, test: { status: 'pendiente' } };
  try {
    const { data, error } = await admin
      .from('admin_private_settings')
      .select('value, updated_at')
      .eq('key', ATTRIBUTION_KEY)
      .maybeSingle();
    if (error) {
      if (!isMissingSchemaError(error)) console.error(`[admin-settings] ${error.message}`);
      return { available: !isMissingSchemaError(error), test: { status: 'pendiente' } };
    }
    if (!data) return { available: true, test: { status: 'pendiente' } };
    return { available: true, test: parseAttribution(data.value, data.updated_at) };
  } catch (err) {
    console.error('[admin-settings] no se pudo leer la prueba de atribución:', err);
    return { available: false, test: { status: 'pendiente' } };
  }
}

/** Estado de la prueba de atribución. 'pendiente' si no hay fila o falta la tabla. */
export async function readAttributionStatus(admin: SupabaseClient | null): Promise<AttributionStatus> {
  return (await readAttributionTest(admin)).test;
}

export async function writeAttributionTest(
  admin: SupabaseClient,
  test: Omit<AttributionStatus, 'updatedAt'>
): Promise<{ ok: true } | { ok: false; missing: boolean; error: string }> {
  const { error } = await admin.from('admin_private_settings').upsert({
    key: ATTRIBUTION_KEY,
    value: {
      status: test.status,
      clickedAt: test.clickedAt ?? null,
      purchasedAt: test.purchasedAt ?? null,
      orderRef: test.orderRef ?? null,
      notes: test.notes ?? null,
    },
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, missing: isMissingSchemaError(error), error: error.message };
  return { ok: true };
}

/**
 * ¿El botón de compra se arma hoy desde la ficha, con la comisión
 * comprobada? Encendidos, con la prueba de atribución confirmada y con
 * matt_word y matt_tool para armarlos. En ese caso el link guardado de cada
 * producto no se usa: que esté repetido, que no sea un meli.la o que lleve a
 * otra ficha deja de ser un problema (ver lib/admin-stats).
 */
export function directLinksInUse(
  settings: Pick<AffiliateSettings, 'word' | 'tool' | 'directLinks'>,
  attribution: Pick<AttributionStatus, 'status'>
): boolean {
  return settings.directLinks && attribution.status === 'confirmada' && Boolean(settings.word && settings.tool);
}

/**
 * ¿Se pueden usar los links directos? Solo si están encendidos Y la prueba
 * de atribución está confirmada. Lo usan las acciones que publicarían un
 * link directo en lugar de un meli.la.
 */
export async function directLinksUsable(admin: SupabaseClient | null): Promise<boolean> {
  const [settings, attribution] = await Promise.all([
    readAffiliateSettings(admin),
    readAttributionStatus(admin),
  ]);
  return settings.directLinks && attribution.status === 'confirmada';
}
