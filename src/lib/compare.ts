/**
 * Lógica del comparador (portada y /comparador), separada de los
 * componentes para poder probarla con datos fijos.
 *
 * Sin I/O: lo usan componentes de cliente.
 */
import { getAllCategories } from '@/lib/categories';
import { buyUrl } from '@/lib/outbound';
import { domainLabel, OTHER_TYPE_LABEL } from '@/lib/product-types';
import type { Product } from '@/lib/types';

/** Lo mínimo que el comparador necesita de cada producto para elegir. */
export interface CompareCandidate {
  slug: string;
  name: string;
  category: string;
  ml_domain_id: string | null;
  seller_sales_count: number;
}

/**
 * Lo que la tabla de /comparador muestra de un producto.
 *
 * Antes la página le pasaba al navegador todos los productos con sus specs
 * (790 KB, y crecía con el catálogo) para poder armar cualquier par. Ahora
 * lleva solo el par con que abre; la lista para elegir se pide por categoría
 * y las specs, por producto, a /comparador/datos.
 */
export interface CompareDetail extends CompareCandidate {
  id: string;
  price: number;
  image_url: string;
  specs: Record<string, string | number>;
  /** Destino del botón de compra, ya resuelto con lib/outbound. */
  href: string;
}

/** Solo los campos para elegir: lo demás del producto no viaja. */
export function toCompareCandidate(product: CompareCandidate): CompareCandidate {
  return {
    slug: product.slug,
    name: product.name,
    category: product.category,
    ml_domain_id: product.ml_domain_id,
    seller_sales_count: product.seller_sales_count,
  };
}

export function toCompareDetail(product: Product): CompareDetail {
  return {
    ...toCompareCandidate(product),
    id: product.id,
    price: product.price,
    image_url: product.image_url,
    specs: product.specs ?? {},
    href: buyUrl(product),
  };
}

/** Lo que responde /comparador/datos?cat=: los productos de una categoría. */
export interface CompareList {
  items: CompareCandidate[];
}

/** Lo que se le puede pedir a /comparador/datos. */
export type CompareQuery = { category: string } | { slug: string };

export function compareListUrl(category: string): string {
  return `/comparador/datos?cat=${encodeURIComponent(category)}`;
}

export function compareProductUrl(slug: string): string {
  return `/comparador/datos?slug=${encodeURIComponent(slug)}`;
}

const CATEGORY_SLUG_RE = /^[a-z0-9-]{1,40}$/;
// Los slugs salen del nombre del producto (lib/candidate-slugs) y los nombres
// de Mercado Libre son largos: el más largo del catálogo tiene 198 letras.
const PRODUCT_SLUG_RE = /^[a-z0-9-]{1,250}$/;

/**
 * Lee lo que pide /comparador/datos. Estricto, igual que /ofertas/lote: cada
 * dirección distinta es una respuesta distinta en el caché, así que solo se
 * aceptan las que arman compareListUrl y compareProductUrl. Un parámetro de
 * más, repetido, los dos juntos o con otro formato es null (400).
 */
export function parseCompareQuery(params: URLSearchParams): CompareQuery | null {
  const keys = [...params.keys()];
  if (keys.length !== 1) return null;

  const value = params.get(keys[0]) ?? '';
  if (keys[0] === 'cat') return CATEGORY_SLUG_RE.test(value) ? { category: value } : null;
  if (keys[0] === 'slug') return PRODUCT_SLUG_RE.test(value) ? { slug: value } : null;
  return null;
}

/**
 * Par con que abre el comparador: los dos más vendidos del tipo de producto
 * con más fichas. Antes abría con los dos primeros del catálogo y comparaba
 * un parlante con un iPhone, una tabla que no le sirve a nadie.
 *
 * Si ningún tipo tiene dos productos, cae a los dos primeros.
 */
