import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isCronAuthorized } from '@/lib/cron-auth';
import { chileDateKey, chileDayStart } from '@/lib/clicks';
import { readAffiliateSettings } from '@/lib/settings';
import { SITE_URL } from '@/lib/site';
import { countUnreadHistory, readSocialEvidence } from '@/lib/social/drops';
import { pieceKey } from '@/lib/social/piece-url';
import { pickByRules, readFreshSocialProducts } from '@/lib/social/telegram';
import {
  NETWORK_RULES,
  PLAN_MAX,
  buildPlanItem,
  countPostsBetween,
  postedOnNetworks,
  readPendingIssues,
  type PlanItem,
} from '@/lib/social/networks';

/**
 * Qué publicar en Instagram, Facebook y TikTok: los productos elegidos, con
 * el texto de cada red y la imagen en una dirección pública. Vienen en orden
 * de interés (lib/social/interest), cada uno con sus puntos, el motivo y, si
 * hay algo que mirar a mano, un aviso.
 *
 * También avisa de lo que ya está programado y dejó de calzar con el sitio
 * (el producto se agotó o cambió de precio), para retirarlo de Metricool
 * antes de que salga.
 *
 * Solo lee: no publica ni marca nada. Lo llama quien programa las
 * publicaciones en Metricool (ver lib/social/networks), con el mismo secreto
 * de los crons. ?n= pide otra cantidad de productos (1 a 12).
 *
 * ?producto=<id> arma el plan de ese producto y nada más, aunque ya se haya
 * publicado, no llegue al descuento o el puntaje no lo hubiera elegido: sirve
 * para sacar su historia después de la publicación, o para publicar algo
 * elegido a mano (ahí el aviso es lo que hay que leer). Igual tiene que estar
 * a la venta y con el precio recién revisado.
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** El mes siguiente a 'AAAA-MM'. */
function nextMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase admin no configurado' }, { status: 500 });
  const key = pieceKey();
  if (!key) {
    return NextResponse.json(
      { error: 'CRON_SECRET falta o tiene menos de 32 caracteres: no se pueden firmar las imágenes' },
      { status: 500 }
    );
  }

  const wantedId = (req.nextUrl.searchParams.get('producto') ?? '').trim().toLowerCase();
  if (wantedId && !UUID_RE.test(wantedId)) {
    return NextResponse.json({ error: 'producto no es un id válido' }, { status: 400 });
  }
  const asked = Number(req.nextUrl.searchParams.get('n'));
  const count = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, PLAN_MAX) : NETWORK_RULES.maxPosts;

  const now = new Date();
  const freshSince = new Date(now.getTime() - NETWORK_RULES.maxPriceAgeMs).toISOString();

  try {
    const read = await readFreshSocialProducts(admin, freshSince);
    if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);
    const rows = read.rows;

    const since = new Date(now.getTime() - NETWORK_RULES.repeatAfterDays * 86_400_000);
    const month = chileDateKey(now).slice(0, 7);
    const monthStart = chileDayStart(`${month}-01`);
    const nextMonthStart = chileDayStart(`${nextMonthKey(month)}-01`);
    const [posted, monthCount, pendientes, settings] = await Promise.all([
      postedOnNetworks(admin, since),
      countPostsBetween(admin, monthStart, nextMonthStart),
      readPendingIssues(admin, now),
      readAffiliateSettings(admin),
    ]);

    // El historial y las señales (más vendidos de Mercado Libre, clics en el
    // sitio) se leen solo de lo que puede salir: el producto pedido, o todo lo
    // que no se publicó hace poco.
    const wanted = wantedId ? rows.filter((p) => p.id === wantedId) : null;
    const evidence = await readSocialEvidence(admin, wanted ?? rows, now, wanted ? undefined : posted ?? undefined);

    const picks = wanted
      ? pickByRules(
          wanted,
          { now, recentlyPosted: new Set(), evidence },
          { ...NETWORK_RULES, maxPosts: 1, minDiscount: 0, minDrop: 0, anyScore: true }
        )
      : pickByRules(
          rows,
          { now, recentlyPosted: posted ?? new Set(), evidence },
          { ...NETWORK_RULES, maxPosts: count }
        );
    const seleccion = picks
      .map((pick) => buildPlanItem(pick, { now, siteUrl: SITE_URL, settings, key }))
      .filter((item): item is PlanItem => item !== null);

    return NextResponse.json({
      ok: true,
      generado: now.toISOString(),
      sitio: SITE_URL,
      con_precio_fresco: rows.length,
      ya_publicados_14_dias: posted?.size ?? null,
      // Metricool gratis: 20 al mes, y cada red cuenta como una publicación.
      programadas_este_mes: monthCount,
      falta_tabla_social_posts: posted === null,
      // Productos cuyo historial de precios no se pudo leer ahora: no se proponen (salvo pedidos por su id).
      historial_sin_leer: countUnreadHistory(evidence),
      ...(wantedId && seleccion.length === 0
        ? { aviso: 'Ese producto no está a la venta o su precio no se revisó en las últimas 6 horas.' }
        : {}),
      seleccion,
      pendientes_con_problemas: pendientes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
