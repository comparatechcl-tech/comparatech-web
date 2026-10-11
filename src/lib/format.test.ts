import { describe, expect, it } from 'vitest';
import { salesLabel, singularizeUnits, specLabel, warrantyLabel } from '@/lib/format';

describe('singularizeUnits', () => {
  it('pasa a singular el plazo de una unidad, que Mercado Libre manda en plural', () => {
    expect(singularizeUnits('1 años')).toBe('1 año');
    expect(singularizeUnits('1 meses')).toBe('1 mes');
    expect(singularizeUnits('1 semanas')).toBe('1 semana');
    expect(singularizeUnits('1 días')).toBe('1 día');
    expect(singularizeUnits('1 dias')).toBe('1 día');
    expect(singularizeUnits('1 horas')).toBe('1 hora');
    expect(singularizeUnits('1 minutos')).toBe('1 minuto');
  });

  it('corrige el plazo en medio de una frase y cada vez que aparece', () => {
    expect(singularizeUnits('Batería de 1 semanas de duración. Resiste hasta 1m bajo el agua.')).toBe(
      'Batería de 1 semana de duración. Resiste hasta 1m bajo el agua.'
    );
    expect(singularizeUnits('Garantía de fábrica: 1 años y 1 meses')).toBe('Garantía de fábrica: 1 año y 1 mes');
    expect(singularizeUnits('(1 Meses)')).toBe('(1 mes)');
    // Dos espacios entre la cifra y la unidad: se respetan y se corrige igual.
    expect(singularizeUnits('Garantía de fábrica: 1  años')).toBe('Garantía de fábrica: 1  año');
  });

  it('deja el plural cuando la cifra no es uno', () => {
    const untouched = [
      '12 meses',
      '30 días',
      '2 años',
      '21 años',
      '11 meses',
      '31 días',
      '101 horas',
      '1,5 años',
      '1.5 años',
      '0,1 años',
      '1.000 días',
    ];
    for (const text of untouched) expect(singularizeUnits(text)).toBe(text);
  });

  it('no toca lo que ya está bien ni las abreviaturas', () => {
    for (const text of ['1 año', '1 mes', '1 día', '1 h', '1 kg', '1 TB', '1 mesesitos']) {
      expect(singularizeUnits(text)).toBe(text);
    }
  });
});

describe('warrantyLabel', () => {
  it('corrige los textos con una unidad que hay en el catálogo', () => {
    expect(warrantyLabel('Garantía de fábrica: 1 años')).toBe('Garantía de fábrica: 1 año');
    expect(warrantyLabel('Garantía del vendedor: 1 años')).toBe('Garantía del vendedor: 1 año');
    expect(warrantyLabel('Garantía del vendedor: 1 meses')).toBe('Garantía del vendedor: 1 mes');
    expect(warrantyLabel('Garantía de fábrica: 1 meses')).toBe('Garantía de fábrica: 1 mes');
    expect(warrantyLabel('Garantía del vendedor: 1 días')).toBe('Garantía del vendedor: 1 día');
  });

  it('deja igual los demás textos del catálogo', () => {
    const untouched = [
      'Garantía de fábrica: 12 meses',
      'Garantía del vendedor: 6 meses',
      'Garantía del vendedor: 30 días',
      'Garantía de fábrica: 2 años',
      'Garantía del vendedor: 18 meses',
      'Garantía del vendedor: 180 días',
      'Garantía de fábrica',
    ];
    for (const text of untouched) expect(warrantyLabel(text)).toBe(text);
  });

  it('antepone "Garantía" cuando el texto trae solo el plazo', () => {
    expect(warrantyLabel('6 meses')).toBe('Garantía: 6 meses');
    expect(warrantyLabel('2 años')).toBe('Garantía: 2 años');
    expect(warrantyLabel('1 años')).toBe('Garantía: 1 año');
  });
});

describe('specLabel', () => {
  it('corrige el plazo de una especificación y deja el resto como viene', () => {
    expect(specLabel('1 días')).toBe('1 día');
    expect(specLabel('40 h')).toBe('40 h');
    expect(specLabel('825 GB')).toBe('825 GB');
    expect(specLabel('Sí')).toBe('Sí');
  });

  it('muestra los números tal cual', () => {
    expect(specLabel(2025)).toBe('2025');
    expect(specLabel(1)).toBe('1');
  });
});

describe('salesLabel', () => {
  it('concuerda en singular con una sola venta', () => {
    expect(salesLabel(1)).toBe('1 venta');
  });

  it('usa el plural y el separador de miles en el resto', () => {
    expect(salesLabel(0)).toBe('0 ventas');
    expect(salesLabel(2)).toBe('2 ventas');
    expect(salesLabel(1306)).toBe('1.306 ventas');
    expect(salesLabel(1000001)).toBe('1.000.001 ventas');
  });
});
