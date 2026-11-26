'use client';

import type { MouseEvent } from 'react';
import { SRC_STORAGE_KEY } from '@/lib/clicks';
import { storeClickDedupKey, storeClickPayload } from '@/lib/store-clicks';

/**
 * El link a la ficha de un producto en otra tienda. Es un <a> estándar que se
 * abre solo por clic de la persona. El clic se cuenta aparte, con un beacon a
 * /api/e (lib/store-clicks): el link no pasa por un redirect propio.
 *
 * `sponsored` marca los links que llevan parámetros de afiliado.
 */
export function StoreLink({
  href,
  productId,
  store,
  storeName,
  sponsored = false,
  className = '',
}: {
  href: string;
  productId: string;
  store: string;
  storeName: string;
  sponsored?: boolean;
  className?: string;
}) {
  function track() {
    // Un clic por producto, tienda y sesión.
    try {
      const key = storeClickDedupKey(productId, store);
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // Sin sessionStorage se cuenta igual, sin deduplicar.
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

    const body = storeClickPayload(productId, store, src, mobile);
    try {
      if (navigator.sendBeacon?.('/api/e', body)) return;
    } catch {
      // Sigue con fetch.
    }
    try {
      void fetch('/api/e', { method: 'POST', body, keepalive: true }).catch(() => {});
    } catch {
      // Se pierde el clic, nunca la navegación.
    }
  }

  function handleAuxClick(e: MouseEvent<HTMLAnchorElement>) {
    // Clic con la rueda (abre en otra pestaña). El clic derecho no abre nada: no se cuenta.
    if (e.button === 1) track();
  }

  return (
    <a
      href={href}
      target="_blank"
      rel={sponsored ? 'nofollow sponsored noopener' : 'nofollow noopener'}
      aria-label={`Ver en ${storeName} (se abre en otra pestaña)`}
      onClick={track}
      onAuxClick={handleAuxClick}
      className={`inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-center text-sm font-semibold text-fg transition hover:border-accent hover:text-accent ${className}`}
    >
      Ver en {storeName}
    </a>
  );
}
