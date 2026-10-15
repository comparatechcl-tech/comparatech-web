import { getSupabaseAdmin } from '@/lib/supabase/server';
import { pieceKey } from '@/lib/social/piece-url';
import {
  STORY_REPOST_DROP,
  STORY_RULES,
  readPostedStories,
  readStoryPicks,
  type PostedStory,
  type StoryItem,
} from '@/lib/social/stories';
import { HISTORY_UNREAD_WARNING } from '@/lib/social/interest';
import { StoryList } from './StoryList';

export const dynamic = 'force-dynamic';

/**
 * Historias de hoy: las ofertas de este momento, cada una con su imagen 9:16
 * y el link de afiliado, para subirlas desde el teléfono.
 *
 * Una historia con link no se puede programar: el sticker "Enlace" solo se
 * pone a mano en la app de Instagram. Esta página deja todo lo demás listo,
 * para que cada historia tome medio minuto y no haya que buscar el producto,
 * bajar la imagen y armar el link por separado.
 */

export default async function HistoriasPage() {
  const admin = getSupabaseAdmin();
  const key = pieceKey();
  const now = new Date();

  let items: StoryItem[] = [];
  let posted: PostedStory[] = [];
  let error: string | null = null;
  if (!admin) error = 'Supabase admin no configurado';
  else if (!key) error = 'CRON_SECRET falta o tiene menos de 32 caracteres: no se pueden firmar las imágenes';
  else {
    try {
      [items, posted] = await Promise.all([readStoryPicks(admin, now, key), readPostedStories(admin, now, key)]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const unreadHistory = items.filter((item) => item.warning?.includes(HISTORY_UNREAD_WARNING)).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Historias de hoy</h1>
          <p className="mt-1 text-sm text-muted">
            Las ofertas de este momento, con la imagen lista y el link de afiliado para el sticker. Cada imagen dice
            a qué hora se revisó su precio: súbela hoy.
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

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        {/* La página no puede elegir la cuenta: Compartir abre la app con la última que se usó. */}
        <li>
          Antes de empezar, deja activa en Instagram la cuenta de <strong>ComparaTech</strong>: las historias salen
          por la última cuenta que usaste en la app.
        </li>
        <li>
          Toca <strong>Compartir</strong> en una oferta y elige Instagram, Historia. El link queda copiado.
        </li>
        <li>
          En la historia toca el ícono de stickers, elige <strong>Enlace</strong> y pega el link. Déjalo bajo el
          precio, en el espacio vacío.
        </li>
        <li>
          Publica y vuelve acá a tocar <strong>Ya la publiqué</strong>: no te la muestro de nuevo, salvo que baje de
          precio y siga entre las que más pueden interesar.
        </li>
      </ol>

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
          {STORY_RULES.repeatAfterDays} días. Tampoco muestro las que le interesarían a poca gente ni las que hace poco
          costaban bastante menos. Vuelve a mirar más tarde.
        </p>
      )}

      {(items.length > 0 || posted.length > 0) && (
        <>
          <StoryList
            items={items}
            posted={posted}
            maxPriceAgeMs={STORY_RULES.maxPriceAgeMs}
            renderedAt={now.getTime()}
          />
          <p className="mt-6 text-xs text-muted">
            Hasta {STORY_RULES.maxPosts} ofertas, primero las que más pueden interesar: lo que la gente busca y
            reconoce, qué tan comprobada está la oferta y que el precio esté al alcance. Una por tipo de producto y dos
            por marca (si hay pocas ofertas, se repiten), y nunca más de dos por categoría. Si una oferta dice
            &quot;Ojo&quot;, mira eso antes de subirla. Una historia que ya subiste no vuelve en{' '}
            {STORY_RULES.repeatAfterDays} días, salvo que el producto baje {Math.round(STORY_REPOST_DROP * 100)}% o
            más y siga entre las que más pueden interesar. No cuentan para las publicaciones del feed.
          </p>
        </>
      )}
    </div>
  );
}
