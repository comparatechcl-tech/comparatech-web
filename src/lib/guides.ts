/**
 * Guías de compra (SEO etapa 2, punto 7): /guias/{slug}.
 *
 * Una guía es una lista que se arma sola con el catálogo del día y con las
 * reglas escritas acá: qué tipos de producto entran a cada sección, en qué
 * rango de precio, cuántos del mismo tipo o de la misma marca, y qué queda
 * fuera porque el precio que se ve podría no ser el que muestra Mercado Libre
 * al abrirlo. Nadie elige ni prueba producto por producto, y la página lo
 * dice así.
 *
 * La dirección no lleva año (como /black-friday): la misma página sirve cada
 * temporada y se rearma con los precios del día. El título para Google lo
 * aprueba el dueño, igual que la lista de guías.
 *
 * Sin I/O: se prueba con datos fijos. La lectura del historial está en
 * lib/queries/guides.
 */
import type { Product } from '@/lib/types';
import type { Placement } from '@/lib/clicks';
import type { PriceStats } from '@/lib/deals';
import { dropsById, type ConfirmedDrop } from '@/lib/deal-rank';
import { formatCLP } from '@/lib/format';
import { domainLabel } from '@/lib/product-types';
import { startsWithCode } from '@/lib/content/social-name';
import { interestEvidence } from '@/lib/social/evidence';
import { interestBrand, interestScore, meetsInterestFloor } from '@/lib/social/interest';
import { INTEREST_WEIGHTS, NOT_NEW } from '@/lib/social/interest-tables';
import { normalizeName } from '@/lib/text';

export interface GuideSection {
  /** El ancla (#hasta-20000). No se cambia: puede estar enlazada. */
  id: string;
  /** El título de la sección (H2). */
  title: string;
  /** Rango de precio: más de `above` y hasta `upTo` pesos. */
  above: number;
  upTo: number;
  /** Los tipos de producto que entran (los nombres de lib/product-types). */
  types: readonly string[];
  /** Cuántos productos muestra, como mucho. */
  size: number;
}

export interface GuideDef {
  /** La dirección (/guias/{slug}). No se cambia: la tienen Google y los links. */
  slug: string;
  /** Desde dónde salen sus clics (lib/clicks, Métricas). Uno por guía. */
  placement: Placement;
  /** Nombre corto: migas, pie de página y enlaces. */
  name: string;
  /** El <title>, entero. Lo aprueba el dueño. */
  title: string;
  /** El H1. */
  heading: string;
  /** Meta description. */
  description: string;
  /** La primera frase de la página. */
  intro: string;
  sections: readonly GuideSection[];
  /** La variedad de cada sección (ver GuideVariety). */
  variety: GuideVariety;
  /** "Cómo armamos esta lista": frases cortas que dicen las reglas de verdad. */
  method: readonly string[];
}

/**
 * En cada sección, cuántos productos como mucho del mismo tipo (lib/product-
 * types), de la misma marca y de la misma categoría del sitio. Sin el campo,
 * no hay tope: en una guía de notebooks todos son del mismo tipo.
 */
export interface GuideVariety {
  perType?: number;
  perBrand?: number;
  perCategory?: number;
}

/**
 * Lo que se suele regalar. Quedan fuera los repuestos y lo de la casa
 * (routers, cargadores, discos, cámaras de seguridad, electrodomésticos):
 * sirven, pero no son un regalo.
 */
const GIFT_TYPES = [
  'Audífonos',
  'Parlantes',
  'Parlantes inteligentes',
  'Smartwatch',
  'Localizadores',
  'Controles',
  'Juegos',
  'Consolas',
  'Lectores de e-books',
  'Tablets',
  'Cámaras',
  'Drones',
  'Proyectores',
  'Streaming',
  'Micrófonos',
  'Luces para foto y video',
  'Tiras LED',
  'Mouse',
  'Teclados',
  'Afeitadoras y cortapelos',
  'Walkie talkies',
] as const;

