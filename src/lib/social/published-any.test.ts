import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

import { ANY_FORMAT_REPEAT_DAYS, droppedSincePublished, lowestPublishedPrice, stillPublished } from './published-any';

/**
 * Lo publicado en cualquier formato no se vuelve a sugerir en otro durante
 * 14 días, salvo que haya bajado 3% o más (pedido del dueño, 07-11-2026).
 */
describe('lo publicado en cualquier formato', () => {
  it('guarda el precio más bajo con que salió cada producto', () => {
    const map = lowestPublishedPrice([
      { product_id: 'a', posted_price: 100_000 },
      { product_id: 'a', posted_price: 90_000 },
      { product_id: 'a', posted_price: null },
      { product_id: 'b', posted_price: null },
      { product_id: null, posted_price: 50_000 },
    ]);
    expect([...map.entries()]).toEqual([
      ['a', 90_000],
      ['b', null],
    ]);
  });

  it('vuelve solo si bajó 3% o más desde que salió', () => {
    expect(droppedSincePublished(100_000, 97_000)).toBe(true);
    expect(droppedSincePublished(100_000, 97_500)).toBe(false);
    expect(droppedSincePublished(null, 10_000)).toBe(false);
    expect(ANY_FORMAT_REPEAT_DAYS).toBe(14);
  });

  it('saca lo publicado que no ha bajado y deja lo nuevo y lo que bajó', () => {
    const published = new Map<string, number | null>([
      ['igual', 100_000],
      ['bajo', 100_000],
      ['sin-precio', null],
    ]);
    const rows = [
      { id: 'igual', price: 100_000 },
      { id: 'bajo', price: 90_000 },
      { id: 'sin-precio', price: 80_000 },
      { id: 'nuevo', price: 50_000 },
    ];
    expect([...stillPublished(published, rows)].sort()).toEqual(['igual', 'sin-precio']);
  });
});
