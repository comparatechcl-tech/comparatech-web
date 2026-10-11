import { describe, expect, it } from 'vitest';
import { resolveDescription } from '@/lib/product-description';

const base = { name: 'Smartband Keluona ZL02', brand: 'Keluona', is_active: true };

describe('resolveDescription', () => {
  it('corrige el plazo en singular que Mercado Libre manda en plural', () => {
    expect(
      resolveDescription({
        ...base,
        description: 'Memoria interna de 32MB y RAM de 32MB. Batería de 1 semanas de duración. Resiste hasta 1m bajo el agua.',
      })
    ).toBe('Memoria interna de 32MB y RAM de 32MB. Batería de 1 semana de duración. Resiste hasta 1m bajo el agua.');
  });

  it('deja igual una descripción sin ese error', () => {
    const description = 'Batería de 400 mAh que ofrece 45 horas de reproducción continua.';
    expect(resolveDescription({ ...base, description })).toBe(description);
  });

  it('sin descripción guardada usa el texto de respaldo', () => {
    expect(resolveDescription({ ...base, description: '  ' })).toBe(
      'Smartband Keluona ZL02 de Keluona: precio actualizado, especificaciones y reputación del vendedor. Compara antes de comprar en Mercado Libre Chile.'
    );
    expect(resolveDescription({ ...base, description: '', is_active: false })).toBe(
      'Smartband Keluona ZL02 de Keluona: especificaciones y alternativas disponibles en Mercado Libre Chile.'
    );
  });
});
