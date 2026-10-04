'use client';

import { useEffect } from 'react';
import { SRC_STORAGE_KEY, normalizeSrc } from '@/lib/clicks';

/**
 * Recuerda de dónde llegó la visita (?src=telegram, ?utm_source=instagram)
 * para adjuntarlo a los clics hacia Mercado Libre. Así se sabe qué canal
 * trae compradores y no solo visitas.
 *
 * Solo cuenta el primer aterrizaje de la sesión: si después navega a una
 * página con otro ?src=, el origen sigue siendo el primero. Se guarda en
 * sessionStorage (se borra al cerrar la pestaña), no en una cookie.
 *
 * Lee window.location en vez de useSearchParams para no obligar a todas las
 * páginas a renderizarse en el navegador.
 */
export function UtmCapture() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SRC_STORAGE_KEY)) return;
      const params = new URLSearchParams(window.location.search);
      const src = normalizeSrc(params.get('src') ?? params.get('utm_source'));
      if (src) sessionStorage.setItem(SRC_STORAGE_KEY, src);
    } catch {
      // Sin sessionStorage (modo privado estricto): los clics van sin origen.
    }
  }, []);

  return null;
}
