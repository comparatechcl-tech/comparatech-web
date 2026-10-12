import { describe, expect, it } from 'vitest';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { OG_SIZES, ogFonts, type OgProduct } from '@/lib/content/og-template';
import { OfferTemplate, fitName, textWidth, type OfferFormat } from '@/lib/content/offer-template';

const product = (over: Partial<OgProduct> = {}): OgProduct => ({
  name: 'Parlante Bluetooth JBL Grip bt Squad',
  brand: 'JBL',
  price: 61_990,
  original_price: 99_990,
  image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-F.jpg',
  price_checked_at: '2026-10-12T01:00:00.000Z',
  offer_info: { free_shipping: true, is_full: true },
  ...over,
});

describe('textWidth', () => {
  const W = Array.from({ length: 95 }, () => 500);

  it('mide en px según el tamaño y suma el interletrado por letra', () => {
    expect(textWidth('abcd', W, 100)).toBe(200);
    expect(textWidth('abcd', W, 100, -1)).toBe(196);
  });

  it('una letra con tilde mide lo que su letra base, y lo desconocido se cuenta ancho', () => {
    expect(textWidth('á', W, 100)).toBe(textWidth('a', W, 100));
    expect(textWidth('ñ', W, 100)).toBe(textWidth('n', W, 100));
    expect(textWidth('日', W, 100)).toBe(100);
  });
});

describe('fitName', () => {
  it('un nombre corto va en un renglón, al tamaño grande', () => {
    expect(fitName('Dji Osmo Pocket 4 Creator Combo')).toEqual({ size: 52, line: 60, rows: ['Dji Osmo Pocket 4 Creator Combo'] });
  });

  it('un nombre largo va en dos renglones parejos, sin perder palabras', () => {
    const name = 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX 6GB';
    const fit = fitName(name);
    expect(fit.size).toBe(50);
    expect(fit.rows).toHaveLength(2);
    expect(fit.rows!.join(' ')).toBe(name);
    // "Ryzen 7" no se separa: el número va con su modelo.
    expect(fit.rows![0].endsWith('Ryzen')).toBe(false);
  });

  it('no deja un conector colgando ni separa un número de su unidad', () => {
    const fit = fitName('Refrigerador Side by Side 578 lt Space Max con Dispensador');
    expect(fit.rows).toHaveLength(2);
    expect(fit.rows![0]).not.toMatch(/ (con|de|578)$/);
  });

  it('una palabra más ancha que el renglón queda para que la corte el dibujante', () => {
    expect(fitName('X'.repeat(80)).rows).toBeNull();
  });
});

describe('OfferTemplate', () => {
  const BACKGROUND = [7, 11, 20];

  /** Dibuja la pieza y deja leer el color de un punto, para saber dónde termina la tarjeta. */
  async function draw(p: OgProduct, format: OfferFormat) {
    const response = new ImageResponse(<OfferTemplate product={p} photo={null} format={format} />, {
      ...OG_SIZES[format],
      fonts: await ogFonts(format),
    });
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer()))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    return { width: info.width, height: info.height, at };
  }

  const full = product({
    name: `${'Notebook Gamer Pantalla 144 Hz '.repeat(3)}Windows 11 Home`,
    price: 12_345_678,
    original_price: 19_999_990,
  });
  const bare = product({ brand: null, original_price: null, offer_info: null, price_checked_at: null });

  it('la historia termina su tarjeta en y=1420 y deja libre el lugar del sticker, también en los casos extremos', async () => {
    for (const p of [product(), full, bare]) {
      const image = await draw(p, 'story');
      expect([image.width, image.height]).toEqual([1080, 1920]);
      // El filete cian del borde izquierdo de la tarjeta (x=72) sigue justo antes de y=1420 y ya no después.
      expect(image.at(72, 1370)[2]).toBeGreaterThan(80);
      expect(image.at(72, 1440)[2]).toBeLessThan(40);
      // El lugar del sticker lleva solo una luz suave: nada claro que compita con él.
      for (const [x, y] of [[540, 1500], [200, 1560], [880, 1600]]) expect(Math.max(...image.at(x, y))).toBeLessThan(90);
      // Lo que Instagram tapa abajo es fondo liso.
      expect(image.at(540, 1900)).toEqual(BACKGROUND);
    }
  }, 60_000);

  it('la publicación del feed usa la misma plantilla en 1080x1350, con la tarjeta de margen a margen', async () => {
    for (const p of [product(), full, bare]) {
      const image = await draw(p, 'feed');
      expect([image.width, image.height]).toEqual([1080, 1350]);
      // La tarjeta llega hasta y=1278: con el reparto de la historia seguiría hasta fuera del lienzo.
      expect(image.at(72, 1230)[2]).toBeGreaterThan(80);
      for (const y of [1285, 1310, 1345]) expect(image.at(540, y)).toEqual(BACKGROUND);
    }
  }, 60_000);
});

describe('ogFonts', () => {
  it('entrega Inter en tres pesos para la historia y el feed, y nada para las demás piezas', async () => {
    expect((await ogFonts('story'))?.map((f) => f.weight)).toEqual([400, 600, 800]);
    expect((await ogFonts('feed'))?.map((f) => f.weight)).toEqual([400, 600, 800]);
    expect(await ogFonts('og')).toBeUndefined();
    expect(await ogFonts('pin')).toBeUndefined();
  });
});
