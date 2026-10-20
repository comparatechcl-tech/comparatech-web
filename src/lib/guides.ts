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
  /** Rango de precio: más de `above` y hasta `upTo` pesos (Infinity: sin tope). */
  above: number;
  upTo: number;
  /** Los tipos de producto que entran (los nombres de lib/product-types). */
  types: readonly string[];
  /**
   * true: solo los que tienen tarjeta de video (hasDedicatedGpu); false:
   * solo los que no. Sin el campo, da igual.
   */
  gpu?: boolean;
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
  /** Cómo se cuentan sus productos en el resumen de cada sección ("8 ideas", "3 notebooks"). */
  unit: { one: string; many: string };
  sections: readonly GuideSection[];
  /** La variedad de cada sección (ver GuideVariety). */
  variety: GuideVariety;
  /**
   * Memoria mínima, en GB (ver memoryOf). Queda fuera lo que tiene menos
   * según la ficha o el nombre; si no lo dice, entra.
   */
  minRamGb?: number;
  minStorageGb?: number;
  /** "Qué mirar": datos generales para elegir, cortos y sin nombrar productos. */
  tips?: { title: string; items: readonly string[] };
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
    unit: { one: 'idea', many: 'ideas' },
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
  {
    slug: 'notebook-para-la-universidad',
    placement: 'guia-notebook',
    name: 'Notebook para la universidad',
    title: 'Notebook para la universidad: precios en Chile | ComparaTech',
    heading: 'Notebook para la universidad',
    description:
      'Notebooks para la universidad con 8 GB de RAM o más, por presupuesto, y con tarjeta de video para diseño o ingeniería. Con el precio de hoy en Mercado Libre.',
    intro:
      'Notebooks nuevos con 8 GB de RAM o más, ordenados por presupuesto, con el precio de hoy en Mercado Libre. La lista se arma sola con nuestro catálogo y cambia con los precios del día.',
    unit: { one: 'notebook', many: 'notebooks' },
    sections: [
      { id: 'hasta-500000', title: 'Hasta $500.000', above: 0, upTo: 500_000, types: ['Notebooks'], gpu: false, size: 8 },
      { id: 'mas-de-500000', title: 'Más de $500.000', above: 500_000, upTo: Infinity, types: ['Notebooks'], gpu: false, size: 8 },
      { id: 'con-tarjeta-de-video', title: 'Con tarjeta de video', above: 0, upTo: Infinity, types: ['Notebooks'], gpu: true, size: 8 },
    ],
    // Todos son del mismo tipo: la variedad está en la marca.
    variety: { perBrand: 2 },
    minRamGb: 8,
    minStorageGb: 256,
    tips: {
      title: 'Qué mirar',
      items: [
        'Memoria RAM: 8 GB alcanzan para clases, documentos y navegar; con 16 GB se nota menos el peso de muchas pestañas o programas abiertos.',
        'Disco: uno SSD prende y abre los programas rápido. 256 GB se llenan pronto; 512 GB dan más espacio.',
        'Tarjeta de video: hace falta para programas 3D, render o juegos, como en arquitectura, diseño o algunas ingenierías.',
        'Pantalla: 14 pulgadas pesan menos para llevar todos los días; 15,6 son más cómodas para trabajar.',
      ],
    },
    method: [
      'Salen de nuestro catálogo, que se arma solo con lo más vendido y lo más buscado en Mercado Libre, de vendedores con reputación verde.',
      'Solo notebooks nuevos con 8 GB de RAM o más y 256 GB de disco o más, según la ficha de Mercado Libre. Los que tienen tarjeta de video van aparte.',
      'Quedan fuera los de precio que cambia seguido, los que hoy cuestan 10% o más sobre su precio más bajo del último mes, los que tienen un nombre que es un código y los de vendedores con pocas ventas.',
      'Hasta dos de la misma marca en cada sección. El orden lo pone un puntaje automático: marca, descuento y envío, entre otras cosas.',
    ],
  },
];

export function guidePath(slug: string): string {
  return `/guias/${slug}`;
}

export function getGuide(slug: string): GuideDef | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/**
 * El rango de una sección en palabras: "Hasta $20.000", "De $20.000 a
 * $50.000", "Más de $500.000" o, sin límites, "Cualquier precio".
 */
export function sectionRange(section: Pick<GuideSection, 'above' | 'upTo'>): string {
  const capped = Number.isFinite(section.upTo);
  if (section.above > 0) {
    return capped ? `De ${formatCLP(section.above)} a ${formatCLP(section.upTo)}` : `Más de ${formatCLP(section.above)}`;
  }
  return capped ? `Hasta ${formatCLP(section.upTo)}` : 'Cualquier precio';
}

