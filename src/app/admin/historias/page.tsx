import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { pieceKey } from '@/lib/social/piece-url';
import { PRICE_REFRESH_MINUTES } from '@/lib/social/content-timing';
import {
  STORY_LIFETIME_MS,
  STORY_REPOST_DROP,
  STORY_RULES,
  readPostedStories,
  readStoryPicks,
  type PostedStory,
  type StoryItem,
} from '@/lib/social/stories';
import { HISTORY_UNREAD_WARNING } from '@/lib/social/interest';
import { NextRefresh } from './NextRefresh';
import { StoryList } from './StoryList';
import { waitingText } from './rules';

export const dynamic = 'force-dynamic';

/**
 * Historias de hoy: las ofertas de este momento, cada una con su imagen 9:16
 * y el link de afiliado, para subirlas desde el teléfono.
 *
 * Una historia con link no se puede programar: el sticker "Enlace" solo se
 * pone a mano en la app de Instagram. Esta página deja todo lo demás listo,
 * para que cada historia tome medio minuto y no haya que buscar el producto,
 * bajar la imagen y armar el link por separado. Antes de subir, cada tarjeta
 * se revisa en vivo en Mercado Libre (ver StoryList).
 */

export default async function HistoriasPage() {
  const admin = getSupabaseAdmin();
  const key = pieceKey();
  const now = new Date();

  let items: StoryItem[] = [];
  let waiting = 0;
  let posted: PostedStory[] = [];
  let error: string | null = null;
  if (!admin) error = 'Supabase admin no configurado';
  else if (!key) error = 'CRON_SECRET falta o tiene menos de 32 caracteres: no se pueden firmar las imágenes';
  else {
    try {
      const [picks, done] = await Promise.all([readStoryPicks(admin, now, key), readPostedStories(admin, now, key)]);
      // Un arreglo común para la lista: lo que va pegado al de la selección no viaja al teléfono.
      items = [...picks];
      waiting = typeof picks.waiting === 'number' ? picks.waiting : 0;
      posted = done;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const unreadHistory = items.filter((item) => item.warning?.includes(HISTORY_UNREAD_WARNING)).length;
  const days = STORY_RULES.repeatAfterDays;
  const dropPct = Math.round(STORY_REPOST_DROP * 100);
  const lifetimeHours = Math.round(STORY_LIFETIME_MS / 3_600_000);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Historias de hoy</h1>
          <p className="mt-1 text-sm text-muted">
            Las ofertas de este momento, con la imagen lista y el link de afiliado para el sticker. Antes de que las
            subas, reviso cada una en Mercado Libre.
          </p>
        </div>
        {/* Un enlace común y no <Link>: tiene que recargar la página entera, con ofertas, precios e imágenes nuevas. */}
        <a
          href="/admin/historias"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50"
        >
          Actualizar
        </a>
      </div>

      {/* El carrusel semanal vive dentro de Historias: también se sube a mano desde el teléfono. */}
      <Link
        href="/admin/historias/carrusel"
        className="mt-5 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-fg transition hover:border-accent"
      >
        <span>
          <strong>Carrusel de la semana:</strong> el Top 5 de bajas para Instagram y Facebook, listo para subir.
        </span>
        <ChevronRight size={18} className="shrink-0 text-accent" aria-hidden />
      </Link>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        {/* La página no puede elegir la cuenta: Compartir abre la app con la última que se usó. */}
        <li>
          Antes de empezar, deja activa en Instagram la cuenta de <strong>ComparaTech</strong>: las historias salen
          por la última cuenta que usaste en la app.
        </li>
        <li>
          Mira la línea bajo el precio. Si dice <strong>✓ Mismo precio que en Mercado Libre</strong>, súbela. Si dice
          en rojo que cambió, no la subas y toca <strong>Actualizar</strong>. Si no pude revisar, toca{' '}
          <strong>Ver en Mercado Libre</strong> y compara el precio.
        </li>
        <li>
          Toca <strong>Compartir</strong> en una oferta y elige Instagram, Historia. El link queda copiado.
        </li>
        <li>
          En la historia toca el ícono de stickers, elige <strong>Enlace</strong> y pega el link. Déjalo bajo el
          precio, en el espacio vacío.
        </li>
        <li>
          Marca <strong>Ya la publiqué</strong> cuando la subas a Instagram: se marca una sola vez, no por red. La
          tarjeta queda pálida hasta que tocas Actualizar; después pasa a &quot;Ya publicadas&quot; por{' '}
          {lifetimeHours} horas, para llevarla a otras redes, y no vuelve en {days} días salvo que baje {dropPct}% o
          más.
        </li>
      </ol>

      {!error && (
        <p className="mt-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg">
          <strong>Cuándo hay historias nuevas:</strong> la lista se calcula cada vez que tocas Actualizar. Los precios
          se revisan cada {PRICE_REFRESH_MINUTES} minutos (la próxima revisión, cerca de las{' '}
          <NextRefresh renderedAt={now.getTime()} />). {waitingText(waiting, days)}
        </p>
      )}

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudieron preparar las historias: {error}
        </div>
      )}

      {unreadHistory > 0 && (
        <div role="status" className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Ahora no pude leer el historial de precios de {unreadHistory === items.length ? 'estas ofertas' : `${unreadHistory} de estas ofertas`}:
          no sé si estuvieron más baratas hace poco. Es una falla pasajera del sitio, no de los productos. Toca{' '}
          <strong>Actualizar</strong> en unos minutos antes de subirlas.
        </div>
      )}

      {!error && items.length === 0 && (
        <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          Ahora no hay ofertas para mostrar: tienen que venir con {STORY_RULES.minDiscount}% o más de descuento (o con
          una baja confirmada por el historial), con el precio revisado en las últimas{' '}
          {Math.round(STORY_RULES.maxPriceAgeMs / 3_600_000)} horas, y no haberse subido como historia en los últimos{' '}
          {days} días. Tampoco muestro las que le interesarían a poca gente ni las que hace poco costaban bastante menos.
          Vuelve a mirar más tarde.
        </p>
      )}

      {(items.length > 0 || posted.length > 0) && (
        <>
          <StoryList
            // Otra carga de la página, otra lista: las revisiones y lo marcado de la anterior no se le aplican.
            key={now.getTime()}
            items={items}
            posted={posted}
            maxPriceAgeMs={STORY_RULES.maxPriceAgeMs}
            renderedAt={now.getTime()}
            lifetimeMs={STORY_LIFETIME_MS}
          />
          <p className="mt-6 text-xs text-muted">
            Hasta {STORY_RULES.maxPosts} ofertas, primero las que más pueden interesar: lo que la gente busca y
            reconoce, qué tan comprobada está la oferta y que el precio esté al alcance. Una por tipo de producto y dos
            por marca (si hay pocas ofertas, se repiten), y nunca más de dos por categoría. Las que traen un
            &quot;Ojo&quot; van al final, en &quot;Con algo que mirar&quot;: lee el aviso antes de subirlas. Una
            historia que ya subiste no vuelve en {days} días, salvo que el producto baje {dropPct}% o más y siga entre
            las que más pueden interesar. No cuentan para las publicaciones del feed.
          </p>
        </>
      )}
    </div>
  );
}
