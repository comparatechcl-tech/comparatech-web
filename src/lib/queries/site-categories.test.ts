import { describe, expect, it, vi } from 'vitest';
import { categoriesWithCounts, MIN_PRODUCTS_PER_CATEGORY } from '@/lib/queries/site-categories';

// lib/queries/products usa cache() de React 19 (el que trae Next). El React
// de node_modules que ven los tests no lo tiene: acá no hace falta memoizar.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

const products = [
  ...Array.from({ length: 5 }, () => ({ category: 'audio' })),
  ...Array.from({ length: 3 }, () => ({ category: 'celulares' })),
  { category: 'computacion' },
  ...Array.from({ length: 4 }, () => ({ category: 'drones' })),
];

describe('categoriesWithCounts', () => {
  it(`deja solo las categorías con ${MIN_PRODUCTS_PER_CATEGORY} o más productos, en el orden del registro`, () => {
    expect(categoriesWithCounts(products)).toEqual([
      { slug: 'celulares', name: 'Celulares', count: 3 },
      { slug: 'audio', name: 'Audio', count: 5 },
      // Fuera del registro: igual aparece, con el slug capitalizado.
      { slug: 'drones', name: 'Drones', count: 4 },
    ]);
  });

  it('con mínimo 1 incluye todas las pobladas y nunca las vacías', () => {
    const slugs = categoriesWithCounts(products, 1).map((c) => c.slug);
    expect(slugs).toEqual(['celulares', 'computacion', 'audio', 'drones']);
    expect(slugs).not.toContain('gaming');
  });
});
