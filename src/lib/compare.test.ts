import { describe, expect, it } from 'vitest';
import {
  betterSpec,
  compareOptionsForB,
  defaultComparePair,
  groupByCategory,
  sharedSpecKeys,
  topSeller,
  type CompareCandidate,
} from '@/lib/compare';

function p(slug: string, domain: string | null, sales: number, category = 'audio', name = slug): CompareCandidate {
  return { slug, name, category, ml_domain_id: domain, seller_sales_count: sales };
}

describe('defaultComparePair', () => {
  it('elige los dos más vendidos del dominio con más productos', () => {
    const products = [
      p('parlante', 'MLC-SPEAKERS', 9000),
      p('iphone', 'MLC-CELLPHONES', 8000, 'celulares'),
      p('aud-1', 'MLC-HEADPHONES', 50),
      p('aud-2', 'MLC-HEADPHONES', 700),
      p('aud-3', 'MLC-HEADPHONES', 300),
      p('parlante-2', 'MLC-SPEAKERS', 10),
    ];
    expect(defaultComparePair(products)).toEqual(['aud-2', 'aud-3']);
  });

  it('nunca arma un par de dominios distintos si hay un dominio con dos', () => {
    const products = [p('a', 'X', 1), p('b', 'Y', 100), p('c', 'Y', 5)];
    expect(defaultComparePair(products)).toEqual(['b', 'c']);
  });

  it('cae a los dos primeros si ningún dominio tiene dos productos', () => {
    expect(defaultComparePair([p('a', 'X', 1), p('b', null, 2)])).toEqual(['a', 'b']);
    expect(defaultComparePair([p('a', 'X', 1)])).toEqual(['a', 'a']);
    expect(defaultComparePair([])).toEqual(['', '']);
  });
});

describe('compareOptionsForB', () => {
  const products = [p('a1', 'A', 1), p('a2', 'A', 2), p('b1', 'B', 3), p('n', null, 4)];

  it('limita B al mismo dominio que A, sin A', () => {
    const { options, restricted } = compareOptionsForB(products, products[0], false);
    expect(options.map((x) => x.slug)).toEqual(['a2']);
    expect(restricted).toBe(true);
  });

  it('muestra todo con el toggle', () => {
    const { options, restricted } = compareOptionsForB(products, products[0], true);
    expect(options.map((x) => x.slug)).toEqual(['a2', 'b1', 'n']);
    expect(restricted).toBe(false);
  });

  it('muestra todo si A no tiene dominio o es el único de su dominio', () => {
    expect(compareOptionsForB(products, products[3], false).options).toHaveLength(3);
    expect(compareOptionsForB(products, products[2], false).restricted).toBe(false);
  });

  it('topSeller devuelve el más vendido', () => {
    expect(topSeller(products)?.slug).toBe('n');
    expect(topSeller([])).toBeUndefined();
  });
});

describe('groupByCategory', () => {
  it('agrupa en el orden del registro y ordena por nombre', () => {
    const groups = groupByCategory([
      p('z', 'A', 1, 'audio', 'Zeta'),
      p('c', 'C', 1, 'celulares', 'Celu'),
      p('a', 'A', 1, 'audio', 'Alfa'),
      p('x', 'X', 1, 'nueva', 'Nuevo'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Celulares', 'Audio', 'Nueva']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('sharedSpecKeys', () => {
  it('deja solo las claves que tienen ambos, con valor', () => {
    expect(
      sharedSpecKeys(
        { Color: 'Negro', 'Memoria RAM': '8 GB', Modelo: 'X', Vacía: '' },
        { 'Memoria RAM': '6 GB', Color: 'Azul', Batería: '5000 mAh', Vacía: 'algo' }
      )
    ).toEqual(['Color', 'Memoria RAM']);
  });
});

describe('betterSpec', () => {
  it('destaca el valor mayor en la lista blanca', () => {
    expect(betterSpec('Memoria RAM', '8 GB', '6 GB')).toBe('a');
    expect(betterSpec('Memoria interna', '128 GB', '1 TB')).toBe('b');
    expect(betterSpec('Capacidad de la batería', '5000 mAh', '4500 mAh')).toBe('a');
    expect(betterSpec('Potencia de salida (RMS)', '4,8 W', '16 W')).toBe('b');
    expect(betterSpec('Autonomía máxima de la batería', '8 h', '14 h')).toBe('b');
    expect(betterSpec('Duración de la batería del audífono', '1 días', '20 h')).toBe('a');
    expect(betterSpec('Clasificación IP', 'IP67', 'IP54')).toBe('a');
  });

  it('no destaca specs fuera de la lista blanca', () => {
    expect(betterSpec('Tamaño de la caja', '49 mm', '43 mm')).toBeNull();
    expect(betterSpec('Tiempo de carga del audífono', '1.5 h', '2 h')).toBeNull();
    expect(betterSpec('Alcance inalámbrico', '20 m', '10 m')).toBeNull();
  });

  it('nunca destaca el voltaje, aunque diga potencia', () => {
    expect(betterSpec('Voltaje', '220V', '5V')).toBeNull();
    expect(betterSpec('Voltaje de salida', '22.5W', '5V')).toBeNull();
    expect(betterSpec('Potencia y voltaje', '20 W', '10 W')).toBeNull();
  });

  it('no destaca empates, unidades raras ni IP sin ganador claro', () => {
    expect(betterSpec('Memoria RAM', '8 GB', '8 GB')).toBeNull();
    expect(betterSpec('Capacidad de la batería', '5000', '4000 mAh')).toBeNull();
    expect(betterSpec('Tipo de batería', 'Ion de litio', 'Polímero')).toBeNull();
    expect(betterSpec('Clasificación IP', 'IP54', 'IPX7')).toBeNull();
    expect(betterSpec('Memoria RAM', undefined, '8 GB')).toBeNull();
  });
});
