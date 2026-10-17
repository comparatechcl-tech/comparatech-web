import {
  LIVE_CHECK_MAX_ITEMS,
  LIVE_LINE,
  LIVE_RECHECK_AFTER_MS,
  LIVE_SAME_MAX_AGE_MS,
  LIVE_TEXT,
  liveChangedText,
  minutesAgo,
  readLiveCheck,
  staleSameLine,
  type LiveCheck,
  type ShownOffer,
} from '@/lib/social/live-price';
import type { ReadyVideo } from '@/lib/social/videos';
import type { PostedByNetwork } from './wiring';

/**
 * La revisión en vivo del precio de cada video, contra la ficha de Mercado
 * Libre: lo que la tarjeta dice cerca del precio y si deja subir el video.
 *
 * Puro y sin React: lo usan la lista (que pide la revisión al servidor), las
 * reglas de los toques (./gestures) y los tests. La revisión la hace
 * checkLivePrices (app/admin/live-price-actions), que se pide al cargar, al
 * volver a la pestaña y cuando un toque la encuentra vieja; nunca dentro del
 * toque de Compartir, que tiene que abrir la hoja sin esperar al servidor.
 */

/** Lo que dijo una revisión y cuándo llegó, con el reloj de este teléfono (no el del servidor). */
export interface LiveResult {
  check: LiveCheck;
  at: number;
}

/** Lo que se sabe del precio de un video en Mercado Libre. */
export interface LiveEntry {
  /** La última respuesta; null mientras no llega la primera. */
  result: LiveResult | null;
  /** Hay una revisión en camino. Mientras tanto vale la respuesta anterior, si la hay. */
  checking: boolean;
  /** No se revisa en vivo: ya está en las cuatro redes desde hace más de un día. */
  skipped?: boolean;
}

/** Con "same" de hace este rato o menos se puede subir (15 minutos). */
export const SAME_FRESH_MS = LIVE_SAME_MAX_AGE_MS;
/** Al volver a la pestaña se revisa de nuevo si la última revisión tiene más que esto (5 minutos). */
export const RECHECK_AFTER_MS = LIVE_RECHECK_AFTER_MS;
/** Con la pestaña a la vista se revisa sola antes de que el "mismo precio" venza. */
export const AUTO_RECHECK_MS = 12 * 60_000;
/** Pasado este rato desde que se abrió la lista, sin revisión en vivo no se sube: los precios se revisan cada media hora. */
export const MAX_LIST_AGE_MS = 60 * 60_000;
/** Lo que acepta checkLivePrices en una llamada. */
export const MAX_LIVE_ITEMS = LIVE_CHECK_MAX_ITEMS;
/** Lo que cuenta como "publicada hace rato": no se revisa en vivo. */
const POSTED_LONG_AGO_MS = 24 * 3_600_000;

/** Si el servidor no contesta en este rato, esos videos quedan en "no pude revisar" (como en Historias). */
export const CALL_TIMEOUT_MS = 55_000;

export const CHECKING_LINE: string = LIVE_LINE.checking;
export const UNKNOWN_LINE: string = LIVE_LINE.unknown;
export const SKIPPED_LINE =
  'No lo reviso en vivo: lo subiste a las cuatro redes hace más de un día. Mira el precio con el botón antes de subirlo de nuevo.';
/** Lo que se muestra cuando la llamada misma falló (sin conexión, error del sitio). */
export const CALL_FAILED: string = LIVE_TEXT.mlDown;
/** El toque llegó antes que la revisión, o la revisión ya venció: se pidió otra. */
export const CHECKING_NOTE = 'Estoy revisando el precio en Mercado Libre. Toca otra vez en unos segundos.';
export const OLD_LIST = 'Esta lista ya tiene rato y el precio puede haber cambiado. Toca Actualizar, arriba, antes de subir el video.';

/** Un precio del sitio más viejo que el plazo, sin revisión en vivo que lo confirme. Puro. */
export function oldPriceText(maxPriceAgeMs: number): string {
  const hours = Math.round(maxPriceAgeMs / 3_600_000);
  return `El precio de este video se revisó hace más de ${hours} horas y ahora no pude revisarlo en Mercado Libre. Toca Actualizar, arriba, antes de subirlo.`;
}
/** El de siempre, con el plazo de 6 horas de la selección de videos. */
export const OLD_PRICE = oldPriceText(6 * 3_600_000);

