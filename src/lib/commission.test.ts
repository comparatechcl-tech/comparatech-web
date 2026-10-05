import { describe, expect, it } from 'vitest';
import { commissionRate, estimateCommission } from '@/lib/commission';

describe('commissionRate', () => {
  it('tecnología paga 7% directo y 2% indirecto', () => {
    for (const id of ['MLC1051', 'MLC1648', 'MLC1000', 'MLC1144', 'MLC1039', 'MLC5726']) {
      expect(commissionRate(id)).toEqual({ direct: 0.07, indirect: 0.02, source: 'tabla' });
    }
  });

  it('las categorías generales pagan 11% directo y 4% indirecto', () => {
    for (const id of ['MLC1574', 'MLC1276', 'MLC3937', 'MLC1182', 'MLC1246']) {
      expect(commissionRate(id)).toEqual({ direct: 0.11, indirect: 0.04, source: 'tabla' });
    }
  });

  it('una raíz desconocida o ausente asume la tasa de tecnología', () => {
    expect(commissionRate('MLC9999')).toEqual({ direct: 0.07, indirect: 0.02, source: 'asumido' });
    expect(commissionRate(null)).toEqual({ direct: 0.07, indirect: 0.02, source: 'asumido' });
  });
});

describe('estimateCommission', () => {
  it('multiplica el precio por la tasa directa y redondea', () => {
    expect(estimateCommission(64_990, 'MLC1000')).toBe(4549);
    expect(estimateCommission(19_990, 'MLC1574')).toBe(2199);
    expect(estimateCommission(10_000, null)).toBe(700);
  });

  it('un precio inválido no deja comisión', () => {
    expect(estimateCommission(0, 'MLC1000')).toBe(0);
    expect(estimateCommission(Number.NaN, 'MLC1000')).toBe(0);
  });
});
