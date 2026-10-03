import { getSupabaseAdmin } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';
import type { DigestCandidate, DigestInput } from '@/lib/daily-digest';

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/**
 * Junta los datos del resumen diario.
 *
 * Vive aparte de la ruta porque lo usan dos lugares: el endpoint que permite
 * previsualizar el correo en el navegador, y el cron que lo envía.
 */
export async function gatherDigestInput(admin: SupabaseAdmin): Promise<DigestInput> {
  // Ventana de 24 horas en vez de "día calendario": evita depender de la
  // zona horaria del servidor y del cambio de hora en Chile.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [newRes, pendingRes, publishedRes, offSiteRes] = await Promise.all([
    admin
      .from('product_candidates')
      .select('name, price, category, image_url, seller_nickname')
      .eq('status', 'pending_review')
      .gte('prospected_at', since)
      .order('price', { ascending: true }),
    admin
      .from('product_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_review'),
    admin
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('is_hidden', false),
    // Todo lo que está fuera del sitio sin que nadie lo haya ocultado. Se
    // separa abajo entre lo que requiere acción y lo que vuelve solo.
    admin
      .from('products')
      .select('name, inactive_reason')
      .eq('is_active', false)
      .eq('is_hidden', false)
      .order('inactive_since', { ascending: false, nullsFirst: false }),
  ]);

  const offSite = (offSiteRes.data ?? []) as { name: string; inactive_reason: string | null }[];
  const needsLink = offSite.filter((p) => p.inactive_reason === 'link_otro_producto');

  return {
    newCandidates: (newRes.data ?? []) as DigestCandidate[],
    pendingTotal: pendingRes.count ?? 0,
    publishedTotal: publishedRes.count ?? 0,
    needsLink: needsLink.map((p) => ({ name: p.name })),
    pausedCount: offSite.length - needsLink.length,
    adminUrl: SITE_URL,
  };
}
