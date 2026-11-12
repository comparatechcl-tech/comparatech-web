import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { CHRISTMAS_WINDOW, chileDay, christmasRibbon, isValidChristmasWindow, offerThemeAt, snowFor } from '@/lib/content/christmas';
import { OG_SIZES, ProductOgTemplate, ogFonts, type OgProduct } from '@/lib/content/og-template';
import { OfferTemplate, type OfferFormat } from '@/lib/content/offer-template';

/**
 * La temática de Navidad de las piezas: la cuenta de días del listón, que
 * se enciende solo dentro de su ventana y que la pieza sigue respetando sus
 * reglas.
 */

describe('christmasRibbon: "Navidad 2026 · Faltan N días" (el dueño, 12-11-2026)', () => {
  it('cuenta los días que faltan para el 25, según el día de Chile', () => {
    // En noviembre y diciembre Chile está en UTC-3.
    expect(christmasRibbon(new Date('2026-11-12T15:00:00Z'))).toEqual({ title: 'Navidad 2026', countdown: 'Faltan 43 días' });
    expect(christmasRibbon(new Date('2026-11-13T02:59:00Z'))?.countdown).toBe('Faltan 43 días'); // 12-11 a las 23:59
    expect(christmasRibbon(new Date('2026-11-13T03:00:00Z'))?.countdown).toBe('Faltan 42 días'); // 13-11 a las 00:00
    expect(christmasRibbon(new Date('2026-12-01T12:00:00Z'))?.countdown).toBe('Faltan 24 días');
    expect(christmasRibbon(new Date('2026-12-23T12:00:00Z'))?.countdown).toBe('Faltan 2 días');
    expect(christmasRibbon(new Date('2026-12-24T12:00:00Z'))?.countdown).toBe('Falta 1 día');
    expect(christmasRibbon(new Date('2026-12-25T12:00:00Z'))?.countdown).toBe('Hoy es Navidad');
  });

  it('después del 25, o con una fecha inválida, no hay listón', () => {
    expect(christmasRibbon(new Date('2026-12-26T03:00:00Z'))).toBeNull(); // 26-12 a las 00:00 en Chile
    expect(christmasRibbon(new Date('no es fecha'))).toBeNull();
  });

  it('dentro de la ventana encendida siempre hay listón', () => {
    if (!CHRISTMAS_WINDOW) return;
    for (let t = Date.parse(`${CHRISTMAS_WINDOW.from}T15:00:00Z`); chileDay(new Date(t)) <= CHRISTMAS_WINDOW.until; t += 86_400_000) {
      expect(christmasRibbon(new Date(t)), chileDay(new Date(t))).not.toBeNull();
    }
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

/** Un día con la temática encendida: las pruebas no dependen de la fecha en que corren. */
const DRAWN_AT = new Date('2026-12-01T15:00:00Z');

/** Lo que la marca no dice nunca, sin tildes ni mayúsculas. */
const FORBIDDEN = [/recomendad/, /mejor precio/, /mas barat/, /imperdible/, /solo hoy/, /precio de lista/, /antes \$/, /rebajad/, /precio normal/, /verificad/, /publicidad/];
const plain = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const visibleText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('la pieza con la temática de Navidad', () => {
  it('dice "Navidad 2026" y los días que faltan, sin palabras que la marca no usa; sin tema, no lo dice', () => {
    for (const [at, countdown] of [['2026-11-12T15:00:00Z', 'Faltan 43 días'], ['2026-12-24T15:00:00Z', 'Falta 1 día']] as const) {
      for (const format of ['story', 'feed'] as OfferFormat[]) {
        const text = visibleText(
          renderToStaticMarkup(<ProductOgTemplate product={product({ original_price: null })} format={format} photo={null} theme="navidad" at={new Date(at)} />)
        );
        expect(text).toContain('Navidad 2026');
        expect(text).toContain(countdown);
        expect(text).not.toContain('Idea de regalo');
        expect(FORBIDDEN.filter((re) => re.test(plain(text))).map(String)).toEqual([]);
      }
    }
    const normal = visibleText(renderToStaticMarkup(<ProductOgTemplate product={product()} format="story" photo={null} />));
    expect(normal).not.toContain('Navidad 2026');
    // Los datos de siempre siguen ahí: el descuento, la cifra tachada como "sin descuento" y la hora del precio.
    const xmas = visibleText(renderToStaticMarkup(<OfferTemplate product={product()} format="story" photo={null} theme="navidad" at={DRAWN_AT} />));
    expect(xmas).toContain('−37%');
    expect(xmas).toContain('sin descuento $69.641');
    expect(xmas).toContain('Precio revisado 07/11 11:00');
  });

  it('la historia sigue terminando su tarjeta en y=1420, con el listón rojo arriba y el lugar del sticker libre', async () => {
    const response = new ImageResponse(<OfferTemplate product={product()} photo={null} format="story" theme="navidad" at={DRAWN_AT} />, {
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
    // El centro del lugar del sticker queda limpio: ni el Viejito Pascuero ni el arbolito llegan ahí.
    let brightest = 0;
    for (let y = 1430; y < 1620; y += 6) for (let x = 230; x < 860; x += 6) brightest = Math.max(brightest, ...at(x, y));
    expect(brightest).toBeLessThan(90);
    // Abajo a la derecha se asoma el Viejito Pascuero (rojo del gorro y blanco de la barba) y abajo a la izquierda
    // está el arbolito (verde).
    const some = (x0: number, x1: number, y0: number, y1: number, test: (c: number[]) => boolean) => {
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (test(at(x, y))) return true;
      return false;
    };
    expect(some(900, 1064, 1430, 1600, ([r, g, b]) => r > 180 && g < 90 && b < 100)).toBe(true);
    expect(some(900, 1064, 1430, 1600, ([r, g, b]) => r > 235 && g > 235 && b > 235)).toBe(true);
    expect(some(30, 200, 1460, 1610, ([r, g, b]) => g > 120 && r < 90 && b < 140)).toBe(true);
    // El gorro sobre el logo de la cabecera: rojo justo arriba de la lupa (x=72 a 134, y=250 a 280).
    expect(some(64, 124, 250, 282, ([r, g, b]) => r > 180 && g < 90 && b < 100)).toBe(true);
  }, 60_000);

  it('sin la temática no lleva gorro, ni Viejito Pascuero, ni arbolito', async () => {
    const response = new ImageResponse(<OfferTemplate product={product()} photo={null} format="story" />, {
      ...OG_SIZES.story,
      fonts: await ogFonts('story'),
    });
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).raw().toBuffer({ resolveWithObject: true });
    let reddest = 0;
    for (let y = 240; y < 1620; y += 4) {
      for (let x = 0; x < 1080; x += 4) {
        const i = (y * info.width + x) * info.channels;
        if (data[i + 1] < 90 && data[i + 2] < 100) reddest = Math.max(reddest, data[i]);
      }
    }
    expect(reddest).toBeLessThan(120);
  }, 60_000);
});
