'use server';

import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { META_STORY_PAUSE_KEY, writeStoryPause, type StoryPauseMode } from '@/lib/social/meta-story';
import { getSupabaseAdmin } from '@/lib/supabase/server';

/**
 * El control de la historia automática en /admin/historias: pausarla por hoy,
 * hasta encenderla, o volver a encenderla. No publica nada.
 */

const MODES: readonly StoryPauseMode[] = ['activa', 'hoy', 'indefinida'];

export async function setStoryAutoPause(mode: StoryPauseMode): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  if (!MODES.includes(mode)) return { ok: false, error: 'Opción no válida' };
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  if (!(await writeStoryPause(admin, mode, new Date()))) return { ok: false, error: 'No se pudo guardar. Prueba otra vez.' };
  await logAdminEvent(admin, { actor, action: 'pausa_historia', target: META_STORY_PAUSE_KEY, after: { modo: mode } });
  return { ok: true };
}
