import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildCaption, buildVideoTexts, captionDiscount, pickHook, type CaptionChannel } from '@/lib/content/captions';
import { ProductOgTemplate, type OgFormat } from '@/lib/content/og-template';
import { hasForbiddenWord, interestScore, type InterestEvidence, type InterestProduct } from '@/lib/social/interest';

/**
 * Cómo se dice un descuento en todo lo que se publica (dueño, 14/10/2026):
 * "45% de descuento" y, para la cifra tachada, "sin descuento $399.990".
 * Nunca "precio de lista": la cifra tachada la pone el vendedor y el sitio no
 * sabe si de verdad lo vendía a ese precio. Y una baja medida con el
 * historial propio no es un descuento: se dice "bajó 12% según nuestro
 * historial", nunca "de descuento".
 *
 * Este archivo recorre los textos de redes (los que se pegan en cada red,
 * Telegram incluido, los de un reel, las imágenes y el motivo y el aviso que
 * lee el dueño) con varios productos de ejemplo.
 */

const CHANNELS: CaptionChannel[] = ['instagram', 'tiktok', 'whatsapp', 'telegram', 'facebook'];
const FORMATS: OgFormat[] = ['feed', 'story', 'pin', 'og'];
const NOW = new Date('2026-10-14T15:00:00Z');

type Sample = InterestProduct & {
  slug: string;
  image_url: string;
  price_checked_at: string | null;
  seller_reputation?: string | null;
};

let seq = 0;
function sample(over: Partial<Sample>): Sample {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: 'Celular Motorola Moto G86 Power 256GB - Color Azul',
    brand: 'Motorola',
    category: 'celulares',
    price: 219_990,
    original_price: 399_990,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-F.jpg',
    price_checked_at: '2026-10-14T13:30:00Z',
    seller_reputation: 'verde',
    seller_sales_count: 12_000,
    ml_root_category: 'MLC1051',
    ml_category_id: 'MLC1055',
    offer_info: { free_shipping: true, is_full: true, official_store: false, sold_by_ml: true, is_lowest: true },
    ...over,
  };
}

const NO_DROP: InterestEvidence = { drop: null, min30: null, daysTracked: 8 };

/** Productos de ejemplo: con descuento, solo con baja del historial, con las dos cosas y sin nada. */
const SAMPLES: { label: string; product: Sample; evidence: InterestEvidence; drop: number | null }[] = [
  { label: 'celular con 45% de descuento', product: sample({}), evidence: NO_DROP, drop: null },
  {
    label: 'televisor que solo bajó según el historial',
    product: sample({
      name: 'Smart TV Samsung 55" Crystal UHD 4K',
      brand: 'Samsung',
      category: 'electronica',
      price: 349_990,
      original_price: null,
      ml_category_id: 'MLC1002',
    }),
    evidence: { drop: { pct: 18.4, amount: 79_000 }, min30: 349_990, daysTracked: 20 },
    drop: 18,
  },
  {
    label: 'audífonos con descuento y además una baja grande',
    product: sample({
      name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
      brand: 'JBL',
      category: 'audio',
      price: 39_990,
      original_price: 49_990,
      ml_category_id: 'MLC3697',
      offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true },
    }),
    evidence: { drop: { pct: 33, amount: 19_700 }, min30: 39_990, daysTracked: 30 },
    drop: 33,
  },
  {
    label: 'parlante con una cifra tachada de un vendedor cualquiera (60%)',
    product: sample({
      name: 'Parlante Portátil Bluetooth 20W Recargable',
      brand: 'Genérica',
      category: 'audio',
      price: 19_990,
      original_price: 49_990,
      seller_sales_count: 300,
      offer_info: { free_shipping: false, is_full: false, official_store: false, sold_by_ml: false, is_lowest: true },
    }),
    evidence: NO_DROP,
    drop: null,
  },
  {
    label: 'notebook sin descuento ni baja',
    product: sample({ name: 'Notebook Lenovo IdeaPad Slim 3 15"', brand: 'Lenovo', category: 'computacion', original_price: null }),
    evidence: NO_DROP,
    drop: null,
  },
  {
    label: 'cifra tachada menor que el precio (no es rebaja)',
    product: sample({ name: 'Mouse Logitech M170', brand: 'Logitech', category: 'computacion', price: 12_990, original_price: 9_990 }),
    evidence: NO_DROP,
    drop: null,
  },
];

/** Todo lo que se publica o se le muestra al dueño de un producto, como texto. */
function socialTexts(p: Sample, evidence: InterestEvidence): { where: string; text: string }[] {
  const texts: { where: string; text: string }[] = [];
  for (const channel of CHANNELS) {
    texts.push({ where: channel, text: buildCaption(p, channel, { now: NOW, siteUrl: 'https://sitio.test', link: 'https://meli.la/abc' }) });
  }
  for (const [key, text] of Object.entries(buildVideoTexts(p, NOW))) texts.push({ where: `reel ${key}`, text });
  const score = interestScore(p, evidence);
  texts.push({ where: 'motivo', text: score.reason });
  if (score.warning) texts.push({ where: 'aviso', text: score.warning });
  // Un gancho cambia con el día: se recorren varios.
  for (let day = 1; day <= 20; day++) {
    texts.push({ where: `gancho del día ${day}`, text: pickHook(p, new Date(Date.UTC(2026, 9, day, 15))) });
  }
  return texts;
}

