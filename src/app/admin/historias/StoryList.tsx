'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Share2,
  TrendingDown,
  Undo2,
} from 'lucide-react';
import { formatPrice } from '@/lib/content/captions';
import { formatDayMonth } from '@/lib/format';
import { LIVE_TEXT } from '@/lib/social/live-price';
import type { PostedStory, StoryItem } from '@/lib/social/stories';
import { explainWarning } from '@/lib/social/warning-help';
import { checkLivePrices } from '@/app/admin/live-price-actions';
import { WarningGuide } from '../WarningGuide';
import { markStoryPublished, undoStoryPublished } from './actions';
import { createStoryGestures, type Note, type StoryEnv, type StoryGestures } from './gestures';
import { createLiveChecker } from './live-checks';
import {
  checkTargets,
  coverText,
  groupOffers,
  liveLine,
  minutesAgo,
  postedAlert,
  safeMlUrl,
  shareGate,
  type CardCheck,
} from './rules';

/**
 * Las historias del día, pensadas para el teléfono: compartir la imagen
 * directo a Instagram con el link ya copiado, marcar lo publicado, y tener
 * a mano lo que ya se subió para llevarlo a otras redes.
 *
 * Cada tarjeta se revisa en vivo en Mercado Libre al cargar la lista y al
 * volver a la pestaña (./live-checks): Compartir y Guardar imagen se dejan
 * solo si lo que muestra la tarjeta sigue siendo lo que muestra Mercado Libre
 * (./rules). La revisión se hace antes y no al tocar: el teléfono solo abre
 * la hoja de compartir si la llamada ocurre dentro del toque.
 *
 * Las imágenes se bajan de a una y se guardan en memoria. De a una, porque
 * cada pieza la dibuja el servidor en el momento; en memoria, porque el
 * teléfono solo deja compartir un archivo si ya está listo cuando se toca
 * el botón.
 *
 * La miniatura y "Guardar imagen" usan la dirección de la pieza y no una
 * dirección blob: del archivo en memoria: la política de seguridad del sitio
 * publicado (next.config.js) no deja mostrar imágenes blob:. Como la pieza
 * ya se bajó, el navegador la saca de su caché y no se dibuja dos veces.
 */

export type FileState = 'cargando' | 'lista' | 'error';

/**
 * Lo marcado en esta sesión (dirección de la pieza → id de la marca) y la
 * hora en que cada lista se vio por primera vez (hora del servidor en que
 * se armó → hora de este teléfono).
 *
 * Fuera del componente a propósito: al ir a otra pestaña del admin y volver
 * con "atrás", Next muestra la misma lista sin pedirla de nuevo y monta el
 * componente desde cero. Sin esto, lo ya marcado volvería como pendiente
 * (sin "Deshacer") y una lista vieja parecería recién cargada. En el
 * servidor no se guarda nada: ahí este módulo lo comparten todas las visitas.
 */
const marks = new Map<string, number>();
const firstSeen = new Map<number, number>();

/** Lo que dura una historia en Instagram, si la página no dice otra cosa. */
const DEFAULT_LIFETIME_MS = 24 * 3600_000;
/** Cada cuánto se redibuja "hace N min" y se vuelve a mirar la edad de cada revisión. */
const TICK_MS = 30_000;

const BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

const timeFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** El navegador de verdad. Nada se lee de él hasta que hay un toque: este módulo también se carga en el servidor. */
const BROWSER: StoryEnv = {
  // Directo, sin esperar nada antes: el teléfono abre la hoja de compartir solo dentro del toque.
  share: (data) => navigator.share(data),
  writeText: (text) => navigator.clipboard.writeText(text),
  now: () => Date.now(),
  later: (run, ms) => {
    setTimeout(run, ms);
  },
};

const LINE_CLASS: Record<ReturnType<typeof liveLine>['tone'], string> = {
  checking: 'text-muted',
  same: 'text-accent',
  bad: 'font-semibold text-red-400',
  unknown: 'font-medium text-amber-400',
};

/** Quita una entrada de un estado por llave, sin crear otro objeto si no estaba. Puro. */
function without<T>(all: Record<string, T>, key: string): Record<string, T> {
  if (!(key in all)) return all;
  const rest = { ...all };
  delete rest[key];
  return rest;
}

