import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/*
 * Cómo se ve cada cosa pegada en "Agregar desde Mercado Libre", dibujada a
 * HTML estático: qué botones ofrece en cada estado, el link de afiliado y las
 * palabras de la marca para el descuento ("N% de descuento", "sin descuento").
 */

// Las acciones leen ML y escriben en la base: acá solo se mira lo que se dibuja.
vi.mock('@/app/admin/candidatos/agregar/actions', () => ({ addFromMl: vi.fn(), reviewMlLinks: vi.fn() }));

import { AddFromMl, ReviewItemCard } from '@/app/admin/candidatos/agregar/AddFromMl';
import type { ProductPreview, ReviewItem } from '@/lib/manual-add';

const ready: ProductPreview = {
  kind: 'ficha',
  id: 'MLC45203390',
  raw: 'https://www.mercadolibre.cl/p/MLC45203390',
  name: 'Parlante JBL Charge 5 Rojo',
  imageUrl: 'https://http2.mlstatic.com/D_jbl.jpg',
  price: 129_990,
  originalPrice: 169_990,
  discountPct: 24,
  category: 'audio',
  categoryName: 'Audio',
  sellerNickname: 'MUNDOLAMAR',
  commission: 9_099,
  commissionAssumed: false,
  affiliateUrl: 'https://www.mercadolibre.cl/p/MLC45203390?matt_word=comparatech&matt_tool=15629069',
  state: 'listo',
  warnings: ['Ya publicas otro color de este modelo (Parlante JBL Charge 5 Azul).'],
};

const draw = (item: ReviewItem) => renderToStaticMarkup(<ReviewItemCard item={item} busy={false} onPick={() => {}} />);

describe('Agregar desde Mercado Libre', () => {
  it('la pantalla parte con el cuadro para pegar y los dos botones', () => {
    const html = renderToStaticMarkup(<AddFromMl />);
    expect(html).toContain('Links o códigos de Mercado Libre');
    expect(html).toContain('Pegar y revisar');
    expect(html).toContain('Revisar');
  });

  it('un producto listo muestra precio, descuento con las palabras de la marca, comisión, link y los dos botones', () => {
    const html = draw(ready);
    expect(html).toContain('Parlante JBL Charge 5 Rojo');
    expect(html).toContain('24% de descuento');
    expect(html).toContain('sin descuento');
    expect(html).not.toMatch(/precio de lista|antes \$/i);
    expect(html).toContain('Audio · MUNDOLAMAR · Comisión est. $9.099');
    expect(html).toContain('value="https://www.mercadolibre.cl/p/MLC45203390?matt_word=comparatech&amp;matt_tool=15629069"');
    expect(html).toContain('Copiar');
    expect(html).toContain('Agregar a la cola');
    expect(html).toContain('Publicar ahora');
    expect(html).toContain('Ya publicas otro color de este modelo');
    // Revisar la ficha en ML va al link limpio: abrir el de afiliado contaría como un clic.
    expect(html).toContain('href="https://www.mercadolibre.cl/p/MLC45203390"');
  });

  it('sin link directo confirmado no deja publicar (sí agregar a la cola)', () => {
    const html = draw({ ...ready, affiliateUrl: null });
    expect(html).not.toContain('Link de afiliado');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publicar ahora<\/button>/);
    // El atributo, no la palabra: las clases de estilo también dicen "disabled:".
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Agregar a la cola<\/button>/);
  });

  it('ya en la cola: ofrece publicar, no agregar de nuevo', () => {
    const html = draw({ ...ready, state: 'en_cola', warnings: [] });
    expect(html).toContain('Ya está en la cola de');
    expect(html).toContain('Publicar ahora');
    expect(html).not.toContain('Agregar a la cola');
  });

  it('ya en el sitio o sin poder agregarse: sin botones para guardar', () => {
    const onSite = draw({ ...ready, state: 'en_sitio', siteSlug: 'parlante-jbl', warnings: [] });
    expect(onSite).toContain('Ya está en el sitio.');
    expect(onSite).toContain('href="/producto/parlante-jbl"');
    expect(onSite).not.toContain('Publicar ahora');

    const blocked = draw({ ...ready, state: 'no_se_puede', reason: 'Ahora nadie vende este producto…', warnings: [] });
    expect(blocked).toContain('Ahora nadie vende este producto…');
    expect(blocked).not.toContain('Agregar a la cola');
    expect(blocked).not.toContain('Link de afiliado');
  });

  it('una publicación suelta explica qué pasa y ofrece revisar las fichas parecidas', () => {
    const html = draw({
      kind: 'publicacion',
      id: 'MLC1517429417',
      raw: 'https://articulo.mercadolibre.cl/MLC-1517429417-audifonos-sony-_JM',
      message: 'Este link es de una publicación de un vendedor… ¿Es alguna de estas fichas?',
      suggestions: [{ id: 'MLC40650114', name: 'Sony WH-1000XM5', imageUrl: 'https://http2.mlstatic.com/D_s.jpg' }],
    });
    expect(html).toContain('¿Es alguna de estas fichas?');
    expect(html).toContain('Sony WH-1000XM5');
    expect(html).toContain('Revisar esta');
  });
});
