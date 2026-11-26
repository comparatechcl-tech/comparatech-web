import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/*
 * La lista de "Otras tiendas" (/admin/tiendas): el orden de las tarjetas y lo
 * que muestra una tarjeta con tiendas ya enlazadas. Se usa desde el teléfono:
 * una tarjeta no puede cambiar de lugar al guardarle una tienda.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Las acciones del servidor no se llaman al dibujar: basta con que existan.
vi.mock('@/app/admin/tiendas/actions', () => ({
  linkStoreOffer: vi.fn(),
  rereadOffer: vi.fn(),
  reviewStoreLink: vi.fn(),
  searchInStore: vi.fn(),
  setOfferPaused: vi.fn(),
  setStoresVisible: vi.fn(),
  unlinkOffer: vi.fn(),
}));

import { orderStoreCards } from '@/app/admin/tiendas/list';
import { ProductCard, VisibilitySwitch, type OfferItem, type ProductItem } from '@/app/admin/tiendas/StoreManager';
import { StoreOffers } from '@/components/product/StoreOffers';

const card = (id: string, clicks: number, linked: boolean, name = `Producto ${id}`) => ({ id, name, clicks, linked });

describe('orderStoreCards', () => {
  it('ordena por clics, tengan o no una tienda enlazada', () => {
    const cards = [card('a', 5, false), card('b', 90, false), card('c', 19, true), card('d', 0, true)];
    expect(orderStoreCards(cards, 20).map((c) => c.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('una tarjeta no cambia de lugar cuando pasa a estar enlazada', () => {
    const before = [card('a', 90, false), card('b', 19, false), card('c', 13, false), card('d', 9, false)];
    const after = before.map((c) => (c.id === 'b' ? { ...c, linked: true } : c));
    expect(orderStoreCards(after, 20).map((c) => c.id)).toEqual(orderStoreCards(before, 20).map((c) => c.id));
  });

  it('muestra todas las enlazadas y solo las más abiertas de las que no tienen tienda', () => {
    const cards = [card('a', 50, false), card('b', 40, false), card('c', 30, false), card('d', 1, true), card('e', 0, true)];
    expect(orderStoreCards(cards, 2).map((c) => c.id)).toEqual(['a', 'b', 'd', 'e']);
    // Al enlazar una de las visibles, entra la siguiente al final de las sin tienda: las de arriba no se mueven.
    const linkedOne = cards.map((c) => (c.id === 'a' ? { ...c, linked: true } : c));
    expect(orderStoreCards(linkedOne, 2).map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('sin repetidos, y con empates ordena por nombre', () => {
    const cards = [card('z', 3, false, 'Zeta'), card('y', 3, false, 'Alfa'), card('z', 3, true, 'Zeta')];
    expect(orderStoreCards(cards, 20).map((c) => c.id)).toEqual(['y', 'z']);
  });
});

const OFFER: OfferItem = {
  id: 7,
  store: 'paris',
  storeName: 'Paris',
  href: 'https://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html',
  title: 'Consola Nintendo Switch 2 Negro',
  seller: 'Paris',
  price: 699_990,
  checkedAt: '2026-11-26T16:50:00Z',
  status: 'activo',
  lastError: null,
  readable: true,
};

const ITEM: ProductItem = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Consola Nintendo Switch 2',
  slug: 'consola-nintendo-switch-2',
  image: 'https://http2.mlstatic.com/D_1.webp',
  mlPrice: 545_337,
  mlDate: '26/11',
  clicks: 90,
  offers: [],
  query: 'Consola Nintendo Switch 2',
};

const STORES = [{ key: 'paris', name: 'Paris' }];

describe('ProductCard', () => {
  it('sin tiendas: ofrece buscar en Paris o pegar el link', () => {
    const html = renderToStaticMarkup(<ProductCard item={ITEM} stores={STORES} />);
    expect(html).toContain('Consola Nintendo Switch 2');
    expect(html).toContain('$545.337');
    expect(html).toContain('90 clics en 30 días');
    expect(html).toContain('Buscar en Paris');
    expect(html).toContain('Revisar');
    expect(html).not.toContain('Leer de nuevo');
  });

  it('con una tienda enlazada: la muestra en la misma tarjeta, con su precio, su fecha y sus botones', () => {
    const preview = <StoreOffers offers={[{ store: 'paris', storeName: 'Paris', price: 699_990, checkedAt: OFFER.checkedAt!, url: OFFER.href, seller: null, commission: true }]} productId="vista-previa" />;
    const html = renderToStaticMarkup(<ProductCard item={{ ...ITEM, offers: [OFFER] }} stores={STORES} preview={preview} />);
    expect(html).toContain('$699.990');
    expect(html).toContain('revisado el 26/11');
    expect(html).toContain('La tienda lo llama: Consola Nintendo Switch 2 Negro');
    for (const button of ['Abrir en Paris', 'Leer de nuevo', 'Pausar', 'Quitar']) expect(html, button).toContain(button);
    // Lo vende la tienda misma: no hace falta decirlo.
    expect(html).not.toContain('Lo vende:');
    expect(html).toContain('Así se ve en la ficha del sitio');
    expect(html).toContain('Precio en otras tiendas');
    // Y sigue pudiendo agregar otra tienda.
    expect(html).toContain('Agregar una tienda');
  });

  it('dice por qué una tienda enlazada no se está mostrando', () => {
    const cases: Array<[Partial<OfferItem>, string, string[]]> = [
      [{ status: 'sin_stock' }, 'no tiene stock', ['Leer de nuevo', 'Pausar']],
      [{ status: 'error', lastError: 'bloqueada: la tienda respondió 403' }, 'No se pudo leer varias veces', ['Leer de nuevo', 'Último intento: bloqueada']],
      [{ status: 'pausado' }, 'En pausa', ['Reanudar']],
      [{ seller: 'Tecno Store SpA' }, 'Lo vende: Tecno Store SpA', ['Pausar']],
    ];
    for (const [over, note, buttons] of cases) {
      const html = renderToStaticMarkup(<ProductCard item={{ ...ITEM, offers: [{ ...OFFER, ...over }] }} stores={STORES} />);
      expect(html, note).toContain(note);
      for (const button of buttons) expect(html, button).toContain(button);
    }
    // Una ficha en pausa no se vuelve a leer desde acá: primero se reanuda.
    expect(renderToStaticMarkup(<ProductCard item={{ ...ITEM, offers: [{ ...OFFER, status: 'pausado' }] }} stores={STORES} />)).not.toContain('Leer de nuevo');
  });

  it('una tienda cuyo precio no se lee de la ficha no ofrece "Leer de nuevo"', () => {
    const html = renderToStaticMarkup(<ProductCard item={{ ...ITEM, offers: [{ ...OFFER, store: 'samsung', storeName: 'Samsung', readable: false }] }} stores={STORES} />);
    expect(html).not.toContain('Leer de nuevo');
    expect(html).toContain('Abrir en Samsung');
  });
});

describe('VisibilitySwitch', () => {
  it('apagado lo dice claro y ofrece encenderlo; encendido, lo contrario', () => {
    const off = renderToStaticMarkup(<VisibilitySwitch show={false} shown={0} />);
    expect(off).toContain('no se muestran');
    expect(off).toContain('Mostrarlas en el sitio');
    const on = renderToStaticMarkup(<VisibilitySwitch show shown={3} />);
    expect(on).toContain('se muestran');
    expect(on).toContain('3 precios a la vista');
    expect(on).toContain('Dejar de mostrarlas en el sitio');
  });
});
