import { getCategoryInfo } from '@/lib/categories';
import { formatDiscountPct } from '@/lib/format';
import { normalizeName, stripDiacritics } from '@/lib/text';
import type { Product } from '@/lib/types';

/**
 * Búsqueda del catálogo y elección de alternativas, sin acceso a datos.
 *
 * Antes la búsqueda exigía que la frase completa apareciera tal cual en el
 * nombre: "parlante jbl", "audifonos sony" y "celular samsung" devolvían 0
 * resultados porque ML escribe "Parlante Portable Jbl…", "Audífonos
 * Inalámbricos Sony…" y "Galaxy S26 Ultra" (sin la palabra "celular" ni
 * "Samsung"). Quien busca ya tiene intención de compra: una página vacía es
 * una venta perdida.
 *
 * Ahora cada palabra de la consulta se busca por separado, en cualquier
 * orden, en un texto que suma nombre, marca, categoría, tipo de producto de
 * ML y specs.
 */

/** Palabras que no distinguen un producto de otro. */
const STOPWORDS = new Set(['de', 'la', 'el', 'los', 'las', 'para', 'con', 'y', 'en', 'del', 'un', 'una']);

/** Minúsculas y sin tildes: casi nadie escribe "audífonos" al buscar. */
export function normalizeSearchText(text: string): string {
  return stripDiacritics(text.toLowerCase());
}

/**
 * Plural → singular, igual para la consulta y para el producto, así
 * "parlantes" encuentra "Parlante" y "celular" encuentra la categoría
 * "Celulares". Es una regla gruesa a propósito ("lentes" queda "lent"), pero
 * como se aplica a los dos lados, lo que importa es que coincidan.
 */
export function singularize(word: string): string {
  if (word.length > 4 && /[b-df-hj-np-tv-z]es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** Palabras sueltas, normalizadas y en singular, sin stopwords. */
export function tokenize(text: string): string[] {
  return normalizeSearchText(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(singularize);
}

export type SearchableProduct = Pick<
  Product,
  'name' | 'brand' | 'category' | 'ml_domain_id' | 'specs' | 'price' | 'original_price'
>;

/** "MLC-SMART_SPEAKERS" → "smart speakers": el tipo de producto según ML. */
function domainWords(domainId: string | null | undefined): string {
  if (!domainId) return '';
  return domainId.replace(/^[A-Z]{3}-/, '').replace(/_/g, ' ');
}

/** Qué tipo de producto es: la categoría del sitio y el dominio de ML. */
function typeWords(product: SearchableProduct): string[] {
  const category = getCategoryInfo(product.category)?.name ?? product.category ?? '';
  return tokenize(`${category} ${domainWords(product.ml_domain_id)}`);
}

/** Todo lo que describe al producto, como palabras buscables. */
function productWords(product: SearchableProduct): string[] {
  const specValues = Object.values(product.specs ?? {}).map((v) => String(v));
  return [...tokenize([product.name, product.brand ?? '', ...specValues].join(' ')), ...typeWords(product)];
}

/**
 * ¿La palabra de la consulta calza con una del producto?
 *
 * Por prefijo, para que "galax" o "iph" ya encuentren algo mientras se
 * escribe. La segunda condición cubre un borde de la regla de plurales:
 * "parlantes" queda "parlant" y "parlante" no, así que un producto que solo
 * dice "parlantes" no aparecería al buscar "parlante".
 */
function matchesWord(token: string, word: string): boolean {
  if (word.startsWith(token)) return true;
  return word.length >= 5 && token.length === word.length + 1 && token.startsWith(word);
}

function matchesAny(token: string, words: string[]): boolean {
  return words.some((w) => matchesWord(token, w));
}

/**
 * Productos que calzan con la consulta, del más al menos relevante.
 *
 * Cada palabra de la consulta tiene que aparecer en el producto: "celular
 * samsung" no puede traer un Xiaomi solo porque es celular. El orden pone
 * primero los que tienen más palabras en el nombre (lo que se ve en la
 * tarjeta) y, entre esos, el de mayor descuento. Una consulta vacía (o
 * solo con stopwords) no encuentra nada: quien llama decide qué mostrar.
 *
 * Antes que todo eso va el tipo de producto: si una palabra de la consulta
 * es la categoría ("celular"), los que SON de esa categoría van primero.
 * Sin esto, "celular samsung" ponía arriba un power bank "para
 * iPhone/Samsung/Motorola Celular", que tiene las dos palabras en el
 * nombre, y los Galaxy (que no dicen ni "celular" ni "Samsung") al final.
 */
export function searchProducts<T extends SearchableProduct>(products: T[], query: string): T[] {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];

  const scored: { product: T; inType: number; inName: number; discount: number; index: number }[] = [];
  products.forEach((product, index) => {
    const words = productWords(product);
    if (!tokens.every((t) => matchesAny(t, words))) return;

    const nameWords = tokenize(product.name);
    const kindWords = typeWords(product);
    scored.push({
      product,
      inType: tokens.filter((t) => matchesAny(t, kindWords)).length,
      inName: tokens.filter((t) => matchesAny(t, nameWords)).length,
      discount: formatDiscountPct(product.price, product.original_price) ?? 0,
      index,
    });
  });

  return scored
    .sort(
      (a, b) => b.inType - a.inType || b.inName - a.inName || b.discount - a.discount || a.index - b.index
    )
    .map((s) => s.product);
}

export type AlternativeCandidate = Pick<
  Product,
  'id' | 'name' | 'category' | 'ml_domain_id' | 'ml_family_id' | 'price'
>;

/**
 * Alternativas para una ficha: el mismo tipo de producto de ML (otros
 * parlantes para un parlante) y, si no alcanzan, la misma categoría del
 * sitio. Nunca otra versión del mismo producto: esas ya salen en "Otras
 * versiones". Primero las de precio más parecido, que son las que compiten
 * de verdad por la misma compra.
 *
 * `candidates` tiene que venir ya filtrado a productos activos y visibles.
 */
export function pickAlternatives<T extends AlternativeCandidate>(
  product: AlternativeCandidate,
  candidates: T[],
  limit = 6
): T[] {
  const name = normalizeName(product.name);
  const eligible = candidates.filter(
    (p) =>
      p.id !== product.id &&
      !(product.ml_family_id && p.ml_family_id === product.ml_family_id) &&
      normalizeName(p.name) !== name
  );
  const byDistance = (a: T, b: T) => Math.abs(a.price - product.price) - Math.abs(b.price - product.price);

  const sameDomain = product.ml_domain_id
    ? eligible.filter((p) => p.ml_domain_id === product.ml_domain_id).sort(byDistance)
    : [];
  if (sameDomain.length >= limit) return sameDomain.slice(0, limit);

  const taken = new Set(sameDomain.map((p) => p.id));
  const sameCategory = eligible
    .filter((p) => p.category === product.category && !taken.has(p.id))
    .sort(byDistance);

  return [...sameDomain, ...sameCategory].slice(0, limit);
}
