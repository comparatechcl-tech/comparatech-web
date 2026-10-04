'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import {
  isAttributionStatus,
  readAttributionStatus,
  writeAttributionTest,
  type AttributionStatusValue,
} from '@/lib/admin-settings';

/**
 * Resultado de la prueba de atribución de los links directos.
 *
 * Es lo que decide si los links directos se pueden usar sin pedir
 * confirmación (ver directLinksUsable): por eso queda en una tabla privada
 * y cada cambio se registra en la actividad.
 */
export async function saveAttributionTest(input: {
  clickedAt: string;
  purchasedAt: string;
  orderRef: string;
  status: AttributionStatusValue;
  notes: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!isAttributionStatus(input.status)) return { ok: false, error: 'Elige un resultado válido.' };

  const clean = (value: string, max: number) => (value ?? '').trim().slice(0, max) || undefined;
  const next = {
    status: input.status,
    clickedAt: clean(input.clickedAt, 40),
    purchasedAt: clean(input.purchasedAt, 40),
    orderRef: clean(input.orderRef, 80),
    notes: clean(input.notes, 2000),
  };
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const before = await readAttributionStatus(admin);
  const saved = await writeAttributionTest(admin, next);
  if (!saved.ok) {
    return {
      ok: false,
      error: saved.missing
        ? 'Falta aplicar la migración 0013 en Supabase para guardar la prueba de atribución.'
        : saved.error,
    };
  }

  await logAdminEvent(admin, {
    actor,
    action: 'prueba_atribucion',
    target: 'attribution_test',
    before,
    after: next,
  });

  // El estado decide si se pueden publicar links directos (directLinksUsable),
  // que se ven en todo el sitio.
  revalidatePath('/', 'layout');
  return { ok: true };
}
