import { describe, expect, it } from 'vitest';
import { parseClickBody } from './clicks';
import { parseStoreClickBody, storeClickDedupKey, storeClickPayload } from './store-clicks';

const PRODUCT = '11111111-1111-4111-8111-111111111111';

describe('parseStoreClickBody', () => {
  it('acepta lo que manda el botón de una tienda', () => {
    expect(parseStoreClickBody(storeClickPayload(PRODUCT, 'paris', 'chatgpt.com', true))).toEqual({
      productId: PRODUCT,
      store: 'paris',
      src: 'chatgpt.com',
      mobile: true,
    });
    expect(parseStoreClickBody(JSON.stringify({ p: PRODUCT.toUpperCase(), t: 'maconline' }))).toEqual({
      productId: PRODUCT,
      store: 'maconline',
      src: null,
      mobile: false,
    });
  });

  it('descarta lo que no es un clic bien formado hacia una tienda', () => {
    for (const bad of [
      '',
      'no es json',
      '[]',
      JSON.stringify({ p: PRODUCT }),
      JSON.stringify({ t: 'paris' }),
      JSON.stringify({ p: 'vista-previa', t: 'paris' }),
      JSON.stringify({ p: PRODUCT, t: 'Paris' }),
      JSON.stringify({ p: PRODUCT, t: 'paris; drop table' }),
      JSON.stringify({ p: PRODUCT, t: 7 }),
      JSON.stringify({ p: PRODUCT, t: 'paris', relleno: 'x'.repeat(2000) }),
    ]) {
      expect(parseStoreClickBody(bad), bad.slice(0, 40)).toBeNull();
    }
  });

  it('un clic hacia Mercado Libre no es un clic a una tienda, y al revés', () => {
    const ml = JSON.stringify({ p: PRODUCT, s: 'ficha', m: 'directo', src: null, mob: false });
    expect(parseStoreClickBody(ml)).toBeNull();
    expect(parseClickBody(ml)).not.toBeNull();
    // El de una tienda no trae `s`: no se cuenta como clic hacia Mercado Libre.
    expect(parseClickBody(storeClickPayload(PRODUCT, 'paris', null, false))).toBeNull();
  });
});

describe('storeClickDedupKey', () => {
  it('es una marca por producto y tienda', () => {
    expect(storeClickDedupKey(PRODUCT, 'paris')).not.toBe(storeClickDedupKey(PRODUCT, 'maconline'));
    expect(storeClickDedupKey(PRODUCT, 'paris')).toContain(PRODUCT);
  });
});
