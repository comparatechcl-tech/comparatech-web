import type { Metadata } from 'next';
import Link from 'next/link';
import { Flame, Megaphone, Send } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getAllProducts, getDeals } from '@/lib/queries/products';
import { readVideoMarks } from '@/lib/social/videos';
import { lastShownAt, readCarouselMarks } from '@/lib/social/carousel-marks';
import { ProductGrid } from '@/components/product/ProductGrid';
import type { Product } from '@/lib/types';

/**
 * Landing del link de la bio (Instagram y TikTok no permiten links en los
 * posts): primero lo que se mostró en redes esta semana, para que quien
 * viene de un post o de un reel encuentre ese producto sin buscarlo, y
 * después las mejores ofertas del día.
 *
 * Fuera de Google: es una página para quien llega desde redes y repite lo
 * que ya está en /ofertas.
 */

export const metadata: Metadata = {
  title: 'Lo de hoy en redes',
  description:
    'Los productos que mostramos en redes esta semana y los mayores descuentos del día, con precios actualizados varias veces al día.',
  alternates: { canonical: '/hoy' },
  robots: { index: false, follow: true },
};

export const revalidate = 60;

const SOCIAL_WINDOW_DAYS = 7;
/** Cuántos productos caben en "Lo que mostramos en redes", vengan del feed, de un video o del carrusel. */
const SOCIAL_MAX = 24;
const TOP_DEALS = 12;

/**
 * Canal de Telegram, si está configurado. Solo https://, para que una
 * variable mal cargada no termine como un link raro.
 */
function telegramUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_TELEGRAM_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/** La fecha como número, o null si no se entiende. */
function timeOf(iso: string | null | undefined): number | null {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Lo publicado en el feed de las redes en los últimos 7 días: producto →
 * fecha. Sin la migración 0017 (o si falla la lectura), nada.
 */
async function readFeedDates(since: Date): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  const supabase = getSupabase();
  if (!supabase) return dates;
  // Lo programado en Metricool lleva la fecha en que sale (a lo más dos días
  // adelante) y se muestra desde ya: esta página se regenera cuando alguien
  // la pide, así que esperar a la hora exacta la dejaría sin el producto
  // justo para quien llega primero desde el post.
  const { data, error } = await supabase
    .from('products')
    .select('id, rrss_published_at')
    .gte('rrss_published_at', since.toISOString())
    .order('rrss_published_at', { ascending: false })
    .limit(SOCIAL_MAX);
  if (error) {
    if (!isMissingSchemaError(error)) console.warn('[hoy] no se pudo leer lo publicado en redes:', error.message);
    return dates;
  }
  for (const row of (data ?? []) as { id: string; rrss_published_at: string | null }[]) {
    // Una fecha que no se entiende no saca al producto: va al final de la lista.
    dates.set(row.id, timeOf(row.rrss_published_at) ?? since.getTime());
  }
  return dates;
}

/**
 * Los videos marcados como subidos en /admin/videos en los últimos 7 días:
 * producto → la marca más reciente de cualquier red.
 *
 * Los textos de los reels mandan al link del perfil, que es esta página: sin
 * esto, quien llega desde un reel no encuentra el producto, porque subir un
 * video no deja fecha en el producto (eso es del plan del feed). Las marcas
 * viven en social_posts, que el cliente público no puede leer: se leen con el
 * de servicio, que solo existe en el servidor. Si no está o la lectura falla,
 * la sección sale con lo del feed, como antes.
 */
async function readVideoDates(since: Date): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return dates;
    for (const [productId, posted] of await readVideoMarks(admin, since)) {
      let latest: number | null = null;
      for (const mark of Object.values(posted)) {
        const at = timeOf(mark?.at);
        if (at !== null && (latest === null || at > latest)) latest = at;
      }
      if (latest !== null) dates.set(productId, latest);
    }
  } catch (err) {
    console.warn('[hoy] no se pudo leer los videos subidos:', err instanceof Error ? err.message : String(err));
    return new Map();
  }
  return dates;
}

/**
 * Los productos del carrusel semanal marcado como publicado en
 * /admin/historias/carrusel en los últimos 7 días: producto → hora de la
 * marca. Su texto dice "Link de compra en nuestra bio", que es esta página.
 * Como con los videos, si la lectura falla la sección sale sin ellos.
 */
async function readCarouselDates(since: Date): Promise<Map<string, number>> {
  const dates = new Map<string, number>();
  try {
    const admin = getSupabaseAdmin();
    if (!admin) return dates;
    for (const [productId, at] of lastShownAt(await readCarouselMarks(admin, since))) dates.set(productId, at);
  } catch (err) {
    console.warn('[hoy] no se pudo leer los carruseles publicados:', err instanceof Error ? err.message : String(err));
    return new Map();
  }
  return dates;
}

/**
 * Ids de lo mostrado en redes en los últimos 7 días, en el feed, en un video
 * o en el carrusel, del más reciente al más antiguo y sin repetir: de un
 * producto que salió por varios lados vale su fecha más nueva.
 */
async function recentSocialIds(): Promise<string[]> {
  const since = new Date(Date.now() - SOCIAL_WINDOW_DAYS * 86_400_000);
  const [feed, videos, carousels] = await Promise.all([readFeedDates(since), readVideoDates(since), readCarouselDates(since)]);

  const latest = new Map(feed);
  for (const [id, at] of [...videos, ...carousels]) {
    const known = latest.get(id);
    if (known === undefined || at > known) latest.set(id, at);
  }
  return Array.from(latest)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, SOCIAL_MAX)
    .map(([id]) => id);
}

export default async function HoyPage() {
  const [ids, all, deals] = await Promise.all([recentSocialIds(), getAllProducts(), getDeals()]);

  // Del catálogo publicado: lo que se sacó del sitio o quedó sin vendedor
  // no se muestra aunque haya salido en redes.
  const byId = new Map(all.map((p) => [p.id, p]));
  const social = ids.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
  const socialIds = new Set(social.map((p) => p.id));
  const topDeals = deals.filter((p) => !socialIds.has(p.id)).slice(0, TOP_DEALS);
  const telegram = telegramUrl();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold sm:text-3xl">Lo de hoy</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Lo que mostramos en redes y los mayores descuentos del día. Los precios se revisan contra Mercado Libre
          varias veces al día y pueden cambiar.
        </p>
        {telegram && (
          <a
            href={telegram}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90"
          >
            <Send size={15} /> Recibe las ofertas en Telegram
          </a>
        )}
      </div>

      {social.length > 0 && (
        <section className="mb-12">
          <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
            <Megaphone size={18} className="text-accent" /> Lo que mostramos en redes
          </h2>
          <ProductGrid products={social} placement="social" />
        </section>
      )}

      <section>
        <h2 className="mb-4 flex items-center gap-2 font-heading text-lg font-semibold">
          <Flame size={18} className="text-accent" /> Mayores descuentos de hoy
        </h2>
        <ProductGrid products={topDeals} placement="social" />
        <div className="mt-6 text-center">
          <Link href="/ofertas" className="text-sm font-medium text-accent hover:underline">
            Ver todas las ofertas →
          </Link>
        </div>
      </section>
    </div>
  );
}
