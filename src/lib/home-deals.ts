/**
 * Qué ofertas encabezan la portada.
 *
 * Antes iba primero la de mayor baja o, si no había, la de más descuento
 * sobre el precio de lista, y ahí se quedaba hasta que apareciera otra. Así
 * terminó arriba un cargador de $7.990 con "60% de descuento" que veinte
 * vendedores se peleaban: cuando alguien lo abría, en Mercado Libre ya tenía
 * otro precio.
 *
 * Ahora el bloque lo encabeza un grupo chico elegido con el puntaje de
 * interés (lib/social/interest), y solo entre las ofertas que además pasan
 * estas reglas, pensadas para que el precio que se ve siga siendo cierto:
 *
 *   - nada que mirar a mano: ni excluida, ni con aviso, ni bajo el piso de puntos;
 *   - precio revisado hace menos de dos horas: si la revisión se atrasa, no
 *     se destaca nada viejo;
 *   - precio quieto: a lo más un cambio en 48 horas y sin ir y volver entre
 *     los mismos valores;
 *   - en su precio más bajo: no encabeza algo que el sitio anotó más barato
 *     (por seis horas o más) en los últimos 30 días, aunque sea por poco. De
 *     lo que no quedó anotado no se puede responder: por eso tampoco encabeza
 *     un producto cuyo único cambio conocido es de hace menos de dos días;
 *   - pocos vendedores en la ficha: con muchos, la caja de compra cambia de
 *     manos, y de precio, varias veces al día;
 *   - con el historial leído: si hoy no se pudo leer, no se sabe nada de lo
 *     anterior y no encabeza.
 *
 * Medido el 12-10-2026 sobre el catálogo: con un solo vendedor el precio
 * cambia unas 0,6 veces cada 48 horas; con cuatro o más, entre 1,4 y 3,9. Que
 * lleve horas quieto casi no predice nada: por eso se mira cuántos venden y
 * no solo el historial.
 *
 * La primera va rotando: cada hora encabeza otra del grupo, y a la misma hora
 * del día siguiente, otra distinta. Sin azar, porque la portada se regenera
 * cada minuto o poco más y dentro de la misma hora tiene que salir igual
 * mientras el grupo no cambie (si una deja de calificar, el turno pasa a la
 * que quedó en su puesto).
 *
 * Puro: sin I/O, y la hora llega por parámetro.
 */

import { estimateCommission } from '@/lib/commission';
import { discountOf, rankDeals } from '@/lib/deal-rank';
import type { PriceStats } from '@/lib/deals';
import { interestEvidence } from '@/lib/social/evidence';
import {
  interestScore,
  meetsInterestFloor,
  pickVaried,
  type InterestProduct,
  type InterestScore,
} from '@/lib/social/interest';

/** Lo que la selección necesita del producto, además de lo que mira el puntaje. */
export interface HomeDealProduct extends InterestProduct {
  /** Última vez que se comparó el precio contra la ficha de Mercado Libre. */
  price_checked_at?: string | null;
  /** Cuándo se agregó al sitio: dice si el primer registro del historial es su precio de partida. */
  created_at?: string | null;
  offer_info?: (NonNullable<InterestProduct['offer_info']> & { offers_count?: number | null }) | null;
}

/** La destacada más las ocho tarjetas que la siguen. */
export const HOME_DEALS_SIZE = 9;

/** Cuántas ofertas se turnan el primer lugar. */
export const HOME_LEAD_ROTATION = 6;

/** Los precios se revisan cada 30 minutos: dos horas son varias revisiones perdidas. */
const FRESH_CHECK_MS = 2 * 3_600_000;

/** Los relojes de la base de datos y del servidor no marcan lo mismo al segundo. */
const CLOCK_SKEW_MS = 5 * 60_000;

const MAX_RECENT_CHANGES = 1;
const MAX_SELLERS = 3;
const HOUR_MS = 3_600_000;

/** Que el bloque no sea una sola vitrina: categorías, tipos y marcas repartidos. */
const VARIETY = { perCategory: 3, perType: 1, perBrand: 2 };

