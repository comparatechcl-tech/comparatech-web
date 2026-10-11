'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, Download, Loader2, Share2 } from 'lucide-react';
import { formatPrice } from '@/lib/content/captions';
import type { StoryItem } from '@/lib/social/stories';
import { setRrssStatus } from '../productos/actions';

/**
 * Las historias del día, pensadas para el teléfono: compartir la imagen
 * directo a Instagram con el link ya copiado, y marcar lo publicado.
 *
 * Las imágenes se bajan de a una y se guardan en memoria. De a una, porque
 * cada pieza la dibuja el servidor en el momento; en memoria, porque el
 * teléfono solo deja compartir un archivo si ya está listo cuando se toca
 * el botón (si hubiera que bajarlo en ese instante, el permiso del toque se
 * pierde y no se abre la hoja de compartir).
 */

type Loaded = { file: File; url: string };
type Status = 'cargando' | 'lista' | 'error';

const BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

export function StoryList({ items }: { items: StoryItem[] }) {
  const loaded = useRef(new Map<string, Loaded>());
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const store = loaded.current;
    // Con ofertas nuevas (botón Actualizar) todo se vuelve a bajar: los precios pueden haber cambiado.
    setStatus({});

    (async () => {
      for (const item of items) {
        if (cancelled) return;
        try {
          const res = await fetch(item.image);
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          if (cancelled) return;
          const file = new File([blob], item.fileName, { type: 'image/jpeg' });
          store.set(item.id, { file, url: URL.createObjectURL(blob) });
          setStatus((s) => ({ ...s, [item.id]: 'lista' }));
          // En el computador no hay hoja de compartir con archivos: ahí queda "Guardar imagen".
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) setCanShare(true);
        } catch {
          if (!cancelled) setStatus((s) => ({ ...s, [item.id]: 'error' }));
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const entry of store.values()) URL.revokeObjectURL(entry.url);
      store.clear();
    };
  }, [items]);

  const fail = (id: string, message: string) => setErrors((e) => ({ ...e, [id]: message }));
  const clear = (id: string) => setErrors(({ [id]: _gone, ...rest }) => rest);

  async function copyLink(item: StoryItem): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(item.link);
      setCopied(item.id);
      clear(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2500);
      return true;
    } catch {
      fail(item.id, 'El teléfono no dejó copiar el link. Mantén el dedo sobre el link de abajo y elige Copiar.');
      return false;
    }
  }

  function share(item: StoryItem) {
    const entry = loaded.current.get(item.id);
    if (!entry) return;
    // Las dos cosas dentro del mismo toque: el link se pega después en el sticker.
    void copyLink(item);
    navigator.share({ files: [entry.file] }).catch((err: unknown) => {
      // Cerrar la hoja de compartir no es un error.
      if (err instanceof Error && err.name === 'AbortError') return;
      fail(item.id, 'No se pudo abrir Compartir. Usa "Guardar imagen" y súbela desde Instagram.');
    });
  }

  function markPublished(item: StoryItem) {
    setMarking(item.id);
    clear(item.id);
    startTransition(async () => {
      try {
        const result = await setRrssStatus(item.id, 'publicado', 'instagram');
        if (!result.ok) {
          fail(item.id, result.error);
          return;
        }
        setPublished((p) => new Set(p).add(item.id));
      } catch {
        fail(item.id, 'No se pudo guardar. Revisa tu conexión.');
      } finally {
        setMarking(null);
      }
    });
  }

  return (
    <ul className="mt-6 flex flex-col gap-4">
      {items.map((item) => {
        const state = status[item.id] ?? 'cargando';
        const entry = loaded.current.get(item.id);
        const done = published.has(item.id);
        return (
          <li
            key={item.id}
            className={`flex gap-4 rounded-xl border border-border bg-surface p-3 sm:p-4 ${done ? 'opacity-60' : ''}`}
          >
            <div className="relative aspect-[9/16] w-28 shrink-0 self-start overflow-hidden rounded-md bg-bg sm:w-36">
              {state === 'lista' && entry ? (
                // eslint-disable-next-line @next/next/no-img-element -- JPG ya descargado: es el mismo archivo que se comparte.
                <img src={entry.url} alt={`Historia de ${item.name}`} className="h-full w-full object-cover" />
              ) : state === 'error' ? (
                <p className="flex h-full items-center justify-center p-2 text-center text-[11px] text-muted">
                  No se pudo generar la imagen.
                </p>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={18} className="animate-spin text-muted" aria-label="Preparando la imagen" />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div>
                {/* Hay nombres que parten por el código del modelo: la marca dice de qué se trata. */}
                {item.brand && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{item.brand}</p>}
                <p className="text-sm font-semibold leading-snug text-fg">{item.name}</p>
                <p className="mt-1 text-sm text-fg">
                  <strong className="font-heading text-lg">{formatPrice(item.price)}</strong>
                  {item.listPrice !== null && (
                    <span className="ml-2 text-xs text-muted">
                      lista <s>{formatPrice(item.listPrice)}</s> · -{item.discount}%
                    </span>
                  )}
                  {item.listPrice === null && item.drop !== null && (
                    <span className="ml-2 text-xs text-muted">bajó {item.drop}% según el historial</span>
                  )}
                </p>
              </div>

              {done ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-accent">
                  <Check size={15} aria-hidden /> Publicada
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {canShare && (
                    <button
                      onClick={() => share(item)}
                      disabled={state !== 'lista'}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50 sm:col-span-2"
                    >
                      <Share2 size={15} aria-hidden /> {state === 'lista' ? 'Compartir' : 'Preparando…'}
                    </button>
                  )}
                  <button onClick={() => void copyLink(item)} className={BUTTON}>
                    {copied === item.id ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
                    {copied === item.id ? 'Link copiado' : 'Copiar link'}
                  </button>
                  {state === 'lista' && entry ? (
                    <a href={entry.url} download={item.fileName} className={BUTTON}>
                      <Download size={15} aria-hidden /> Guardar imagen
                    </a>
                  ) : (
                    <button disabled className={BUTTON}>
                      <Download size={15} aria-hidden /> Guardar imagen
                    </button>
                  )}
                  <button
                    onClick={() => markPublished(item)}
                    disabled={marking !== null}
                    className={`${BUTTON} sm:col-span-2`}
                  >
                    {marking === item.id ? 'Guardando…' : 'Ya la publiqué'}
                  </button>
                </div>
              )}

              {/* Completo y seleccionable: es el respaldo si el teléfono no deja copiar con el botón. */}
              <p className="select-all break-all text-[11px] text-muted" aria-label="Link de afiliado">
                {item.link}
              </p>
              <p role="status" aria-live="polite" className="text-xs text-red-400">
                {errors[item.id] ?? ''}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
