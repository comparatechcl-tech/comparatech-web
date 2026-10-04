import { describe, expect, it } from 'vitest';
import { collapseToModels, reviewableCandidates } from '@/lib/candidate-queue';

const row = (id: string, family: string | null, price: number, product = `MLC-${id}`) => ({
  id,
  ml_product_id: product,
  ml_family_id: family,
  price,
});

describe('collapseToModels', () => {
  it('cuenta un modelo por familia (el más barato) y cada fila sin familia', () => {
    const models = collapseToModels([
      row('a', 'F1', 30_000),
      row('b', 'F1', 25_000),
      row('c', 'F1', 25_000),
      row('d', null, 10_000),
      row('e', null, 12_000),
      row('f', 'F2', 5_000),
    ]);
    expect(models.map((m) => m.id).sort()).toEqual(['b', 'd', 'e', 'f']);
  });
});

describe('reviewableCandidates', () => {
  it('saca los colores de un modelo ya publicado, salvo que sean bastante más baratos', () => {
    const catalog = [{ ml_product_id: 'MLC-pub', ml_family_id: 'F1', price: 100_000 }];
    const rows = [
      row('mismo', null, 100_000, 'MLC-pub'),
      row('otro-color', 'F1', 99_000),
      row('mucho-mas-barato', 'F1', 90_000),
      row('otro-modelo', 'F2', 50_000),
    ];
    expect(reviewableCandidates(rows, catalog).map((r) => r.id)).toEqual(['mucho-mas-barato', 'otro-modelo']);
  });
});
