import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { interFonts } from '@/lib/content/og-fonts';
import {
  CAROUSEL_SAFE,
  CAROUSEL_SIZE,
  CarouselClosing,
  CarouselCover,
  CarouselProductSlide,
  dropTextSize,
  type CarouselSlideProduct,
} from '@/lib/content/carousel-template';
import { hasForbiddenWord } from '@/lib/social/interest';

/**
 * Las láminas del carrusel semanal: lo que dicen (la baja es "Bajó $X", nunca
 * un descuento; siempre la hora del precio; nada de lo que el sitio no dice) y
 * cómo se reparten (1080x1350, la tarjeta de margen a margen como el feed).
 */

const product = (over: Partial<CarouselSlideProduct> = {}): CarouselSlideProduct => ({
  name: 'Smart TV Samsung 55" Crystal UHD 4K U8000F',
  brand: 'Samsung',
  price: 349_990,
  dropAmount: 80_000,
  dropSince: '2026-10-15T14:00:00.000Z',
  checkedAt: '2026-10-18T20:30:00.000Z',
  freeShipping: true,
  full: true,
  ...over,
});

/** El texto que se lee en la lámina, sin etiquetas. */
function text(node: JSX.Element): string {
  return renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function draw(node: JSX.Element) {
  const response = new ImageResponse(node, { ...CAROUSEL_SIZE, fonts: await interFonts() });
  const { data, info } = await sharp(Buffer.from(await response.arrayBuffer()))
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  return { width: info.width, height: info.height, at };
}

const BACKGROUND = [7, 11, 20];

/**
 * Instagram puede cortar la lámina al cuadrado del centro (y de 135 a 1215):
 * afuera solo puede haber fondo. Arriba el fondo es un degradado vertical, así
 * que cada fila tiene que ser pareja de lado a lado; abajo es el fondo liso.
 */
function expectOnlyBackgroundOutsideSquare(image: Awaited<ReturnType<typeof draw>>, skipBottomRight = false) {
  for (let y = 0; y < CAROUSEL_SAFE.top; y += 6) {
    const edge = image.at(4, y);
    for (const x of [100, 300, 540, 780, 1000]) expect(image.at(x, y)).toEqual(edge);
  }
  for (let y = CAROUSEL_SAFE.bottom + 1; y < 1350; y += 6) {
    for (const x of skipBottomRight ? [40, 300, 540] : [40, 300, 540, 780, 1040]) expect(image.at(x, y)).toEqual(BACKGROUND);
  }
}

describe('la lámina de un producto', () => {
  it('dice el puesto, la marca, el precio de hoy, cuánto bajó y desde qué día, y la hora del precio', () => {
    const t = text(<CarouselProductSlide product={product()} rank={1} photo={null} />);
    expect(t).toContain('#1');
    expect(t).toContain('Samsung');
    expect(t).toContain('Bajó $80.000');
    expect(t).toContain('desde el 15/10');
    expect(t).toContain('349.990');
    expect(t).toContain('Precio revisado 18/10 17:30');
    expect(t).toContain('Precios en Mercado Libre');
    expect(t).toContain('Envío gratis');
    expect(t).toContain('Full');
  });

  it('una baja no se llama descuento, y no van la cifra tachada ni lo que el sitio no dice', () => {
    const t = text(<CarouselProductSlide product={product()} rank={2} photo={null} />);
    expect(t).not.toMatch(/descuento|antes|precio de lista|rebaj|publicidad|comisi/i);
    expect(hasForbiddenWord(t)).toBe(false);
    expect(t).not.toMatch(/%/);
  });

  it('envío gratis y Full, solo si son ciertos; sin hora conocida no se inventa una', () => {
    const t = text(<CarouselProductSlide product={product({ freeShipping: false, full: false, checkedAt: null })} rank={3} photo={null} />);
    expect(t).not.toContain('Envío gratis');
    expect(t).not.toContain('Full');
    expect(t).toContain('Precio sujeto a cambios');
  });

  it('el monto de la baja se achica para que quepa junto a la fecha', () => {
    expect(dropTextSize('Bajó $80.000', 600)).toBe(80);
    const big = dropTextSize('Bajó $1.250.000', 600);
    expect(big).toBeLessThan(80);
    expect(big).toBeGreaterThanOrEqual(40);
  });

  it('mide 1080x1350 y todo cabe en el cuadrado del centro: la tarjeta termina en y=1192, con la franja verde de la baja', async () => {
    for (const p of [product(), product({ name: 'Notebook Asus Gaming A16 AMD Ryzen 7 170C 16GB 512GB 16" RTX 4050 6GB Windows 11', price: 1_249_990, dropAmount: 1_250_000, freeShipping: false, full: false })]) {
      const image = await draw(<CarouselProductSlide product={p} rank={1} photo={null} />);
      expect([image.width, image.height]).toEqual([1080, 1350]);
      // El filete cian del borde izquierdo de la tarjeta sigue antes de y=1192 y ya no después.
      expect(image.at(72, 1150)[2]).toBeGreaterThan(80);
      expectOnlyBackgroundOutsideSquare(image);
    }
    // La franja de la baja es verde (#34D399), no el cian del descuento.
    const image = await draw(<CarouselProductSlide product={product()} rank={1} photo={null} />);
    let green = 0;
    for (let y = 600; y < 1200; y += 4) {
      const [r, g, b] = image.at(1000, y);
      if (g > 190 && r < 90 && b > 130 && b < 180) green++;
    }
    expect(green).toBeGreaterThan(20);
  }, 60_000);
});

describe('la portada y el cierre', () => {
  it('la portada dice cuántos son, de qué semana, y que las bajas las confirma el historial', () => {
    const t = text(<CarouselCover kind="bajas" rangeLabel="del 12 al 18 de octubre" photos={[null, null, null, null, null]} />);
    expect(t).toContain('TOP 5');
    expect(t).toContain('bajas de la semana');
    expect(t).toContain('Del 12 al 18 de octubre');
    expect(t).toContain('Confirmadas con nuestro historial de precios');
    expect(t).toContain('Desliza');
    // Con cuatro, dice Top 4: no se rellena.
    expect(text(<CarouselCover kind="bajas" rangeLabel="del 12 al 18 de octubre" photos={[null, null, null, null]} />)).toContain('TOP 4');
  });

  it('el cierre dice dónde comprar: el link del perfil o el sitio, y que los precios cambian', () => {
    const t = text(<CarouselClosing site="comparatech.cl" rangeLabel="del 12 al 18 de octubre" />);
    expect(t).toContain('Link de compra en nuestro perfil');
    expect(t).toContain('o búscalo en comparatech.cl');
    expect(t).toContain('Bajas registradas del 12 al 18 de octubre.');
    expect(t).toContain('Los precios cambian varias veces al día');
  });

  it('ninguna dice lo que el sitio no dice', () => {
    for (const node of [
      <CarouselCover key="p" kind="bajas" rangeLabel="del 12 al 18 de octubre" photos={[null, null, null]} />,
      <CarouselClosing key="c" site="comparatech.cl" rangeLabel="del 12 al 18 de octubre" />,
    ]) {
      const t = text(node);
      expect(t).not.toMatch(/descuento|publicidad|comisi|mejor precio|más barat|recomendad|imperdible|solo hoy|verificad/i);
      expect(hasForbiddenWord(t)).toBe(false);
    }
  });

  it('las dos miden 1080x1350 y todo lo que dicen cabe en el cuadrado del centro; afuera, solo "Desliza" en la portada', async () => {
    const cover = await draw(<CarouselCover kind="bajas" rangeLabel="del 28 de octubre al 3 de noviembre" photos={[null, null, null, null, null]} />);
    expect([cover.width, cover.height]).toEqual([1080, 1350]);
    expectOnlyBackgroundOutsideSquare(cover, true);
    // "Desliza" va abajo a la derecha, fuera del cuadrado: si Instagram corta, sobra.
    let cyan = 0;
    for (let x = 640; x < 1040; x += 4) {
      const [r, g, b] = cover.at(x, 1270);
      if (r < 30 && g > 190 && b > 230) cyan++;
    }
    expect(cyan).toBeGreaterThan(10);

    const closing = await draw(<CarouselClosing site="comparatech.cl" rangeLabel="del 28 de octubre al 3 de noviembre" />);
    expect([closing.width, closing.height]).toEqual([1080, 1350]);
    expectOnlyBackgroundOutsideSquare(closing);
  }, 60_000);
});