/** Lo que la tarjeta y el video muestran de la oferta: con esto se compara en Mercado Libre. Puro. */
export function shownOffer(video: ReadyVideo): ShownOffer {
  return { price: video.price, listPrice: video.listPrice, freeShipping: video.freeShipping, full: video.full };
}

/** ¿La revisión dice que lo que muestra el video ya no es cierto? Puro. */
export function isPriceOff(entry: LiveEntry | undefined): boolean {
  const status = entry?.result?.check.status;
  return status === 'changed' || status === 'unavailable';
}

/** El aviso rojo de un precio que cambió, con lo que el servidor encontró. Puro. */
export function offText(check: LiveCheck): string {
  if (check.status !== 'changed' && check.status !== 'unavailable') return '';
  return `✗ ${liveChangedText(check, 'lo')}`;
}

/** "hace N min", con el reloj de este teléfono. Puro. */
export function agoText(at: number, now: number): string {
  return minutesAgo(now - at);
}

export type LiveTone = 'checking' | 'ok' | 'bad' | 'warn';

/** La línea que la tarjeta muestra junto al precio. Puro. */
export interface LiveLine {
  tone: LiveTone;
  text: string;
  /** Lo que dijo el servidor cuando no pudo revisar, si agrega algo. */
  detail?: string;
}

export function liveLine(entry: LiveEntry | undefined, now: number): LiveLine {
  if (entry?.skipped) return { tone: 'warn', text: SKIPPED_LINE };
  const result = entry?.result;
  // Sin respuesta todavía: es lo que se ve al cargar, mientras la revisión viaja.
  if (!result) return { tone: 'checking', text: CHECKING_LINE };
  const { check } = result;
  if (check.status === 'same') {
    // Vencido ya no deja subir: no va en verde, aunque haya sido el mismo precio.
    if (now - result.at > SAME_FRESH_MS) {
      return entry?.checking ? { tone: 'checking', text: CHECKING_LINE } : { tone: 'warn', text: staleSameLine(now - result.at) };
    }
    const again = entry?.checking ? ' · revisando de nuevo…' : '';
    return { tone: 'ok', text: `✓ Mismo precio que en Mercado Libre (${agoText(result.at, now)})${again}` };
  }
  if (check.status === 'changed' || check.status === 'unavailable') return { tone: 'bad', text: offText(check) };
  // No pudo revisar: si el servidor dijo por qué (por ejemplo, que en este PC no se revisa en vivo), se agrega.
  const why = check.what.trim();
  return why && why !== CALL_FAILED ? { tone: 'warn', text: UNKNOWN_LINE, detail: why } : { tone: 'warn', text: UNKNOWN_LINE };
}

/** Lo que hace falta para la regla de siempre, la que vale cuando no se pudo revisar en vivo. */
export interface GateContext {
  /** Cuándo se vio la lista por primera vez en este teléfono. */
  openedAt: number;
  /** Cuándo revisó el sitio el precio que muestra la tarjeta. */
  checkedAt: string | null;
  maxPriceAgeMs: number;
}

export type GateVerdict = { ok: true } | { ok: false; text: string; recheck: boolean };

/**
 * ¿Se puede compartir, guardar o copiar el texto de este video ahora? Puro.
 *
 * - "same" de hace 15 minutos o menos: sí.
 * - "changed" o "unavailable": no, con lo que cambió.
 * - Sin poder revisar en vivo ("unknown", o ya subido a todo hace más de un
 *   día): la regla de siempre, lista de 60 minutos o menos y precio del sitio
 *   revisado en las últimas 6 horas. La tarjeta ya lo dice en ámbar.
 * - Sin respuesta todavía, o un "same" vencido: no, y se pide otra revisión.
 */
