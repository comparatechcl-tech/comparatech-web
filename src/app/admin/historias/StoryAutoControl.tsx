'use client';

import { useState, useTransition } from 'react';
import { setStoryAutoPause } from './auto-actions';
import type { StoryAutoStatus, StoryPauseMode } from '@/lib/social/meta-story';

const STATE_TEXT: Record<StoryPauseMode, string> = {
  activa: 'Encendida. Sale sola a las 12:40, con "Link en el perfil", si ese día no subiste otra.',
  hoy: 'En pausa por hoy. Mañana vuelve sola.',
  indefinida: 'En pausa hasta que la enciendas.',
};

function todayText(today: StoryAutoStatus['today']): string | null {
  if (!today) return null;
  if (today.status === 'publicado') return `Hoy salió: ${today.name}.`;
  if (today.status === 'error') return 'Hoy no se pudo publicar. Se intenta de nuevo a las 15:40.';
  return 'Hoy no llegó respuesta de Instagram. Mira la cuenta antes de subir otra.';
}

const BUTTON =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

/** Pausar o encender la historia automática (lib/social/meta-story). */
export function StoryAutoControl({ status }: { status: StoryAutoStatus }) {
  const [mode, setMode] = useState<StoryPauseMode>(status.pause);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const today = todayText(status.today);

  const choose = (next: StoryPauseMode) => {
    setError(null);
    startTransition(async () => {
      const result = await setStoryAutoPause(next);
      if (result.ok) setMode(next);
      else setError(result.error);
    });
  };

  return (
    <section aria-labelledby="historia-automatica" className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-fg">
      <h2 id="historia-automatica" className="font-semibold">
        Historia automática
      </h2>
      <p className="mt-1 text-muted" role="status">
        {STATE_TEXT[mode]}
      </p>
      {today && <p className="mt-1">{today}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {mode === 'activa' ? (
          <>
            <button type="button" className={BUTTON} disabled={pending} onClick={() => choose('hoy')}>
              Pausar hoy
            </button>
            <button type="button" className={BUTTON} disabled={pending} onClick={() => choose('indefinida')}>
              Pausar hasta encenderla
            </button>
          </>
        ) : (
          <button type="button" className={BUTTON} disabled={pending} onClick={() => choose('activa')}>
            Encender
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
