'use client';

import { useEffect, useState } from 'react';
import { nextPassText } from './texts';

/** Cada cuánto se vuelve a calcular, por si la página queda abierta. */
const TICK_MS = 30_000;

/**
 * La línea de arriba de /admin/videos: cuántas pasadas hay al día, cuándo es
 * la próxima (en hora de Chile) y qué hace falta para que entren productos
 * nuevos. Sigue al día aunque la página quede abierta. El primer dibujo usa
 * la hora del servidor, así el del servidor y el del teléfono salen iguales.
 */
export function NextPass({ renderedAt }: { renderedAt: number }) {
  const [now, setNow] = useState(renderedAt);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return <>{nextPassText(new Date(now))}</>;
}