export function uploadGate(entry: LiveEntry | undefined, now: number, ctx: GateContext): GateVerdict {
  const result = entry?.result;
  if (result && (result.check.status === 'changed' || result.check.status === 'unavailable')) {
    return { ok: false, text: offText(result.check), recheck: false };
  }
  if (result && result.check.status === 'same' && now - result.at <= SAME_FRESH_MS) return { ok: true };
  if (entry?.skipped || (result && result.check.status === 'unknown')) {
    const checked = ctx.checkedAt ? new Date(ctx.checkedAt).getTime() : NaN;
    const oldPrice = Number.isFinite(checked) && now - checked > ctx.maxPriceAgeMs;
    if (now - ctx.openedAt > MAX_LIST_AGE_MS) return { ok: false, text: OLD_LIST, recheck: !entry?.skipped };
    if (oldPrice) return { ok: false, text: oldPriceText(ctx.maxPriceAgeMs), recheck: !entry?.skipped };
    return { ok: true };
  }
  return { ok: false, text: CHECKING_NOTE, recheck: !entry?.checking };
}

/** ¿Conviene pedir otra revisión de este video? (sin respuesta, o una de hace más de `after`). Puro. */
export function wantsRecheck(entry: LiveEntry | undefined, now: number, after: number): boolean {
  if (entry?.skipped || entry?.checking) return false;
  const result = entry?.result;
  // Un precio que ya cambió no vuelve atrás con otra revisión: hay que actualizar la lista.
  if (result && (result.check.status === 'changed' || result.check.status === 'unavailable')) return false;
  return !result || now - result.at > after;
}

/**
 * ¿Es una respuesta que se puede mostrar? Llega del servidor: no se da por
 * sentado. La misma regla que Historias (readLiveCheck): un "cambió" sin el
 * precio nuevo no se muestra. Puro.
 */
export function isLiveCheck(value: unknown): value is LiveCheck {
  return value !== null && typeof value === 'object' && readLiveCheck(value) === value;
}

/** Lo que la revisión le pide al resto de la página. */
export interface LiveCheckerDeps {
  /** La acción del servidor (checkLivePrices). */
  check(items: { productId: string; shown: ShownOffer }[]): Promise<Record<string, LiveCheck>>;
  now(): number;
  /** Lo que se sabe ahora, para dibujarlo (el setState de la lista). */
  publish(entries: Record<string, LiveEntry>): void;
  /** Llegó la respuesta de estos videos. */
  settled(videoIds: string[]): void;
  /** Corre `run` en `ms` (el plazo de la llamada). Por omisión, setTimeout. */
  later?: (run: () => void, ms: number) => void;
}

/** Lo que las reglas de los toques usan de la revisión. */
export interface LiveSource {
  entry(videoId: string): LiveEntry | undefined;
  /** Pide revisar estos videos; no espera la respuesta. */
  recheck(videoIds: string[]): void;
}

export interface LiveChecker extends LiveSource {
  entries(): Record<string, LiveEntry>;
  /** La lista está en pantalla: revisa lo que todavía no tiene respuesta. */
  start(): void;
  /** La lista salió de pantalla: lo que llegue después no se dibuja. */
  stop(): void;
  /** Se volvió a la pestaña: revisa todo si la última revisión tiene más de 5 minutos. */
  visible(): void;
  /** Cada medio minuto con la pestaña a la vista: revisa todo antes de que el "mismo precio" venza. */
  tick(): void;
}

/**
 * La revisión en vivo de una lista: de a una llamada a la vez, con lo que
 * muestra cada video. Lo que se pide mientras otra viaja espera a que esa
 * termine, salvo que ya vaya en ella. Si la llamada falla, esos videos quedan
 * en "no pude revisar" (la regla de siempre), nunca en "mismo precio".
 */
