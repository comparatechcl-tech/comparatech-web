'use client';

import { useState, useTransition } from 'react';
import { Clapperboard, Loader2 } from 'lucide-react';
import { buildVideosNow } from './build';

/**
 * El botón "Armar los videos ahora" de /admin/videos y lo que dice sobre
 * cuándo llegan videos nuevos.
 *
 * `ready`: está la llave de GitHub (sin ella el sitio no puede pedir nada).
 * `auto`: además la revisión de cada media hora está corriendo (pg_cron).
 */
export function BuildNow({ ready, auto, maxAgeHours }: { ready: boolean; auto: boolean; maxAgeHours: number }) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'info' | 'bad' } | null>(null);
  // Un pedido ya hecho no se repite al tiro: GitHub tarda unos minutos en armar.
  const [asked, setAsked] = useState(false);

  function build() {
    setNote(null);
    startTransition(async () => {
      const result = await buildVideosNow();
      if (!result.ok) {
        setNote({ text: result.error, tone: 'bad' });
        return;
      }
      const count = result.pending === 1 ? '1 video' : `${result.pending} videos`;
      if (result.test) {
        setNote({ text: `Modo prueba: hay ${count} por armar. Acá no se le pidió nada a GitHub.`, tone: 'info' });
      } else if (result.requested) {
        setAsked(true);
        setNote({ text: `Pedido hecho: ${count} por armar. Tardan entre 5 y 10 minutos; después toca Actualizar.`, tone: 'ok' });
      } else {
        setNote({
          text: `Ahora no hay videos por armar. Aparecen cuando revisas un precio en Precios o guardas un aviso del canal, y valen por ${maxAgeHours} horas.`,
          tone: 'info',
        });
      }
    });
  }

  if (!ready) {
    return (
      <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
        Los videos se arman en GitHub, y GitHub se salta casi todas sus pasadas programadas. Para que el sitio pueda pedirlos a tiempo falta un
        paso tuyo, una sola vez: una llave de GitHub guardada en Railway.
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-fg">
        {auto
          ? `¿Recién revisaste un precio o guardaste un aviso del canal? Su video llega solo dentro de la media hora siguiente (el precio vale por ${maxAgeHours} horas).`
          : 'La revisión de cada media hora todavía no está corriendo: los videos dependen del horario de GitHub, que se atrasa.'}{' '}
        Si no quieres esperar:
      </p>
      <button
        type="button"
        onClick={build}
        disabled={pending || asked}
        className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Clapperboard size={16} aria-hidden />}
        Armar los videos ahora
      </button>
      {note && (
        <p role="status" className={`mt-2 text-sm ${note.tone === 'bad' ? 'text-red-400' : note.tone === 'ok' ? 'text-accent' : 'text-muted'}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