export interface StoryCardProps {
  item: StoryItem | PostedStory;
  /** Una oferta para subir o una historia ya subida (para llevarla a otras redes). */
  kind: 'offer' | 'posted';
  /** La llave de los avisos y del botón de copiar de esta tarjeta. */
  cardKey: string;
  fileState: FileState | undefined;
  check: CardCheck | undefined;
  /** La hora con que se dibuja: "hace N min" y la edad de la revisión. */
  now: number;
  /** Cuándo se vio esta lista por primera vez en este teléfono. */
  openedAt: number;
  maxPriceAgeMs: number;
  /** null hasta saber si este aparato puede compartir archivos. */
  canShare: boolean | null;
  copied: string | null;
  /** La tarjeta cuya marca está viajando al servidor, de cualquier tarjeta. */
  busy: string | null;
  note: Note | undefined;
  /** La oferta se marcó como publicada en esta visita: el id de su marca. */
  publishedId?: number;
  gestures: StoryGestures;
}

/**
 * Una tarjeta. Sin estado propio: dibuja lo que recibe y cada botón llama a
 * su regla. Así un test puede armarla en cualquier estado de la revisión.
 */
export function StoryCard({
  item,
  kind,
  cardKey,
  fileState,
  check,
  now,
  openedAt,
  maxPriceAgeMs,
  canShare,
  copied,
  busy,
  note,
  publishedId,
  gestures,
}: StoryCardProps) {
  const posted = kind === 'posted' ? (item as PostedStory) : null;
  // Ya subida y sin venta: la historia sigue en Instagram, pero no hay imagen que dar ni nada que revisar.
  const gone = posted?.onSale === false;
  const state: FileState = gone ? 'error' : (fileState ?? 'cargando');
  const done = kind === 'offer' && publishedId !== undefined;
  const mlUrl = safeMlUrl(item.mlUrl);
  const line = liveLine(check, now, mlUrl !== null);
  const gate = shareGate(check, { now, openedAt, checkedAt: item.checkedAt, maxPriceAgeMs });
  const cover = coverText(gate);
  const alert = posted ? postedAlert(posted, check) : null;
  const help = kind === 'offer' && item.warning ? explainWarning(item.warning) : [];

  return (
    <li className="flex gap-4 rounded-xl border border-border bg-surface p-3 sm:p-4">
      <div
        className={`relative aspect-[9/16] w-28 shrink-0 self-start overflow-hidden rounded-md bg-bg sm:w-36 ${done && !cover ? 'opacity-60' : ''}`}
      >
        {state === 'lista' ? (
          // eslint-disable-next-line @next/next/no-img-element -- JPG ya descargado: sale del caché del navegador.
          <img
            src={item.image}
            alt={`Historia de ${item.name}`}
            className={`h-full w-full object-cover ${cover ? 'pointer-events-none select-none opacity-30' : ''}`}
            draggable={cover ? false : undefined}
          />
        ) : state === 'error' ? (
          <p className="flex h-full items-center justify-center p-2 text-center text-xs text-muted">
            {gone ? 'Ya no está a la venta.' : 'No se pudo generar la imagen. Toca Actualizar.'}
          </p>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-muted" aria-label="Preparando la imagen" />
          </div>
        )}
        {/* Encima de la imagen: mantener el dedo toca el aviso y no ofrece guardar la imagen. */}
        {cover && state === 'lista' && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/70 p-2 text-center text-xs font-semibold text-red-400">
            {cover}
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
                sin descuento <s>{formatPrice(item.listPrice)}</s> · -{item.discount}%
              </span>
            )}
            {item.listPrice === null && item.drop !== null && (
              <span className="ml-2 text-xs text-muted">bajó {item.drop}% según el historial</span>
            )}
          </p>

          {/* La revisión en vivo, junto al precio que revisa. Lo que ya no se vende no se revisa: el aviso rojo lo dice. */}
          {!gone && (
            <p className={`mt-1 flex items-start gap-1.5 text-xs leading-snug ${LINE_CLASS[line.tone]}`}>
              {line.tone === 'checking' && <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" aria-hidden />}
              <span>{line.text}</span>
            </p>
          )}
          {!gone && line.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted">{line.detail}</p>}
          {/* Un enlace común a la ficha, sin el link de afiliado: mirar no cuenta como clic ni como visita. */}
          {mlUrl && (
            <a href={mlUrl} target="_blank" rel="noopener noreferrer" className={`${BUTTON} mt-2 w-full sm:w-auto sm:inline-flex`}>
              <ExternalLink size={15} className="shrink-0" aria-hidden /> Ver en Mercado Libre
            </a>
          )}

          {kind === 'offer' && (
            <>
              {/* Por qué se propone y qué mirar antes de subirla. No cambian al marcar: la tarjeta conserva su alto. */}
              {item.reason && <p className="mt-2 text-xs leading-snug text-muted">{item.reason}.</p>}
              {item.warning && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-400">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span>Ojo: {item.warning}.</span>
                </p>
              )}
              {help.length > 0 && (
                <ul className="mt-1 space-y-1 pl-5 text-[11px] leading-snug text-muted">
                  {help.map((h, i) => (
                    <li key={i}>
                      {h.meaning} <span className="text-fg">{h.whatToDo}</span>
                    </li>
                  ))}
                </ul>
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
            </>
          )}

          {posted && (
            <>
              <p className="mt-2 text-xs text-muted">
                Subida a Instagram el {formatDayMonth(posted.postedAt)} a las {timeFmt.format(new Date(posted.postedAt))}
                {posted.postedPrice !== null && posted.postedPrice > 0 ? `, a ${formatPrice(posted.postedPrice)}.` : '.'}
              </p>
              {alert && (
                <p
                  className={
                    alert.tone === 'bad'
                      ? 'mt-2 flex items-start gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs font-semibold text-red-400'
                      : 'mt-2 flex items-start gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1.5 text-xs font-medium text-accent'
                  }
                >
                  {alert.tone === 'bad' ? (
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                  ) : (
                    <TrendingDown size={14} className="mt-0.5 shrink-0" aria-hidden />
                  )}
                  <span>{alert.text}</span>
                </p>
              )}
            </>
          )}
        </div>

        {/* La misma grilla antes y después de marcar: si la tarjeta cambiara de alto, las de abajo se correrían bajo el dedo. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {canShare && !gone && (
            <button
              type="button"
              onClick={() => gestures.share(cardKey, item)}
              disabled={state !== 'lista'}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50 sm:col-span-2"
            >
              <Share2 size={15} aria-hidden />{' '}
              {state === 'lista' ? 'Compartir' : state === 'error' ? 'Sin imagen' : 'Preparando…'}
            </button>
          )}
          {!gone && (
            <button type="button" onClick={() => void gestures.copyLink(cardKey, item)} className={BUTTON}>
              {copied === cardKey ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
              {copied === cardKey ? 'Link copiado' : 'Copiar link'}
            </button>
          )}
          {/*
            Un enlace de descarga solo cuando se puede subir: si no, un botón
            que dice por qué. Un enlace bloqueado igual ofrece "Descargar
            vínculo" al mantener el dedo encima.
          */}
          {gone ? null : state === 'lista' && gate.ok ? (
            <a
              href={item.image}
              download={item.fileName}
              onClick={(e) => {
                if (!gestures.save(cardKey, item)) e.preventDefault();
              }}
              className={BUTTON}
            >
              <Download size={15} aria-hidden /> Guardar imagen
            </a>
          ) : (
            <button
              type="button"
              onClick={() => gestures.save(cardKey, item)}
              disabled={state !== 'lista'}
              className={BUTTON}
            >
              <Download size={15} aria-hidden /> Guardar imagen
            </button>
          )}
          {kind === 'offer' ? (
            done ? (
              <button
                type="button"
                onClick={() => gestures.undoOffer(item, publishedId as number)}
                disabled={busy !== null}
                className={`${BUTTON} border-accent/50 text-accent sm:col-span-2`}
              >
                <Check size={15} aria-hidden /> {busy === cardKey ? 'Deshaciendo…' : 'Publicada · Deshacer'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => gestures.mark(item)}
                disabled={busy !== null}
                className={`${BUTTON} sm:col-span-2`}
              >
                {busy === cardKey ? 'Guardando…' : 'Ya la publiqué'}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => gestures.undoPosted(cardKey, (item as PostedStory).postId)}
              disabled={busy !== null}
              className={`${BUTTON} sm:col-span-2`}
            >
              <Undo2 size={15} aria-hidden /> {busy === cardKey ? 'Deshaciendo…' : 'No la publiqué: deshacer'}
            </button>
          )}
        </div>

        {/* Completo y seleccionable: es el respaldo si el teléfono no deja copiar con el botón. */}
        {!gone && (
          <p className="select-all break-all text-[11px] text-muted" aria-label="Link de afiliado">
            {item.link}
          </p>
        )}
        <p
          role="status"
          aria-live="polite"
          className={`text-xs ${note?.tone === 'warn' ? 'font-medium text-amber-400' : 'text-red-400'}`}
        >
          {note?.text ?? ''}
        </p>
      </div>
    </li>
  );
}

/**
 * La línea de arriba: cuándo se revisó en Mercado Libre y cómo repetirlo.
 * "Revisé" solo si alguna revisión llegó de verdad: una que no pudo revisar
 * no cuenta. Pura.
 */
export function checkSummary(checks: Record<string, CardCheck>, now: number): { running: boolean; text: string } {
  const all = Object.keys(checks).map((id) => checks[id]);
  if (all.length === 0 || all.some((c) => c.pending)) {
    return { running: true, text: 'Revisando los precios en Mercado Libre…' };
  }
  const answered = all.map((c) => c.last).filter((last): last is NonNullable<CardCheck['last']> => last !== null);
  if (answered.length === 0) return { running: false, text: 'Todavía no reviso los precios en Mercado Libre.' };
  const real = answered.filter((last) => last.result.status !== 'unknown');
  if (real.length === 0) {
    const offline = answered.some((last) => last.result.status === 'unknown' && last.result.what === LIVE_TEXT.offline);
    return {
      running: false,
      text: offline
        ? 'Aquí no reviso en vivo: eso funciona solo en el sitio publicado. Mira cada precio con su botón antes de subir.'
        : 'No pude revisar los precios en Mercado Libre. Mira cada precio con su botón antes de subir.',
    };
  }
  const missing = answered.length - real.length;
  const rest =
    missing === 0
      ? ''
      : missing === 1
        ? ' Una no se pudo revisar: mira su precio con el botón.'
        : ` ${missing} no se pudieron revisar: mira su precio con el botón.`;
  return { running: false, text: `Revisé los precios en Mercado Libre ${minutesAgo(now - Math.max(...real.map((last) => last.at)))}.${rest}` };
}

export function StoryList({
  items: initial,
  posted: initialPosted,
  maxPriceAgeMs,
  renderedAt,
  lifetimeMs = DEFAULT_LIFETIME_MS,
}: {
  items: StoryItem[];
  /** Historias ya marcadas que siguen vigentes en Instagram, para subirlas a otras redes. */
  posted: PostedStory[];
  maxPriceAgeMs: number;
  /** Cuándo armó la lista el servidor: identifica esta carga de la página. */
  renderedAt: number;
  /** Lo que dura una historia en Instagram: después ya no se revisa. */
  lifetimeMs?: number;
}) {
  // Copias locales: las listas no cambian solas mientras se trabaja con ellas.
  // Para traer ofertas y precios nuevos está "Actualizar", que recarga la página.
  const [items] = useState(initial);
  const [posted, setPosted] = useState(initialPosted);
  // La edad de la lista se mide con el reloj de este teléfono, no contra la hora del servidor.
  const [openedAt] = useState(() => {
    const seen = firstSeen.get(renderedAt) ?? Date.now();
    if (typeof window !== 'undefined') firstSeen.set(renderedAt, seen);
    return seen;
  });
  /** Archivos por dirección de la pieza: una oferta y su copia ya publicada comparten imagen. */
  const files = useRef(new Map<string, File>());
  const [fileState, setFileState] = useState<Record<string, FileState>>({});
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
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [checks, setChecks] = useState<Record<string, CardCheck>>({});
  // Con la hora del servidor en el primer dibujo: el del servidor y el del teléfono salen iguales.
  const [now, setNow] = useState(renderedAt);
  const [, startTransition] = useTransition();

  const [checker] = useState(() =>
    createLiveChecker({
      check: (batch) => checkLivePrices(batch),
      now: () => Date.now(),
      later: (run, ms) => {
        setTimeout(run, ms);
      },
      publish: (next) => {
        setChecks(next);
        setNow(Date.now());
      },
    })
  );
  // Las ya subidas de ahora, no las de la carga: una que se deshizo no se sigue revisando.
  const postedNow = useRef(initialPosted);
  useEffect(() => {
    postedNow.current = posted;
  }, [posted]);
  const targets = () => checkTargets(initial, postedNow.current, Date.now(), lifetimeMs);

  // Las reglas se arman una vez por lista: guardan los candados de doble toque.
  const [gestures] = useState(() =>
    createStoryGestures(
      BROWSER,
      { mark: markStoryPublished, undo: undoStoryPublished },
      {
        note: (key, note) => setNotes((n) => (note ? { ...n, [key]: note } : without(n, key))),
        copied: (key, on) => setCopied((c) => (on ? key : c === key ? null : c)),
        busy: (key) => setBusy(key),
        published: (item, postId) => {
          if (postId) marks.set(item.image, postId);
          else marks.delete(item.image);
          setPublished((p) => (postId ? { ...p, [item.id]: postId } : without(p, item.id)));
        },
        unposted: (postId) => setPosted((list) => list.filter((p) => p.postId !== postId)),
        run: (job) => startTransition(job),
      },
      {
        openedAt,
        maxPriceAgeMs,
        checkOf: (productId) => checker.get(productId),
        recheck: () => void checker.run(targets()),
        fileOf: (image) => files.current.get(image),
      }
    )
  );

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
    // Al cargar, y al volver a la pestaña si la última revisión tiene más de 5 minutos.
    void checker.run(targets());
    const onVisible = () => {
      if (document.visibilityState === 'visible') checker.visible(targets());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // targets() lee listas que no cambian mientras la página está abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checker]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      // Con la pestaña a la vista, se revisa sola antes de que venza el "mismo precio".
      if (document.visibilityState === 'visible') checker.tick(targets());
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checker]);

  useEffect(() => {
    let cancelled = false;
    const store = files.current;

    (async () => {
      // Primero las ofertas, que son lo que se viene a subir; después lo ya publicado
      // que sigue a la venta (de lo demás la pieza no se dibuja).
      for (const item of [...items, ...initialPosted.filter((story) => story.onSale !== false)]) {
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
          setFileState((s) => ({ ...s, [item.image]: 'error' }));
          continue;
        }
        store.set(item.image, file);
        setFileState((s) => ({ ...s, [item.image]: 'lista' }));
      }
    })();

    return () => {
      cancelled = true;
      store.clear();
    };
  }, [items, initialPosted]);

  const card = (item: StoryItem | PostedStory, kind: 'offer' | 'posted') => {
    const key = kind === 'offer' ? item.id : `publicada-${(item as PostedStory).postId}`;
    return (
      <StoryCard
        key={key}
        item={item}
        kind={kind}
        cardKey={key}
        fileState={fileState[item.image]}
        check={checks[item.id]}
        now={now}
        openedAt={openedAt}
        maxPriceAgeMs={maxPriceAgeMs}
        canShare={canShare}
        copied={copied}
        busy={busy}
        note={notes[key]}
        publishedId={kind === 'offer' ? published[item.id] : undefined}
        gestures={gestures}
      />
    );
  };

  const { again, fresh, warned } = groupOffers(items);
  const summary = checkSummary(checks, now);

  return (
    <div className="mt-6 flex flex-col gap-6">
      {canShare === false && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          El botón <strong className="text-fg">Compartir</strong> aparece en el teléfono, con Safari o Chrome. Si no lo
          ves, guarda la imagen y copia el link.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm text-muted">
        <span className="flex items-center gap-2">
          {summary.running && <Loader2 size={14} className="shrink-0 animate-spin" aria-hidden />}
          {summary.text}
        </span>
        {!summary.running && (
          <button type="button" onClick={() => void checker.run(targets())} className={BUTTON}>
            <RefreshCw size={15} aria-hidden /> Revisar otra vez
          </button>
        )}
      </div>

      {again.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Bajaron desde que las subiste</h2>
          <ul className="mt-3 flex flex-col gap-4">{again.map((item) => card(item, 'offer'))}</ul>
        </section>
      )}

      {fresh.length > 0 && (
        <section>
          {(again.length > 0 || warned.length > 0 || posted.length > 0) && (
            <h2 className="font-heading text-lg font-semibold text-fg">Ofertas de ahora</h2>
          )}
          <ul className={`flex flex-col gap-4 ${again.length > 0 || warned.length > 0 || posted.length > 0 ? 'mt-3' : ''}`}>
            {fresh.map((item) => card(item, 'offer'))}
          </ul>
        </section>
      )}

      {warned.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Con algo que mirar</h2>
          <p className="mt-1 text-sm text-muted">
            Estas traen un aviso &quot;Ojo&quot;. Léelo y mira el precio con <strong className="text-fg">Ver en Mercado Libre</strong>{' '}
            antes de subirlas.
          </p>
          <WarningGuide />
          <ul className="mt-3 flex flex-col gap-4">{warned.map((item) => card(item, 'offer'))}</ul>
        </section>
      )}

      {posted.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-fg">Ya publicadas (últimas 24 horas)</h2>
          <p className="mt-1 text-sm text-muted">
            Para llevarlas a otra red: comparte la misma imagen y pega el link. En WhatsApp el link se puede tocar si
            va en el texto. Si una dice en rojo que ahora está más cara o que ya no está a la venta, borra esa
            historia de Instagram.
          </p>
          <ul className="mt-3 flex flex-col gap-4">{posted.map((item) => card(item, 'posted'))}</ul>
        </section>
      )}
    </div>
  );
}
