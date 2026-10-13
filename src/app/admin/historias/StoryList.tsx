'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { AlertTriangle, Check, Copy, Download, Loader2, Share2, TrendingDown, Undo2 } from 'lucide-react';
import { formatPrice } from '@/lib/content/captions';
import { formatDayMonth } from '@/lib/format';
import type { PostedStory, StoryItem } from '@/lib/social/stories';
import { markStoryPublished, undoStoryPublished } from './actions';

/**
 * Las historias del día, pensadas para el teléfono: compartir la imagen
 * directo a Instagram con el link ya copiado, marcar lo publicado, y tener
 * a mano lo que ya se subió para llevarlo a otras redes.
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

const timeFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function StoryList({
  items: initial,
  posted: initialPosted,
  maxPriceAgeMs,
  renderedAt,
}: {
  items: StoryItem[];
  /** Historias ya marcadas que siguen vigentes en Instagram, para subirlas a otras redes. */
  posted: PostedStory[];
  maxPriceAgeMs: number;
  /** Cuándo armó la lista el servidor: identifica esta carga de la página. */
  renderedAt: number;
}) {
  // Copias locales: las listas no cambian solas mientras se trabaja con ellas.
  // Para traer ofertas y precios nuevos está "Actualizar", que recarga la página.
  const [items] = useState(initial);
  const [posted, setPosted] = useState(initialPosted);
  // La edad de la lista se mide con el reloj de este teléfono, no contra la hora del servidor.
  const [openedAt] = useState(() => {
    const seen = firstSeen.get(renderedAt) ?? Date.now();
    firstSeen.set(renderedAt, seen);
    return seen;
  });
  /** Archivos y estado por dirección de la pieza: una oferta y su copia ya publicada comparten imagen. */
  const files = useRef(new Map<string, File>());
  const lastShare = useRef(0);
  const lastMark = useRef(0);
  const [status, setStatus] = useState<Record<string, Status>>({});
  /** null hasta saber si este aparato puede compartir archivos. */
  const [canShare, setCanShare] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Ofertas marcadas en esta visita: id del producto → id de la marca, para poder deshacerla. */
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
      // Primero las ofertas, que son lo que se viene a subir; después lo ya publicado.
      for (const item of [...items, ...initialPosted]) {
        if (store.has(item.image)) continue;
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
          setStatus((s) => ({ ...s, [item.image]: 'error' }));
          continue;
        }
        store.set(item.image, file);
        setStatus((s) => ({ ...s, [item.image]: 'lista' }));
      }
    })();

    return () => {
      cancelled = true;
      store.clear();
    };
  }, [items, initialPosted]);

  const fail = (key: string, message: string) => setErrors((e) => ({ ...e, [key]: message }));
  const clear = (key: string) => setErrors(({ [key]: _gone, ...rest }) => rest);

  /** Una pestaña que quedó abierta lleva los precios de cuando se cargó. */
  function tooOld(key: string, item: StoryItem): boolean {
    const oldPrice = item.checkedAt ? Date.now() - new Date(item.checkedAt).getTime() > maxPriceAgeMs : false;
    const oldList = Date.now() - openedAt > MAX_LIST_AGE_MS;
    if (!oldPrice && !oldList) return false;
    fail(key, 'Esta lista ya tiene más de una hora y el precio puede haber cambiado. Toca Actualizar, arriba.');
    return true;
  }

  async function copyLink(key: string, item: StoryItem) {
    try {
      await navigator.clipboard.writeText(item.link);
      setCopied(key);
      // Solo se borra el aviso de la copia: otro aviso (precio antiguo, Compartir) sigue a la vista.
      setErrors((e) => {
        if (e[key] !== COPY_ERROR) return e;
        const { [key]: _gone, ...rest } = e;
        return rest;
      });
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2500);
    } catch {
      fail(key, COPY_ERROR);
    }
  }

  function share(key: string, item: StoryItem) {
    const file = files.current.get(item.image);
    if (!file || tooOld(key, item)) return;
    // Un doble toque no vuelve a pedir Compartir: el navegador rechaza el segundo y quedaría un error falso.
    if (Date.now() - lastShare.current < 1500) return;
    lastShare.current = Date.now();
    // Las dos cosas dentro del mismo toque: el link se pega después en el sticker (o en el texto, en WhatsApp).
    void copyLink(key, item);
    navigator.share({ files: [file] }).catch((err: unknown) => {
      // Cerrar la hoja de compartir no es un error.
      if (err instanceof Error && err.name === 'AbortError') return;
      fail(
        key,
        'No se pudo abrir Compartir. Mantén el dedo sobre la imagen, elige "Guardar en Fotos" y súbela desde la app.'
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

  /** Deshace una marca. `after` corre solo si se deshizo. */
  function undo(key: string, postId: number, after: () => void) {
    setBusy(key);
    clear(key);
    startTransition(async () => {
      try {
        const result = await undoStoryPublished(postId);
        if (!result.ok) {
          fail(key, result.error);
          return;
        }
        after();
      } catch {
        fail(key, `No se pudo deshacer. ${RELOAD_HINT}`);
      } finally {
        setBusy(null);
      }
    });
  }

  function undoOffer(item: StoryItem) {
    const postId = published[item.id];
    // "Deshacer" queda donde estaba "Ya la publiqué": un segundo toque seguido no debe deshacer.
    if (!postId || Date.now() - lastMark.current < 1000) return;
    undo(item.id, postId, () => {
      marks.delete(item.image);
      setPublished(({ [item.id]: _gone, ...rest }) => rest);
    });
  }

  /** Miniatura, nombre y precio: lo que comparten una oferta y una historia ya publicada. */
  function summary(item: StoryItem, dimmed: boolean) {
    const state = status[item.image] ?? 'cargando';
    return {
      state,
      thumb: (
        <div
          className={`relative aspect-[9/16] w-28 shrink-0 self-start overflow-hidden rounded-md bg-bg sm:w-36 ${dimmed ? 'opacity-60' : ''}`}
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
      ),
      heading: (
        <>
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
        </>
      ),
    };
  }

  /** Compartir, copiar el link y guardar la imagen: iguales en las dos listas. */
  function shareButtons(key: string, item: StoryItem, state: Status) {
    return (
      <>
        {canShare && (
          <button
            onClick={() => share(key, item)}
            disabled={state !== 'lista'}
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50 sm:col-span-2"
          >
            <Share2 size={15} aria-hidden />{' '}
            {state === 'lista' ? 'Compartir' : state === 'error' ? 'Sin imagen' : 'Preparando…'}
          </button>
        )}
        <button onClick={() => void copyLink(key, item)} className={BUTTON}>
          {copied === key ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied === key ? 'Link copiado' : 'Copiar link'}
        </button>
        {state === 'lista' ? (
          <a
            href={item.image}
            download={item.fileName}
            onClick={(e) => {
              if (tooOld(key, item)) e.preventDefault();
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
      </>
    );
  }

  function footer(key: string, item: StoryItem) {
    return (
      <>
        {/* Completo y seleccionable: es el respaldo si el teléfono no deja copiar con el botón. */}
        <p className="select-all break-all text-[11px] text-muted" aria-label="Link de afiliado">
          {item.link}
        </p>
        <p role="status" aria-live="polite" className="text-xs text-red-400">
          {errors[key] ?? ''}
        </p>
      </>
    );
  }

  function offerCard(item: StoryItem) {
    const done = item.id in published;
    const { state, thumb, heading } = summary(item, done);
    return (
      <li key={item.id} className="flex gap-4 rounded-xl border border-border bg-surface p-3 sm:p-4">
        {thumb}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            {heading}
            {/* Por qué se propone y qué mirar antes de subirla. No cambian al marcar: la tarjeta conserva su alto. */}
            {item.reason && <p className="mt-1 text-xs leading-snug text-muted">{item.reason}.</p>}
            {item.warning && (
              <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-400">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>Ojo: {item.warning}.</span>
              </p>
            )}
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
            {shareButtons(item.id, item, state)}
            {done ? (
              <button
                onClick={() => undoOffer(item)}
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
          {footer(item.id, item)}
        </div>
      </li>
    );
  }

  function postedCard(item: PostedStory) {
    const key = `publicada-${item.postId}`;
    const { state, thumb, heading } = summary(item, false);
    return (
      <li key={key} className="flex gap-4 rounded-xl border border-border bg-surface p-3 sm:p-4">
        {thumb}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div>
            {heading}
            <p className="mt-1 text-xs text-muted">
              Subida el {formatDayMonth(item.postedAt)} a las {timeFmt.format(new Date(item.postedAt))}
              {item.postedPrice !== null && item.postedPrice !== Math.round(item.price)
                ? `, a ${formatPrice(item.postedPrice)}. El precio cambió: la imagen lleva el de ahora.`
                : '.'}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {shareButtons(key, item, state)}
            <button
              onClick={() => undo(key, item.postId, () => setPosted((list) => list.filter((p) => p.postId !== item.postId)))}
              disabled={busy !== null}
              className={`${BUTTON} sm:col-span-2`}
            >
              <Undo2 size={15} aria-hidden /> {busy === key ? 'Deshaciendo…' : 'No la publiqué: deshacer'}
            </button>
          </div>
          {footer(key, item)}
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
          <ul className="mt-3 flex flex-col gap-4">{again.map(offerCard)}</ul>
        </section>
      )}

      {fresh.length > 0 && (
        <section>
          {(again.length > 0 || posted.length > 0) && (
            <h2 className="font-heading text-lg font-semibold text-fg">Ofertas de ahora</h2>
          )}
          <ul className={`flex flex-col gap-4 ${again.length > 0 || posted.length > 0 ? 'mt-3' : ''}`}>
            {fresh.map(offerCard)}
          </ul>
        </section>
      )}

      {posted.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Ya publicadas (últimas 24 horas)</h2>
          <p className="mt-1 text-sm text-muted">
            Para llevarlas a otra red: comparte la misma imagen y pega el link. En WhatsApp el link se puede tocar si
            va en el texto.
          </p>
          <ul className="mt-3 flex flex-col gap-4">{posted.map(postedCard)}</ul>
        </section>
      )}
    </div>
  );
}