export function createLiveChecker(
  videos: ReadyVideo[],
  targets: { check: string[]; skip: string[] },
  deps: LiveCheckerDeps
): LiveChecker {
  const offers = new Map<string, ShownOffer>();
  for (const video of videos) offers.set(video.id, shownOffer(video));
  const entries: Record<string, LiveEntry> = {};
  for (const id of targets.skip) entries[id] = { result: null, checking: false, skipped: true };
  const checkable = (id: string) => offers.has(id) && !entries[id]?.skipped;

  let alive = true;
  let running: string[] | null = null;
  let queued: string[] = [];

  const emit = () => {
    if (alive) deps.publish({ ...entries });
  };

  function run(ids: string[]) {
    const wanted = ids.filter((id, i) => checkable(id) && ids.indexOf(id) === i);
    if (running) {
      const busy = running;
      for (const id of wanted) if (busy.indexOf(id) < 0 && queued.indexOf(id) < 0) queued.push(id);
      return;
    }
    const batch = wanted.slice(0, MAX_LIVE_ITEMS);
    if (batch.length === 0) return;
    // Lo que no cabe en una llamada espera la siguiente, igual que Historias con sus tandas.
    for (const id of wanted.slice(MAX_LIVE_ITEMS)) if (queued.indexOf(id) < 0) queued.push(id);
    running = batch;
    for (const id of batch) entries[id] = { result: entries[id]?.result ?? null, checking: true };
    emit();

    const items = batch.map((id) => ({ productId: id, shown: offers.get(id) as ShownOffer }));
    // Una falla al llamar, una respuesta rara o una conexión que se cayó no
    // dejan a nadie en "revisando" para siempre: pasado el plazo, "no pude revisar".
    const later = deps.later ?? ((run: () => void, ms: number) => void setTimeout(run, ms));
    const call = Promise.race([
      (async () => deps.check(items))().catch(() => null),
      new Promise<null>((resolve) => later(() => resolve(null), CALL_TIMEOUT_MS)),
    ]);
    void call.then((answer) => {
      const at = deps.now();
      for (const id of batch) {
        const got: unknown = answer && typeof answer === 'object' ? (answer as Record<string, unknown>)[id] : undefined;
        const check: LiveCheck = isLiveCheck(got) ? got : { status: 'unknown', what: CALL_FAILED };
        entries[id] = { result: { check, at }, checking: false };
      }
      running = null;
      emit();
      if (alive) deps.settled(batch);
      if (queued.length > 0) {
        const next = queued;
        queued = [];
        run(next);
      }
    });
  }

  /** La respuesta más vieja de la lista, o null si a alguno le falta la primera. */
  function oldest(): number | null {
    let min = Infinity;
    for (const id of targets.check) {
      const result = entries[id]?.result;
      if (!result) return null;
      if (result.at < min) min = result.at;
    }
    return min;
  }

  function staleSince(ms: number): boolean {
    if (targets.check.length === 0) return false;
    const at = oldest();
    return at === null || deps.now() - at > ms;
  }

  return {
    entry: (videoId) => entries[videoId],
    entries: () => ({ ...entries }),
    recheck: (videoIds) => run(videoIds),
    start() {
      alive = true;
      if (targets.check.some((id) => !entries[id]?.result)) run(targets.check);
      else emit();
    },
    stop() {
      alive = false;
    },
    visible() {
      if (staleSince(RECHECK_AFTER_MS)) run(targets.check);
    },
    tick() {
      if (staleSince(AUTO_RECHECK_MS)) run(targets.check);
    },
  };
}

/** La marca más nueva de un video, en milisegundos; 0 si no tiene. Puro. */
function newestMark(posted: PostedByNetwork | undefined): number {
  let newest = 0;
  for (const mark of Object.values(posted ?? {})) {
    const at = mark ? new Date(mark.at).getTime() : NaN;
    if (Number.isFinite(at) && at > newest) newest = at;
  }
  return newest;
}

/**
 * Qué videos se revisan en vivo: todos los de la lista, menos los que ya
 * están en las cuatro redes desde hace más de un día (no se van a subir de
 * nuevo). Como mucho lo que acepta una llamada. Puro.
 */
export function liveTargets(
  videos: ReadyVideo[],
  posted: Record<string, PostedByNetwork>,
  isEverywhere: (posted: PostedByNetwork | undefined) => boolean,
  now: number
): { check: string[]; skip: string[] } {
  const check: string[] = [];
  const skip: string[] = [];
  for (const video of videos) {
    const marks = posted[video.id];
    if (isEverywhere(marks) && now - newestMark(marks) > POSTED_LONG_AGO_MS) skip.push(video.id);
    else if (check.length < MAX_LIVE_ITEMS) check.push(video.id);
  }
  return { check, skip };
}