// ---------------------------------------------------------------------------
// Lo que dice la ficha

/** Las especificaciones de Mercado Libre con la RAM y con el disco, por tipo de producto. */
const RAM_SPECS = ['Capacidad total del módulo de memoria RAM', 'Memoria RAM'];
const STORAGE_SPECS = ['Capacidad de disco SSD', 'Capacidad del disco rígido', 'Memoria interna', 'Capacidad'];

/** "8 GB", "1 TB", "128 MB" → GB. null si no es una cantidad de memoria. */
function gigabytes(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const match = String(value).toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\b/);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  return match[2] === 'tb' ? amount * 1024 : match[2] === 'mb' ? amount / 1024 : amount;
}

function firstSpec(specs: Product['specs'] | null | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const gb = gigabytes(specs?.[key]);
    if (gb !== null) return gb;
  }
  return null;
}

/**
 * La RAM y el disco, en GB: de la ficha de Mercado Libre y, si la ficha no
 * lo dice, del nombre ("8gb ram", "512gb ssd"). null si no se sabe. La
 * ficha a veces se equivoca de campo (un SSD como "disco rígido"), pero la
 * cantidad es la misma: por eso se mira cuánto y no de qué tipo.
 */
export function memoryOf(product: Pick<Product, 'name' | 'specs'>): { ramGb: number | null; storageGb: number | null } {
  const name = normalizeName(product.name);
  const ramInName = name.match(/\b(\d{1,2}) ?gb (?:de )?ram\b/) ?? name.match(/\bram (?:de )?(\d{1,2}) ?gb\b/);
  const storageInName =
    name.match(/\b(\d{2,4}) ?(gb|tb) (?:de )?(?:ssd|rom|almacenamiento|memoria interna)\b/) ??
    name.match(/\bssd (?:de )?(\d{2,4}) ?(gb|tb)\b/);
  return {
    ramGb: firstSpec(product.specs, RAM_SPECS) ?? (ramInName ? Number(ramInName[1]) : null),
    storageGb:
      firstSpec(product.specs, STORAGE_SPECS) ??
      (storageInName ? Number(storageInName[1]) * (storageInName[2] === 'tb' ? 1024 : 1) : null),
  };
}

/**
 * ¿Tiene tarjeta de video aparte? Se lee del nombre ("RTX 3050", "RTX3050",
 * "GTX 1650", "Radeon RX 6500M"): la ficha de Mercado Libre no trae el dato
 * de forma pareja.
 */
export function hasDedicatedGpu(name: string): boolean {
  return /\b(?:rtx|gtx) ?\d{3,4}\b|\brtx\b|\bradeon rx ?\d{3,4}/.test(normalizeName(name));
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
 *  - low-memory: menos RAM o disco que el mínimo de la guía (memoryOf);
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
  | 'low-memory'
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
    section.types.includes(domainLabel(product.ml_domain_id)) &&
    (section.gpu === undefined || hasDedicatedGpu(product.name) === section.gpu)
  );
}

/** Menos RAM o disco que el mínimo de la guía, según lo que se sabe (memoryOf). */
export function memoryBlocker(guide: Pick<GuideDef, 'minRamGb' | 'minStorageGb'>, product: Product): GuideBlocker | null {
  if (guide.minRamGb === undefined && guide.minStorageGb === undefined) return null;
  const { ramGb, storageGb } = memoryOf(product);
  if (guide.minRamGb !== undefined && ramGb !== null && ramGb < guide.minRamGb) return 'low-memory';
  if (guide.minStorageGb !== undefined && storageGb !== null && storageGb < guide.minStorageGb) return 'low-memory';
  return null;
}

/**
 * Los productos que podrían entrar a la guía (tipo, precio y sin avisos que
 * se vean sin historial): a estos, y solo a estos, se les lee el historial.
 */
export function guideCandidates(guide: GuideDef, catalog: Product[]): Product[] {
  return catalog.filter(
    (p) => guide.sections.some((s) => fitsSection(p, s)) && staticBlocker(p) === null && memoryBlocker(guide, p) === null,
  );
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

/** La línea bajo el título de una sección: cuántos hay y entre qué precios. null si no hay ninguno. */
export function sectionSummary(view: GuideSectionView, unit: GuideDef['unit']): string | null {
  const prices = view.products.map((p) => p.price);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const what = prices.length === 1 ? `1 ${unit.one}` : `${prices.length} ${unit.many}`;
  const range = min === max ? `a ${formatCLP(min)}` : `de ${formatCLP(min)} a ${formatCLP(max)}`;
  return `${what} ${range}, con el precio de hoy.`;
}
