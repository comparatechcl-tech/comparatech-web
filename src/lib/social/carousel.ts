import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCarouselCaptions, type CarouselCaptions } from '@/lib/content/captions';
import { socialProductName } from '@/lib/content/social-name';
import { estimateCommission } from '@/lib/commission';
import { confirmedDrop, type ConfirmedDrop } from '@/lib/deal-rank';
import type { PriceStats } from '@/lib/deals';
import { getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { lastShownAt, readCarouselMarks, type CarouselBatch } from '@/lib/social/carousel-marks';
import {
  CAROUSEL_WINDOW_DAYS,
  addDays,
  carouselExpiry,
  carouselPath,
  carouselRangeLabel,
  chileDay,
  type CarouselKind,
  type CarouselSet,
} from '@/lib/social/carousel-url';
import { interestEvidence } from '@/lib/social/evidence';
import { interestScore, pickVaried, type InterestScore } from '@/lib/social/interest';
import { mlCheckUrl } from '@/lib/social/live-price';
import { NETWORK_RULES } from '@/lib/social/networks';
import {
  familyLowestPrices,
  isOnSale,
  pricierThanFamily,
  readFreshSocialProducts,
  selectSocialProducts,
  type SocialProduct,
} from '@/lib/social/telegram';

/**
 * El carrusel semanal "Top 5 bajas de la semana" para Instagram y Facebook,
 * que el dueño baja y sube a mano desde /admin/historias/carrusel.
 *
 * Solo bajas que confirma el historial propio (confirmedDrop, con todos sus
 * resguardos: un precio que va y vuelve, un "antes" que duró minutos o que no
 * quedó anotado no cuentan), de algún día de esta semana en Chile, y con lo
 * mismo que exige todo lo que se publica en redes: a la venta, precio
 * revisado hace 6 horas o menos, no más caro que otra versión del mismo
 * modelo, baja de 5% o más y el piso de interés. Lo que trae un aviso ("Ojo")
 * no entra: el carrusel sale entero. Van de la baja más grande a la más chica
 * (en pesos), con las reglas de variedad de siempre: dos por categoría, uno
 * por modelo y, si alcanza, uno por tipo y dos por marca.
 *
 * Si no hay cinco, no se rellena: sale con los que hay (Top 4, Top 3), y con
 * menos de tres no se arma.
 */

export const CAROUSEL_KIND: CarouselKind = 'bajas';

export const CAROUSEL_RULES = {
  /** El "Top 5". */
  size: 5,
  /** Con menos no se arma: una portada, dos láminas y el cierre no son un top. */
  minSize: 3,
  /** Días que mira, contando hoy (en Chile): la baja tiene que haber empezado en uno de ellos. */
  days: CAROUSEL_WINDOW_DAYS.bajas,
  perCategory: 2,
  /** Primera vuelta: uno por tipo y dos por marca. Si así no se llega a cinco, se sueltan (como en pickVaried). */
  perType: 1,
  perBrand: 2,
  /** La baja mínima de lo que se publica en redes sin descuento de lista. */
  minDropPct: NETWORK_RULES.minDrop,
  maxPriceAgeMs: NETWORK_RULES.maxPriceAgeMs,
  /** Uno por semana: después de publicar uno, el próximo se arma a los siete días (por fecha en Chile). */
  everyDays: 7,
};

export type CarouselRules = typeof CAROUSEL_RULES;

/** Un producto elegido, con su baja y su puntaje. */
export interface CarouselPick<T extends SocialProduct = SocialProduct> {
  product: T;
  drop: ConfirmedDrop;
  score: InterestScore;
}

export interface CarouselSelection<T extends SocialProduct = SocialProduct> {
  picks: CarouselPick<T>[];
  /** Cuántas bajas pasan todas las reglas, una por modelo, antes del cupo y de la variedad. */
  qualifying: number;
}

const ALL = Number.MAX_SAFE_INTEGER;

/**
 * Las bajas de la semana para el carrusel. Puro: recibe el historial ya
 * leído (`stats`) y, por producto, cuándo salió en un carrusel por última vez
 * (`shownAt`): la misma baja no vuelve a salir; si después bajó otra vez, sí.
 */
export function pickCarouselDrops<T extends SocialProduct>(
  rows: T[],
  stats: ReadonlyMap<string, PriceStats>,
  opts: { now: Date; shownAt?: ReadonlyMap<string, number> },
  rules: CarouselRules = CAROUSEL_RULES
): CarouselSelection<T> {
  const now = opts.now.getTime();
  const firstDay = addDays(chileDay(now), -(rules.days - 1));
  const familyLowest = familyLowestPrices(rows);

  type Candidate = {
    id: string;
    category: string;
    familyId: string | null;
    commission: number;
    score: InterestScore;
    pick: CarouselPick<T>;
  };
  const candidates: Candidate[] = [];
  for (const p of rows) {
    if (!isOnSale(p) || pricierThanFamily(p, familyLowest)) continue;
    const checked = p.price_checked_at ? new Date(p.price_checked_at).getTime() : NaN;
    if (!Number.isFinite(checked) || now - checked > rules.maxPriceAgeMs || checked > now + 60_000) continue;

    const history = stats.get(p.id);
    const drop = history ? confirmedDrop(p, history, now) : null;
    if (!history || !drop || !(drop.pct >= rules.minDropPct) || !(drop.amount > 0)) continue;
    const since = new Date(drop.since).getTime();
    if (!Number.isFinite(since) || since > now || chileDay(since) < firstDay) continue;
    const shown = opts.shownAt?.get(p.id);
    if (shown !== undefined && shown >= since) continue;

    const score = interestScore(p, interestEvidence(p, history, now));
    if (score.warning !== null) continue;
    candidates.push({
      id: p.id,
      category: p.category,
      familyId: p.ml_family_id ?? null,
      commission: estimateCommission(p.price, p.ml_root_category ?? null),
      score,
      pick: { product: p, drop, score },
    });
  }

  const byDrop = (a: Candidate, b: Candidate) =>
    b.pick.drop.amount - a.pick.drop.amount || b.pick.drop.pct - a.pick.drop.pct || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const picks = pickVaried(candidates, {
    max: rules.size,
    perCategory: rules.perCategory,
    perType: rules.perType,
    perBrand: rules.perBrand,
    order: byDrop,
  }).map((c) => c.pick);
  const qualifying = pickVaried(candidates, { max: ALL, perCategory: ALL, perType: ALL, perBrand: ALL, order: byDrop }).length;
  return { picks, qualifying };
}

// ---------------------------------------------------------------------------
// Lo que muestra el admin.

/** Una lámina para bajar: la dirección firmada (sin dominio) y el nombre del archivo. */
export interface CarouselSlideFile {
  image: string;
  fileName: string;
}

/** La lámina de un producto, con lo que la tarjeta del admin muestra y revisa en vivo. */
export interface CarouselEntry extends CarouselSlideFile {
  id: string;
  rank: number;
  slug: string;
  /** El nombre de redes: el mismo de la lámina y del texto. */
  name: string;
  brand: string | null;
  price: number;
  /**
   * El precio sin descuento que trae hoy la ficha, solo si es mayor que el
   * precio. La lámina no lo muestra: va para que la revisión en vivo compare
   * contra lo de ahora y no avise un cambio que no hubo.
   */
  listPrice: number | null;
  dropAmount: number;
  /** La baja en %, para el admin (la lámina dice el monto). */
  dropPct: number;
  /** Desde cuándo rige el precio de hoy. */
  since: string;
  checkedAt: string | null;
  freeShipping: boolean;
  full: boolean;
  /** La ficha de Mercado Libre sin parámetros de afiliado (mirar no cuenta como clic). */
  mlUrl: string | null;
}

export interface WeeklyCarousel {
  kind: CarouselKind;
  /** El día del carrusel en Chile (AAAAMMDD). */
  day: number;
  /** "del 12 al 18 de octubre". */
  rangeLabel: string;
  cover: CarouselSlideFile;
  entries: CarouselEntry[];
  closing: CarouselSlideFile;
  captions: CarouselCaptions;
}

const seconds = (iso: string | null | undefined) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) && t > 0 ? Math.floor(t / 1000) : 0;
};

