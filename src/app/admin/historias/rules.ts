import { formatPrice } from '@/lib/content/captions';
import {
  LIVE_CHECK_MAX_ITEMS,
  LIVE_LINE,
  LIVE_RECHECK_AFTER_MS,
  LIVE_SAME_MAX_AGE_MS,
  LIVE_TEXT,
  asSentence,
  liveChangedText,
  minutesAgo,
  postedPriceShift,
  staleSameLine,
  type LiveCheck,
  type ShownOffer,
} from '@/lib/social/live-price';
import type { PostedStory, StoryItem } from '@/lib/social/stories';

// Los mismos textos y ayudas que Videos: viven en lib/social/live-price.
export { minutesAgo, safeMlUrl } from '@/lib/social/live-price';

/**
 * Las reglas de /admin/historias que dependen de la revisión en vivo en
 * Mercado Libre: qué dice cada tarjeta cerca del precio, cuándo se deja
 * compartir o guardar la imagen, qué avisa una historia ya subida y en qué
 * grupo va cada oferta.
 *
 * Puro y sin React: lo usan la lista, las reglas de los toques (./gestures)
 * y los tests, con la misma salida para la misma entrada.
 */

/** Pasado este rato hay que recargar si no se pudo revisar en Mercado Libre. */
export const LIST_MAX_AGE_MS = 60 * 60_000;
/** Una revisión "mismo precio" deja subir la historia durante este rato (15 minutos). */
export const SAME_MAX_AGE_MS = LIVE_SAME_MAX_AGE_MS;
/** Al volver a la pestaña se revisa de nuevo si la última revisión tiene más que esto (5 minutos). */
export const RECHECK_AFTER_MS = LIVE_RECHECK_AFTER_MS;
/** Lo que acepta la acción del servidor en una llamada (16). */
export const CHECK_BATCH_SIZE = LIVE_CHECK_MAX_ITEMS;

/** Lo que se sabe de la revisión en vivo de un producto. */
export interface CardCheck {
  /** La última respuesta y cuándo llegó (reloj de este teléfono), o null si todavía no llega ninguna. */
  last: { result: LiveCheck; at: number } | null;
  /** Hay una revisión viajando. */
  pending: boolean;
}

/** Lo que se le pide revisar al servidor por cada tarjeta. */
export interface CheckTarget {
  productId: string;
  shown: ShownOffer;
}

export const CHECKING_LINE: string = LIVE_LINE.checking;
export const UNKNOWN_LINE: string = LIVE_LINE.unknown;
/** Lo mismo, cuando la tarjeta no tiene botón (falta el producto de Mercado Libre). */
export const UNKNOWN_LINE_NO_BUTTON: string = LIVE_LINE.unknownNoButton;
/** Lo que vale una revisión que no llegó (se cortó, falló la conexión o vino algo que no se entiende). */
export const NOT_CHECKED: string = LIVE_TEXT.mlDown;

export const CHECKING_WAIT = 'Estoy revisando el precio en Mercado Libre. Espera unos segundos y toca otra vez.';
export const STALE_SAME =
  'La revisión en Mercado Libre tiene más de 15 minutos. La estoy repitiendo: toca otra vez en unos segundos.';
export const OLD_LIST =
  'Esta lista tiene más de una hora y no pude revisar el precio en Mercado Libre. Toca Actualizar, arriba.';

/** Lo que dice una tarjeta cuya revisión encontró otra cosa en Mercado Libre. Puro. */
export function changedText(result: Extract<LiveCheck, { status: 'changed' | 'unavailable' }>): string {
  return liveChangedText(result, 'la');
}

export function oldPriceText(maxPriceAgeMs: number): string {
  const hours = Math.round(maxPriceAgeMs / 3_600_000);
  return `El precio de esta oferta se revisó hace más de ${hours} horas. Toca Actualizar, arriba.`;
}

export type LineTone = 'checking' | 'same' | 'bad' | 'unknown';

/** La línea de estado de la tarjeta, cerca del precio. */
export interface LiveLine {
  tone: LineTone;
  text: string;
  /** Lo que respondió el servidor cuando no pudo revisar, si dice algo más. */
  detail: string | null;
}

