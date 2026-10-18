import { describe, expect, it } from 'vitest';
import { mlIdFromShortCode, shortLinkCode, shortLinkText } from './short-link';

describe('link corto', () => {
  it('son los dígitos del código del catálogo de Mercado Libre', () => {
    expect(shortLinkCode('MLC78729874')).toBe('78729874');
    expect(shortLinkCode('MLC1234567890')).toBe('1234567890');
    expect(shortLinkCode('MLA123')).toBeNull();
    expect(shortLinkCode(null)).toBeNull();
  });

  it('se escribe sin "https://" ni "www."', () => {
    expect(shortLinkText('https://www.comparatech.cl', 'MLC78729874')).toBe('comparatech.cl/p/78729874');
    expect(shortLinkText('https://www.comparatech.cl', null)).toBeNull();
    expect(shortLinkText('no es url', 'MLC78729874')).toBeNull();
  });

  it('de vuelta: solo dígitos, y del largo de un código', () => {
    expect(mlIdFromShortCode('78729874')).toBe('MLC78729874');
    expect(mlIdFromShortCode('7872')).toBeNull();
    expect(mlIdFromShortCode('MLC78729874')).toBeNull();
    expect(mlIdFromShortCode('78729874; DROP')).toBeNull();
  });
});
