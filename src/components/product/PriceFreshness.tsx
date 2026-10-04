'use client';

import { useEffect, useState } from 'react';
import { formatTimeAgo } from '@/lib/format';

/**
 * "Precio revisado hace 12 minutos". Dice "revisado" y no "verificado": habla
 * de cuándo se miró el precio, no garantiza el descuento.
 *
 * Es componente de cliente a propósito: la página se sirve desde caché y se
 * regenera cada pocos minutos, así que un texto calculado en el servidor
 * quedaría congelado y diría "hace 2 minutos" durante un buen rato. Se
 * calcula en el navegador y se actualiza solo.
 */
export function PriceFreshness({ checkedAt }: { checkedAt: string | null }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setLabel(formatTimeAgo(checkedAt));
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [checkedAt]);

  // Antes de hidratar no se muestra nada, para no desincronizar con el HTML
  // del servidor.
  if (!label) return null;

  return (
    <p className="mt-1.5 text-xs text-muted">
      Precio revisado en Mercado Libre {label}
    </p>
  );
}
