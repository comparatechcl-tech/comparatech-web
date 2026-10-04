import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Registro de lo que se hace en el admin (tabla admin_audit_log, migración
 * 0013).
 *
 * Los links de afiliado y su configuración son la única fuente de ingresos:
 * si una comisión deja de llegar, lo primero es saber quién cambió qué y
 * cuándo. Antes nada quedaba registrado.
 *
 * Registrar nunca puede impedir la acción: si la tabla aún no existe o la
 * base falla, se anota en los logs de Vercel y la acción sigue.
 */

export interface AdminEvent {
  actor: string;
  action: string;
  target?: string;
  before?: unknown;
  after?: unknown;
}

export interface AdminEventRow {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
}

/** Deja el valor listo para jsonb: sin undefined, funciones ni ciclos. */
function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) ?? null;
  } catch {
    return String(value);
  }
}

export async function logAdminEvent(admin: SupabaseClient | null, e: AdminEvent): Promise<void> {
  if (!admin) return;
  try {
    const { error } = await admin.from('admin_audit_log').insert({
      actor: e.actor,
      action: e.action,
      target: e.target ?? null,
      before: toJson(e.before),
      after: toJson(e.after),
    });
    if (error && !isMissingSchemaError(error)) {
      console.error(`[admin-audit] no se pudo registrar '${e.action}': ${error.message}`);
    }
  } catch (err) {
    console.error(`[admin-audit] no se pudo registrar '${e.action}':`, err);
  }
}

export type AdminEventsRead =
  | { ok: true; rows: AdminEventRow[] }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: string };

/** Últimos eventos, del más nuevo al más viejo (para /admin/actividad). */
export async function readAdminEvents(
  admin: SupabaseClient | null,
  opts: { action?: string; limit?: number } = {}
): Promise<AdminEventsRead> {
  if (!admin) return { ok: false, missing: false, error: 'Supabase admin no configurado' };
  let query = admin
    .from('admin_audit_log')
    .select('id, at, actor, action, target, before, after')
    .order('at', { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.action) query = query.eq('action', opts.action);

  const { data, error } = await query;
  if (error) {
    return isMissingSchemaError(error) ? { ok: false, missing: true } : { ok: false, missing: false, error: error.message };
  }
  return { ok: true, rows: (data ?? []) as AdminEventRow[] };
}
