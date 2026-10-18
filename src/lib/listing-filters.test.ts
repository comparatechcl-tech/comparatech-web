import { describe, expect, it, vi } from 'vitest';

// lib/category-listing lee de lib/queries/products, que usa cache() de React 19 y Supabase.
vi.mock('@/lib/queries/products', async () => {
  const { MIN_DEAL_DISCOUNT, discountOf } = await import('@/lib/deal-rank');
  return { MIN_DEAL_DISCOUNT, discountPercent: discountOf };
});

import {
  LISTING_FILTERS,
  MIN_FILTER_PAGE,
  filterChips,
  filterPath,
  filterTitle,
  filtersOfType,
  getFilter,
  indexableFilters,
  matchesFilter,
  productsOfFilter,
  screenInches,
} from './listing-filters';
import { SEO_TITLE_MAX } from './seo-title';
import { domainLabel, typeSlug } from './product-types';
import { categoryFromDomain } from './categories';

const tv = (name: string, inches: string | null, brand = 'Samsung') => ({
  name,
  brand,
  specs: (inches ? { 'Tamaño de la pantalla': inches } : {}) as Record<string, string | number>,
});

describe('la lista de filtros', () => {
  it('cada filtro tiene una dirección propia', () => {
    const paths = LISTING_FILTERS.map(filterPath);
    expect(new Set(paths).size).toBe(paths.length);
    for (const f of LISTING_FILTERS) expect(f.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(filterPath(getFilter('electronica', 'televisores', '55-pulgadas')!)).toBe('/categoria/electronica/televisores/55-pulgadas');
    expect(getFilter('electronica', 'televisores', '99-pulgadas')).toBeUndefined();
  });

  it('vive en un tipo que existe en su categoría', () => {
    const types = new Map<string, string>();
    for (const domain of ['MLC-TELEVISIONS', 'MLC-CELLPHONES', 'MLC-SPEAKERS', 'MLC-SMARTWATCHES', 'MLC-TABLETS', 'MLC-REFRIGERATORS', 'MLC-WASHING_MACHINES']) {
      types.set(typeSlug(domainLabel(domain)), categoryFromDomain(domain)!);
    }
    for (const f of LISTING_FILTERS) expect(types.get(f.type)).toBe(f.category);
  });

  it('el título cabe en lo que muestra Google, con "| ComparaTech" solo si cabe', () => {
    for (const f of LISTING_FILTERS) expect(filterTitle(f).length).toBeLessThanOrEqual(SEO_TITLE_MAX);
    expect(filterTitle(getFilter('audio', 'parlantes', 'jbl')!)).toBe('Parlantes JBL — Precios y ofertas en Chile | ComparaTech');
    expect(filterTitle(getFilter('electronica', 'televisores', '55-pulgadas')!)).toBe(
      'Smart TV 55 pulgadas — Precios y ofertas en Chile',
    );
  });

  it('se indexa desde los mismos 6 productos que un tipo', () => {
    expect(MIN_FILTER_PAGE).toBe(6);
  });
});

describe('qué entra en cada filtro', () => {
  it('las pulgadas salen de la ficha, o del nombre si la ficha no las trae', () => {
    expect(screenInches(tv('Smart TV 55 4K', '55 "'))).toBe(55);
    expect(screenInches(tv('Monitor', '23.8 "'))).toBe(24);
    expect(screenInches(tv("43'' UHD U8000H Vision AI Smart TV (2026)", null))).toBe(43);
    expect(screenInches(tv('Smart TV TCL 55" UHD 4K V6D', null))).toBe(55);
    expect(screenInches(tv('Smart Tv 32 Pulgadas Hd', null))).toBe(32);
    expect(screenInches(tv('Smart Tv Aoc Led Hd', null))).toBeNull();
  });

  it('la marca es la que informa Mercado Libre, aunque traiga más palabras', () => {
    const xiaomi = getFilter('celulares', 'celulares', 'xiaomi')!;
    expect(matchesFilter({ name: 'Poco C85', brand: 'Xiaomi (completamente nuevo)', specs: {} }, xiaomi)).toBe(true);
    expect(matchesFilter({ name: 'Galaxy A07', brand: 'Samsung', specs: {} }, xiaomi)).toBe(false);
    // "iPhone" es la marca Apple dentro de Celulares.
    const iphone = getFilter('celulares', 'celulares', 'iphone')!;
    expect(matchesFilter({ name: 'Apple iPhone 17 (256 GB)', brand: 'Apple', specs: {} }, iphone)).toBe(true);
  });

  it('chips con cuántos hay de cada filtro, solo los que tienen; e indexables desde 6', () => {
    const products = [
      ...Array.from({ length: 6 }, (_, i) => tv(`TV ${i}`, '55 "', i < 4 ? 'Samsung' : 'TCL')),
      tv('TV 32', '32 "', 'LG'),
    ];
    const filters = filtersOfType('electronica', 'televisores');
    expect(filterChips(products, filters)).toEqual([
      { slug: '32-pulgadas', label: 'Smart TV 32 pulgadas', count: 1 },
      { slug: '55-pulgadas', label: 'Smart TV 55 pulgadas', count: 6 },
      { slug: 'samsung', label: 'Smart TV Samsung', count: 4 },
      { slug: 'lg', label: 'Smart TV LG', count: 1 },
      { slug: 'tcl', label: 'Smart TV TCL', count: 2 },
    ]);
    expect(indexableFilters(products, filters).map((f) => f.slug)).toEqual(['55-pulgadas']);
    expect(productsOfFilter(products, getFilter('electronica', 'televisores', 'lg')!).map((p) => p.name)).toEqual(['TV 32']);
  });
});