/** Las guías publicadas, en el orden del pie de página. */
export const GUIDES: readonly GuideDef[] = [
  {
    slug: 'regalos-tecnologicos',
    placement: 'guia-regalos',
    name: 'Regalos tecnológicos',
    title: 'Regalos tecnológicos hasta $20.000, $50.000 y $100.000',
    heading: 'Regalos tecnológicos por presupuesto',
    description:
      'Ideas de regalos tecnológicos hasta $20.000, $50.000 y $100.000: audífonos, parlantes, relojes inteligentes y más, con el precio de hoy en Mercado Libre.',
    intro:
      'Ideas para regalar tecnología según cuánto quieras gastar, con el precio de hoy en Mercado Libre. La lista se arma sola con nuestro catálogo y cambia con los precios del día.',
    sections: [
      { id: 'hasta-20000', title: 'Hasta $20.000', above: 0, upTo: 20_000, types: GIFT_TYPES, size: 8 },
      { id: 'hasta-50000', title: 'Hasta $50.000', above: 20_000, upTo: 50_000, types: GIFT_TYPES, size: 8 },
      { id: 'hasta-100000', title: 'Hasta $100.000', above: 50_000, upTo: 100_000, types: GIFT_TYPES, size: 8 },
    ],
    // Sin tope por categoría salían 4 de gaming de 8 (dos juegos y dos controles).
    variety: { perType: 2, perBrand: 2, perCategory: 3 },
    method: [
      'Salen de nuestro catálogo, que se arma solo con lo más vendido y lo más buscado en Mercado Libre, de vendedores con reputación verde.',
      'Solo entran tipos de producto que se suelen regalar: audífonos, parlantes, relojes inteligentes, controles, juegos, cámaras y otros.',
      'Quedan fuera los de precio que cambia seguido, los que hoy cuestan 10% o más sobre su precio más bajo del último mes, los reacondicionados, los sin marca y los de vendedores con pocas ventas.',
      'En cada presupuesto, hasta dos del mismo tipo y dos de la misma marca, repartidos entre categorías. El orden lo pone un puntaje automático: tipo de producto, marca, descuento y envío, entre otras cosas.',
    ],
  },
];

export function guidePath(slug: string): string {
  return `/guias/${slug}`;
}

export function getGuide(slug: string): GuideDef | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/** El rango de una sección en palabras: "Hasta $20.000" o "De $20.000 a $50.000". */
export function sectionRange(section: Pick<GuideSection, 'above' | 'upTo'>): string {
  return section.above > 0
    ? `De ${formatCLP(section.above)} a ${formatCLP(section.upTo)}`
    : `Hasta ${formatCLP(section.upTo)}`;
}

// ---------------------------------------------------------------------------
// Qué queda fuera

/**
 * Por qué un producto no entra a ninguna guía. Son los avisos que el sitio
 * ya usa para no destacar ni publicar solo algo cuyo precio puede no ser el
 * que se ve, o que en una tarjeta no se entiende (lib/social/interest,
 * lib/home-deals):
 *
 *  - code-name: el nombre parte con un código ("FA607NUQ-RL060W AMD…"): en
 *    la tarjeta no dice qué es;
 *  - not-new: reacondicionado, usado, caja abierta;
 *  - no-brand: genérico o sin marca;
 *  - few-sales: vendedor con menos de 100 ventas (salvo tienda oficial o
 *    Mercado Libre);
 *  - other-cheaper: otro vendedor de la misma ficha lo ofrece a menos;
 *  - history-unread: hoy no se pudo leer su historial, y no se sabe si su
 *    precio se ha movido;
 *  - moving-price: dos o más cambios de precio en 48 horas, o un precio que
 *    va y vuelve entre los mismos valores;
 *  - many-sellers: 4 o más vendedores en la ficha se turnan la caja de
 *    compra, y con ella el precio. Entran solo si el precio no cambió en 48
 *    horas: medido el 18-10-2026, cuatro de cada diez productos del catálogo
 *    tienen tantos vendedores, entre ellos los parlantes y juegos más
 *    conocidos, y muchos llevan días con el mismo precio;
 *  - above-minimum: hoy cuesta 10% o más sobre el precio más bajo que se
 *    sostuvo en los últimos 30 días;
 *  - low-interest: menos de GUIDE_MIN_POINTS en el puntaje de interés.
 */
