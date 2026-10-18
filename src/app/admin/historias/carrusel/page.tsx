import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { SITE_URL } from '@/lib/site';
import { CAROUSEL_RULES, readCarouselPage, type CarouselPage } from '@/lib/social/carousel';
import { carouselKey } from '@/lib/social/carousel-url';
import { CarouselView } from './CarouselView';
import { PublishedPanel } from './PublishedPanel';

export const dynamic = 'force-dynamic';

/**
 * El carrusel semanal "Top 5 bajas de la semana" para Instagram y Facebook,
 * listo para bajarlo y subirlo desde el teléfono (lib/social/carousel). Va
 * dentro de Historias y no como pestaña aparte: es lo mismo, contenido que se
 * sube a mano.
 */

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** "domingo 25/10" de un día AAAAMMDD. */
function dayLabel(day: number): string {
  const y = Math.floor(day / 10_000);
  const m = Math.floor(day / 100) % 100;
  const d = day % 100;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export default async function CarruselPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const force = params.ver === 'proximo';
  const admin = getSupabaseAdmin();
  const key = carouselKey();
  const now = new Date();

  let page: CarouselPage | null = null;
  let error: string | null = null;
  if (!admin) error = 'Supabase admin no configurado';
  else if (!key) error = 'CRON_SECRET falta o tiene menos de 32 caracteres: no se pueden firmar las imágenes';
  else {
    try {
      page = await readCarouselPage(admin, now, key, { siteUrl: SITE_URL, force });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const carousel = page?.carousel ?? null;
  const published = page?.published ?? null;
  const showCarousel = !published || force;
  const hours = Math.round(CAROUSEL_RULES.maxPriceAgeMs / 3_600_000);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Link href="/admin/historias" className="text-sm text-muted hover:text-fg">
        ← Historias
      </Link>
      <div className="mt-2 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Carrusel de la semana</h1>
          <p className="mt-1 text-sm text-muted">
            Top {CAROUSEL_RULES.size} bajas de la semana para Instagram y Facebook: las bajas más grandes que confirma
            nuestro historial de precios. Antes de que lo subas, reviso cada producto en Mercado Libre.
          </p>
        </div>
        {/* Un enlace común: tiene que recargar la página entera, con precios e imágenes nuevas. */}
        <a
          href={force ? '/admin/historias/carrusel?ver=proximo' : '/admin/historias/carrusel'}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50"
        >
          Actualizar
        </a>
      </div>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          Deja activa en Instagram la cuenta de <strong>ComparaTech</strong>.
        </li>
        <li>
          Mira la línea bajo cada precio. Si todas dicen <strong>✓ Mismo precio que en Mercado Libre</strong>, súbelo. Si
          una dice en rojo que cambió, no lo subas y toca <strong>Actualizar</strong>.
        </li>
        <li>
          Toca <strong>Compartir</strong> y elige Instagram, <strong>Publicación</strong>: van todas las imágenes en
          orden y el texto queda copiado para pegarlo. Si Instagram no aparece, toca <strong>Guardar</strong> y súbelas
          desde la app.
        </li>
        <li>
          Para Facebook, activa &quot;Compartir en Facebook&quot; al publicar, o comparte de nuevo, elige Facebook y pega
          su texto (<strong>Copiar texto (Facebook)</strong>).
        </li>
        <li>
          Marca <strong>Ya lo publiqué</strong>: sus productos salen en /hoy, el link del perfil, y el próximo se arma
          en {CAROUSEL_RULES.everyDays} días.
        </li>
      </ol>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          No se pudo preparar el carrusel: {error}
        </div>
      )}

      {page && page.unread > 0 && (
        <div role="status" className="mt-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Ahora no pude leer el historial de precios de {page.unread} {page.unread === 1 ? 'producto' : 'productos'}: puede
          faltar alguna baja. Es una falla pasajera del sitio. Toca <strong>Actualizar</strong> en unos minutos.
        </div>
      )}

      {published && (
        <>
          <PublishedPanel published={published} nextLabel={page?.nextDay ? dayLabel(page.nextDay) : null} />
          {!force && (
            <p className="mt-3 text-sm text-muted">
              Si de todas formas quieres armar otro antes,{' '}
              <a href="/admin/historias/carrusel?ver=proximo" className="font-medium text-accent">
                míralo aquí
              </a>
              : no repite las bajas que ya publicaste.
            </p>
          )}
        </>
      )}

      {page && showCarousel && carousel && (
        <>
          <p className="mt-6 text-sm text-fg">
            <strong>Bajas {carousel.rangeLabel}.</strong>{' '}
            {carousel.entries.length < CAROUSEL_RULES.size
              ? `Esta semana solo ${carousel.entries.length} bajas cumplen todas las reglas: sale como Top ${carousel.entries.length}, sin rellenar con otras.`
              : page.qualifying > carousel.entries.length
                ? `${page.qualifying} bajas cumplen las reglas; van las ${carousel.entries.length} más grandes, sin repetir modelo ni más de ${CAROUSEL_RULES.perCategory} por categoría.`
                : null}
          </p>
          <CarouselView
            // Otra carga de la página, otro carrusel: lo revisado y marcado del anterior no se le aplica.
            key={now.getTime()}
            carousel={carousel}
            maxPriceAgeMs={CAROUSEL_RULES.maxPriceAgeMs}
            renderedAt={now.getTime()}
          />
        </>
      )}

      {page && showCarousel && !carousel && (
        <p className="mt-6 rounded-xl border border-border bg-surface px-4 py-6 text-sm text-muted">
          Esta semana no alcanza para el carrusel:{' '}
          {page.found === 0 ? 'ninguna baja cumple' : page.found === 1 ? 'solo 1 baja cumple' : `solo ${page.found} bajas cumplen`}{' '}
          todas las reglas y hacen falta al menos {CAROUSEL_RULES.minSize}. No relleno con otras: vuelve a mirar en unas
          horas, cuando cambien los precios.
        </p>
      )}

      <p className="mt-6 text-xs text-muted">
        Entran solo bajas que confirma nuestro historial de precios, de {CAROUSEL_RULES.minDropPct}% o más y de algún día
        de esta semana, con el precio revisado en las últimas {hours} horas: lo mismo que se exige a todo lo que se
        publica en redes. Quedan fuera las que traen un &quot;Ojo&quot; en Historias (estuvo más barato hace poco, el
        precio se mueve mucho, otro vendedor lo tiene a menos…) y las que ya salieron en un carrusel. Van de la baja más
        grande a la más chica, con {CAROUSEL_RULES.perCategory} por categoría como máximo y un color por modelo.
      </p>
    </div>
  );
}
