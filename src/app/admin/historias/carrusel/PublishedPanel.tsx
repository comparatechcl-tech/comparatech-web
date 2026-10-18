'use client';

import { useState, useTransition } from 'react';
import { Check, Undo2 } from 'lucide-react';
import { formatPrice } from '@/lib/content/captions';
import { formatDayMonth } from '@/lib/format';
import type { PublishedCarousel } from '@/lib/social/carousel';
import { undoCarouselPublished } from './actions';

const timeFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

/**
 * El último carrusel marcado como publicado: qué productos llevaba, a qué
 * precio y a cuánto están ahora, y cómo deshacer la marca si fue un error.
 */
export function PublishedPanel({ published, nextLabel }: { published: PublishedCarousel; nextLabel: string | null }) {
  const [state, setState] = useState<'idle' | 'busy' | 'undone'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function undo() {
    if (state !== 'idle') return;
    setState('busy');
    setError(null);
    startTransition(async () => {
      try {
        const result = await undoCarouselPublished(published.postIds);
        if (result.ok) {
          setState('undone');
          return;
        }
        setError(result.error);
      } catch {
        setError('No se pudo deshacer. Revisa tu conexión; si sigue igual, toca Actualizar, arriba.');
      }
      setState('idle');
    });
  }

  return (
    <section className="mt-6 rounded-xl border border-accent/40 bg-accent/5 p-4">
      <h2 className="flex items-center gap-2 font-heading text-lg font-semibold text-fg">
        <Check size={18} className="text-accent" aria-hidden /> Ya publicaste el carrusel de esta semana
      </h2>
      <p className="mt-1 text-sm text-muted">
        Lo marcaste el {formatDayMonth(published.postedAt)} a las {timeFmt.format(new Date(published.postedAt))}.
        {nextLabel ? ` El próximo se arma desde el ${nextLabel}.` : ''} Sus productos salen en /hoy, el link del perfil.
      </p>
      <ul className="mt-3 space-y-1 text-sm text-fg">
        {published.items.map((item, i) => (
          <li key={item.productId}>
            #{i + 1} · {item.name}
            {item.postedPrice !== null && item.postedPrice > 0 ? ` · publicado a ${formatPrice(item.postedPrice)}` : ''}
            {item.priceNow === null ? (
              <span className="text-amber-400"> · ya no está a la venta</span>
            ) : item.postedPrice !== null && item.priceNow !== item.postedPrice ? (
              <span className="text-muted"> · ahora {formatPrice(item.priceNow)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {state === 'undone' ? (
          <p className="text-sm font-medium text-accent">
            Listo, quedó sin marcar. Toca <strong>Actualizar</strong> para armarlo de nuevo.
          </p>
        ) : (
          <button type="button" onClick={undo} disabled={state === 'busy'} className={BUTTON}>
            <Undo2 size={15} aria-hidden /> {state === 'busy' ? 'Deshaciendo…' : 'No lo publiqué: deshacer'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
