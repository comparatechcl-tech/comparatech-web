'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Copy, Download, ExternalLink, Loader2, RefreshCw, Share2, TrendingDown } from 'lucide-react';
import { formatPrice } from '@/lib/content/captions';
import { formatDayMonth } from '@/lib/format';
import type { WeeklyCarousel } from '@/lib/social/carousel';
import { checkLivePrices } from '@/app/admin/live-price-actions';
import { checkSummary, type FileState } from '../StoryList';
import { createLiveChecker } from '../live-checks';
import { safeMlUrl, type CardCheck } from '../rules';
import { markCarouselPublished, undoCarouselPublished } from './actions';
import { MetaPublishPanel } from './MetaPublishPanel';
import {
  createCarouselGestures,
  slidesOf,
  type CaptionNetwork,
  type CarouselEnv,
  type CarouselGestures,
  type CarouselMark,
} from './gestures';
import { carouselCover, carouselGate, carouselLine, carouselTargets, relevantCheck } from './rules';
import type { Note } from '../gestures';

/**
 * El carrusel de la semana, pensado para el teléfono: las láminas se bajan a
 * memoria de a una (cada una la dibuja el servidor), y "Compartir" las manda
 * todas juntas a Instagram con el texto ya copiado. Cada producto se revisa en
 * vivo en Mercado Libre al cargar y al volver a la pestaña, como en Historias:
 * si uno cambió, no se comparte ni se guarda ninguna.
 *
 * Las miniaturas y "Guardar" usan la dirección de cada lámina y no una
 * dirección blob: (la política de seguridad del sitio no deja mostrarlas):
 * como ya se bajó, el navegador la saca de su caché.
 */

/** Lo marcado en esta sesión, por carrusel (la dirección de su portada): al volver con "atrás" no se pierde. */
const marks = new Map<string, CarouselMark>();
const firstSeen = new Map<number, number>();

const TICK_MS = 30_000;

const BUTTON =
  'flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-accent/50 disabled:opacity-50';

const LINE_CLASS = {
  checking: 'text-muted',
  same: 'text-accent',
  bad: 'font-semibold text-red-400',
  unknown: 'font-medium text-amber-400',
} as const;

const BROWSER: CarouselEnv = {
  share: (data) => navigator.share(data),
  writeText: (text) => navigator.clipboard.writeText(text),
  now: () => Date.now(),
  later: (run, ms) => {
    setTimeout(run, ms);
  },
  download: (url, fileName) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
};

const timeFmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function CarouselView({
  carousel,
  maxPriceAgeMs,
  renderedAt,
  metaReady = false,
}: {
  carousel: WeeklyCarousel;
  maxPriceAgeMs: number;
  renderedAt: number;
  /** Meta conectado: aparece "Publicar desde el sitio". */
  metaReady?: boolean;
}) {
  const slides = slidesOf(carousel);
  const [openedAt] = useState(() => {
    const seen = firstSeen.get(renderedAt) ?? Date.now();
    if (typeof window !== 'undefined') firstSeen.set(renderedAt, seen);
    return seen;
  });
  const files = useRef(new Map<string, File>());
  const [fileState, setFileState] = useState<Record<string, FileState>>({});
  const [canShare, setCanShare] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<CaptionNetwork | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [published, setPublished] = useState<CarouselMark | null>(() => marks.get(carousel.cover.image) ?? null);
  const [checks, setChecks] = useState<Record<string, CardCheck>>({});
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
  const targets = () => carouselTargets(carousel.entries);

  const [gestures] = useState<CarouselGestures>(() =>
    createCarouselGestures(
      BROWSER,
      { mark: markCarouselPublished, undo: undoCarouselPublished },
      {
        note: (next) => setNote(next),
        copied: (network) => setCopied(network),
        busy: (on) => setBusy(on),
        published: (mark) => {
          if (mark) marks.set(carousel.cover.image, mark);
          else marks.delete(carousel.cover.image);
          setPublished(mark);
        },
        run: (job) => startTransition(job),
      },
      {
        openedAt,
        maxPriceAgeMs,
        checkOf: (productId) => checker.get(productId),
        recheck: () => void checker.run(targets()),
        fileOf: (image) => files.current.get(image),
      },
      carousel
    )
  );

  useEffect(() => {
    // Solo con pantalla táctil: el computador también "comparte", pero su panel no llega a Instagram.
    const probe = new File([''], 'lamina.jpg', { type: 'image/jpeg' });
    setCanShare(
      typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [probe, probe] }) &&
        window.matchMedia('(pointer: coarse)').matches
    );
  }, []);

  useEffect(() => {
    void checker.run(targets());
    const onVisible = () => {
      if (document.visibilityState === 'visible') checker.visible(targets());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checker]);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') checker.tick(targets());
    }, TICK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checker]);

  useEffect(() => {
    let cancelled = false;
    const store = files.current;
    (async () => {
      // De a una: cada lámina la dibuja el servidor en el momento.
      for (const slide of slidesOf(carousel)) {
        if (store.has(slide.image)) continue;
        let file: File | null = null;
        for (let attempt = 0; attempt < 2 && !file && !cancelled; attempt++) {
          try {
            const res = await fetch(slide.image);
            if (!res.ok) throw new Error(String(res.status));
            file = new File([await res.blob()], slide.fileName, { type: 'image/jpeg' });
          } catch {
            /* se intenta una vez más */
          }
        }
        if (cancelled) return;
        if (!file) {
          setFileState((s) => ({ ...s, [slide.image]: 'error' }));
          continue;
        }
        store.set(slide.image, file);
        setFileState((s) => ({ ...s, [slide.image]: 'lista' }));
      }
    })();
    return () => {
      cancelled = true;
      store.clear();
    };
  }, [carousel]);

  const ready = slides.filter((slide) => fileState[slide.image] === 'lista').length;
  const failed = slides.some((slide) => fileState[slide.image] === 'error');
  const allReady = ready === slides.length;
  const gate = carouselGate(carousel.entries, (id) => checks[id], { now, openedAt, maxPriceAgeMs });
  const cover = carouselCover(gate);
  const summary = checkSummary(checks, now);

  return (
    <div className="mt-6 flex flex-col gap-6">
      {canShare === false && (
        <p className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          El botón <strong className="text-fg">Compartir</strong> aparece en el teléfono, con Chrome o Safari. Si no lo ves,
          guarda las imágenes y copia el texto.
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

      <MetaPublishPanel
        metaReady={metaReady}
        slides={slides.map((slide) => slide.image)}
        ready={gate.ok}
        blocked={!gate.ok && gate.kind !== 'checking' ? gate.message : null}
        alreadyMarked={published !== null}
        onMarked={(mark) => {
          marks.set(carousel.cover.image, mark);
          setPublished(mark);
        }}
      />

      <section className="rounded-xl border border-border bg-surface p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {canShare !== false && (
            <button
              type="button"
              onClick={() => gestures.share()}
              disabled={!allReady || canShare === null}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-ink transition hover:bg-accent/90 disabled:opacity-50 sm:col-span-2"
            >
              <Share2 size={15} aria-hidden />
              {allReady ? `Compartir las ${slides.length} imágenes` : failed ? 'Falta una imagen: toca Actualizar' : `Preparando las imágenes (${ready} de ${slides.length})…`}
            </button>
          )}
          <button type="button" onClick={() => void gestures.copy('instagram')} className={BUTTON}>
            {copied === 'instagram' ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied === 'instagram' ? 'Texto copiado' : 'Copiar texto (Instagram)'}
          </button>
          <button type="button" onClick={() => void gestures.copy('facebook')} className={BUTTON}>
            {copied === 'facebook' ? <Check size={15} className="text-accent" aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied === 'facebook' ? 'Texto copiado' : 'Copiar texto (Facebook)'}
          </button>
          <button type="button" onClick={() => gestures.saveAll()} disabled={!allReady} className={BUTTON}>
            <Download size={15} aria-hidden /> Guardar las {slides.length} imágenes
          </button>
          {published ? (
            <button type="button" onClick={() => gestures.undo(published)} disabled={busy} className={`${BUTTON} border-accent/50 text-accent`}>
              <Check size={15} aria-hidden /> {busy ? 'Deshaciendo…' : 'Publicado · Deshacer'}
            </button>
          ) : (
            <button type="button" onClick={() => gestures.mark()} disabled={busy} className={BUTTON}>
              {busy ? 'Guardando…' : 'Ya lo publiqué'}
            </button>
          )}
        </div>
        {!gate.ok && gate.kind !== 'checking' && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-400">
            {gate.message}
          </p>
        )}
        {gate.ok && gate.caution && <p className="mt-3 text-sm font-medium text-amber-400">{gate.caution}</p>}
        <p role="status" aria-live="polite" className={`mt-2 text-sm ${note?.tone === 'warn' ? 'font-medium text-amber-400' : 'text-red-400'}`}>
          {note?.text ?? ''}
        </p>
        {published && (
          <p className="mt-1 text-xs text-muted">
            Marcado como publicado el {formatDayMonth(published.postedAt)} a las {timeFmt.format(new Date(published.postedAt))}.
          </p>
        )}
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold text-fg">Las {slides.length} imágenes, en orden</h2>
        <ol className="mt-3 flex gap-3 overflow-x-auto pb-2">
          {slides.map((slide, i) => {
            const state = fileState[slide.image];
            const label = i === 0 ? 'Portada' : i === slides.length - 1 ? 'Cierre' : `#${i}`;
            return (
              <li key={slide.image} className="flex w-36 shrink-0 flex-col gap-1.5">
                <div className="relative aspect-[4/5] w-36 overflow-hidden rounded-md bg-bg">
                  {state === 'lista' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- JPG ya descargado: sale del caché del navegador.
                    <img
                      src={slide.image}
                      alt={label}
                      className={`h-full w-full object-cover ${cover ? 'pointer-events-none select-none opacity-30' : ''}`}
                      draggable={cover ? false : undefined}
                    />
                  ) : state === 'error' ? (
                    <p className="flex h-full items-center justify-center p-2 text-center text-xs text-muted">No se pudo generar. Toca Actualizar.</p>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 size={18} className="animate-spin text-muted" aria-label="Preparando la imagen" />
                    </div>
                  )}
                  {cover && state === 'lista' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-bg/70 p-2 text-center text-xs font-semibold text-red-400">
                      {cover}
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>
                    {i + 1}. {label}
                  </span>
                  {state === 'lista' && gate.ok ? (
                    <a
                      href={slide.image}
                      download={slide.fileName}
                      onClick={(e) => {
                        if (!gestures.save()) e.preventDefault();
                      }}
                      className="inline-flex min-h-11 items-center gap-1 px-1 text-accent"
                    >
                      <Download size={13} aria-hidden /> Guardar
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => gestures.save()}
                      disabled={state !== 'lista'}
                      className="inline-flex min-h-11 items-center gap-1 px-1 disabled:opacity-50"
                    >
                      <Download size={13} aria-hidden /> Guardar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2 className="font-heading text-lg font-semibold text-fg">Los productos</h2>
        <ul className="mt-3 flex flex-col gap-3">
          {carousel.entries.map((entry) => {
            const mlUrl = safeMlUrl(entry.mlUrl);
            const check = relevantCheck(checks[entry.id], entry);
            const line = carouselLine(check, now, mlUrl !== null);
            return (
              <li key={entry.id} className="rounded-xl border border-border bg-surface p-3 sm:p-4">
                {entry.brand && <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{entry.brand}</p>}
                <p className="text-sm font-semibold leading-snug text-fg">
                  #{entry.rank} · {entry.name}
                </p>
                <p className="mt-1 text-sm text-fg">
                  <strong className="font-heading text-lg">{formatPrice(entry.price)}</strong>
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-400">
                    <TrendingDown size={13} aria-hidden /> Bajó {formatPrice(entry.dropAmount)} desde el {formatDayMonth(entry.since)} ({entry.dropPct}% según nuestro historial)
                  </span>
                </p>
                <p className={`mt-1 flex items-start gap-1.5 text-xs leading-snug ${LINE_CLASS[line.tone]}`}>
                  {line.tone === 'checking' && <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" aria-hidden />}
                  <span>{line.text}</span>
                </p>
                {line.detail && <p className="mt-0.5 text-[11px] leading-snug text-muted">{line.detail}</p>}
                {mlUrl && (
                  <a href={mlUrl} target="_blank" rel="noopener noreferrer" className={`${BUTTON} mt-2 w-full sm:inline-flex sm:w-auto`}>
                    <ExternalLink size={15} className="shrink-0" aria-hidden /> Ver en Mercado Libre
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold text-fg">Los textos</h2>
        {(['instagram', 'facebook'] as const).map((network) => (
          <details key={network} className="rounded-xl border border-border bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium text-fg">
              Texto para {network === 'instagram' ? 'Instagram' : 'Facebook'}
            </summary>
            {/* Completo y seleccionable: el respaldo si el teléfono no deja copiar con el botón. */}
            <pre className="mt-2 select-all whitespace-pre-wrap break-words font-sans text-xs text-muted">{carousel.captions[network]}</pre>
          </details>
        ))}
      </section>
    </div>
  );
}
