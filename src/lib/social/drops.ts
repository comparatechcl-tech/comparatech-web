import { getPriceStatsManyChecked, type CheckedPriceStats } from '@/lib/queries/price-history';
import { interestEvidence } from '@/lib/social/evidence';
import type { InterestEvidence } from '@/lib/social/interest';

/**
 * Lo que el historial de precios dice de cada candidato a redes: la baja que
 * vimos, el mínimo de 30 días, cuántos días llevamos siguiéndolo y si el
 * precio se ha estado moviendo.
 *
 * Se lee para TODOS los candidatos, no solo para los que no llegan al
 * descuento mínimo: el puntaje de interés (lib/social/interest) necesita
 * saber si el sitio vio más barato también lo que trae un buen descuento de
 * lista. `skip` son los que igual no pueden salir (ya publicados hace poco):
 * su historial no se lee y quedan sin entrada.
 *
 * Usa la misma lectura del historial que las páginas del sitio, que va por
 * tandas y no se corta a las 1.000 filas de Supabase. Nunca lanza. Si el
 * historial de un producto no se pudo leer, su evidencia lo dice
 * (historyUnread): el puntaje le pone un aviso, y con aviso no sale en los
 * canales que publican solos. Tratarlo como "sin historial" apagaría justo
 * la regla que impide publicar lo que el sitio vio más barato.
 */
export async function readInterestEvidence<
  T extends { id: string; price: number; original_price: number | null },
>(rows: T[], now: Date, skip?: ReadonlySet<string>): Promise<Map<string, InterestEvidence>> {
  const evidence = new Map<string, InterestEvidence>();
  const candidates = skip ? rows.filter((p) => !skip.has(p.id)) : rows;
  if (candidates.length === 0) return evidence;

  const ids = candidates.map((p) => p.id);
  let read: CheckedPriceStats;
  try {
    read = await getPriceStatsManyChecked(ids);
  } catch (err) {
    console.warn('[social] no se pudo leer el historial de precios:', err);
    read = { stats: new Map(), unread: new Set(ids) };
  }
  for (const p of candidates) {
    evidence.set(p.id, interestEvidence(p, read.stats.get(p.id), now.getTime(), read.unread.has(p.id)));
  }
  return evidence;
}

/** De cuántos candidatos no se pudo leer el historial. Para decirlo en la respuesta de quien publica. */
export function countUnreadHistory(evidence: Map<string, InterestEvidence>): number {
  let unread = 0;
  for (const item of evidence.values()) if (item.historyUnread === true) unread++;
  return unread;
}