/** La regla que le impide a una oferta encabezar la portada. */
export type LeadBlocker =
  | 'excluded'
  | 'low-interest'
  | 'history-unread'
  | 'warning'
  | 'stale-check'
  | 'recent-changes'
  | 'seesaw'
  | 'above-minimum'
  | 'many-sellers';

function checkedRecently(checkedAt: string | null | undefined, now: number): boolean {
  if (!checkedAt) return false;
  const age = now - new Date(checkedAt).getTime();
  // Una fecha del futuro no es una revisión: es un dato malo.
  return age < FRESH_CHECK_MS && age > -CLOCK_SKEW_MS;
}

/**
 * Por qué esta oferta no puede encabezar la portada, o null si puede.
 *
 * Sin historial se permite: el puntaje ya le dio menos por no tenerlo. Lo
 * mismo si Mercado Libre no informó cuántos vendedores hay. `unread` es otra
 * cosa: el historial no se pudo leer, y entonces no encabeza.
 */
export function leadBlocker(
  product: HomeDealProduct,
  score: InterestScore,
  stats: PriceStats | null | undefined,
  now: number,
  unread: boolean = false
): LeadBlocker | null {
  return blockerOf(product, score, stats, now, unread, false);
}

/** `ignoreCheckAge`: sin mirar hace cuánto se revisó el precio, para saber si es lo único que falla. */
function blockerOf(
  product: HomeDealProduct,
  score: InterestScore,
  stats: PriceStats | null | undefined,
  now: number,
  unread: boolean,
  ignoreCheckAge: boolean
): LeadBlocker | null {
  if (score.excluded !== null) return 'excluded';
  // Las comparaciones van negadas a propósito: un número que no es válido no pasa.
  // El piso es el mismo de las redes y se mide igual, sin las señales.
  if (!meetsInterestFloor(score)) return 'low-interest';
  if (unread) return 'history-unread';
  if (score.warning !== null) return 'warning';
  if (!ignoreCheckAge && !checkedRecently(product.price_checked_at, now)) return 'stale-check';

  if (stats) {
    // Las mismas cuentas que usan las redes (lib/social/evidence), con una vara más alta.
    const seen = interestEvidence(product, stats, now, unread);
    if (!((seen.recentChanges ?? 0) <= MAX_RECENT_CHANGES)) return 'recent-changes';
    // Cambió hace poco y no quedó anotado desde qué precio: pudo subir.
    if (seen.changedFromUnknown === true) return 'recent-changes';
    if (seen.seesaw === true) return 'seesaw';
    // El puntaje perdona hasta 3% sobre el mínimo; para ir primero, nada.
    if (seen.min30 !== null && product.price > seen.min30) return 'above-minimum';
  }

  const sellers = product.offer_info?.offers_count;
  if (typeof sellers === 'number' && sellers > MAX_SELLERS) return 'many-sellers';
  return null;
}

export interface HomeDeals<T> {
  /** La que encabeza. null si ninguna oferta pasa las reglas. */
  spotlight: T | null;
  /** El bloque en el orden en que se muestra. Si hay destacada, es la primera. */
  block: T[];
}

interface Candidate<T> {
  id: string;
  category: string;
  familyId: string | null;
  commission: number;
  score: InterestScore;
  product: T;
  blocker: LeadBlocker | null;
  /** Pasaría todas las reglas si la revisión de precios estuviera al día. */
  lateOnly: boolean;
}

/**
 * El bloque de ofertas de la portada.
 *
 * Primero van las que pueden encabezar, con variedad, y entre las primeras
 * se turnan el primer lugar por hora. Si no alcanzan a llenar el bloque, se
 * completa en tres pasos: las que solo fallan porque la revisión de precios
 * viene atrasada (siguen siendo las mismas ofertas buenas); después las
 * siguientes por interés que no estén excluidas (ahí sí entran las que llevan
 * aviso, tienen muchos vendedores o cambiaron de precio hace poco); y, si
 * todavía falta, el orden de /ofertas: mejor una tarjeta floja que un bloque
 * a medias. El primer lugar no se rellena nunca.
 *
 * `unread`: las ofertas cuyo historial no se pudo leer. No encabezan y solo
 * entran después de todas las que sí se leyeron. No muta la entrada ni
 * depende de su orden.
 * `scoreOf` reemplaza el puntaje (lo usan los tests).
 */