export type GuideBlocker =
  | 'code-name'
  | 'not-new'
  | 'no-brand'
  | 'few-sales'
  | 'other-cheaper'
  | 'history-unread'
  | 'moving-price'
  | 'many-sellers'
  | 'above-minimum'
  | 'low-interest';

/**
 * El piso del puntaje de interés, medido sin las señales (floorPoints), como
 * en las redes. Es más bajo que el de las redes (40) porque una guía no
 * necesita oferta: lo que queda bajo 35 es casi siempre de marca desconocida
 * en un tipo que nadie busca ("Cinta Led Cob 24v", una cámara trampa).
 */
export const GUIDE_MIN_POINTS = 35;

const W = INTEREST_WEIGHTS;

/** Lo que se puede decidir sin el historial: con esto se elige a quién se le lee. */
export function staticBlocker(product: Product): GuideBlocker | null {
  const info = product.offer_info ?? null;
  if (startsWithCode(product.name)) return 'code-name';
  if (NOT_NEW.test(normalizeName(product.name))) return 'not-new';
  if (interestBrand(product).level < 0) return 'no-brand';
  const trusted = info?.official_store === true || info?.sold_by_ml === true;
  const sales = product.seller_sales_count;
  if (!trusted && !(typeof sales === 'number' && sales >= W.fewSalesBelow)) return 'few-sales';
  if (info?.is_lowest === false) return 'other-cheaper';
  return null;
}

/**
 * Lo que dice el historial. Sin historial (un producto recién agregado) se
 * permite, salvo con muchos vendedores: no se sabe si su precio se queda
 * quieto. `unread` es otra cosa: el historial existe o puede existir, pero
 * hoy no se pudo leer.
 */
export function historyBlocker(
  product: Product,
  stats: PriceStats | null | undefined,
  now: number,
  unread: boolean,
): GuideBlocker | null {
  if (unread) return 'history-unread';
  const sellers = product.offer_info?.offers_count;
  const manySellers = typeof sellers === 'number' && sellers >= W.manySellersFrom;
  if (!stats) return manySellers ? 'many-sellers' : null;

  const seen = interestEvidence(product, stats, now);
  const changes = seen.recentChanges ?? 0;
  // Las comparaciones van negadas a propósito: un número que no es válido no pasa.
  if (!(changes < W.movingPriceFromChanges) || seen.seesaw === true) return 'moving-price';
  if (manySellers && !(changes === 0)) return 'many-sellers';
  if (seen.min30 !== null && product.price * 100 >= seen.min30 * (100 + W.excludeAbovePct)) return 'above-minimum';
  return null;
}

/** ¿Entra a la sección por tipo y precio? */
export function fitsSection(product: Product, section: GuideSection): boolean {
  return (
    product.price > section.above &&
    product.price <= section.upTo &&
    section.types.includes(domainLabel(product.ml_domain_id))
  );
}

/**
 * Los productos que podrían entrar a la guía (tipo, precio y sin avisos que
 * se vean sin historial): a estos, y solo a estos, se les lee el historial.
 */
export function guideCandidates(guide: GuideDef, catalog: Product[]): Product[] {
  return catalog.filter((p) => guide.sections.some((s) => fitsSection(p, s)) && staticBlocker(p) === null);
}

// ---------------------------------------------------------------------------
// El orden y la variedad

