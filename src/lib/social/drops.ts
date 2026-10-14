import type { SupabaseClient } from '@supabase/supabase-js';
import { getPriceStatsManyChecked, type CheckedPriceStats } from '@/lib/queries/price-history';
import { interestEvidence } from '@/lib/social/evidence';
import type { InterestEvidence } from '@/lib/social/interest';
import { readInterestSignals, type InterestSignals, type SignalOptions } from '@/lib/social/signals';

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

/**
 * Todo lo que el puntaje de interés puede saber de cada candidato: lo que
 * dice el historial de precios (readInterestEvidence) más las dos señales de
 * "ganadores y tendencia" (lib/social/signals: el puesto entre los más
 * vendidos de Mercado Libre y los clics recientes en el sitio).
 *
 * Es el único lugar donde se juntan, y lo usan los cuatro que eligen para
 * redes (historias, plan de publicaciones, Telegram y videos): así un mismo
 * producto tiene los mismos puntos y el mismo motivo en todos.
 *
 * Las señales solo suman, y solo al orden: el piso de interés se mide sin
 * ellas (lib/social/interest). Si no se pudieron leer, la evidencia queda
 * como la del historial solo. Nunca lanza.
 */
export async function readSocialEvidence<
  T extends { id: string; price: number; original_price: number | null; ml_product_id?: string | null },
>(admin: SupabaseClient, rows: T[], now: Date, skip?: ReadonlySet<string>): Promise<Map<string, InterestEvidence>> {
  const candidates = skip ? rows.filter((p) => !skip.has(p.id)) : rows;
  const [evidence, signals] = await Promise.all([
    readInterestEvidence(candidates, now),
    readInterestSignals(admin, candidates, now),
  ]);
  return withSignals(evidence, signals);
}

/** La evidencia del historial con las señales de cada producto encima. La de quien no tiene historial leído no se inventa. */
function withSignals(
  evidence: Map<string, InterestEvidence>,
  signals: Map<string, InterestSignals>
): Map<string, InterestEvidence> {
  for (const [id, signal] of signals) {
    const known = evidence.get(id);
    if (known) evidence.set(id, { ...known, mlPosition: signal.mlPosition, recentClicks: signal.recentClicks });
  }
  return evidence;
}

/**
 * Lo mismo que readSocialEvidence, en dos pasos, para quien ya leyó el
 * historial (readInterestEvidence) y con él decidió con cuáles productos se
 * queda: les suma las señales a esos y devuelve su evidencia completa, sin
 * tocar la que recibió.
 *
 * Lo usa el tablero de videos, que primero necesita la baja de cada producto
 * para saber qué videos siguen diciendo la verdad, y recién ahí sabe de
 * cuáles vale la pena preguntar los clics. Son pocos, así que por defecto se
 * piden solo los suyos (SignalOptions.onlyTheirClicks). Nunca lanza.
 */
export async function addInterestSignals<T extends { id: string; ml_product_id?: string | null }>(
  admin: SupabaseClient,
  rows: T[],
  history: ReadonlyMap<string, InterestEvidence>,
  now: Date,
  options: SignalOptions = { onlyTheirClicks: true }
): Promise<Map<string, InterestEvidence>> {
  const evidence = new Map<string, InterestEvidence>();
  for (const p of rows) {
    const known = history.get(p.id);
    if (known) evidence.set(p.id, known);
  }
  return withSignals(evidence, await readInterestSignals(admin, rows, now, options));
}

/** De cuántos candidatos no se pudo leer el historial. Para decirlo en la respuesta de quien publica. */
export function countUnreadHistory(evidence: Map<string, InterestEvidence>): number {
  let unread = 0;
  for (const item of evidence.values()) if (item.historyUnread === true) unread++;
  return unread;
}
