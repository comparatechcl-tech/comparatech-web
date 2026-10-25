'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, ExternalLink, Loader2, Send } from 'lucide-react';
import type { MetaNetwork } from '@/lib/social/carousel-publish';
import { publishCarouselOnMeta, type NetworkResult } from './meta-actions';

/**
 * "Publicar en Instagram y Facebook": el carrusel sale desde el sitio con la
 * app de Meta del dueño (meta-actions), completo y con el texto de cada red.
 * Solo se puede cuando la revisión en vivo dejó publicar (el mismo permiso
 * que Compartir y Guardar), y siempre pregunta antes.
 */

const LABEL: Record<MetaNetwork, string> = { instagram: 'Instagram', facebook: 'Facebook' };
const ORDER: MetaNetwork[] = ['instagram', 'facebook'];

export function MetaPublishPanel({
  metaReady,
  slides,
  ready,
  blocked,
  alreadyMarked,
  onMarked,
}: {
  metaReady: boolean;
  /** Las direcciones firmadas de las láminas, en orden. */
  slides: string[];
  /** La revisión en vivo dejó publicar. */
  ready: boolean;
  /** Por qué no se puede ahora (precio cambió, etc.), o null. */
  blocked: string | null;
  /** Ya estaba marcado como publicado (a mano o desde aquí). */
  alreadyMarked: boolean;
  onMarked: (mark: { postIds: number[]; postedAt: string }) => void;
}) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Partial<Record<MetaNetwork, NetworkResult>>>({});
  const [error, setError] = useState<string | null>(null);

  if (!metaReady) {
    return (
      <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
        Para publicar el carrusel desde aquí, sin pasar por el teléfono, conecta Meta en{' '}
        <Link href="/admin/configuracion/meta" className="font-medium text-accent hover:underline">
          Configuración → Instagram y Facebook
        </Link>
        .
      </p>
    );
  }

  const done = ORDER.filter((n) => results[n]?.ok);
  const pending = ORDER.filter((n) => !results[n]?.ok);
  const retryable = pending.filter((n) => {
    const r = results[n];
    return !r || (!r.ok && !r.uncertain);
  });

  async function publish(networks: MetaNetwork[]) {
    const where = networks.map((n) => LABEL[n]).join(' y ');
    const warn = alreadyMarked ? '\n\nOjo: este carrusel ya está marcado como publicado. Si lo subiste a mano, no lo publiques de nuevo.' : '';
    if (!window.confirm(`¿Publicar ahora el carrusel en ${where}? Sale de inmediato, con el texto de cada red.${warn}`)) return;
    setRunning(true);
    setError(null);
    try {
      const r = await publishCarouselOnMeta({ slides, networks });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResults((prev) => ({ ...prev, ...r.results }));
      if (r.mark) onMarked(r.mark);
      if (r.markError) setError(`Se publicó, pero no se pudo marcar como publicado (${r.markError}). Toca "Ya lo publiqué".`);
    } catch {
      setError('Se cortó la conexión con el sitio. Antes de volver a intentar, mira en Instagram y Facebook si salió, y toca Actualizar.');
    } finally {
      setRunning(false);
    }
  }

  const primaryLabel = running
    ? 'Publicando… (puede tardar un minuto)'
    : retryable.length === 2
      ? 'Publicar en Instagram y Facebook'
      : `Publicar en ${retryable.map((n) => LABEL[n]).join(' y ')}`;

  return (
    <section className="rounded-xl border border-accent/40 bg-accent/5 p-3 sm:p-4">
      <h2 className="text-sm font-semibold text-fg">Publicar desde el sitio</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Sale ahora mismo en Instagram y en tu página de Facebook, con las imágenes completas y el texto de cada red, y queda
        marcado como publicado. No hace falta guardar ni compartir nada.
      </p>

      {pending.length > 0 && retryable.length > 0 && (
        <button
          type="button"
          onClick={() => void publish(retryable)}
          disabled={running || !ready || blocked !== null}
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50"
        >
          {running ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />}
          {!running && !ready && blocked === null ? 'Revisando los precios en Mercado Libre…' : primaryLabel}
        </button>
      )}
      {running && <p className="mt-2 text-xs text-muted">No cierres esta página hasta que termine.</p>}
      {blocked && !running && <p className="mt-2 text-sm font-medium text-red-400">{blocked}</p>}

      {ORDER.some((n) => results[n]) && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {ORDER.map((n) => {
            const r = results[n];
            if (!r) return null;
            return r.ok ? (
              <li key={n} className="flex flex-wrap items-center gap-2 text-accent">
                <Check size={15} aria-hidden /> {LABEL[n]}: {r.already ? 'ya estaba publicado' : 'publicado'}
                {r.permalink && (
                  <a href={r.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline">
                    Ver <ExternalLink size={13} aria-hidden />
                  </a>
                )}
              </li>
            ) : (
              <li key={n} className={r.uncertain ? 'font-medium text-amber-400' : 'text-red-400'}>
                {LABEL[n]}: {r.error}
              </li>
            );
          })}
        </ul>
      )}
      {done.length === 2 && <p className="mt-2 text-xs text-muted">Listo en las dos redes.</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
