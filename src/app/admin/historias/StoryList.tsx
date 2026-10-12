'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, Download, Loader2, Share2, TrendingDown } from 'lucide-react';
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

/**
 * Lo marcado en esta sesión (dirección de la pieza → id de la marca) y la
 * hora en que cada lista se vio por primera vez (hora del servidor en que
 * se armó → hora de este teléfono).
 *
 * Fuera del componente a propósito: al ir a otra pestaña del admin y volver
 * con "atrás", Next muestra la misma lista sin pedirla de nuevo y monta el
 * componente desde cero. Sin esto, lo ya marcado volvería como pendiente
 * (sin "Deshacer") y una lista vieja parecería recién cargada.
 */
const marks = new Map<string, number>();
const firstSeen = new Map<number, number>();

/** Pasado este rato hay que recargar: los precios se revisan cada media hora. */
const MAX_LIST_AGE_MS = 60 * 60_000;

const COPY_ERROR = 'El teléfono no dejó copiar el link. Mantén el dedo sobre el link de abajo y elige Copiar.';
const RELOAD_HINT = 'Revisa tu conexión; si sigue igual, toca Actualizar, arriba.';

const BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

export function StoryList({
  items: initial,
  maxPriceAgeMs,
  renderedAt,
}: {
  items: StoryItem[];
  maxPriceAgeMs: number;
  /** Cuándo armó la lista el servidor: identifica esta carga de la página. */
  renderedAt: number;
}) {
  // Copia local: la lista no cambia sola mientras se trabaja con ella. Para
  // traer ofertas y precios nuevos está "Actualizar", que recarga la página.
  const [items] = useState(initial);
  // La edad de la lista se mide con el reloj de este teléfono, no contra la hora del servidor.
  const [openedAt] = useState(() => {
    const seen = firstSeen.get(renderedAt) ?? Date.now();
    firstSeen.set(renderedAt, seen);
    return seen;
  });
  const files = useRef(new Map<string, File>());
  const lastShare = useRef(0);
  const lastMark = useRef(0);
  const [status, setStatus] = useState<Record<string, Status>>({});
  /** null hasta saber si este aparato puede compartir archivos. */
  const [canShare, setCanShare] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Historias marcadas: id del producto → id de la marca, para poder deshacerla. */
  const [published, setPublished] = useState<Record<string, number>>(() => {
    const known: Record<string, number> = {};
    for (const item of initial) {
      const postId = marks.get(item.image);
      if (postId) known[item.id] = postId;
    }
    return known;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  useEffect(() => {
    // Solo con pantalla táctil: el computador también "comparte" archivos,
    // pero su panel no llega a Instagram.
    const probe = new File([''], 'historia.jpg', { type: 'image/jpeg' });
    setCanShare(
      typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [probe] }) &&
        window.matchMedia('(pointer: coarse)').matches
    );
  }, []);

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
      }
    })();

    return () => {
      cancelled = true;
      store.clear();
    };
  }, [items]);

  const fail = (id: string, message: string) => setErrors((e) => ({ ...e, [id]: message }));
  const clear = (id: string) => setErrors(({ [id]: _gone, ...rest }) => rest);

  /** Una pestaña que quedó abierta lleva los precios de cuando se cargó. */
  function tooOld(item: StoryItem): boolean {
    const oldPrice = item.checkedAt ? Date.now() - new Date(item.checkedAt).getTime() > maxPriceAgeMs : false;
    const oldList = Date.now() - openedAt > MAX_LIST_AGE_MS;
    if (!oldPrice && !oldList) return false;
    fail(item.id, 'Esta lista ya tiene más de una hora y el precio puede haber cambiado. Toca Actualizar, arriba.');
    return true;
  }

  async function copyLink(item: StoryItem) {
    try {
      await navigator.clipboard.writeText(item.link);
      setCopied(item.id);
      // Solo se borra el aviso de la copia: otro aviso (precio antiguo, Compartir) sigue a la vista.
      setErrors((e) => {
        if (e[item.id] !== COPY_ERROR) return e;
        const { [item.id]: _gone, ...rest } = e;
        return rest;
      });
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 2500);
    } catch {
      fail(item.id, COPY_ERROR);
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
        // Con el precio de la tarjeta, que es el que lleva la imagen compartida.
        const result = await markStoryPublished(item.id, item.price);
        if (!result.ok) {
          fail(item.id, result.error);
          return;
        }
        marks.set(item.image, result.postId);
        lastMark.current = Date.now();
        setPublished((p) => ({ ...p, [item.id]: result.postId }));
      } catch {
        fail(item.id, `No se pudo guardar. ${RELOAD_HINT}`);
      } finally {
        setBusy(null);
      }
    });
  }

  function undo(item: StoryItem) {
    const postId = published[item.id];
    // "Deshacer" queda donde estaba "Ya la publiqué": un segundo toque seguido no debe deshacer.
    if (!postId || Date.now() - lastMark.current < 1000) return;
    setBusy(item.id);
    clear(item.id);
    startTransition(async () => {
      try {
        const result = await undoStoryPublished(postId);
        if (!result.ok) {
          fail(item.id, result.error);
          return;
        }
        marks.delete(item.image);
        setPublished(({ [item.id]: _gone, ...rest }) => rest);
      } catch {
        fail(item.id, `No se pudo deshacer. ${RELOAD_HINT}`);
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

          {/* La misma grilla antes y después de marcar: si la tarjeta cambiara de alto, las de abajo se correrían bajo el dedo. */}
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
              <a
                href={item.image}
                download={item.fileName}
                onClick={(e) => {
                  if (tooOld(item)) e.preventDefault();
                }}
                className={BUTTON}
              >
                <Download size={15} aria-hidden /> Guardar imagen
              </a>
            ) : (
              <button disabled className={BUTTON}>
                <Download size={15} aria-hidden /> Guardar imagen
              </button>
            )}
            {done ? (
              <button
                onClick={() => undo(item)}
                disabled={busy !== null}
                className={`${BUTTON} border-accent/50 text-accent sm:col-span-2`}
              >
                <Check size={15} aria-hidden /> {busy === item.id ? 'Deshaciendo…' : 'Publicada · Deshacer'}
              </button>
            ) : (
              <button onClick={() => markPublished(item)} disabled={busy !== null} className={`${BUTTON} sm:col-span-2`}>
                {busy === item.id ? 'Guardando…' : 'Ya la publiqué'}
              </button>
            )}
          </div>

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

  return (
    <div className="mt-6 flex flex-col gap-6">
      {canShare === false && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          El botón <strong className="text-fg">Compartir</strong> aparece en el teléfono, con Safari o Chrome. Si no lo
          ves, guarda la imagen y copia el link.
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