export function selectHomeDeals<T extends HomeDealProduct>(
  deals: T[],
  stats: Map<string, PriceStats>,
  now: number,
  options: { size?: number; unread?: ReadonlySet<string>; scoreOf?: (product: T) => InterestScore } = {}
): HomeDeals<T> {
  const size = options.size ?? HOME_DEALS_SIZE;
  const isUnread = (id: string) => options.unread?.has(id) === true;
  const scoreOf =
    options.scoreOf ??
    ((product: T) =>
      interestScore(product, interestEvidence(product, stats.get(product.id), now, isUnread(product.id))));

  // Orden de partida fijo, para que el resultado no dependa de cómo llegó la
  // lista: por descuento, que es como la entrega getDeals y como la espera rankDeals.
  const base = [...deals].sort(
    (a, b) => discountOf(b) - discountOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );

  const candidates = base.map((product): Candidate<T> => {
    const score = scoreOf(product);
    const history = stats.get(product.id);
    const blocker = blockerOf(product, score, history, now, isUnread(product.id), false);
    return {
      id: product.id,
      category: product.category,
      familyId: product.ml_family_id ?? null,
      commission: estimateCommission(product.price, product.ml_root_category ?? null),
      score,
      product,
      blocker,
      lateOnly: blocker === 'stale-check' && blockerOf(product, score, history, now, isUnread(product.id), true) === null,
    };
  });

  const leaders = pickVaried(
    candidates.filter((c) => c.blocker === null),
    { max: size, ...VARIETY }
  );

  const block: T[] = [];
  const taken = new Set<string>();
  const append = (products: T[]) => {
    for (const product of products) {
      if (block.length >= size) return;
      if (taken.has(product.id)) continue;
      taken.add(product.id);
      block.push(product);
    }
  };

  let spotlight: T | null = null;
  if (leaders.length > 0) {
    const turns = Math.min(leaders.length, HOME_LEAD_ROTATION);
    const hours = Math.floor(now / HOUR_MS);
    const days = Math.floor(hours / 24);
    // El turno lo da la hora del día, y cada día parte un puesto más allá:
    // con seis que se turnan y 24 horas, sin ese corrimiento a la misma hora
    // encabezaría todos los días la misma.
    const first = leaders[((hours % 24) + days) % turns];
    spotlight = first.product;
    append([first, ...leaders.filter((c) => c !== first)].map((c) => c.product));
  }

  if (block.length < size) {
    // Con la revisión atrasada no hay destacada, pero el bloque no tiene por
    // qué abrirse a fichas de precio movido: primero las que pasarían todo
    // lo demás.
    const late = pickVaried(
      candidates.filter((c) => !taken.has(c.id) && c.lateOnly),
      { max: size - block.length, ...VARIETY }
    );
    append(late.map((c) => c.product));
  }

  if (block.length < size) {
    // pickVaried ya deja fuera las excluidas. El piso de puntos no corre acá:
    // lo que queda bajo el piso igual va antes que el orden por descuento.
    const fill = pickVaried(
      candidates.filter((c) => !taken.has(c.id) && !isUnread(c.id)),
      { max: size - block.length, ...VARIETY, minPoints: -Infinity }
    );
    append(fill.map((c) => c.product));
  }

  if (block.length < size) {
    // Si el historial no se pudo leer (de algunas o de todas), antes que el
    // orden por descuento de lista van esas mismas por interés: sin
    // historial el puntaje sabe menos, pero sigue sabiendo qué es cada cosa.
    const blind = pickVaried(
      candidates.filter((c) => !taken.has(c.id) && isUnread(c.id)),
      { max: size - block.length, ...VARIETY, minPoints: -Infinity }
    );
    append(blind.map((c) => c.product));
  }

  if (block.length < size) append(rankDeals(base, stats, now));

  return { spotlight, block };
}
