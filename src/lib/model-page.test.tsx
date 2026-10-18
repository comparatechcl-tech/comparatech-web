import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * La página de un modelo (/modelo/[modelo]) dibujada a HTML, con datos
 * fijos: qué dice, qué enlaza y el dato estructurado (ProductGroup).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/modelo/iphone-17',
  useSearchParams: () => null,
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
// Los módulos de lecturas usan cache() de React 19 y Supabase.
vi.mock('@/lib/queries/models', () => ({ getModelVersions: vi.fn(), getModelHistories: vi.fn() }));
vi.mock('@/lib/queries/price-history', () => ({ getPriceHistoryCached: vi.fn() }));
vi.mock('@/lib/queries/products', async () => {
  const { MIN_DEAL_DISCOUNT, discountOf } = await import('@/lib/deal-rank');
  return { MIN_DEAL_DISCOUNT, discountPercent: discountOf, getCatalogProducts: vi.fn(async () => []) };
});

import ModeloPage, { generateMetadata, generateStaticParams } from '@/app/modelo/[modelo]/page';
import { productGroupJsonLd } from '@/components/seo/ProductGroupJsonLd';
import { getModelHistories, getModelVersions } from '@/lib/queries/models';
import { MODELS, getModel } from '@/lib/models';
import { priceStats, type PricePoint, type PriceStats } from '@/lib/deals';
import type { Product } from '@/lib/types';

const SITE = 'https://www.comparatech.cl';
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

let seq = 0;
function product(over: Partial<Product> = {}): Product {
  seq++;
  return {
    id: `id-${seq}`,
    slug: `apple-iphone-17-256-gb-${seq}`,
    name: `Apple iPhone 17 (256 GB) - Color ${seq}`,
    brand: 'Apple',
    category: 'celulares',
    price: 1_000_000 + seq,
    original_price: null,
    image_url: `https://http2.mlstatic.com/D_NQ_NP_${seq}-F.webp`,
    affiliate_url: 'https://meli.la/abc',
    outbound_url: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    description: '',
    specs: { Color: `Color ${seq}`, 'Memoria interna': '256 GB' },
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: `MLC${seq}`,
    ml_domain_id: 'MLC-CELLPHONES',
    ml_family_id: 'MLC1055308826',
    seller_id: 99,
    rrss_status: 'sin_usar',
    created_at: '2026-10-05T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: ago(600_000),
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
    ...over,
  };
}

/** Lo que el sitio no dice nunca (CLAUDE.md, voz de marca). */
const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra|comisi[oó]n|publicidad/i;

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<\/?(?:strong|s|a|em|span)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

function attributes(html: string): string[] {
  const found: string[] = [];
  const re = /\s(?:title|alt|aria-label)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) found.push(m[1]);
  return found;
}

function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

describe('productGroupJsonLd', () => {
  const model = getModel('iphone-17')!;

  it('un ProductGroup con cada versión como variante, con la dirección de su ficha y su oferta', () => {
    const onSale = product();
    const paused = product({ is_active: false, inactive_since: '2026-10-16T00:00:00Z' });
    const data = productGroupJsonLd(model, [onSale, paused], SITE, 'descripción');

    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'iPhone 17',
      url: `${SITE}/modelo/iphone-17`,
      description: 'descripción',
      brand: { '@type': 'Brand', name: 'Apple' },
      productGroupID: 'iphone-17',
      // Cambia el color; la capacidad es la misma en las dos.
      variesBy: ['https://schema.org/color'],
    });
    expect(data.hasVariant).toHaveLength(2);
    expect(data.hasVariant[0]).toMatchObject({
      '@type': 'Product',
      name: onSale.name,
      url: `${SITE}/producto/${onSale.slug}`,
      sku: onSale.ml_product_id,
      image: [onSale.image_url],
      color: onSale.specs.Color,
      inProductGroupWithID: 'iphone-17',
      offers: { '@type': 'Offer', priceCurrency: 'CLP', price: onSale.price, availability: 'https://schema.org/InStock' },
    });
    expect(data.hasVariant[0]).not.toHaveProperty('size');
    // Fuera de venta: sin link de compra, como en su ficha.
    expect(data.hasVariant[1].offers).toMatchObject({ availability: 'https://schema.org/OutOfStock' });
    expect(data.hasVariant[1].offers).not.toHaveProperty('url');
    // Sin reseñas ni estrellas.
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|review/);
  });

  it('si cambia la capacidad, va como size; si nada cambia, sin variesBy', () => {
    const a = product({ specs: { Color: 'Negro', 'Memoria interna': '256 GB' } });
    const b = product({ specs: { Color: 'Negro', 'Memoria interna': '512 GB' } });
    const data = productGroupJsonLd(getModel('iphone-18-pro-max')!, [a, b], SITE, '');
    expect(data.variesBy).toEqual(['https://schema.org/size']);
    expect(data.hasVariant.map((v) => v.size)).toEqual(['256 GB', '512 GB']);
    expect(data.hasVariant[0]).not.toHaveProperty('color');

    const same = productGroupJsonLd(model, [product({ specs: { Color: 'Negro' } }), product({ specs: { Color: 'negro' } })], SITE, '');
    expect(same).not.toHaveProperty('variesBy');
  });

  it('el otro nombre del modelo va como alternateName', () => {
    const data = productGroupJsonLd(getModel('ps5')!, [product()], SITE, '');
    expect(data).toMatchObject({ name: 'PS5', alternateName: 'PlayStation 5', brand: { name: 'Sony' } });
  });
});

