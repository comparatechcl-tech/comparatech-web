'use client';

import { useEffect, useState } from 'react';
import { formatFullDateTime, formatTimeAgo } from '@/lib/format';

/**
 * "Precio revisado hace 12 minutos". Dice "revisado" y no "verificado": habla
 * de cuándo se miró el precio, no garantiza el descuento.
 *
 * Es componente de cliente a propósito: la página se sirve desde caché y se
 * regenera cada tanto, así que un "hace 2 minutos" calculado en el servidor
 * quedaría congelado un buen rato. Se calcula en el navegador y se actualiza
 * solo.
 *
 * En el HTML del servidor va la fecha completa ("el 22-11-2026 a las 18:42"),
 * que es cierta se lea cuando se lea: los buscadores y las IAs leen ese HTML,
 * y un precio sin fecha no les dice si está vigente. Hasta el 22-11-2026 el
 * servidor no escribía nada.
 */
export function PriceFreshness({ checkedAt }: { checkedAt: string | null }) {
  const [mounted, setMounted] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setLabel(formatTimeAgo(checkedAt));
    update();
    setMounted(true);
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [checkedAt]);

  // Antes de hidratar: lo mismo que escribió el servidor, la fecha completa.
  // Ya en el navegador: "hace 12 minutos", o nada si la fecha no sirve.
  const when = formatFullDateTime(checkedAt);
  const text = mounted ? label : when ? `el ${when.date} a las ${when.time} (hora de Chile)` : null;
  if (!text) return null;

  return (
    <p className="mt-1.5 text-xs text-muted">
      Precio revisado en Mercado Libre {text}
    </p>
  );
}
