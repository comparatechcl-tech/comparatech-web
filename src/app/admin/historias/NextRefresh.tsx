'use client';

import { useEffect, useState } from 'react';
import { chileTime, nextPriceRefresh } from '@/lib/social/content-timing';

/** Cada cuánto se vuelve a calcular la hora, por si la página queda abierta. */
const TICK_MS = 30_000;

/**
 * "HH:MM" de la próxima revisión de precios, en hora de Chile. Sigue al día
 * aunque la página quede abierta. El primer dibujo usa la hora del servidor,
 * así el del servidor y el del teléfono salen iguales.
 */
export function NextRefresh({ renderedAt }: { renderedAt: number }) {
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return <>{chileTime(nextPriceRefresh(new Date(now)))}</>;
}