export interface GuideSectionView {
  section: GuideSection;
  products: Product[];
  /** Bajas comprobadas con el historial propio, por id (lib/deal-rank). */
  drops: Record<string, ConfirmedDrop>;
}

export interface GuideView {
  sections: GuideSectionView[];
  /** Todos los productos de la guía, en el orden de la página. */
  products: Product[];
}

/** Cuenta cuántos van de cada clave y dice si cabe uno más (sin tope, siempre cabe). */
function counter(limit: number | undefined) {
  const counts = new Map<string, number>();
  return {
    fits: (key: string) => limit === undefined || !key || (counts.get(key) ?? 0) < limit,
    add: (key: string) => {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    },
  };
}

/**
 * La guía armada: en cada sección, los de más puntaje de interés (el mismo
 * de las redes y la portada) que pasan las reglas, con los topes de
 * variedad de la guía (GuideVariety) y uno por familia (dos colores del
 * mismo modelo son el mismo producto). Un producto sale una sola vez en la
 * guía.
 *
 * Si con todos los topes la sección no se llena, una segunda vuelta suelta
 * solo el de categoría: lo barato y de precio quieto es casi todo audio, y
 * "hasta $20.000" quedaba con 4. Los topes de tipo, marca y familia no se
 * sueltan nunca: mejor una sección corta que ocho audífonos.
 *
 * Puro y estable: no depende del orden en que llega el catálogo.
 */
export function buildGuide(
  guide: GuideDef,
  catalog: Product[],
  stats: Map<string, PriceStats>,
  unread: ReadonlySet<string>,
  now: number,
): GuideView {
  const scored = guideCandidates(guide, catalog)
    .filter((p) => historyBlocker(p, stats.get(p.id), now, unread.has(p.id)) === null)
    .map((p) => ({ product: p, score: interestScore(p, interestEvidence(p, stats.get(p.id), now)) }))
    .filter(({ score }) => meetsInterestFloor(score, GUIDE_MIN_POINTS))
    .sort(
      (a, b) =>
        b.score.points - a.score.points || (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0),
    );

  const used = new Set<string>();
  const sections = guide.sections.map((section): GuideSectionView => {
    const types = counter(guide.variety.perType);
    // Los productos sin marca no se limitan entre sí: no son "la misma marca" (y la guía ya los deja fuera).
    const brands = counter(guide.variety.perBrand);
    const categories = counter(guide.variety.perCategory);
    const families = new Set<string>();
    const picked = new Set<string>();
    for (const strict of [true, false]) {
      for (const { product } of scored) {
        if (picked.size >= section.size) break;
        if (used.has(product.id) || !fitsSection(product, section)) continue;
        const family = product.ml_family_id || '';
        const type = domainLabel(product.ml_domain_id);
        const brand = interestBrand(product).key;
        if ((family && families.has(family)) || !types.fits(type) || !brands.fits(brand)) continue;
        if (strict && !categories.fits(product.category)) continue;
        picked.add(product.id);
        used.add(product.id);
        if (family) families.add(family);
        types.add(type);
        brands.add(brand);
        categories.add(product.category);
      }
    }
    // En el orden del puntaje, no en el de las vueltas.
    const products = scored.map((s) => s.product).filter((p) => picked.has(p.id));
    return { section, products, drops: dropsById(products, stats, now) };
  });

  return { sections, products: sections.flatMap((s) => s.products) };
}

/** La línea bajo el título de una sección: cuántos hay y entre qué precios. */
export function sectionSummary(view: GuideSectionView): string {
  const prices = view.products.map((p) => p.price);
  if (prices.length === 0) return sectionRange(view.section);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const what = prices.length === 1 ? '1 idea' : `${prices.length} ideas`;
  const range = min === max ? `a ${formatCLP(min)}` : `de ${formatCLP(min)} a ${formatCLP(max)}`;
  return `${what} ${range}, con el precio de hoy.`;
}