/**
 * El carrusel listo para bajar: las direcciones firmadas de sus láminas, los
 * nombres de los archivos (en orden, para que la galería los deje en orden) y
 * los textos. null si no hay con qué armarlo (menos de `minSize`) o no se
 * pudo firmar alguna lámina. Puro.
 */
export function buildWeeklyCarousel(
  picks: CarouselPick[],
  opts: { now: Date; key: Buffer; siteUrl: string; minSize?: number }
): WeeklyCarousel | null {
  if (picks.length < (opts.minSize ?? CAROUSEL_RULES.minSize)) return null;
  const day = chileDay(opts.now);
  const set: CarouselSet = {
    kind: CAROUSEL_KIND,
    day,
    ids: picks.map((pick) => pick.product.id),
    expiresAt: carouselExpiry(opts.now),
  };
  const prefix = `comparatech-top${picks.length}-${String(day).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')}`;
  const last = picks.length + 1;

  const coverPath = carouselPath({ type: 'portada', set }, opts.key);
  const closingPath = carouselPath({ type: 'cierre', set }, opts.key);
  if (!coverPath || !closingPath) return null;

  const entries: CarouselEntry[] = [];
  for (const [i, pick] of picks.entries()) {
    const p = pick.product;
    const freeShipping = p.offer_info?.free_shipping === true;
    const full = p.offer_info?.is_full === true;
    const image = carouselPath(
      {
        type: 'producto',
        set,
        item: {
          rank: i + 1,
          price: Math.round(p.price),
          dropAmount: Math.round(pick.drop.amount),
          dropSince: seconds(pick.drop.since),
          checkedAt: seconds(p.price_checked_at),
          freeShipping,
          full,
        },
      },
      opts.key
    );
    if (!image) return null;
    const safeSlug = p.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '').slice(0, 60) || 'producto';
    entries.push({
      id: p.id,
      rank: i + 1,
      slug: p.slug,
      name: socialProductName(p),
      brand: p.brand,
      price: Math.round(p.price),
      listPrice: p.original_price && p.original_price > p.price ? Math.round(p.original_price) : null,
      dropAmount: Math.round(pick.drop.amount),
      dropPct: Math.round(pick.drop.pct),
      since: pick.drop.since,
      checkedAt: p.price_checked_at,
      freeShipping,
      full,
      image,
      fileName: `${prefix}-${i + 1}-${safeSlug}.jpg`,
      mlUrl: mlCheckUrl(p.ml_product_id),
    });
  }

  const rangeLabel = carouselRangeLabel(CAROUSEL_KIND, day);
  return {
    kind: CAROUSEL_KIND,
    day,
    rangeLabel,
    cover: { image: coverPath, fileName: `${prefix}-0-portada.jpg` },
    entries,
    closing: { image: closingPath, fileName: `${prefix}-${last}-cierre.jpg` },
    captions: buildCarouselCaptions(
      entries.map((e) => ({ name: e.name, price: e.price, dropAmount: e.dropAmount, price_checked_at: e.checkedAt })),
      { rangeLabel, siteUrl: opts.siteUrl }
    ),
  };
}