describe('/modelo/[modelo]', () => {
  const params = (modelo: string) => ({ params: Promise.resolve({ modelo }) });

  // Blanco bajó de $1.100.000 a $1.000.000 hace dos días (se agregó al sitio
  // con el primer registro); Lavanda nunca cambió.
  const blanco = product({
    name: 'Apple iPhone 17 (256 GB) - Blanco',
    price: 1_000_000,
    specs: { Color: 'Blanco', 'Memoria interna': '256 GB' },
    created_at: ago(12 * DAY),
  });
  const lavanda = product({ name: 'Apple iPhone 17 (256 GB) - Lavanda', price: 1_050_000, specs: { Color: 'Lavanda', 'Memoria interna': '256 GB' } });
  const negro = product({
    name: 'Apple iPhone 17 (256 GB) - Negro',
    price: 930_000,
    specs: { Color: 'Negro', 'Memoria interna': '256 GB' },
    is_active: false,
    inactive_reason: 'sin_ganador',
    inactive_since: ago(DAY),
  });
  const blancoHistory: PricePoint[] = [
    { price: 1_100_000, observed_at: ago(12 * DAY) },
    { price: 1_000_000, observed_at: ago(2 * DAY) },
  ];
  const lavandaHistory: PricePoint[] = [{ price: 1_050_000, observed_at: ago(12 * DAY) }];
  const negroHistory: PricePoint[] = [{ price: 930_000, observed_at: ago(12 * DAY) }];

  beforeEach(() => {
    vi.mocked(getModelVersions).mockReset();
    vi.mocked(getModelHistories).mockReset();
    vi.mocked(getModelVersions).mockImplementation(async (slug: string) =>
      slug === 'iphone-17' ? { model: getModel('iphone-17')!, onSale: [blanco, lavanda], paused: [negro] } : null,
    );
    vi.mocked(getModelHistories).mockResolvedValue({
      histories: new Map([
        [blanco.id, blancoHistory],
        [lavanda.id, lavandaHistory],
        [negro.id, negroHistory],
      ]),
      stats: new Map<string, PriceStats>([
        [blanco.id, priceStats(blancoHistory)!],
        [lavanda.id, priceStats(lavandaHistory)!],
      ]),
    });
  });

  it('se arma una página por cada modelo de la lista', () => {
    expect(generateStaticParams()).toEqual(MODELS.map((m) => ({ modelo: m.slug })));
  });

  it('el título, la descripción y el canonical', async () => {
    const meta = await generateMetadata(params('iphone-17'));
    expect(meta.title).toEqual({ absolute: 'iPhone 17: precio en Chile e historial | ComparaTech' });
    expect(meta.description).toBe(
      'iPhone 17: 2 versiones a la venta en Mercado Libre Chile desde $1.000.000. Mira el historial de precios y el más bajo que registramos.',
    );
    expect(meta.alternates).toEqual({ canonical: '/modelo/iphone-17' });
    expect(await generateMetadata(params('no-existe'))).toEqual({});
  });

  it('las versiones con su precio de hoy, la que no tiene vendedor y el historial', async () => {
    const html = renderToStaticMarkup(await ModeloPage(params('iphone-17')));
    const read = text(html);

    expect(read).toContain('iPhone 17: precio en Chile');
    expect(read).toContain(
      'Encontramos 2 versiones de iPhone 17 a la venta en Mercado Libre, desde $1.000.000 hasta $1.050.000. Otra no tiene vendedor con reputación verde hoy.',
    );
    // Las tarjetas llevan a la ficha de cada versión, y la baja que confirma el historial va como "Bajó".
    expect(html).toContain(`href="/producto/${blanco.slug}"`);
    expect(html).toContain(`href="/producto/${lavanda.slug}"`);
    expect(read).toContain('Bajó $100.000');
    // La que no tiene vendedor, con su último precio y su ficha.
    expect(read).toContain('Sin vendedor con reputación verde hoy');
    expect(read).toContain('256 GB · Negro último precio $930.000');
    expect(html).toContain(`href="/producto/${negro.slug}"`);
    // El historial: el más bajo entre las versiones, de cuál fue y cuándo.
    expect(read).toContain('Historial de precios');
    expect(read).toContain('El gráfico muestra el precio más bajo entre las versiones de iPhone 17 a la venta en cada momento');
    expect(read).toMatch(/Más bajo registrado \$930\.000 El \d\d\/\d\d \(256 GB · Negro\)/);
    expect(read).toContain('Sin vendedor hoy (último $930.000)');
    // Las migas: Inicio › Celulares › iPhone 17.
    expect(read).toMatch(/Inicio\s*›\s*Celulares\s*›\s*iPhone 17/);

    const [group] = jsonLd(html).filter((d) => d['@type'] === 'ProductGroup');
    expect(group).toMatchObject({ name: 'iPhone 17', productGroupID: 'iphone-17' });
    expect((group.hasVariant as unknown[]).length).toBe(3);
    expect(jsonLd(html).some((d) => d['@type'] === 'BreadcrumbList')).toBe(true);

    expect(read).not.toMatch(AVOIDED);
    for (const attr of attributes(html)) expect(attr).not.toMatch(AVOIDED);
  });

  it('si el más bajo es el de hoy, dice desde cuándo y que sigue; una versión sin precio anotado dice "Sin registro"', async () => {
    // Salvia salió de venta antes de su primer registro: nunca le anotamos un precio a la venta.
    const salvia = product({
      name: 'Apple iPhone 17 (256 GB) - Salvia',
      price: 979_753,
      specs: { Color: 'Salvia', 'Memoria interna': '256 GB' },
      is_active: false,
      inactive_since: ago(13 * DAY),
    });
    vi.mocked(getModelVersions).mockResolvedValue({ model: getModel('iphone-17')!, onSale: [blanco, lavanda], paused: [salvia] });
    vi.mocked(getModelHistories).mockResolvedValue({
      histories: new Map([
        [blanco.id, blancoHistory],
        [lavanda.id, lavandaHistory],
        [salvia.id, [{ price: 979_753, observed_at: ago(12 * DAY) }]],
      ]),
      stats: new Map(),
    });
    const read = text(renderToStaticMarkup(await ModeloPage(params('iphone-17'))));
    expect(read).toMatch(/Más bajo registrado \$1\.000\.000 Sigue hoy, desde el \d\d\/\d\d \(256 GB · Blanco\)/);
    expect(read).not.toContain('por unas');
    expect(read).toMatch(/256 GB · Salvia Sin vendedor hoy \(último \$979\.753\) Sin registro/);
  });

  it('sin historial que se pueda leer, la página sale igual, sin el gráfico ni "más bajo registrado"', async () => {
    vi.mocked(getModelHistories).mockResolvedValue({
      histories: new Map([
        [blanco.id, null],
        [lavanda.id, null],
        [negro.id, null],
      ]),
      stats: new Map(),
    });
    const read = text(renderToStaticMarkup(await ModeloPage(params('iphone-17'))));
    expect(read).toContain('Versiones y precio de hoy');
    expect(read).not.toContain('Historial de precios');
    expect(read).not.toContain('Más bajo registrado');
  });

  it('un modelo que no está en la lista, o sin ninguna versión, no tiene página', async () => {
    await expect(ModeloPage(params('no-existe'))).rejects.toThrow('NOT_FOUND');
    vi.mocked(getModelVersions).mockResolvedValue({ model: getModel('ps5')!, onSale: [], paused: [] });
    await expect(ModeloPage(params('ps5'))).rejects.toThrow('NOT_FOUND');
  });
});
