import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { CHRISTMAS_WINDOW, chileDay, giftBudgetBand, isValidChristmasWindow, offerThemeAt, snowFor } from '@/lib/content/christmas';
import { OG_SIZES, ProductOgTemplate, ogFonts, type OgProduct } from '@/lib/content/og-template';
import { OfferTemplate, type OfferFormat } from '@/lib/content/offer-template';

/**
 * La temática de Navidad de las piezas: el rango de "Idea de regalo" tiene
 * que ser siempre cierto, se enciende solo dentro de su ventana (apagada
 * hasta que el dueño apruebe) y la pieza sigue respetando sus reglas.
 */

describe('giftBudgetBand: el rango de "Idea de regalo"', () => {
  it('reparte por precio, con las puntas en el rango correcto', () => {
    expect(giftBudgetBand(1)).toBe('Menos de $50 mil');
    expect(giftBudgetBand(43_870)).toBe('Menos de $50 mil');
    expect(giftBudgetBand(49_990)).toBe('Menos de $50 mil');
    expect(giftBudgetBand(49_999)).toBe('Menos de $50 mil');
    // $50.000 justo no es "menos de $50 mil".
    expect(giftBudgetBand(50_000)).toBe('$50 a $100 mil');
    expect(giftBudgetBand(94_990)).toBe('$50 a $100 mil');
    expect(giftBudgetBand(99_990)).toBe('$50 a $100 mil');
    expect(giftBudgetBand(100_000)).toBe('$50 a $100 mil');
    expect(giftBudgetBand(100_001)).toBe('$100 a $300 mil');
    expect(giftBudgetBand(115_910)).toBe('$100 a $300 mil');
    expect(giftBudgetBand(299_990)).toBe('$100 a $300 mil');
    expect(giftBudgetBand(300_000)).toBe('$100 a $300 mil');
    expect(giftBudgetBand(300_001)).toBe('Más de $300 mil');
    expect(giftBudgetBand(746_255)).toBe('Más de $300 mil');
    expect(giftBudgetBand(12_345_678)).toBe('Más de $300 mil');
  });

  it('sin un precio válido no hay rango', () => {
    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(giftBudgetBand(price), String(price)).toBeNull();
  });

  it('lo que dice el rango es cierto para cualquier precio', () => {
    // Se lee la frase y se comprueba contra el precio: "Menos de $X mil", "$A a $B mil" o "Más de $X mil".
    const holds = (label: string, price: number) => {
      const less = /^Menos de \$(\d+) mil$/.exec(label);
      if (less) return price < Number(less[1]) * 1000;
      const range = /^\$(\d+) a \$(\d+) mil$/.exec(label);
      if (range) return price >= Number(range[1]) * 1000 && price <= Number(range[2]) * 1000;
      const more = /^Más de \$(\d+) mil$/.exec(label);
      if (more) return price > Number(more[1]) * 1000;
      return false;
    };
    for (let price = 990; price <= 1_500_000; price += 997) expect(holds(giftBudgetBand(price)!, price), String(price)).toBe(true);
    for (const price of [49_999, 50_000, 50_001, 99_999, 100_000, 100_001, 299_999, 300_000, 300_001]) expect(holds(giftBudgetBand(price)!, price), String(price)).toBe(true);
  });
});

describe('offerThemeAt: cuándo sale la temática', () => {
  const WINDOW = { from: '2026-11-10', until: '2026-12-25' };

  it('viene apagada (o, si se encendió, con una ventana bien escrita)', () => {
    expect(CHRISTMAS_WINDOW === null || isValidChristmasWindow(CHRISTMAS_WINDOW)).toBe(true);
    expect(offerThemeAt(new Date('2026-12-24T15:00:00Z'), null)).toBeNull();
  });

  it('cuenta los dos días de la ventana, en hora de Chile', () => {
    // En noviembre y diciembre Chile está en UTC-3.
    expect(offerThemeAt(new Date('2026-11-10T02:59:00Z'), WINDOW)).toBeNull(); // 09-11 a las 23:59 en Chile
    expect(offerThemeAt(new Date('2026-11-10T03:00:00Z'), WINDOW)).toBe('navidad'); // 10-11 a las 00:00
    expect(offerThemeAt(new Date('2026-12-24T23:00:00Z'), WINDOW)).toBe('navidad');
    expect(offerThemeAt(new Date('2026-12-26T02:59:00Z'), WINDOW)).toBe('navidad'); // 25-12 a las 23:59
    expect(offerThemeAt(new Date('2026-12-26T03:00:00Z'), WINDOW)).toBeNull(); // 26-12 a las 00:00
    expect(chileDay(new Date('2026-12-26T02:59:00Z'))).toBe('2026-12-25');
  });

  it('una ventana mal escrita, o al revés, la deja apagada', () => {
    const at = new Date('2026-12-01T15:00:00Z');
    expect(offerThemeAt(at, { from: '2026-12-1', until: '2026-12-25' })).toBeNull();
    expect(offerThemeAt(at, { from: '2026-12-25', until: '2026-11-10' })).toBeNull();
    expect(offerThemeAt(at, { from: '10-11-2026', until: '25-12-2026' })).toBeNull();
    expect(offerThemeAt(new Date('no es fecha'), WINDOW)).toBeNull();
  });
});

