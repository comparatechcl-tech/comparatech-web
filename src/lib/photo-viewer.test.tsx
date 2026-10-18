import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/producto/x', useSearchParams: () => null }));

import { SWIPE_MIN_PX, stepIndex, swipeStep, viewerItems, type ViewerItem } from './photo-viewer';
import { PhotoViewer } from '@/components/product/PhotoViewer';

/**
 * El visor de fotos de la ficha y de la página de cada modelo: qué fotos
 * muestra y en qué orden, cómo se pasa de una a otra, y que cerrado es solo
 * un botón alrededor de la foto de siempre.
 */

const version = (id: string, price: number, is_active = true) => ({
  id,
  slug: `producto-${id}`,
  name: `Producto ${id}`,
  price,
  image_url: `https://http2.mlstatic.com/D_NQ_NP_${id}-F.webp`,
  is_active,
});

describe('viewerItems', () => {
  it('primero las versiones a la venta de menor a mayor precio, después las sin vendedor, sin repetir', () => {
    const current = version('b', 1_074_804);
    const { items, start } = viewerItems(
      current,
      [version('c', 979_753, false), version('a', 1_073_674), current, version('d', 1_401_050)],
      (p) => `etiqueta ${p.id}`,
    );
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'd', 'c']);
    // Abre en la versión de la página.
    expect(start).toBe(1);
    expect(items[3]).toEqual({
      id: 'c',
      slug: 'producto-c',
      label: 'etiqueta c',
      name: 'Producto c',
      price: 979_753,
      imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_c-F.webp',
      onSale: false,
    });
  });

  it('sin otras versiones, solo la de la página', () => {
    const current = version('x', 10_000);
    expect(viewerItems(current, [], () => 'x')).toMatchObject({ items: [{ id: 'x' }], start: 0 });
  });
});

describe('cómo se pasa de una foto a otra', () => {
  it('las flechas dan la vuelta al llegar al final', () => {
    expect(stepIndex(0, 3, 1)).toBe(1);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(0, 0, 1)).toBe(0);
  });

  it('deslizar a la izquierda es la siguiente; un toque o un deslizamiento vertical no cambia nada', () => {
    expect(swipeStep(-SWIPE_MIN_PX)).toBe(1);
    expect(swipeStep(SWIPE_MIN_PX + 20)).toBe(-1);
    expect(swipeStep(10)).toBe(0);
    expect(swipeStep(-80, 200)).toBe(0);
  });
});

describe('PhotoViewer cerrado', () => {
  const items: ViewerItem[] = [
    { id: 'a', slug: 'a', label: '256 GB · Lavanda', name: 'iPhone 17 Lavanda', price: 1, imageUrl: 'https://http2.mlstatic.com/D_1-F.webp', onSale: true },
    { id: 'b', slug: 'b', label: '256 GB · Blanco', name: 'iPhone 17 Blanco', price: 2, imageUrl: 'https://http2.mlstatic.com/D_2-F.webp', onSale: true },
  ];

  it('en la ficha es un botón alrededor de la foto, que dice cuántas versiones hay', () => {
    const html = renderToStaticMarkup(
      <PhotoViewer variant="hero" items={items} title="iPhone 17" currentSlug="a">
        <img src="foto.jpg" alt="iPhone 17 Lavanda" />
      </PhotoViewer>,
    );
    expect(html).toContain('aria-label="Ver la foto en grande y la de su otra versión"');
    expect(html).toContain('alt="iPhone 17 Lavanda"');
    expect(html).toContain('Ver fotos · 2 versiones');
    // Cerrado no hay ventana.
    expect(html).not.toContain('role="dialog"');
  });

  it('en la página del modelo es un botón "Ver fotos"', () => {
    const html = renderToStaticMarkup(<PhotoViewer variant="button" items={items} title="iPhone 17" />);
    expect(html).toContain('Ver fotos (2)</button>');
  });

  it('con una sola foto no habla de versiones', () => {
    const html = renderToStaticMarkup(
      <PhotoViewer variant="hero" items={items.slice(0, 1)} title="iPhone 17">
        <span />
      </PhotoViewer>,
    );
    expect(html).toContain('aria-label="Ver la foto en grande"');
    expect(html).toContain('Ver foto<');
  });
});
