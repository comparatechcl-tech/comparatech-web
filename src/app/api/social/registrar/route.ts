import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import {
  parsePostRecords,
  parseRetirements,
  registerPosts,
  retirePosts,
  type RegisterResult,
} from '@/lib/social/networks';

/**
 * Anota las publicaciones que se programaron en Metricool: quedan en
 * social_posts y el producto se marca, para que /hoy (el link de la bio) lo
 * muestre y para no repetirlo en dos semanas.
 *
 * Cuerpo: { "publicaciones": [{ "product_id", "canal", "programado_para"
 * (con zona horaria, a no más de 48 horas), "metricool_id" (el uuid de la
 * publicación), "precio"?, "texto"? }] }. Con el mismo secreto de los crons.
 * No publica nada en ninguna red.
 *
 * También acepta "retiradas": [{ "canal", "metricool_id" }], para lo que se
 * sacó de Metricool antes de salir (por ejemplo, porque el precio cambió).
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });

  const now = new Date();
  const body = (await req.json().catch(() => null)) as { publicaciones?: unknown } | null;
  const retirements = parseRetirements(body);
  if (!retirements.ok) return NextResponse.json({ error: retirements.error }, { status: 400 });
  // Solo retirar también vale: entonces "publicaciones" puede faltar o venir vacía.
  const posts = body?.publicaciones;
  const noPosts = posts === undefined || posts === null || (Array.isArray(posts) && posts.length === 0);
  const onlyRetire = retirements.items.length > 0 && noPosts;
  const parsed = onlyRetire ? { ok: true as const, records: [] } : parsePostRecords(body, now);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const retiradas = await retirePosts(admin, retirements.items, now);
    // Aparte y de inmediato: si lo que sigue falla, lo retirado ya quedó
    // escrito y tiene que constar.
    if (retirements.items.length > 0) {
      await logAdminEvent(admin, {
        actor: 'metricool',
        action: 'retirar_rrss',
        after: { retiradas: retirements.items.map((r) => ({ canal: r.channel, metricool: r.externalId })) },
      });
    }

    const result: RegisterResult =
      parsed.records.length > 0
        ? await registerPosts(admin, parsed.records, now)
        : { registradas: 0, actualizadas: 0, repetidas: 0, productos: 0, rechazados: [] };
    if (parsed.records.length > 0) {
      await logAdminEvent(admin, {
        actor: 'metricool',
        action: 'programar_rrss',
        after: {
          registradas: result.registradas,
          actualizadas: result.actualizadas,
          rechazados: result.rechazados,
          publicaciones: parsed.records.map((r) => ({
            producto: r.productId,
            canal: r.channel,
            metricool: r.externalId,
            sale: r.at.toISOString(),
          })),
        },
      });
    }
    revalidatePath('/hoy');
    revalidatePath('/admin/productos');
    return NextResponse.json({ ok: true, ...result, retiradas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
