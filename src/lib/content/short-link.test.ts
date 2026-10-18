import { describe, expect, it } from 'vitest';
import { mlIdFromShortCode } from './short-link';

describe('link corto', () => {
  it('de vuelta: solo dígitos, y del largo de un código', () => {
    expect(mlIdFromShortCode('78729874')).toBe('MLC78729874');
    expect(mlIdFromShortCode('7872')).toBeNull();
    expect(mlIdFromShortCode('MLC78729874')).toBeNull();
    expect(mlIdFromShortCode('78729874; DROP')).toBeNull();
  });
});
