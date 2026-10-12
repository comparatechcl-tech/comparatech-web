'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, Download, Loader2, Share2, TrendingDown, Undo2 } from 'lucide-react';
import { formatPrice } from '@/lib/content/captions';
import { formatDayMonth } from '@/lib/format';
import type { StoryItem } from '@/lib/social/stories';
import { markStoryPublished, undoStoryPublished } from './actions';

/**
 * Las historias del día, pensadas para el teléfono: compartir la imagen
 * directo a Instagram con el link ya copiado, y marcar lo publicado.
 *
 * Las imágenes se bajan de a una y se guardan en memoria. De a una, porque
 * cada pieza la dibuja el servidor en el momento; en memoria, porque el
 * teléfono solo deja compartir un archivo si ya está listo cuando se toca
 * el botón (si hubiera que bajarlo en ese instante, el permiso del toque se
 * pierde y no se abre la hoja de compartir).
 *
 * La miniatura y "Guardar imagen" usan la dirección de la pieza y no una
 * dirección blob: del archivo en memoria: la política de seguridad del sitio
 * publicado (next.config.js) no deja mostrar imágenes blob:. Como la pieza
 * ya se bajó, el navegador la saca de su caché y no se dibuja dos veces.
 */

type Status = 'cargando' | 'lista' | 'error';

const BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

