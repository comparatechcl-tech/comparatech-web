/**
 * Páginas filtradas dentro de un tipo de producto (SEO etapa 2, punto 5):
 * /categoria/electronica/televisores/55-pulgadas, /categoria/audio/parlantes/jbl.
 * Responden búsquedas que la página del tipo no responde ("smart tv 55
 * pulgadas", "parlante jbl", "celulares samsung").
 *
 * La lista es a mano: solo filtros que la gente busca de verdad (Google,
 * Knasta, lo más buscado en Mercado Libre), nunca todas las combinaciones de
 * marca y tamaño, que serían miles de páginas casi vacías. Se indexan las
 * que tienen MIN_TYPE_PAGE productos o más, como las páginas por tipo; las
 * demás existen para navegar, con noindex, y se suman solas al crecer.
 *
 * Sin I/O: se prueba con datos fijos.
 */
import type { Product } from '@/lib/types';
import { MIN_TYPE_PAGE, type TypeChip } from '@/lib/category-listing';
import { normalizeName } from '@/lib/text';
import { SEO_TITLE_MAX } from '@/lib/seo-title';

export type FilterRule = { kind: 'pulgadas'; inches: number } | { kind: 'marca'; brands: string[] };

export interface ListingFilter {
  /** La última parte de la dirección. No se cambia: la tienen Google y los links. */
  slug: string;
  /** La categoría y el tipo donde vive (los slugs de /categoria/{categoria}/{tipo}). */
  category: string;
  type: string;
  /** Cómo se llama en el H1, las migas y el título. */
  label: string;
  rule: FilterRule;
}

const tvSize = (inches: number): ListingFilter => ({
  slug: `${inches}-pulgadas`,
  category: 'electronica',
  type: 'televisores',
  label: `Smart TV ${inches} pulgadas`,
  rule: { kind: 'pulgadas', inches },
});

const brand = (category: string, type: string, slug: string, label: string, brands: string[] = [slug]): ListingFilter => ({
  slug,
  category,
  type,
  label,
  rule: { kind: 'marca', brands },
});

/** El orden es el de los chips: tamaños de menor a mayor, después marcas. */
export const LISTING_FILTERS: ListingFilter[] = [
  tvSize(32),
  tvSize(43),
  tvSize(50),
  tvSize(55),
  tvSize(65),
  brand('electronica', 'televisores', 'samsung', 'Smart TV Samsung'),
  brand('electronica', 'televisores', 'lg', 'Smart TV LG'),
  brand('electronica', 'televisores', 'tcl', 'Smart TV TCL'),
  brand('celulares', 'celulares', 'samsung', 'Celulares Samsung'),
  brand('celulares', 'celulares', 'iphone', 'iPhone', ['apple']),
  brand('celulares', 'celulares', 'motorola', 'Celulares Motorola'),
  brand('celulares', 'celulares', 'xiaomi', 'Celulares Xiaomi'),
  brand('audio', 'parlantes', 'jbl', 'Parlantes JBL'),
  brand('electronica', 'smartwatch', 'xiaomi', 'Smartwatch Xiaomi'),
  brand('electronica', 'smartwatch', 'huawei', 'Smartwatch Huawei'),
  brand('computacion', 'tablets', 'lenovo', 'Tablets Lenovo'),
  brand('computacion', 'tablets', 'samsung', 'Tablets Samsung'),
  brand('electrodomesticos', 'refrigeradores', 'midea', 'Refrigeradores Midea'),
  brand('electrodomesticos', 'refrigeradores', 'mademsa', 'Refrigeradores Mademsa'),
  brand('electrodomesticos', 'lavadoras', 'midea', 'Lavadoras Midea'),
  brand('electrodomesticos', 'lavadoras', 'hisense', 'Lavadoras Hisense'),
];

/** Desde cuántos productos (sin variantes repetidas) se indexa: lo mismo que un tipo. */
export const MIN_FILTER_PAGE = MIN_TYPE_PAGE;

export function filterPath(f: Pick<ListingFilter, 'category' | 'type' | 'slug'>): string {
  return `/categoria/${f.category}/${f.type}/${f.slug}`;
}

export function getFilter(category: string, type: string, slug: string): ListingFilter | undefined {
  return LISTING_FILTERS.find((f) => f.category === category && f.type === type && f.slug === slug);
}

export function filtersOfType(category: string, type: string): ListingFilter[] {
  return LISTING_FILTERS.filter((f) => f.category === category && f.type === type);
}

/**
 * Las pulgadas de una pantalla: de la ficha de Mercado Libre ("55 \""), o del
 * nombre si la ficha no lo trae ("43'' UHD", "Smart TV 55 pulgadas"). null si
 * no se sabe.
 */
export function screenInches(product: Pick<Product, 'name' | 'specs'>): number | null {
  const spec = product.specs?.['Tamaño de la pantalla'];
  const fromSpec = typeof spec === 'number' ? spec : typeof spec === 'string' ? parseFloat(spec.replace(',', '.')) : NaN;
  if (Number.isFinite(fromSpec) && fromSpec > 0) return Math.round(fromSpec);
  const m = /\b(\d{2,3})\s*(?:"|''|”|″|pulgadas|pulg\b)/i.exec(product.name);
  return m ? Number(m[1]) : null;
}

/** ¿El producto entra en el filtro? Por pulgadas, o por la marca que informa Mercado Libre. */
export function matchesFilter(product: Pick<Product, 'name' | 'brand' | 'specs'>, filter: ListingFilter): boolean {
  if (filter.rule.kind === 'pulgadas') return screenInches(product) === filter.rule.inches;
  // "Xiaomi (completamente nuevo)" también es Xiaomi.
  const words = normalizeName(product.brand ?? '').split(' ');
  return filter.rule.brands.some((b) => words.includes(b));
}

/** Los productos de un tipo que entran en el filtro, en el mismo orden. */
export function productsOfFilter<T extends Pick<Product, 'name' | 'brand' | 'specs'>>(products: T[], filter: ListingFilter): T[] {
  return products.filter((p) => matchesFilter(p, filter));
}

/** Los chips de los filtros de un tipo que hoy tienen productos, con cuántos. */
export function filterChips<T extends Pick<Product, 'name' | 'brand' | 'specs'>>(
  products: T[],
  filters: ListingFilter[],
): TypeChip[] {
  return filters
    .map((f) => ({ slug: f.slug, label: f.label, count: productsOfFilter(products, f).length }))
    .filter((c) => c.count > 0);
}

/** Los filtros que se indexan: los de la lista con MIN_FILTER_PAGE productos o más. */
export function indexableFilters<T extends Pick<Product, 'name' | 'brand' | 'specs'>>(
  products: T[],
  filters: ListingFilter[],
): ListingFilter[] {
  return filters.filter((f) => productsOfFilter(products, f).length >= MIN_FILTER_PAGE);
}

const TITLE_SUFFIX = ' — Precios y ofertas en Chile';
const SITE_SUFFIX = ' | ComparaTech';

/** El <title>: el formato que aprobó el dueño para los tipos, con "| ComparaTech" solo si cabe. */
export function filterTitle(filter: ListingFilter): string {
  const base = `${filter.label}${TITLE_SUFFIX}`;
  return base.length + SITE_SUFFIX.length <= SEO_TITLE_MAX ? `${base}${SITE_SUFFIX}` : base;
}

