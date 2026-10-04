import { describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/types';
import {
  categoryIntro,
  categoryMetaDescription,
  domainLabel,
  filterByType,
  itemListJsonLd,
  parseSortOrder,
  sortProducts,
  summarizeCategory,
  typeChips,
  typeSlug,
} from '@/lib/category-listing';

// lib/queries/products usa cache() de React 19 (el que trae Next). El React
// de node_modules que ven los tests no lo tiene: acá no hace falta memoizar.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

function product(over: Partial<Product>): Product {
  return {
    id: over.slug ?? 'x',
    slug: 'x',
    name: 'Producto',
    brand: 'Marca',
    category: 'audio',
    price: 10000,
    original_price: null,
    image_url: '',
    affiliate_url: '',
    description: '',
    specs: {},
    seller_reputation: 'verde',
    seller_sales_count: 0,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: null,
    ml_domain_id: 'MLC-HEADPHONES',
    ml_family_id: null,
    seller_id: null,
    rrss_status: 'sin_usar',
    created_at: '2026-01-01T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: null,
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
    ...over,
  };
}

const catalog = [
  product({ slug: 'a', brand: 'Xiaomi', price: 20000, original_price: 40000, seller_sales_count: 10 }),
  product({ slug: 'b', brand: 'Sony', price: 5000, original_price: 5500, seller_sales_count: 500 }),
  product({ slug: 'c', brand: 'Xiaomi', price: 90000, original_price: 100000, ml_domain_id: 'MLC-SPEAKERS', seller_sales_count: 50 }),
  product({ slug: 'd', brand: 'JBL', price: 30000, ml_domain_id: 'MLC-RARO', seller_sales_count: 50 }),
  product({ slug: 'e', brand: 'Sony', price: 15000, original_price: 30000, ml_domain_id: null }),
];

describe('parseSortOrder', () => {
  it('acepta los valores conocidos y cae a relevancia', () => {
    expect(parseSortOrder('descuento')).toBe('descuento');
    expect(parseSortOrder(['vendidos', 'precio'])).toBe('vendidos');
    expect(parseSortOrder('cualquiera')).toBe('relevancia');
    expect(parseSortOrder(undefined)).toBe('relevancia');
  });
});

describe('sortProducts', () => {
  it('relevancia conserva el orden del catálogo', () => {
    expect(sortProducts(catalog, 'relevancia').map((p) => p.slug)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('descuento: mayor primero, sin descuento al final, empates por precio', () => {
    // a y e tienen 50%; e es más barato.
    expect(sortProducts(catalog, 'descuento').map((p) => p.slug)).toEqual(['e', 'a', 'c', 'b', 'd']);
  });

  it('precio: menor primero', () => {
    expect(sortProducts(catalog, 'precio').map((p) => p.slug)).toEqual(['b', 'e', 'a', 'd', 'c']);
  });

  it('vendidos: seller_sales_count de mayor a menor, estable', () => {
    expect(sortProducts(catalog, 'vendidos').map((p) => p.slug)).toEqual(['b', 'c', 'd', 'a', 'e']);
  });

  it('no muta la lista original', () => {
    sortProducts(catalog, 'precio');
    expect(catalog[0].slug).toBe('a');
  });
});

describe('tipos', () => {
  it('etiqueta los dominios conocidos y el resto como Otros', () => {
    expect(domainLabel('MLC-HEADPHONES')).toBe('Audífonos');
    expect(domainLabel('MLC-SPEAKERS')).toBe('Parlantes');
    expect(domainLabel('MLC-SMARTWATCHES')).toBe('Smartwatch');
    expect(domainLabel('MLC-RARO')).toBe('Otros');
    expect(domainLabel(null)).toBe('Otros');
    expect(typeSlug('Audífonos')).toBe('audifonos');
  });

  it('arma chips por cantidad, con Otros al final', () => {
    expect(typeChips(catalog)).toEqual([
      { slug: 'audifonos', label: 'Audífonos', count: 2 },
      { slug: 'parlantes', label: 'Parlantes', count: 1 },
      { slug: 'otros', label: 'Otros', count: 2 },
    ]);
  });

  it('no arma chips si hay un solo tipo', () => {
    expect(typeChips(catalog.slice(0, 2))).toEqual([]);
  });

  it('filtra por tipo y un tipo desconocido no filtra', () => {
    expect(filterByType(catalog, 'parlantes').map((p) => p.slug)).toEqual(['c']);
    expect(filterByType(catalog, 'otros').map((p) => p.slug)).toEqual(['d', 'e']);
    expect(filterByType(catalog, 'nada')).toHaveLength(5);
    expect(filterByType(catalog, undefined)).toHaveLength(5);
  });
});

describe('textos', () => {
  it('resume la categoría', () => {
    expect(summarizeCategory(catalog)).toEqual({
      count: 5,
      minPrice: 5000,
      maxPrice: 90000,
      brands: ['Sony', 'Xiaomi', 'JBL'],
      dealCount: 2,
    });
  });

  it('escribe la intro con conteo, marcas, rango y ofertas', () => {
    expect(categoryIntro(summarizeCategory(catalog))).toBe(
      'Comparamos 5 productos de Sony, Xiaomi y JBL; desde $5.000 hasta $90.000. Hoy 2 tienen 20% o más de descuento informado por Mercado Libre.'
    );
  });

  it('maneja singular y sin ofertas', () => {
    const intro = categoryIntro(summarizeCategory([catalog[3]]));
    expect(intro).toBe(
      'Comparamos 1 producto de JBL; a $30.000. Hoy ninguno tiene 20% o más de descuento informado por Mercado Libre.'
    );
    expect(categoryIntro(summarizeCategory([]))).toBe('');
  });

  it('meta description con conteo y rango', () => {
    expect(categoryMetaDescription('Audio', summarizeCategory(catalog))).toContain(
      'Compara 5 productos de audio en Chile, desde $5.000 hasta $90.000.'
    );
  });

  it('ItemList JSON-LD válido y sin "<"', () => {
    const json = itemListJsonLd(
      [product({ slug: 'malo', name: 'Audífono </script><script>alert(1)</script>' })],
      'https://ejemplo.cl',
      'Audio'
    );
    expect(json).not.toContain('<');
    const data = JSON.parse(json);
    expect(data['@type']).toBe('ItemList');
    expect(data.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      url: 'https://ejemplo.cl/producto/malo',
      name: 'Audífono </script><script>alert(1)</script>',
    });
  });
});
