import { describe, expect, it } from 'vitest';
import { hasForbiddenWord } from '@/lib/social/interest';
import { buildCarouselCaptions, carouselCheckedLine, type CarouselCaptionItem } from './captions';

/**
 * El texto del carrusel semanal: corto, un renglón por lámina, la hora de los
 * precios y dónde comprar en cada red. Una baja nunca se llama descuento, y
 * no van "Publicidad" ni la comisión (decisión del dueño, 18-10-2026).
 */

const items: CarouselCaptionItem[] = [
  { name: 'Notebook HP 15 Intel Core i7 16GB 512GB', price: 879_990, dropAmount: 65_968, price_checked_at: '2026-10-18T20:30:00Z' },
  { name: 'Campana de cocina Electrolux 90cm', price: 99_990, dropAmount: 30_000, price_checked_at: '2026-10-18T20:00:00Z' },
  { name: 'Smart TV iFFALCON 32" FHD', price: 124_990, dropAmount: 19_003, price_checked_at: '2026-10-18T19:10:00Z' },
  { name: 'Lavadora Sindelen 4,2 kg', price: 119_990, dropAmount: 24_002, price_checked_at: '2026-10-18T20:30:00Z' },
  { name: 'Xiaomi Redmi Watch 6', price: 89_990, dropAmount: 16_502, price_checked_at: '2026-10-18T20:30:00Z' },
];
const opts = { rangeLabel: 'del 12 al 18 de octubre', siteUrl: 'https://www.comparatech.cl' };

describe('buildCarouselCaptions', () => {
  it('Instagram: qué es, un renglón por lámina en orden, la hora y la bio', () => {
    expect(buildCarouselCaptions(items, opts).instagram).toBe(
      [
        '📉 Top 5 bajas de la semana (del 12 al 18 de octubre), según nuestro historial de precios:',
        '',
        '1️⃣ Notebook HP 15 Intel Core i7 16GB 512GB: $879.990, bajó $65.968',
        '2️⃣ Campana de cocina Electrolux 90cm: $99.990, bajó $30.000',
        '3️⃣ Smart TV iFFALCON 32" FHD: $124.990, bajó $19.003',
        '4️⃣ Lavadora Sindelen 4,2 kg: $119.990, bajó $24.002',
        '5️⃣ Xiaomi Redmi Watch 6: $89.990, bajó $16.502',
        '',
        'Precios revisados el 18/10 entre las 16:10 y las 17:30 (hora de Chile); pueden cambiar.',
        '',
        '🛒 Link de compra en nuestra bio, o búscalo en comparatech.cl',
        '',
        '#tecnologia #chile #mercadolibre',
      ].join('\n')
    );
  });

  it('Facebook: lo mismo, con el link a /hoy que en una publicación sí se toca', () => {
    const { instagram, facebook } = buildCarouselCaptions(items, opts);
    expect(facebook).toBe(
      instagram.replace(
        '🛒 Link de compra en nuestra bio, o búscalo en comparatech.cl',
        '🛒 Links de compra: https://www.comparatech.cl/hoy?src=facebook-carrusel'
      )
    );
  });

  it('con menos productos dice Top N', () => {
    expect(buildCarouselCaptions(items.slice(0, 3), opts).instagram.split('\n')[0]).toBe(
      '📉 Top 3 bajas de la semana (del 12 al 18 de octubre), según nuestro historial de precios:'
    );
  });

  it('fuera del sitio publicado (localhost) no nombra un sitio que no es', () => {
    const local = buildCarouselCaptions(items, { ...opts, siteUrl: 'http://localhost:3000' });
    expect(local.instagram).toContain('🛒 Link de compra en nuestra bio\n');
    expect(local.facebook).toContain('🛒 Links de compra en nuestro perfil\n');
    expect(local.facebook).not.toContain('localhost');
  });

  it('nunca dice descuento, Publicidad ni la comisión, ni palabras que el sitio no usa, y cabe en Instagram', () => {
    for (const text of Object.values(buildCarouselCaptions(items, opts))) {
      expect(text).not.toMatch(/descuento|publicidad|comisi|precio de lista|antes \$|rebaj/i);
      // La primera línea es el título: lo demás no lleva ninguna palabra que el sitio no use.
      expect(hasForbiddenWord(text)).toBe(false);
      expect(text.length).toBeLessThan(2_200);
    }
  });
});

describe('carouselCheckedLine', () => {
  it('una sola hora, un rango en el mismo día, o de un día a otro', () => {
    expect(carouselCheckedLine([{ price_checked_at: '2026-10-18T20:30:00Z' }, { price_checked_at: '2026-10-18T20:30:40Z' }])).toBe(
      'Precios revisados el 18/10 a las 17:30 (hora de Chile); pueden cambiar.'
    );
    expect(carouselCheckedLine([{ price_checked_at: '2026-10-19T02:50:00Z' }, { price_checked_at: '2026-10-19T03:20:00Z' }])).toBe(
      'Precios revisados entre el 18/10 a las 23:50 y el 19/10 a las 00:20 (hora de Chile); pueden cambiar.'
    );
  });

  it('sin ninguna hora conocida no inventa una', () => {
    expect(carouselCheckedLine([{ price_checked_at: null }, { price_checked_at: 'no es una fecha' }])).toBe(
      'Precios sujetos a cambios en Mercado Libre.'
    );
  });
});
