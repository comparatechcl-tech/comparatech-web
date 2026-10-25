'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import {
  buildConnection,
  cleanPastedToken,
  deleteMetaConnection,
  metaCredentials,
  metaErrorMessage,
  publishingQuota,
  readMetaConnection,
  toStatus,
  writeMetaConnection,
  type MetaStatus,
} from '@/lib/social/meta';

/**
 * Conectar la app propia de Meta (ver lib/social/meta). Nada de esto
 * publica: conecta, prueba la conexión leyendo el cupo de publicaciones de
 * Instagram, o la borra.
 *
 * El token pegado y el de la página nunca vuelven al navegador ni quedan en
 * la actividad del admin: ahí se anota solo el nombre de la página y de la
 * cuenta de Instagram.
 */

export type ConnectResult =
  | { ok: true; status: MetaStatus; missingOptional: string[] }
  | { ok: false; choose: Array<{ id: string; name: string; igUsername: string | null }> }
  | { ok: false; error: string };

export async function connectMeta(input: { token: string; pageId?: string | null }): Promise<ConnectResult> {
  const actor = await requireAdmin();
  const creds = metaCredentials();
  if (!creds) {
    return {
      ok: false,
      error: 'Faltan META_APP_ID y META_APP_SECRET en Vercel (solo Production). Agrégalos y avísame para publicar de nuevo.',
    };
  }
  const token = cleanPastedToken(input?.token ?? '');
  if (!token) {
    return { ok: false, error: 'Eso no parece un token de Meta: empieza con EAA y es largo. Cópialo completo con el botón de copiar.' };
  }
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const current = await readMetaConnection(admin);
  if (!current.available) {
    return { ok: false, error: 'No se pudo leer la configuración privada (migración 0013). Revisa Supabase.' };
  }

  let built: Awaited<ReturnType<typeof buildConnection>>;
  try {
    built = await buildConnection(token, { creds, actor, pageId: input?.pageId ?? null });
  } catch (err) {
    return { ok: false, error: metaErrorMessage(err) };
  }
  if (!built.ok) return built;

  const saved = await writeMetaConnection(admin, built.connection);
  if (!saved.ok) return { ok: false, error: `No se pudo guardar la conexión: ${saved.error}` };

  await logAdminEvent(admin, {
    actor,
    action: 'conectar_meta',
    target: 'meta_connection',
    before: current.connection ? { pagina: current.connection.pageName, instagram: current.connection.igUsername } : null,
    after: { pagina: built.connection.pageName, instagram: built.connection.igUsername },
  });

  revalidatePath('/admin/configuracion/meta');
  return { ok: true, status: toStatus(built.connection), missingOptional: built.missingOptional };
}

export type TestResult =
  | { ok: true; used: number | null; total: number | null }
  | { ok: false; error: string };

/** Solo lectura: cuántas publicaciones por API lleva Instagram en 24 h. */
export async function testMeta(): Promise<TestResult> {
  await requireAdmin();
  const creds = metaCredentials();
  if (!creds) return { ok: false, error: 'Faltan META_APP_ID y META_APP_SECRET en Vercel.' };
  const admin = getSupabaseAdmin();
  const { connection } = await readMetaConnection(admin);
  if (!connection) return { ok: false, error: 'No hay una conexión guardada.' };
  try {
    const quota = await publishingQuota(connection, creds);
    return { ok: true, ...quota };
  } catch (err) {
    return { ok: false, error: metaErrorMessage(err) };
  }
}

export async function disconnectMeta(): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };
  const current = await readMetaConnection(admin);
  const deleted = await deleteMetaConnection(admin);
  if (!deleted.ok) return { ok: false, error: deleted.error };
  await logAdminEvent(admin, {
    actor,
    action: 'desconectar_meta',
    target: 'meta_connection',
    before: current.connection ? { pagina: current.connection.pageName, instagram: current.connection.igUsername } : null,
    after: null,
  });
  revalidatePath('/admin/configuracion/meta');
  return { ok: true };
}