export function StoryList({ items: initial, maxPriceAgeMs }: { items: StoryItem[]; maxPriceAgeMs: number }) {
  // Copia local: la lista no cambia sola mientras se trabaja con ella. Para
  // traer ofertas y precios nuevos está "Actualizar", que recarga la página.
  const [items] = useState(initial);
  const files = useRef(new Map<string, File>());
  const lastShare = useRef(0);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** Historias marcadas en esta visita: id del producto → id de la marca, para poder deshacerla. */
  const [published, setPublished] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const store = files.current;

    (async () => {
      for (const item of items) {
        let file: File | null = null;
        // Dos intentos: en el teléfono una descarga se corta fácil al pasar a otra app.
        for (let attempt = 0; attempt < 2 && !file && !cancelled; attempt++) {
          try {
            const res = await fetch(item.image);
            if (!res.ok) throw new Error(String(res.status));
            file = new File([await res.blob()], item.fileName, { type: 'image/jpeg' });
          } catch {
            /* se intenta una vez más */
          }
        }
        if (cancelled) return;
        if (!file) {
          setStatus((s) => ({ ...s, [item.id]: 'error' }));
          continue;
        }
        store.set(item.id, file);
        setStatus((s) => ({ ...s, [item.id]: 'lista' }));
        // En el computador no hay hoja de compartir con archivos: ahí queda "Guardar imagen".
        if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) setCanShare(true);
      }
    })();

    return () => {
      cancelled = true;
      store.clear();
    };
  }, [items]);

  const fail = (id: string, message: string) => setErrors((e) => ({ ...e, [id]: message }));
  const clear = (id: string) => setErrors(({ [id]: _gone, ...rest }) => rest);

  /** Una pestaña que quedó abierta lleva el precio de cuando se cargó. */
  function tooOld(item: StoryItem): boolean {
    if (!item.checkedAt) return false;
    if (Date.now() - new Date(item.checkedAt).getTime() <= maxPriceAgeMs) return false;
    fail(item.id, 'Este precio ya es antiguo. Toca Actualizar, arriba, y vuelve a intentarlo.');
    return true;
  }

  async function copyLink(item: StoryItem) {
    try {
      await navigator.clipboard.writeText(item.link);
      setCopied(item.id);
      clear(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2500);
    } catch {
      fail(item.id, 'El teléfono no dejó copiar el link. Mantén el dedo sobre el link de abajo y elige Copiar.');
    }
  }

  function share(item: StoryItem) {
    const file = files.current.get(item.id);
    if (!file || tooOld(item)) return;
    // Un doble toque no vuelve a pedir Compartir: el navegador rechaza el segundo y quedaría un error falso.
    if (Date.now() - lastShare.current < 1500) return;
    lastShare.current = Date.now();
    // Las dos cosas dentro del mismo toque: el link se pega después en el sticker.
    void copyLink(item);
    navigator.share({ files: [file] }).catch((err: unknown) => {
      // Cerrar la hoja de compartir no es un error.
      if (err instanceof Error && err.name === 'AbortError') return;
      fail(
        item.id,
        'No se pudo abrir Compartir. Mantén el dedo sobre la imagen, elige "Guardar en Fotos" y súbela desde Instagram.'
      );
    });
  }

  function markPublished(item: StoryItem) {
    setBusy(item.id);
    clear(item.id);
    startTransition(async () => {
      try {
        const result = await markStoryPublished(item.id);
        if (!result.ok) fail(item.id, result.error);
        else setPublished((p) => ({ ...p, [item.id]: result.postId }));
      } catch {
        fail(item.id, 'No se pudo guardar. Revisa tu conexión.');
      } finally {
        setBusy(null);
      }
    });
  }

  function undo(item: StoryItem) {
    const postId = published[item.id];
    if (!postId) return;
    setBusy(item.id);
    clear(item.id);
    startTransition(async () => {
      try {
        const result = await undoStoryPublished(postId);
        if (!result.ok) fail(item.id, result.error);
        else setPublished(({ [item.id]: _gone, ...rest }) => rest);
      } catch {
        fail(item.id, 'No se pudo deshacer. Revisa tu conexión.');
      } finally {
        setBusy(null);
      }
    });
  }

  function card(item: StoryItem) {
    const state = status[item.id] ?? 'cargando';
    const done = item.id in published;
    return (
      <li key={item.id} className="flex gap-4 rounded-xl border border-border bg-surface p-3 sm:p-4">
        <div
          className={`relative aspect-[9/16] w-28 shrink-0 self-start overflow-hidden rounded-md bg-bg sm:w-36 ${done ? 'opacity-60' : ''}`}
        >
          {state === 'lista' ? (
            // eslint-disable-next-line @next/next/no-img-element -- JPG ya descargado: sale del caché del navegador.
            <img src={item.image} alt={`Historia de ${item.name}`} className="h-full w-full object-cover" />
          ) : state === 'error' ? (
            <p className="flex h-full items-center justify-center p-2 text-center text-xs text-muted">
              No se pudo generar la imagen. Toca Actualizar.
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
            {item.again && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-accent">
                <TrendingDown size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  Ya la subiste el {formatDayMonth(item.again.at)} a {formatPrice(item.again.price)}. Bajó{' '}
                  {formatPrice(item.again.price - item.price)}.
                </span>
              </p>
            )}
          </div>

          {done ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-accent">
                <Check size={15} aria-hidden /> Publicada
              </p>
              <button onClick={() => undo(item)} disabled={busy !== null} className={BUTTON}>
                <Undo2 size={15} aria-hidden /> {busy === item.id ? 'Deshaciendo…' : 'Deshacer'}
              </button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {canShare && (
                <button
                  onClick={() => share(item)}
                  disabled={state !== 'lista'}
                  className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50 sm:col-span-2"
                >
                  <Share2 size={15} aria-hidden />{' '}
                  {state === 'lista' ? 'Compartir' : state === 'error' ? 'Sin imagen' : 'Preparando…'}
                </button>
              )}
              <button onClick={() => void copyLink(item)} className={BUTTON}>
                {copied === item.id ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
                {copied === item.id ? 'Link copiado' : 'Copiar link'}
              </button>
              {state === 'lista' ? (
                <a href={item.image} download={item.fileName} className={BUTTON}>
                  <Download size={15} aria-hidden /> Guardar imagen
                </a>
              ) : (
                <button disabled className={BUTTON}>
                  <Download size={15} aria-hidden /> Guardar imagen
                </button>
              )}
              <button onClick={() => markPublished(item)} disabled={busy !== null} className={`${BUTTON} sm:col-span-2`}>
                {busy === item.id ? 'Guardando…' : 'Ya la publiqué'}
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
  }

  const again = items.filter((item) => item.again);
  const fresh = items.filter((item) => !item.again);
  const someReady = Object.values(status).includes('lista');

  return (
    <div className="mt-6 flex flex-col gap-6">
      {someReady && !canShare && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          El botón <strong className="text-fg">Compartir</strong> aparece al abrir esta página en el teléfono. Acá en el
          computador puedes guardar la imagen y copiar el link.
        </p>
      )}

      {again.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Bajaron desde que las subiste</h2>
          <ul className="mt-3 flex flex-col gap-4">{again.map(card)}</ul>
        </section>
      )}

      {fresh.length > 0 && (
        <section>
          {again.length > 0 && <h2 className="font-heading text-lg font-semibold text-fg">Ofertas de ahora</h2>}
          <ul className={`flex flex-col gap-4 ${again.length > 0 ? 'mt-3' : ''}`}>{fresh.map(card)}</ul>
        </section>
      )}
    </div>
  );
}
