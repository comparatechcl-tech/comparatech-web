import type { Metadata } from 'next';
import Link from 'next/link';
import { Flame, Megaphone, Send } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { getAllProducts, getDeals } from '@/lib/queries/products';
import { ProductGrid } from '@/components/product/ProductGrid';
import type { Product } from '@/lib/types';

/**
 * Landing del link de la bio (Instagram y TikTok no permiten links en los
 * posts): primero lo que se mostró en redes esta semana, para que quien
 * viene de un post encuentre ese producto sin buscarlo, y después las
 * mejores ofertas del día.
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

/**
 * Ids de lo publicado en redes en los últimos 7 días, del más reciente al
 * más antiguo. Sin la migración 0017 (o si falla la lectura) la sección no
 * se muestra y la página sigue con las ofertas.
 */
async function recentSocialIds(): Promise<string[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const since = new Date(Date.now() - SOCIAL_WINDOW_DAYS * 86_400_000).toISOString();
  // Lo programado en Metricool lleva la fecha en que sale (a lo más dos días
  // adelante) y se muestra desde ya: esta página se regenera cuando alguien
  // la pide, así que esperar a la hora exacta la dejaría sin el producto
  // justo para quien llega primero desde el post.
  const { data, error } = await supabase
    .from('products')
    .select('id, rrss_published_at')
    .gte('rrss_published_at', since)
    .order('rrss_published_at', { ascending: false })
    .limit(24);
  if (error) {
    if (!isMissingSchemaError(error)) console.warn('[hoy] no se pudo leer lo publicado en redes:', error.message);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
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
        {/* Arriba y legible: a esta página llega quien viene de un post, y el aviso no puede quedar al pie en letra chica. */}
        <p className="mt-2 max-w-2xl text-sm text-fg">
          Publicidad · Los links a Mercado Libre son de afiliado: si compras, ComparaTech recibe una comisión sin
          costo extra para ti.
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
