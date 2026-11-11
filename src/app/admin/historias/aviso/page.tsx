import Link from 'next/link';
import { STORY_RULES } from '@/lib/social/stories';
import { NoticeView } from './NoticeView';

export const dynamic = 'force-dynamic';
/** Revisar un aviso son hasta ~50 consultas a Mercado Libre, de a tres productos a la vez. */
export const maxDuration = 60;

/**
 * Recomendaciones del canal de afiliados de Mercado Libre: el dueño pega el
 * aviso y el sitio busca cada producto por su nombre (lib/social/deal-notice
 * y deal-notice-review). Lo que está en el sitio sale con su historia lista;
 * lo que falta se agrega con un toque; lo que no es de tecnología se salta.
 * Los links del aviso no se abren: cuentan como clic de afiliado.
 */
export default function AvisoPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Link href="/admin/historias" className="text-sm text-muted hover:text-fg">
        ← Historias
      </Link>
      <h1 className="mt-2 font-heading text-2xl font-bold text-fg">Recomendaciones del canal</h1>
      <p className="mt-1 text-sm text-muted">
        Pega el aviso de recomendaciones del canal de afiliados. Busco cada producto: si está en el sitio, te dejo su
        historia lista; si falta, lo agregas con un toque; si no es de tecnología, lo salto.
      </p>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          En WhatsApp, mantén apretado el aviso y toca <strong>Copiar</strong>. Puedes copiar varios mensajes juntos.
        </li>
        <li>
          Pégalo abajo y toca <strong>Revisar aviso</strong>. Los links tinyurl no los abro (cuentan como clic): busco
          cada producto por su nombre.
        </li>
        <li>
          Si alguno falta en el sitio, toca <strong>Publicar ahora</strong> y su historia aparece en la lista.
        </li>
        <li>
          Para cada historia: si dice <strong>✓ Mismo precio que en Mercado Libre</strong>, toca{' '}
          <strong>Compartir</strong> y elige Instagram, Historia. El link queda copiado: ponlo con el sticker{' '}
          <strong>Enlace</strong> bajo el precio. Después marca <strong>Ya la publiqué</strong>.
        </li>
      </ol>

      <NoticeView maxPriceAgeMs={STORY_RULES.maxPriceAgeMs} />

      <p className="mt-6 text-xs text-muted">
        La historia lleva el precio de ahora, que puede no ser el del aviso: el precio cambia seguido y el porcentaje
        de descuento se calcula como en el resto del sitio. Hasta 8 productos por aviso.
      </p>
    </div>
  );
}
