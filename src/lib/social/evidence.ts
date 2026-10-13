import { confirmedDrop } from '@/lib/deal-rank';
import { firstRecordIsStart, type PriceStats } from '@/lib/deals';
import type { InterestEvidence } from '@/lib/social/interest';

const DAY_MS = 86_400_000;

/** Ventana de "hace poco" para los cambios de precio. */
const RECENT_MS = 2 * DAY_MS;

/** Un precio que fue y volvió deja de contar como "movido" cuando lleva una semana quieto. */
const SEESAW_FRESH_MS = 7 * DAY_MS;

/** La misma ventana en que se mira si el producto estuvo más barato. */
const UNKNOWN_START_MS = 30 * DAY_MS;

/**
 * Lo que el historial de precios le aporta al puntaje de interés
 * (lib/social/interest): la baja que vimos, el mínimo de 30 días, cuántos
 * días llevamos siguiendo el producto y si el precio se ha estado moviendo.
 *
 * El mínimo es el sostenido (min30Held): un precio que duró un rato no deja
 * a un producto un mes entero como "ya estuvo más barato".
 *
 * El primer registro del historial puede ser dos cosas (firstRecordIsStart).
 * Si es de cuando se agregó el producto, es su precio de partida. Si es
 * posterior, es su primer cambio, y el precio que tenía antes no quedó
 * anotado: no se sabe si subió o bajó. Ese cambio cuenta como reciente
 * mientras tenga menos de dos días. Y si es el único precio que se conoce,
 * durante 30 días no se puede responder si el producto estuvo más barato:
 * se avisa (`changedFromUnknown`), con lo que no sale en los canales que
 * publican solos ni encabeza la portada.
 *
 * Sin historial no se afirma nada: sin baja, sin mínimo y cero días. El
 * puntaje trata eso como "no se pudo comprobar", que vale menos que una
 * oferta comprobada pero no se castiga. `unread` es otra cosa: el historial
 * existe o puede existir, pero hoy no se pudo leer, y eso sí se avisa.
 *
 * Puro: lo usan las redes (servidor) y la portada.
 */
export function interestEvidence(
  product: { price: number; original_price: number | null; created_at?: string | null },
  stats: PriceStats | null | undefined,
  now: number,
  unread: boolean = false
): InterestEvidence {
  if (!stats) return { drop: null, min30: null, daysTracked: 0, historyUnread: unread };
  const drop = confirmedDrop(product, stats, now);

  // Un resumen guardado por una versión anterior no trae la fecha del primer
  // registro: se trata como un cambio de recién, que es el lado prudente.
  const firstAt = new Date(stats.firstSeenAt).getTime();
  const firstAge = Number.isFinite(firstAt) ? now - firstAt : 0;
  const firstWasChange = !firstRecordIsStart(stats.firstSeenAt, product.created_at);

  const lastChangeAt = stats.lastChangeAt ? new Date(stats.lastChangeAt).getTime() : NaN;

  return {
    drop: drop ? { pct: drop.pct, amount: drop.amount } : null,
    // min30Held puede faltar en un resumen guardado por una versión anterior.
    min30: typeof stats.min30Held === 'number' ? stats.min30Held : stats.min30,
    daysTracked: stats.daysTracked,
    recentChanges:
      stats.changesLast48h +
      (firstWasChange && firstAge <= RECENT_MS ? 1 : 0) +
      // Si el último registro no es el precio de hoy, hubo un cambio que el historial todavía no anota.
      (stats.lastPrice === product.price ? 0 : 1),
    seesaw: stats.lastPriceSeenRecently && Number.isFinite(lastChangeAt) && now - lastChangeAt <= SEESAW_FRESH_MS,
    changedFromUnknown: firstWasChange && stats.previousPrice === null && firstAge <= UNKNOWN_START_MS,
    historyUnread: false,
  };
}
