import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StoreOffers } from '@/components/product/StoreOffers';
import { publicStoreOffers, type PublicStoreOffer } from '@/lib/store-offers';

/*
 * Lo que la ficha pública dice del precio en otras tiendas: siempre con el
 * día en que se revisó, nunca como "hoy", sin palabras que la marca no usa y
 * con un link que no pasa autoridad a la tienda.
 */

const PRODUCT = '11111111-1111-4111-8111-111111111111';

const PARIS: PublicStoreOffer = {
  store: 'paris',
  storeName: 'Paris',
  price: 699_990,
  checkedAt: '2026-11-26T11:17:00Z',
  url: 'https://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html',
  seller: null,
  commission: true,
};

const MAC: PublicStoreOffer = {
  store: 'maconline',
  storeName: 'MacOnline',
  price: 1_099_990,
  checkedAt: '2026-11-25T23:30:00Z',
  url: 'https://www.maconline.com/products/iphone-17#default_sku=MG6J4BE/A',
  seller: null,
  commission: false,
};

describe('StoreOffers', () => {
  it('sin ofertas no dibuja nada: la ficha queda igual que siempre', () => {
    expect(renderToStaticMarkup(<StoreOffers offers={[]} productId={PRODUCT} />)).toBe('');
  });

  it('muestra cada tienda con su precio, el día de la revisión (hora de Chile) y su link', () => {
    const html = renderToStaticMarkup(<StoreOffers offers={[PARIS, MAC]} productId={PRODUCT} />);
    expect(html).toContain('Precio en otras tiendas');
    expect(html).toContain('$699.990');
    expect(html).toContain('Precio revisado el 26/11');
    // 23:30 UTC del 25 son las 20:30 del 25 en Chile.
    expect(html).toContain('Precio revisado el 25/11');
    expect(html).toContain('Ver en Paris');
    expect(html).toContain('href="https://www.maconline.com/products/iphone-17#default_sku=MG6J4BE/A"');
    expect(html).toContain('rel="nofollow noopener"');
    expect(html).toContain('target="_blank"');
  });

  it('dice quién vende cuando no es la tienda misma', () => {
    const html = renderToStaticMarkup(<StoreOffers offers={[{ ...PARIS, seller: 'Tecno Store SpA' }]} productId={PRODUCT} />);
    expect(html).toContain('Vendido por Tecno Store SpA');
    expect(renderToStaticMarkup(<StoreOffers offers={[PARIS]} productId={PRODUCT} />)).not.toContain('Vendido por');
  });

  it('no dice "hoy" de un precio ni usa las palabras que la marca no usa', () => {
    const html = renderToStaticMarkup(<StoreOffers offers={[PARIS, MAC]} productId={PRODUCT} />).toLowerCase();
    // La única mención de "hoy" manda a ver el precio de hoy a la tienda.
    expect(html).not.toContain('precio de hoy');
    expect(html).not.toContain('precio hoy');
    expect(html).toContain('el de hoy está en la tienda');
    for (const banned of ['mejor precio', 'más barato', 'mas barato', 'recomendad', 'imperdible', 'solo hoy', 'verificad', 'precio de lista', 'precio normal', 'rebajad', 'publicidad', 'comisi']) {
      expect(html, banned).not.toContain(banned);
    }
  });

  it('aclara qué precio es: el publicado por la tienda, sin descuentos por medio de pago', () => {
    const html = renderToStaticMarkup(<StoreOffers offers={[PARIS]} productId={PRODUCT} />);
    expect(html).toContain('sin descuentos por medio de pago');
  });
});

describe('de la tabla a la ficha', () => {
  it('una fila guardada se muestra tal cual, y una que no se debe mostrar no llega', () => {
    const now = Date.parse('2026-11-26T15:00:00Z');
    const base = {
      store: 'paris',
      url: PARIS.url,
      external_id: 'MK3LFN4PP4',
      seller: 'Paris',
      price: 699_990,
      checked_at: PARIS.checkedAt,
      status: 'activo' as const,
    };
    const html = renderToStaticMarkup(<StoreOffers offers={publicStoreOffers([base], now)} productId={PRODUCT} />);
    expect(html).toContain('$699.990');
    expect(renderToStaticMarkup(<StoreOffers offers={publicStoreOffers([{ ...base, status: 'pausado' }], now)} productId={PRODUCT} />)).toBe('');
  });
});