describe('snowFor', () => {
  it('es siempre la misma y nunca cae en el centro del lugar del sticker', () => {
    const story = snowFor(1920, { top: 270, cardBottom: 1420, sticker: true });
    expect(snowFor(1920, { top: 270, cardBottom: 1420, sticker: true })).toEqual(story);
    for (const f of story) {
      if (f.y > 1420) expect(f.x < 160 || f.x > 920, `${f.x},${f.y}`).toBe(true);
      // Nunca sobre la cabecera, el listón, el nombre ni la tarjeta: arriba o en los márgenes.
      if (f.y > 252 && f.y <= 1420) expect(f.x < 64 || f.x > 1016, `${f.x},${f.y}`).toBe(true);
      expect(f.a).toBeLessThanOrEqual(0.42);
    }
  });
});

const product = (over: Partial<OgProduct> = {}): OgProduct => ({
  name: 'Control joystick GameSir G7 SE blanco',
  brand: 'GameSir',
  price: 43_870,
  original_price: 69_641,
  image_url: 'https://http2.mlstatic.com/D_NQ_NP_878064-MLA99932923713_112025-F.jpg',
  price_checked_at: '2026-11-07T14:00:10.627+00:00',
  offer_info: { free_shipping: true, is_full: true },
  ...over,
});

/** Lo que la marca no dice nunca, sin tildes ni mayúsculas. */
const FORBIDDEN = [/recomendad/, /mejor precio/, /mas barat/, /imperdible/, /solo hoy/, /precio de lista/, /antes \$/, /rebajad/, /precio normal/, /verificad/, /publicidad/];
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('la pieza con la temática de Navidad', () => {
  it('dice "Idea de regalo" con el rango del precio, sin palabras que la marca no usa; sin tema, no lo dice', () => {
    for (const [price, band] of [[43_870, 'Menos de $50 mil'], [94_990, '$50 a $100 mil'], [115_910, '$100 a $300 mil'], [746_255, 'Más de $300 mil']] as const) {
      for (const format of ['story', 'feed'] as OfferFormat[]) {
        const text = visibleText(renderToStaticMarkup(<ProductOgTemplate product={product({ price, original_price: null })} format={format} photo={null} theme="navidad" />));
        expect(text).toContain('Idea de regalo');
        expect(text).toContain(band);
        expect(FORBIDDEN.filter((re) => re.test(plain(text))).map(String)).toEqual([]);
      }
    }
    const normal = visibleText(renderToStaticMarkup(<ProductOgTemplate product={product()} format="story" photo={null} />));
    expect(normal).not.toContain('Idea de regalo');
    // Los datos de siempre siguen ahí: el descuento, la cifra tachada como "sin descuento" y la hora del precio.
    const xmas = visibleText(renderToStaticMarkup(<OfferTemplate product={product()} format="story" photo={null} theme="navidad" />));
    expect(xmas).toContain('−37%');
    expect(xmas).toContain('sin descuento $69.641');
    expect(xmas).toContain('Precio revisado 07/11 11:00');
  });

  it('la historia sigue terminando su tarjeta en y=1420, con el listón rojo arriba y el lugar del sticker libre', async () => {
    const response = new ImageResponse(<OfferTemplate product={product()} photo={null} format="story" theme="navidad" />, {
      ...OG_SIZES.story,
      fonts: await ogFonts('story'),
    });
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    expect([info.width, info.height]).toEqual([1080, 1920]);
    // El listón: rojo de lado a lado (y=366 a 430), también en los bordes.
    for (const x of [4, 540, 1076]) {
      const [r, g, b] = at(x, 398);
      expect(r, `x=${x}`).toBeGreaterThan(150);
      expect(Math.max(g, b), `x=${x}`).toBeLessThan(90);
    }
    // El filete cian de la tarjeta sigue hasta y=1420 y ya no después.
    expect(at(72, 1370)[2]).toBeGreaterThan(80);
    expect(at(72, 1440)[2]).toBeLessThan(40);
    for (const [x, y] of [[540, 1500], [200, 1560], [880, 1600]]) expect(Math.max(...at(x, y))).toBeLessThan(90);
  }, 60_000);
});
