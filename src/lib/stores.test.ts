import { describe, expect, it } from 'vitest';
import {
  STORES,
  cleanStoreUrl,
  getStore,
  isStoreSku,
  paysCommission,
  skuFromStoreUrl,
  storeForUrl,
  storeProductUrl,
} from './stores';

describe('STORES', () => {
  it('cada tienda tiene clave única, dominios propios y una forma de saber su precio', () => {
    const keys = STORES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const hosts = STORES.flatMap((s) => s.hosts);
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const store of STORES) {
      expect(store.key).toMatch(/^[a-z]+$/);
      expect(store.hosts.length).toBeGreaterThan(0);
      for (const host of store.hosts) expect(host).toBe(host.toLowerCase());
      expect(['ficha', 'api', 'manual']).toContain(store.price);
    }
  });

  it('las tiendas cuyos términos prohíben leer sus páginas no se leen de la ficha', () => {
    expect(getStore('samsung')?.price).toBe('manual');
    expect(getStore('xiaomi')?.price).toBe('manual');
  });

  it('Mercado Libre no está: sus páginas no se leen con programas', () => {
    expect(STORES.some((s) => s.hosts.some((h) => h.includes('mercadolibre')))).toBe(false);
    expect(storeForUrl('https://www.mercadolibre.cl/p/MLC61403702')).toBeNull();
  });
});

describe('getStore', () => {
  it('encuentra una tienda por su clave', () => {
    expect(getStore('paris')?.name).toBe('Paris');
    expect(getStore('falabella')).toBeNull();
    expect(getStore('')).toBeNull();
    expect(getStore(null)).toBeNull();
  });
});

describe('storeForUrl', () => {
  it('reconoce la tienda por el dominio exacto', () => {
    expect(storeForUrl('https://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html')?.store.key).toBe('paris');
    expect(storeForUrl('  https://PARIS.cl/algo.html  ')?.store.key).toBe('paris');
    expect(storeForUrl('https://www.maconline.com/t/iphone')?.store.key).toBe('maconline');
  });

  it('un dominio parecido, otra tienda o algo que no es una dirección web quedan fuera', () => {
    expect(storeForUrl('https://www.paris.cl.otro.com/algo.html')).toBeNull();
    expect(storeForUrl('https://otro.com/?u=https://www.paris.cl/algo.html')).toBeNull();
    expect(storeForUrl('https://tienda.paris.cl/algo.html')).toBeNull();
    expect(storeForUrl('https://www.falabella.com/falabella-cl/product/123')).toBeNull();
    expect(storeForUrl('javascript:alert(1)')).toBeNull();
    expect(storeForUrl('ftp://www.paris.cl/algo.html')).toBeNull();
    expect(storeForUrl('www.paris.cl/algo.html')).toBeNull();
    expect(storeForUrl('')).toBeNull();
  });

  it('no acepta usuario, clave ni puertos raros: esa dirección después se le pide al servidor', () => {
    expect(storeForUrl('https://alguien:clave@www.paris.cl/algo.html')).toBeNull();
    expect(storeForUrl('https://www.paris.cl:8443/algo.html')).toBeNull();
    expect(storeForUrl('https://www.paris.cl:443/algo.html')?.store.key).toBe('paris');
  });
});

describe('cleanStoreUrl', () => {
  it('deja la dirección en https, sin parámetros de seguimiento ni ancla', () => {
    expect(
      cleanStoreUrl('http://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html?utm_source=google&gclid=abc#fotos')
    ).toEqual({
      store: getStore('paris'),
      url: 'https://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html',
    });
  });

  it('la portada no es la ficha de un producto', () => {
    expect(cleanStoreUrl('https://www.paris.cl/')).toBeNull();
    expect(cleanStoreUrl('https://www.paris.cl')).toBeNull();
  });

  it('de Samsung y Xiaomi solo sirve la tienda chilena', () => {
    expect(cleanStoreUrl('https://www.samsung.com/cl/smartphones/galaxy-s26/buy/')?.store.key).toBe('samsung');
    expect(cleanStoreUrl('https://www.samsung.com/us/smartphones/galaxy-s26/buy/')).toBeNull();
    expect(cleanStoreUrl('https://www.mi.com/cl/product/redmi-note-15/')?.store.key).toBe('xiaomi');
    expect(cleanStoreUrl('https://www.mi.com/es/product/redmi-note-15/')).toBeNull();
  });

  it('lo que no es de una tienda de la lista no se limpia: se rechaza', () => {
    expect(cleanStoreUrl('https://www.ripley.cl/algo-2000123456789')).toBeNull();
    expect(cleanStoreUrl('no es un link')).toBeNull();
  });
});

describe('versiones de una ficha', () => {
  const MAC = getStore('maconline')!;
  const FICHA = 'https://www.maconline.com/products/iphone-17';

  it('saca la versión de una dirección de MacOnline y la limpia igual', () => {
    expect(skuFromStoreUrl(`${FICHA}#default_sku=MG6J4BE/A`)).toBe('MG6J4BE/A');
    expect(skuFromStoreUrl(`${FICHA}#otra=1&default_sku=MG6J4BE%2FA`)).toBe('MG6J4BE/A');
    expect(skuFromStoreUrl(FICHA)).toBeNull();
    expect(skuFromStoreUrl(`${FICHA}#default_sku=<script>`)).toBeNull();
    expect(cleanStoreUrl(`${FICHA}#default_sku=MG6J4BE/A`)?.url).toBe(FICHA);
    // Paris tiene una ficha por producto: no hay versión en la dirección.
    expect(skuFromStoreUrl('https://www.paris.cl/algo-MK1.html#default_sku=X1')).toBeNull();
  });

  it('arma la dirección de la versión solo donde la tienda la usa y el código es limpio', () => {
    expect(storeProductUrl(MAC, FICHA, 'MG6J4BE/A')).toBe(`${FICHA}#default_sku=MG6J4BE/A`);
    expect(storeProductUrl(MAC, FICHA, null)).toBe(FICHA);
    expect(storeProductUrl(MAC, FICHA, 'x" onclick="')).toBe(FICHA);
    const paris = 'https://www.paris.cl/algo-MK1.html';
    expect(storeProductUrl(getStore('paris')!, paris, 'MK1')).toBe(paris);
  });

  it('un código de tienda es corto y sin signos raros', () => {
    expect(isStoreSku('MKJOF7SICL')).toBe(true);
    expect(isStoreSku('393981999')).toBe(true);
    expect(isStoreSku('MG6J4BE/A')).toBe(true);
    expect(isStoreSku('')).toBe(false);
    expect(isStoreSku('a b')).toBe(false);
    expect(isStoreSku('a?b=1')).toBe(false);
    expect(isStoreSku('x'.repeat(41))).toBe(false);
    expect(isStoreSku(null)).toBe(false);
  });
});

describe('paysCommission', () => {
  it('distingue las tiendas con programa de afiliados de las que solo se comparan', () => {
    expect(paysCommission(getStore('paris')!)).toBe(true);
    expect(paysCommission(getStore('aliexpress')!)).toBe(true);
    expect(paysCommission(getStore('maconline')!)).toBe(false);
  });
});