/** El último carrusel marcado como publicado, con lo que hay ahora de cada producto. */
export interface PublishedCarousel {
  postedAt: string;
  postIds: number[];
  items: {
    productId: string;
    name: string;
    postedPrice: number | null;
    /** El precio de ahora en el sitio; null si ya no está a la venta. */
    priceNow: number | null;
  }[];
}

export interface CarouselPage {
  /** El carrusel para publicar, o null (no alcanza, o ya se publicó el de esta semana). */
  carousel: WeeklyCarousel | null;
  /** Cuántos productos se eligieron (aunque no alcancen para armarlo). */
  found: number;
  /** Cuántas bajas cumplen todo, antes del cupo y de la variedad. */
  qualifying: number;
  /** De cuántos productos no se pudo leer el historial: puede faltar alguna baja. */
  unread: number;
  /** El último publicado en los últimos días, si hay. */
  published: PublishedCarousel | null;
  /** Si ya se publicó el de esta semana: desde qué día (AAAAMMDD) se arma el próximo. */
  nextDay: number | null;
}

/** Cuánto se mira hacia atrás en las marcas: lo publicado antes ya no puede repetir una baja de esta semana. */
const MARKS_LOOKBACK_DAYS = 14;

/**
 * Lo que muestra /admin/historias/carrusel. Si el carrusel de esta semana ya
 * se marcó como publicado (hace menos de siete días), no se arma otro salvo
 * que se pida (`force`). Solo lee.
 */
export async function readCarouselPage(
  admin: SupabaseClient,
  now: Date,
  key: Buffer,
  opts: { siteUrl: string; force?: boolean }
): Promise<CarouselPage> {
  const batches = await readCarouselMarks(admin, new Date(now.getTime() - MARKS_LOOKBACK_DAYS * 86_400_000));
  const latest: CarouselBatch | undefined = batches[0];
  const nextDay = latest ? addDays(chileDay(new Date(latest.postedAt)), CAROUSEL_RULES.everyDays) : null;
  const thisWeek = latest !== undefined && nextDay !== null && chileDay(now) < nextDay;
  const published = thisWeek ? await describeBatch(admin, latest) : null;

  if (thisWeek && !opts.force) {
    return { carousel: null, found: 0, qualifying: 0, unread: 0, published, nextDay };
  }

  const read = await readFreshSocialProducts(admin, new Date(now.getTime() - CAROUSEL_RULES.maxPriceAgeMs).toISOString());
  if (read.error) throw new Error(`No se pudo leer el catálogo: ${read.error}`);
  const history = await getPriceStatsManyChecked(read.rows.map((p) => p.id));
  const selection = pickCarouselDrops(read.rows, history.stats, { now, shownAt: lastShownAt(batches) });
  return {
    carousel: buildWeeklyCarousel(selection.picks, { now, key, siteUrl: opts.siteUrl }),
    found: selection.picks.length,
    qualifying: selection.qualifying,
    unread: history.unread.size,
    published,
    nextDay: thisWeek ? nextDay : null,
  };
}

/** Un carrusel marcado, con el nombre y el precio de ahora de cada producto. */
async function describeBatch(admin: SupabaseClient, batch: CarouselBatch): Promise<PublishedCarousel> {
  const ids = [...new Set(batch.posts.map((post) => post.productId))];
  const read = await selectSocialProducts((columns) => admin.from('products').select(columns).in('id', ids));
  if (read.error) throw new Error(`No se pudo leer los productos del carrusel: ${read.error}`);
  const byId = new Map(read.rows.map((p) => [p.id, p]));
  return {
    postedAt: batch.postedAt,
    postIds: batch.posts.map((post) => post.postId),
    items: batch.posts.map((post) => {
      const product = byId.get(post.productId);
      return {
        productId: post.productId,
        name: product ? socialProductName(product) : 'Un producto que ya no está en el sitio',
        postedPrice: post.postedPrice,
        priceNow: isOnSale(product) ? product.price : null,
      };
    }),
  };
}