export function defaultComparePair(products: CompareCandidate[]): [string, string] {
  const byDomain = new Map<string, CompareCandidate[]>();
  for (const p of products) {
    if (!p.ml_domain_id) continue;
    const list = byDomain.get(p.ml_domain_id) ?? [];
    list.push(p);
    byDomain.set(p.ml_domain_id, list);
  }

  // Ante empate de tamaño gana el primero que aparece en el catálogo: el
  // resultado tiene que ser el mismo en el servidor y en el navegador.
  let best: CompareCandidate[] | null = null;
  for (const list of byDomain.values()) {
    if (list.length >= 2 && (!best || list.length > best.length)) best = list;
  }

  if (best) {
    const [a, b] = [...best].sort(bySales);
    return [a.slug, b.slug];
  }
  const a = products[0]?.slug ?? '';
  return [a, products[1]?.slug ?? a];
}

function bySales(a: CompareCandidate, b: CompareCandidate): number {
  return (b.seller_sales_count ?? 0) - (a.seller_sales_count ?? 0);
}

/**
 * Candidatos para el producto B: los del mismo tipo que A (sin A). Comparar
 * audífonos con audífonos es lo que busca quien llega a "X vs Y". Si A no
 * tiene tipo o es el único de su tipo, o si se pidió ver todo, van todos.
 */
export function compareOptionsForB<T extends CompareCandidate>(
  products: T[],
  a: CompareCandidate | undefined,
  showAll: boolean
): { options: T[]; restricted: boolean } {
  const others = products.filter((p) => p.slug !== a?.slug);
  if (showAll || !a?.ml_domain_id) return { options: others, restricted: false };
  const sameDomain = others.filter((p) => p.ml_domain_id === a.ml_domain_id);
  if (sameDomain.length === 0) return { options: others, restricted: false };
  return { options: sameDomain, restricted: true };
}

/** El más vendido de una lista, para elegir B cuando A cambia de tipo. */
export function topSeller<T extends CompareCandidate>(products: T[]): T | undefined {
  return [...products].sort(bySales)[0];
}

/**
 * Productos agrupados por categoría para los <optgroup> del selector, en el
 * orden del registro de categorías y por nombre dentro de cada grupo. Con
 * un centenar de opciones en una sola lista no se encontraba nada.
 */
export function groupByCategory<T extends CompareCandidate>(
  products: T[]
): { slug: string; label: string; items: T[] }[] {
  const registry = getAllCategories();
  const groups = new Map<string, T[]>();
  for (const p of products) {
    const list = groups.get(p.category) ?? [];
    list.push(p);
    groups.set(p.category, list);
  }

  const order = (slug: string) => {
    const i = registry.findIndex((c) => c.slug === slug);
    return i === -1 ? registry.length : i;
  };
  const label = (slug: string) =>
    registry.find((c) => c.slug === slug)?.name ?? (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Otros');

  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([slug, items]) => ({
      slug,
      label: label(slug),
      items: [...items].sort((x, y) => x.name.localeCompare(y.name, 'es')),
    }));
}

/**
 * Productos agrupados por tipo ("Audífonos", "Parlantes") para los
 * <optgroup> de /comparador, que lista una categoría a la vez. Los grupos
 * van en orden alfabético, que es como se busca en un desplegable, con
 * 'Otros' al final; dentro de cada uno, por nombre.
 */
export function groupByType<T extends CompareCandidate>(products: T[]): { label: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const p of products) {
    const label = domainLabel(p.ml_domain_id);
    const list = groups.get(label) ?? [];
    list.push(p);
    groups.set(label, list);
  }

  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        Number(a === OTHER_TYPE_LABEL) - Number(b === OTHER_TYPE_LABEL) || a.localeCompare(b, 'es')
    )
    .map(([label, items]) => ({
      label,
      items: [...items].sort((x, y) => x.name.localeCompare(y.name, 'es')),
    }));
}

type SpecValue = string | number | null | undefined;

function isEmpty(value: SpecValue): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Specs que tienen los dos productos. Una fila con "—" de un lado no
 * compara nada, y entre un celular y unos audífonos llenaba la tabla de
 * filas vacías.
 */
export function sharedSpecKeys(
  a: Record<string, SpecValue>,
  b: Record<string, SpecValue>
): string[] {
  return Object.keys(a).filter((key) => !isEmpty(a[key]) && !isEmpty(b[key]));
}

