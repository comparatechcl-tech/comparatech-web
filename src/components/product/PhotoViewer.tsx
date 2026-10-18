'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react';
import mlImageLoader from '@/lib/ml-image-loader';
import { formatCLP } from '@/lib/format';
import { stepIndex, swipeStep, type ViewerItem } from '@/lib/photo-viewer';

/**
 * El visor de fotos (ver lib/photo-viewer): la foto en grande y las de las
 * otras versiones del mismo producto, con flechas, el teclado o deslizando el
 * dedo. Sin el visor la página es la misma: es un botón alrededor de la foto
 * (o un botón "Ver fotos"), y la foto sigue siendo la del HTML.
 *
 * Sin blob: ni scripts de afuera: la CSP del sitio no los permite. Las fotos
 * van directo al CDN de Mercado Libre con mlImageLoader, como en las tarjetas.
 */
export function PhotoViewer({
  items,
  start = 0,
  title,
  currentSlug,
  variant,
  children,
}: {
  items: ViewerItem[];
  /** La foto con que abre. */
  start?: number;
  /** De qué son las fotos: "iPhone 17". */
  title: string;
  /** La versión de la página: a esa no se le ofrece "ver ficha". */
  currentSlug?: string;
  /** hero: el botón es la foto principal de la ficha (children). button: un botón "Ver fotos". */
  variant: 'hero' | 'button';
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(start);
  const [mounted, setMounted] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const count = items.length;

  useEffect(() => setMounted(true), []);

  const step = useCallback((direction: 1 | -1) => setIndex((i) => stepIndex(i, count, direction)), [count]);
  const hide = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // La página de atrás no se mueve mientras el visor está abierto.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, hide, step]);

  if (count === 0) return <>{children}</>;

  const show = () => {
    setIndex(start);
    setOpen(true);
  };
  const others = count - 1;
  const triggerLabel =
    others === 0
      ? 'Ver la foto en grande'
      : others === 1
        ? 'Ver la foto en grande y la de su otra versión'
        : `Ver la foto en grande y las de sus otras ${others} versiones`;

  const onPointerDown = (e: PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = pointer.current;
    pointer.current = null;
    if (!from || count < 2) return;
    const direction = swipeStep(e.clientX - from.x, e.clientY - from.y);
    if (direction !== 0) step(direction);
  };

  const item = items[Math.min(index, count - 1)];

  return (
    <>
      {variant === 'hero' ? (
        <button
          ref={trigger}
          type="button"
          onClick={show}
          aria-label={triggerLabel}
          className="group/visor absolute inset-0 block h-full w-full cursor-zoom-in"
        >
          {children}
          <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white transition group-hover/visor:bg-black/75">
            <Expand size={13} aria-hidden />
            {others > 0 ? `Ver fotos · ${count} versiones` : 'Ver foto'}
          </span>
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          onClick={show}
          aria-label={triggerLabel}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-fg transition hover:border-accent/40 hover:text-accent"
        >
          <Expand size={13} aria-hidden />
          Ver fotos{count > 1 ? ` (${count})` : ''}
        </button>
      )}

      {open &&
        mounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Fotos de ${title}`}
            className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <p className="min-w-0 truncate text-sm font-medium">
                {title}
                {count > 1 && <span className="ml-2 text-xs text-white/60">{`${index + 1} de ${count}`}</span>}
              </p>
              <button
                ref={close}
                type="button"
                onClick={hide}
                aria-label="Cerrar las fotos"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
              >
                <X size={20} aria-hidden />
              </button>
            </div>

            <div
              className="relative min-h-0 flex-1 px-4"
              style={{ touchAction: 'pan-y pinch-zoom' }}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => (pointer.current = null)}
            >
              <div className="relative mx-auto h-full max-w-3xl overflow-hidden rounded-2xl bg-white">
                <Image
                  key={item.id}
                  loader={mlImageLoader}
                  src={item.imageUrl}
                  alt={item.name}
                  fill
                  sizes="(min-width: 768px) 768px, 100vw"
                  className="select-none object-contain"
                  draggable={false}
                />
              </div>
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => step(-1)}
                    aria-label="Versión anterior"
                    className="absolute left-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 transition hover:bg-black/80"
                  >
                    <ChevronLeft size={22} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => step(1)}
                    aria-label="Versión siguiente"
                    className="absolute right-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 transition hover:bg-black/80"
                  >
                    <ChevronRight size={22} aria-hidden />
                  </button>
                </>
              )}
            </div>

            <div className="px-4 pb-4 pt-3" aria-live="polite">
              <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.label}</p>
                  <p className="text-xs text-white/70">
                    {item.onSale ? formatCLP(item.price) : `Sin vendedor hoy · último precio ${formatCLP(item.price)}`}
                  </p>
                </div>
                {item.slug !== currentSlug && (
                  <Link
                    href={`/producto/${item.slug}`}
                    prefetch={false}
                    className="inline-flex min-h-11 items-center rounded-full bg-white px-4 text-sm font-semibold text-black transition hover:bg-white/90"
                  >
                    Ver esta versión
                  </Link>
                )}
              </div>

              {count > 1 && (
                <ul className="mx-auto mt-3 flex max-w-3xl gap-2 overflow-x-auto pb-1">
                  {items.map((v, i) => (
                    <li key={v.id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => setIndex(i)}
                        aria-label={v.label}
                        aria-current={i === index ? 'true' : undefined}
                        className={`relative block h-14 w-14 overflow-hidden rounded-lg bg-white ring-2 transition ${
                          i === index ? 'ring-accent' : 'ring-transparent opacity-70 hover:opacity-100'
                        }`}
                      >
                        <Image loader={mlImageLoader} src={v.imageUrl} alt="" fill sizes="56px" className="object-contain" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
