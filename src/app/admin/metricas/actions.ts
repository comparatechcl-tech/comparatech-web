'use server';

/**
 * Carga semanal de lo que informa la Central de Afiliados de Mercado Libre.
 *
 * ML no tiene una API para leer comisiones, así que la dueña copia los
 * números a mano una vez por semana. Con eso el admin calcula la ganancia
 * por clic y compara los clics propios con los de ML, que es la forma de
 * notar a tiempo que los links dejaron de atribuirse.
 */

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { logAdminEvent } from '@/lib/admin-audit';
import { chileDateKey, parseWholeNumber, weekStartOf } from '@/lib/clicks';

export interface AffiliateReportInput {
  /** Cualquier día de la semana (AAAA-MM-DD); se guarda como su lunes. */
  week: string;
  mlClicks: string;
  mlSales: string;
  mlPendingClp: string;
  mlApprovedClp: string;
  notes: string;
}

export type SaveReportResult = { ok: true; weekStart: string } | { ok: false; error: string };

const FIELD_LABELS = {
  mlClicks: 'Clics en ML',
  mlSales: 'Ventas',
  mlPendingClp: 'Comisión pendiente',
  mlApprovedClp: 'Comisión aprobada',
} as const;

export async function saveAffiliateReport(input: AffiliateReportInput): Promise<SaveReportResult> {
  let actor: string;
  try {
    actor = await requireAdmin();
  } catch {
    return { ok: false, error: 'No autorizado' };
  }

  const weekStart = weekStartOf(input.week);
  if (!weekStart) return { ok: false, error: 'Elige la semana' };
  if (weekStart > chileDateKey(new Date())) {
    return { ok: false, error: 'Esa semana todavía no empieza' };
  }

  const values: Record<keyof typeof FIELD_LABELS, number | null> = {
    mlClicks: null,
    mlSales: null,
    mlPendingClp: null,
    mlApprovedClp: null,
  };
  for (const key of Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]) {
    const parsed = parseWholeNumber(input[key]);
    if (parsed === undefined) {
      return { ok: false, error: `${FIELD_LABELS[key]}: escribe solo números, sin decimales` };
    }
    values[key] = parsed;
  }
  if (Object.values(values).every((v) => v === null)) {
    return { ok: false, error: 'Completa al menos un dato de la Central de Afiliados' };
  }

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const notes = input.notes.trim().slice(0, 500);
  const row = {
    week_start: weekStart,
    ml_clicks: values.mlClicks,
    ml_sales: values.mlSales,
    ml_pending_clp: values.mlPendingClp,
    ml_approved_clp: values.mlApprovedClp,
    notes: notes || null,
  };
  const { error } = await admin
    .from('affiliate_reports')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'week_start' });
  if (error) {
    if (isMissingSchemaError(error)) return { ok: false, error: 'Aplica la migración 0015 en Supabase' };
    return { ok: false, error: error.message };
  }

  await logAdminEvent(admin, { actor, action: 'reporte_afiliados', target: weekStart, after: row });

  revalidatePath('/admin/metricas');
  return { ok: true, weekStart };
}