/** "4,8 W" → 4.8; null si no hay número. */
function firstNumber(value: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)/.exec(value);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Número seguido de una de las unidades, o null si la unidad no calza. */
function withUnit(value: string, units: Record<string, number>): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*([a-zA-Zíá]+)/.exec(value);
  if (!m) return null;
  const factor = units[m[2].toLowerCase()];
  if (factor === undefined) return null;
  const n = firstNumber(m[1]);
  return n === null ? null : n * factor;
}

const BYTES = { mb: 1 / 1024, gb: 1, tb: 1024 };
const HOURS = { h: 1, hs: 1, hrs: 1, horas: 1, hora: 1, min: 1 / 60, días: 24, dias: 24, día: 24, dia: 24 };

/** Código IP ("IP67", "IPX4") como [polvo, agua]; la X cuenta como 0. */
function ipRating(value: string): [number, number] | null {
  const m = /IP\s?([0-6X])([0-9X])/i.exec(value);
  if (!m) return null;
  const digit = (c: string) => (c.toUpperCase() === 'X' ? 0 : Number(c));
  return [digit(m[1]), digit(m[2])];
}

type Comparison = 'a' | 'b' | null;

interface BetterRule {
  key: RegExp;
  compare: (a: string, b: string) => Comparison;
}

function higher(parse: (v: string) => number | null) {
  return (a: string, b: string): Comparison => {
    const na = parse(a);
    const nb = parse(b);
    if (na === null || nb === null || na === nb) return null;
    return na > nb ? 'a' : 'b';
  };
}

/**
 * Specs donde más es mejor, y solo esas. Antes se marcaba "ganador" a
 * cualquier número más alto: el voltaje, el tamaño de la caja o el tiempo
 * de carga (donde menos es mejor) salían destacados como ventaja.
 */
const BETTER_RULES: BetterRule[] = [
  // Autonomía en horas. Va antes que la batería: "Duración de la batería"
  // también dice batería, pero se mide en horas y no en mAh.
  {
    key: /autonom[ií]a|duraci[oó]n de la bater[ií]a/i,
    compare: higher((v) => withUnit(v, HOURS)),
  },
  // Batería en mAh (la del celular, la del audífono o la del estuche).
  { key: /bater[ií]a/i, compare: higher((v) => withUnit(v, { mah: 1 })) },
  { key: /memoria ram|^ram$/i, compare: higher((v) => withUnit(v, BYTES)) },
  {
    key: /memoria interna|almacenamiento|tama[ñn]o de la memoria|^capacidad$/i,
    compare: higher((v) => withUnit(v, BYTES)),
  },
  { key: /potencia/i, compare: higher((v) => withUnit(v, { w: 1, kw: 1000 })) },
  {
    // Resistencia IP: gana solo si es igual o mejor en polvo Y en agua. IP54
    // contra IPX7 no tiene ganador claro.
    key: /\bIP\b|resistencia/i,
    compare: (a, b) => {
      const ra = ipRating(a);
      const rb = ipRating(b);
      if (!ra || !rb) return null;
      const aBetter = ra[0] >= rb[0] && ra[1] >= rb[1] && (ra[0] > rb[0] || ra[1] > rb[1]);
      const bBetter = rb[0] >= ra[0] && rb[1] >= ra[1] && (rb[0] > ra[0] || rb[1] > ra[1]);
      return aBetter ? 'a' : bBetter ? 'b' : null;
    },
  },
];

/** El voltaje nunca es "mejor" por ser más alto, diga lo que diga la clave. */
const NEVER_BETTER = /voltaje|voltage|tensi[oó]n/i;

/**
 * Qué lado destacar en una fila de specs: 'a', 'b' o null si la spec no está
 * en la lista blanca, no se pudo leer o empatan.
 */
export function betterSpec(key: string, a: SpecValue, b: SpecValue): Comparison {
  if (isEmpty(a) || isEmpty(b) || NEVER_BETTER.test(key)) return null;
  const rule = BETTER_RULES.find((r) => r.key.test(key));
  return rule ? rule.compare(String(a), String(b)) : null;
}