/** Lo que dice la tarjeta cerca del precio según la revisión en vivo. Puro. */
export function liveLine(check: CardCheck | undefined, now: number, hasButton: boolean = true): LiveLine {
  const last = check?.last ?? null;
  const checking: LiveLine = { tone: 'checking', text: CHECKING_LINE, detail: null };
  if (!last) return checking;
  const r = last.result;
  // Un cambio se sigue mostrando mientras se repite la revisión: es lo seguro.
  if (r.status === 'changed' || r.status === 'unavailable') return { tone: 'bad', text: `✗ ${changedText(r)}`, detail: null };
  const age = now - last.at;
  if (check?.pending && (r.status === 'unknown' || age > SAME_MAX_AGE_MS)) return checking;
  if (r.status === 'same') {
    // Vencido ya no deja subir: no va en verde, aunque haya sido el mismo precio.
    if (age > SAME_MAX_AGE_MS) return { tone: 'unknown', text: staleSameLine(age), detail: null };
    return { tone: 'same', text: `✓ Mismo precio que en Mercado Libre (${minutesAgo(age)})`, detail: null };
  }
  const what = asSentence(r.what);
  return {
    tone: 'unknown',
    text: hasButton ? UNKNOWN_LINE : UNKNOWN_LINE_NO_BUTTON,
    detail: what && what !== NOT_CHECKED ? what : null,
  };
}

export type BlockKind = 'checking' | 'stale' | 'changed' | 'old-list' | 'old-price';

/** ¿Se puede compartir o guardar la imagen ahora? */
export type Gate =
  | { ok: true; caution: string | null }
  | {
      ok: false;
      kind: BlockKind;
      message: string;
      /** Conviene pedir otra revisión (sin esperarla: nunca dentro del toque de Compartir). */
      recheck: boolean;
    };

export interface GateContext {
  now: number;
  /** Cuándo se vio esta lista por primera vez en este teléfono. */
  openedAt: number;
  /** Cuándo revisó el sitio el precio que lleva la tarjeta. */
  checkedAt: string | null;
  maxPriceAgeMs: number;
}

/**
 * Compartir y Guardar: con "mismo precio" de hace 15 minutos o menos, sí; si
 * Mercado Libre muestra otra cosa, no; si no se pudo revisar, la regla de
 * antes (lista de una hora o menos y precio revisado en las últimas 6 horas),
 * con el aviso ámbar. Sin respuesta todavía, se espera. Puro.
 */
export function shareGate(check: CardCheck | undefined, ctx: GateContext): Gate {
  const last = check?.last ?? null;
  const pending = Boolean(check?.pending);
  if (!last) return { ok: false, kind: 'checking', message: CHECKING_WAIT, recheck: !pending };

  const r = last.result;
  if (r.status === 'changed' || r.status === 'unavailable') {
    return { ok: false, kind: 'changed', message: changedText(r), recheck: false };
  }
  if (r.status === 'same') {
    if (ctx.now - last.at <= SAME_MAX_AGE_MS) return { ok: true, caution: null };
    return pending
      ? { ok: false, kind: 'checking', message: CHECKING_WAIT, recheck: false }
      : { ok: false, kind: 'stale', message: STALE_SAME, recheck: true };
  }

  // No se pudo revisar: valen las reglas de antes, por separado y cada una con su mensaje.
  if (ctx.now - ctx.openedAt > LIST_MAX_AGE_MS) return { ok: false, kind: 'old-list', message: OLD_LIST, recheck: !pending };
  const checkedAt = ctx.checkedAt ? new Date(ctx.checkedAt).getTime() : NaN;
  if (Number.isFinite(checkedAt) && ctx.now - checkedAt > ctx.maxPriceAgeMs) {
    return { ok: false, kind: 'old-price', message: oldPriceText(ctx.maxPriceAgeMs), recheck: !pending };
  }
  return { ok: true, caution: UNKNOWN_LINE };
}

/**
 * Lo que tapa la miniatura cuando no se debe subir: así no invita a
 * guardarla manteniendo el dedo encima. null deja la imagen a la vista. Puro.
 */
export function coverText(gate: Gate): string | null {
  if (gate.ok) return null;
  if (gate.kind === 'changed') return 'Cambió en Mercado Libre: no la guardes ni la subas.';
  if (gate.kind === 'old-list' || gate.kind === 'old-price') return 'Toca Actualizar antes de guardarla.';
  return null;
}

/** El aviso de una historia ya subida: rojo si engaña (más cara o ya no se vende), suave si bajó. */
export interface PostedAlert {
  tone: 'bad' | 'info';
  text: string;
}

