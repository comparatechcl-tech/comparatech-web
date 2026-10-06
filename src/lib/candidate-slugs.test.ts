import { describe, expect, it } from 'vitest';
import { assignSlugs, baseSlug, slugify, suffixedSlug } from '@/lib/candidate-slugs';

describe('slugify', () => {
  it('quita tildes, mayúsculas y símbolos', () => {
    expect(slugify('Audífonos Inalámbricos JBL Tune 520BT — Negro')).toBe('audifonos-inalambricos-jbl-tune-520bt-negro');
    expect(slugify('  Smart TV 55"  ')).toBe('smart-tv-55');
  });

  it('un nombre sin letras ni números igual tiene slug', () => {
    expect(slugify('—')).toBe('');
    expect(baseSlug('—')).toBe('producto');
  });
});

describe('assignSlugs', () => {
  const a = { id: 'aaaaa111-0000', name: 'Mouse Logitech G203' };
  const b = { id: 'bbbbb222-0000', name: 'Mouse Logitech G203' };
  const c = { id: 'ccccc333-0000', name: 'Teclado Redragon Kumara' };

  it('usa el slug del nombre cuando está libre', () => {
    const slugs = assignSlugs([a, c], []);
    expect(slugs.get(a.id)).toBe('mouse-logitech-g203');
    expect(slugs.get(c.id)).toBe('teclado-redragon-kumara');
  });

  it('desempata con el id si el slug ya existe en el catálogo', () => {
    const slugs = assignSlugs([a], ['mouse-logitech-g203']);
    expect(slugs.get(a.id)).toBe('mouse-logitech-g203-aaaaa');
    expect(slugs.get(a.id)).toBe(suffixedSlug(a.name, a.id));
  });

  it('dos candidatos con el mismo nombre en la misma tanda no chocan', () => {
    const slugs = assignSlugs([a, b, c], []);
    expect(slugs.get(a.id)).toBe('mouse-logitech-g203');
    expect(slugs.get(b.id)).toBe('mouse-logitech-g203-bbbbb');
    expect(new Set(slugs.values()).size).toBe(3);
  });

  it('entrega un slug por candidato, en el orden recibido', () => {
    expect([...assignSlugs([c, a, b], []).keys()]).toEqual([c.id, a.id, b.id]);
  });
});
