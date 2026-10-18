import { liveChangedText } from '@/lib/social/live-price';
import type { CarouselEntry } from '@/lib/social/carousel';
import { liveLine, shareGate, type BlockKind, type CardCheck, type CheckTarget, type LiveLine } from '../rules';

/**
 * Las reglas de /admin/historias/carrusel que dependen de la revisión en
 * vivo: qué dice cada producto junto a su precio y si se puede compartir o
 * guardar el carrusel. Son las mismas de Historias (../rules), con dos
 * diferencias: el carrusel se sube entero, así que basta que un producto no
 * pase para que no se suba ninguno; y la lámina no dibuja el precio sin
 * descuento, así que un cambio solo en esa cifra no cuenta.
 *
 * Puro y sin React: lo usan la página, sus toques (./gestures) y los tests.
 */

/** Lo que la lámina de un producto dibuja: con eso se compara en Mercado Libre. */
export function carouselTargets(entries: CarouselEntry[]): CheckTarget[] {
  return entries.map((e) => ({
    productId: e.id,
    shown: { price: e.price, listPrice: e.listPrice, freeShipping: e.freeShipping, full: e.full },
  }));
}

/**
 * La revisión de un producto, sin lo que la lámina no muestra: si Mercado
 * Libre cambió solo el precio sin descuento (o el descuento), para el
 * carrusel es el mismo precio. Puro.
 */
export function relevantCheck(
  check: CardCheck | undefined,
  entry: Pick<CarouselEntry, 'price' | 'freeShipping' | 'full'>
): CardCheck | undefined {
  const last = check?.last;
  if (!check || !last || last.result.status !== 'changed') return check;
  const r = last.result;
  if (r.price !== entry.price || r.freeShipping !== entry.freeShipping || r.full !== entry.full) return check;
  return { ...check, last: { ...last, result: { status: 'same', checkedAt: r.checkedAt } } };
}

/** La línea junto al precio de cada producto: la de Historias, diciendo "no lo subas" (el carrusel). Pura. */
export function carouselLine(check: CardCheck | undefined, now: number, hasButton: boolean): LiveLine {
  const line = liveLine(check, now, hasButton);
  const r = check?.last?.result;
  if (line.tone === 'bad' && r && (r.status === 'changed' || r.status === 'unavailable')) {
    return { ...line, text: `✗ ${liveChangedText(r, 'lo')}` };
  }
  return line;
}

/** ¿Se puede compartir o guardar el carrusel ahora? */
export type CarouselGate =
  | { ok: true; caution: string | null }
  | { ok: false; kind: BlockKind; message: string; recheck: boolean; rank: number };

export interface CarouselGateContext {
  now: number;
  /** Cuándo se vio esta página por primera vez en este teléfono. */
  openedAt: number;
  maxPriceAgeMs: number;
}

/** Del bloqueo más importante al menos: lo que cambió manda sobre lo que hay que esperar. */
const BLOCK_ORDER: BlockKind[] = ['changed', 'old-list', 'old-price', 'stale', 'checking'];

/**
 * El carrusel sale entero: se deja compartir solo si cada producto pasa la
 * regla de Historias (shareGate). Si uno no pasa, se dice cuál y por qué. Si
 * alguno no se pudo revisar en vivo y vale la regla de antes, se deja con el
 * aviso ámbar. Pura.
 */
export function carouselGate(
  entries: CarouselEntry[],
  checkOf: (productId: string) => CardCheck | undefined,
  ctx: CarouselGateContext
): CarouselGate {
  let worst: Extract<CarouselGate, { ok: false }> | null = null;
  let caution: string | null = null;
  for (const entry of entries) {
    const gate = shareGate(relevantCheck(checkOf(entry.id), entry), {
      now: ctx.now,
      openedAt: ctx.openedAt,
      checkedAt: entry.checkedAt,
      maxPriceAgeMs: ctx.maxPriceAgeMs,
    });
    if (gate.ok) {
      caution ??= gate.caution;
      continue;
    }
    const r = checkOf(entry.id)?.last?.result;
    const message =
      gate.kind === 'changed' && r && (r.status === 'changed' || r.status === 'unavailable')
        ? `El #${entry.rank} (${entry.name}): ${liveChangedText(r, 'lo')}`
        : gate.kind === 'old-price'
          ? `El precio del #${entry.rank} se revisó hace más de ${Math.round(ctx.maxPriceAgeMs / 3_600_000)} horas. Toca Actualizar, arriba.`
          : gate.message;
    const blocked = { ok: false as const, kind: gate.kind, message, recheck: gate.recheck, rank: entry.rank };
    if (!worst || BLOCK_ORDER.indexOf(blocked.kind) < BLOCK_ORDER.indexOf(worst.kind)) worst = blocked;
    // Si alguno pide revisar otra vez, se pide (una sola revisión cubre todos).
    if (gate.recheck) worst = { ...worst, recheck: true };
  }
  return worst ?? { ok: true, caution };
}

/** Lo que tapa las miniaturas cuando no se debe subir, para no invitar a guardarlas con el dedo. null deja verlas. */
export function carouselCover(gate: CarouselGate): string | null {
  if (gate.ok) return null;
  if (gate.kind === 'changed') return `El #${gate.rank} cambió en Mercado Libre: no lo guardes ni lo subas.`;
  if (gate.kind === 'old-list' || gate.kind === 'old-price') return 'Toca Actualizar antes de guardarlo.';
  return null;
}