/**
 * Lo que avisa una historia ya subida a Instagram cuyo precio ya no es el que
 * dice: el de la revisión en vivo si encontró otro, o el de la base. En rojo
 * si ahora está más cara (1% o más) o ya no se vende: la historia promete
 * algo que no existe. Sin rojo si bajó 3% o más: no engaña, y la oferta
 * vuelve arriba para subirla de nuevo. null si no cambió lo suficiente. Puro.
 */
export function postedAlert(
  item: Pick<PostedStory, 'price' | 'postedPrice'> & { onSale?: boolean },
  check: CardCheck | undefined
): PostedAlert | null {
  const r = check?.last?.result;
  const said = item.postedPrice !== null && item.postedPrice > 0 ? formatPrice(item.postedPrice) : null;
  if (item.onSale === false || r?.status === 'unavailable') {
    return {
      tone: 'bad',
      text: said
        ? `Tu historia en Instagram dice ${said} y ya no está a la venta: bórrala.`
        : 'El producto de tu historia en Instagram ya no está a la venta: bórrala.',
    };
  }
  if (!said || item.postedPrice === null) return null;
  const now = r?.status === 'changed' ? r.price : item.price;
  const shift = postedPriceShift(item.postedPrice, now);
  if (shift === 'higher') {
    return {
      tone: 'bad',
      text: `Tu historia en Instagram dice ${said} y ahora está más cara, a ${formatPrice(now)}: bórrala o súbela de nuevo.`,
    };
  }
  if (shift === 'lower') {
    return {
      tone: 'info',
      text: `Tu historia dice ${said} y ahora está más barata, a ${formatPrice(now)}: puedes subirla de nuevo con la imagen de ahora.`,
    };
  }
  return null;
}

/**
 * Las ofertas en sus grupos, sin tocar el orden de cada uno: primero las que
 * bajaron desde que se subieron, después las de ahora, y al final las que
 * traen un "Ojo" (aunque hayan bajado). Puro.
 */
export function groupOffers(items: StoryItem[]): { again: StoryItem[]; fresh: StoryItem[]; warned: StoryItem[] } {
  const again: StoryItem[] = [];
  const fresh: StoryItem[] = [];
  const warned: StoryItem[] = [];
  for (const item of items) {
    if (item.warning) warned.push(item);
    else if (item.again) again.push(item);
    else fresh.push(item);
  }
  return { again, fresh, warned };
}

/** Lo que la tarjeta muestra y la pieza lleva dibujado: con eso se compara en Mercado Libre. Puro. */
export function shownOf(item: StoryItem): ShownOffer {
  return { price: item.price, listPrice: item.listPrice, freeShipping: item.freeShipping, full: item.full };
}

/**
 * Lo que se revisa: todas las ofertas y las historias ya subidas que siguen
 * vivas en Instagram (24 horas) y a la venta, una vez por producto y las
 * ofertas primero. Una ya subida que no se vende ya se sabe: no se pregunta. Puro.
 */
export function checkTargets(items: StoryItem[], posted: PostedStory[], now: number, lifetimeMs: number): CheckTarget[] {
  const seen = new Set<string>();
  const targets: CheckTarget[] = [];
  const add = (item: StoryItem) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    targets.push({ productId: item.id, shown: shownOf(item) });
  };
  items.forEach(add);
  for (const story of posted) {
    if (story.onSale === false) continue;
    const at = new Date(story.postedAt).getTime();
    if (Number.isFinite(at) && now - at <= lifetimeMs) add(story);
  }
  return targets;
}

/** En tandas del tamaño que acepta el servidor, en el mismo orden. Puro. */
export function inBatches<T>(list: T[], size: number = CHECK_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < list.length; i += size) batches.push(list.slice(i, i + size));
  return batches;
}

/** Cuántas ofertas más esperan, dicho para el dueño. Puro. */
export function waitingText(waiting: number, repeatAfterDays: number): string {
  if (!Number.isFinite(waiting) || waiting <= 0) {
    return `Ahora no hay más ofertas esperando: aparecen nuevas cuando cambian los precios o cuando se cumplen ${repeatAfterDays} días de una historia ya subida.`;
  }
  if (waiting === 1) return 'Hay 1 oferta más esperando: marca las que ya subiste y toca Actualizar para verla.';
  return `Hay ${Math.floor(waiting)} ofertas más esperando: marca las que ya subiste y toca Actualizar para verlas.`;
}
