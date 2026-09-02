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

  const [newRes, pendingRes, publishedRes, attentionRes] = await Promise.all([
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
    // Se cayeron del sitio solos y no se recuperan sin intervención: el
    // vendedor dejó de ofrecer el producto, o el link apunta a otra oferta.
    admin
      .from('products')
      .select('name')
      .eq('is_active', false)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false }),
  ]);

  return {
    newCandidates: (newRes.data ?? []) as DigestCandidate[],
    pendingTotal: pendingRes.count ?? 0,
    publishedTotal: publishedRes.count ?? 0,
    needsAttention: (attentionRes.data ?? []) as { name: string }[],
    adminUrl: SITE_URL,
  };
}