/** El texto visible de una imagen de producto, sin etiquetas. */
function imageText(p: Sample, format: OgFormat): string {
  const html = renderToStaticMarkup(<ProductOgTemplate product={p} format={format} photo={null} />);
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('cómo se dice un descuento en los textos de redes', () => {
  it('ningún texto, gancho, motivo ni imagen dice "precio de lista"', () => {
    for (const { label, product, evidence } of SAMPLES) {
      for (const { where, text } of socialTexts(product, evidence)) {
        expect(text, `${label} / ${where}`).not.toMatch(/precio de lista|p\. ?lista|\blista \$/i);
        // Tampoco las palabras que darían a entender que antes costaba eso.
        expect(text, `${label} / ${where}`).not.toMatch(/precio normal|rebajad|antes \$|ahorra/i);
      }
      for (const format of FORMATS) {
        expect(imageText(product, format), `${label} / imagen ${format}`).not.toMatch(/precio de lista|\blista\b/i);
      }
    }
  });

  it('una baja del historial nunca dice "de descuento": el porcentaje de "de descuento" es siempre el de la cifra tachada', () => {
    for (const { label, product, evidence, drop } of SAMPLES) {
      const discount = captionDiscount(product);
      for (const { where, text } of socialTexts(product, evidence)) {
        const said = text.match(/\d+% de descuento/g) ?? [];
        if (discount === 0) expect(said, `${label} / ${where}`).toEqual([]);
        for (const phrase of said) expect(phrase, `${label} / ${where}`).toBe(`${discount}% de descuento`);
      }
      const reason = interestScore(product, evidence).reason;
      if (drop !== null) {
        // La baja se dice como baja, con su número.
        if (reason.includes('bajó')) expect(reason, label).toContain(`bajó ${drop}% según nuestro historial`);
        expect(reason, label).not.toContain(`${drop}% de descuento`);
      }
    }
  });

  it('con descuento, los textos dicen "-N%, sin descuento $X" y el título "con N% de descuento"; sin descuento, nada de eso', () => {
    for (const { label, product } of SAMPLES) {
      const discount = captionDiscount(product);
      const caption = buildCaption(product, 'whatsapp', { now: NOW, siteUrl: 'https://sitio.test', link: 'https://meli.la/abc' });
      const title = buildVideoTexts(product, NOW).youtubeTitle;
      if (discount > 0) {
        const figure = `$${String(product.original_price).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
        expect(caption, label).toContain(`(-${discount}%, sin descuento ${figure})`);
        expect(title.endsWith(` con ${discount}% de descuento`), label).toBe(true);
      } else {
        expect(caption, label).not.toContain('sin descuento');
        expect(caption, label).not.toContain('%');
        expect(title, label).not.toContain('descuento');
      }
      // "descuento" no va dos veces en una misma línea ("45% de descuento, sin descuento $X" se lee mal).
      for (const line of caption.split('\n')) expect(line.match(/descuento/gi)?.length ?? 0, `${label}: ${line}`).toBeLessThanOrEqual(1);
    }
  });

  it('las imágenes rotulan la cifra tachada como "sin descuento", solo si hay rebaja', () => {
    for (const { label, product } of SAMPLES) {
      const discount = captionDiscount(product);
      for (const format of FORMATS) {
        const text = imageText(product, format);
        if (discount > 0) expect(text, `${label} / ${format}`).toMatch(/sin descuento \$[\d.]+/);
        else expect(text, `${label} / ${format}`).not.toContain('descuento');
      }
    }
  });

  it('"de descuento" y "sin descuento" no chocan con las palabras que el sitio no usa', () => {
    for (const { label, product, evidence } of SAMPLES) {
      for (const { where, text } of socialTexts(product, evidence)) {
        // El gancho va aparte: uno de los de "precio" (sin descuento) es "Míralo antes de comprar",
        // y ese "antes" no habla de un precio.
        if (where.startsWith('gancho')) continue;
        const body = text.includes('\n') ? text.split('\n').slice(1).join('\n') : text;
        expect(hasForbiddenWord(body), `${label} / ${where}`).toBe(false);
      }
    }
    // Los ganchos de una oferta, que sí hablan del descuento, tampoco.
    const offer = SAMPLES[0].product;
    for (let day = 1; day <= 20; day++) {
      expect(hasForbiddenWord(pickHook(offer, new Date(Date.UTC(2026, 9, day, 15))))).toBe(false);
    }
  });
});
