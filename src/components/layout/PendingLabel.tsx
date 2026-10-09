'use client';

import type { ReactNode } from 'react';
import { useLinkStatus } from 'next/link';

/**
 * Texto de un <Link> que cambia mientras carga la página a la que lleva.
 *
 * Un link a la misma página con otro parámetro ("ver más" en una categoría)
 * no da ninguna señal mientras el servidor responde, y en un teléfono con
 * mala señal parece que el toque no hizo nada. Tiene que ir dentro del
 * <Link>: de ahí lee el estado.
 */
export function PendingLabel({
  children,
  pendingText = 'Cargando…',
}: {
  children: ReactNode;
  pendingText?: string;
}) {
  const { pending } = useLinkStatus();
  return <>{pending ? pendingText : children}</>;
}
