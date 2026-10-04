'use client';

import type { MouseEvent } from 'react';
import { usePathname } from 'next/navigation';
import {
  SRC_STORAGE_KEY,
  clickDedupKey,
  linkModeFromHref,
  placementFromPath,
  type Placement,
} from '@/lib/clicks';

/**
 * Único punto de salida hacia Mercado Libre. Es un <a> estándar: se abre
 * solo por clic explícito del usuario (sin redirects automáticos, sin
 * pop-ups), como exigen las reglas del Programa de Afiliados.
 *
 * El clic se cuenta aparte, con un beacon a /api/e que el navegador manda
 * en segundo plano: el link no pasa por un redirect propio ni cambia, así
 * ML recibe exactamente el mismo clic que antes. Sin noreferrer a
 * propósito: ML usa el referrer para atribuir.
 */
export function AffiliateButton({
  href,
  productId,
  productName,
  placement,
  label = 'Ver en Mercado Libre',
  className = '',
}: {
  href: string;
  productId?: string;
  productName?: string;
  placement?: Placement;
  label?: string;
  className?: string;
}) {
  const pathname = usePathname();

  function track() {
    if (!productId) return;

    // Un clic por producto y por sesión: abrir tres veces el mismo link no
    // son tres compradores. Si el navegador bloquea sessionStorage (modo
    // privado estricto) se cuenta igual, sin deduplicar.
    try {
      const key = clickDedupKey(productId);
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Sin sessionStorage.
    }

    let src: string | null = null;
    try {
      src = sessionStorage.getItem(SRC_STORAGE_KEY);
    } catch {
      // Sin sessionStorage: el clic queda sin origen.
    }

    let mobile = false;
    try {
      mobile = window.matchMedia('(max-width: 640px)').matches;
    } catch {
      // Navegador sin matchMedia.
    }

    const body = JSON.stringify({
      p: productId,
      s: placement ?? placementFromPath(pathname ?? '/'),
      m: linkModeFromHref(href),
      src,
      mob: mobile,
    });

    // sendBeacon sobrevive a que la pestaña cambie de página; fetch con
    // keepalive es el respaldo. Si ambos fallan se pierde el clic, nunca
    // la navegación.
    try {
      if (navigator.sendBeacon?.('/api/e', body)) return;
    } catch {
      // Sigue con fetch.
    }
    try {
      void fetch('/api/e', { method: 'POST', body, keepalive: true }).catch(() => {});
    } catch {
      // Nada más que hacer.
    }
  }

  function handleAuxClick(e: MouseEvent<HTMLAnchorElement>) {
    // Clic con la rueda (abre en otra pestaña). El clic derecho también
    // dispara auxclick y no abre nada: ese no se cuenta.
    if (e.button === 1) track();
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow sponsored noopener"
      aria-label={
        productName
          ? `Ver ${productName} en Mercado Libre (se abre en otra pestaña)`
          : 'Ver en Mercado Libre (se abre en otra pestaña)'
      }
      onClick={track}
      onAuxClick={handleAuxClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-mlYellow px-5 py-3 font-heading font-semibold text-[#1a1400] transition hover:brightness-95 ${className}`}
    >
      {label}
    </a>
  );
}
