import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Cómo dice el sitio público el descuento, dibujado a HTML estático.
 *
 * El dueño (14-10-2026) sacó "precio de lista" de todo lo que se lee: el
 * porcentaje se dice "45% de descuento" y la cifra tachada "sin descuento
 * $99.990". La cifra tachada la pone el vendedor en Mercado Libre, así que
 * donde el sitio explica de dónde sale el descuento lo sigue diciendo.
 */

// Las tarjetas y el botón de compra leen la ruta; el comparador, ?a= y ?b=.
vi.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => null }));
// lib/queries/products usa cache() de React 19 y lee Supabase: la página de ofertas solo necesita esto.
vi.mock('@/lib/queries/products', async () => {
  const { MIN_DEAL_DISCOUNT, discountOf } = await import('@/lib/deal-rank');
  return { MIN_DEAL_DISCOUNT, discountPercent: discountOf };
});
vi.mock('@/lib/queries/deals', () => ({ getRankedDeals: vi.fn() }));
vi.mock('@/lib/queries/site-categories', () => ({ getSiteCategories: vi.fn(async () => []) }));

import OfertasPage, { metadata as ofertasMetadata } from '@/app/ofertas/page';
import { CompareClient } from '@/components/compare/CompareClient';
import { DealBadge, DropChip } from '@/components/product/DealBadge';
import { OffersOgTemplate } from '@/lib/content/og-template';
import { DealSpotlight } from '@/components/product/DealSpotlight';
import { toCompareDetail } from '@/lib/compare';
import { getRankedDeals } from '@/lib/queries/deals';
import type { Product } from '@/lib/types';

/** Lo que el sitio ya no dice en nada que se lea, ni dice nunca. */
const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra/i;

/** El texto que se lee: sin etiquetas, con las comillas de vuelta. Las etiquetas de énfasis no cortan la frase. */
function text(html: string): string {
  return html
    .replace(/<\/?(?:strong|s|a|em|span)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** Los textos que no se ven pero se leen: title, alt y aria-label. */
function attributes(html: string): string[] {
  const found: string[] = [];
  const re = /\s(?:title|alt|aria-label)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) found.push(m[1]);
  return found;
}

let seq = 0;
function product(over: Partial<Product> = {}): Product {
  seq++;
  return {
    id: `id-${seq}`,
    slug: `parlante-jbl-go-${seq}`,
    name: `Parlante JBL Go ${seq}`,
    brand: 'JBL',
    category: 'audio',
    price: 49_990,
    original_price: 99_990,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-MLA1_1-F.webp',
    affiliate_url: 'https://meli.la/abc',
    outbound_url: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    description: '',
    specs: { Potencia: '4,8 W' },
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: `MLC${seq}`,
    ml_domain_id: 'MLC-SPEAKERS',
    ml_family_id: null,
    seller_id: 99,
    rrss_status: 'sin_usar',
    created_at: '2026-01-01T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: null,
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
    ...over,
  };
}

describe('DealBadge', () => {
  it('dice -N% y, al pasar el mouse, que el descuento lo informa el vendedor', () => {
    const html = renderToStaticMarkup(<DealBadge discount={45} />);
    expect(text(html)).toContain('-45%');
    expect(attributes(html)).toEqual(['Descuento informado por el vendedor en Mercado Libre']);
    expect(html).not.toMatch(AVOIDED);
  });

  it('una baja de nuestro historial dice "Bajó", nunca "descuento"', () => {
    const html = renderToStaticMarkup(<DropChip amount={12_000} />);
    expect(text(html)).toContain('Bajó $12.000');
    expect(html).not.toMatch(/descuento/i);
    expect(html).not.toMatch(AVOIDED);
  });
});

describe('Vista previa de /ofertas al compartir el link', () => {
  it('dice que los descuentos los informa cada vendedor, sin hablar de precio de lista', () => {
    const html = renderToStaticMarkup(<OffersOgTemplate count={3} maxDiscount={45} photos={[null, null, null]} />);
    expect(text(html)).toContain('Descuentos según lo que informa cada vendedor en Mercado Libre');
    expect(html).not.toMatch(AVOIDED);
  });
});

describe('DealSpotlight: la oferta destacada de la portada', () => {
  it('la cifra tachada va como "Sin descuento", y la nota dice que la informa el vendedor', () => {
    const html = renderToStaticMarkup(<DealSpotlight product={product()} dealsCount={12} />);
    const read = text(html);
    expect(read).toContain('$49.990');
    expect(read).toContain('Sin descuento $99.990');
    expect(html).toContain('<span class="line-through">$99.990</span>');
    expect(read).toContain('El descuento y la cifra tachada los informa el vendedor en Mercado Libre.');
    expect(html).not.toMatch(AVOIDED);
    for (const attr of attributes(html)) expect(attr).not.toMatch(AVOIDED);
  });

  it('sin descuento real no muestra una cifra tachada', () => {
    const read = text(renderToStaticMarkup(<DealSpotlight product={product({ original_price: null })} dealsCount={1} />));
    expect(read).not.toContain('Sin descuento $');
    expect(read).not.toMatch(AVOIDED);
  });
});

describe('Comparador', () => {
  it('la cifra tachada de cada producto va como "Sin descuento", y el pie dice de dónde sale', () => {
    const a = toCompareDetail(product({ price: 39_990, original_price: 59_990 }));
    const b = toCompareDetail(product({ price: 45_990, original_price: null }));
    const html = renderToStaticMarkup(<CompareClient initial={{ a, b }} categories={[]} />);
    const read = text(html);
    expect(read).toContain('Sin descuento $59.990 · -33%');
    // El que no tiene descuento no inventa uno.
    expect(read.split('Sin descuento')).toHaveLength(2);
    expect(attributes(html)).toContain('El descuento y la cifra tachada los informa el vendedor en Mercado Libre');
    expect(read).toContain('El descuento y la cifra tachada los informa el vendedor en Mercado Libre.');
    expect(read).toContain('Las bajas y subidas salen de nuestro propio registro de precios');
    expect(html).not.toMatch(AVOIDED);
  });
});

describe('/ofertas', () => {
  beforeEach(() => {
    vi.mocked(getRankedDeals).mockReset();
  });

  it('el título y la descripción para Google no hablan de precio de lista', () => {
    expect(ofertasMetadata.title).toBe('Ofertas del día');
    expect(ofertasMetadata.description).toBe(
      'Los mayores descuentos del catálogo, tal como los informa el vendedor en Mercado Libre, con los precios revisados varias veces al día.'
    );
  });

  it('dice cuántos productos tienen descuento, el mayor y de dónde sale la cifra', async () => {
    const deals = [product({ price: 37_000, original_price: 100_000 }), product({ price: 70_000, original_price: 100_000 })];
    vi.mocked(getRankedDeals).mockResolvedValue({ ranked: deals, drops: {}, best: deals[0] });
    const html = renderToStaticMarkup(await OfertasPage());
    const read = text(html);
    expect(read).toContain('2 productos con 20% o más de descuento — el mayor llega a 63%.');
    expect(read).toContain('El descuento y la cifra tachada los informa el vendedor en Mercado Libre.');
    expect(html).not.toMatch(AVOIDED);
    for (const attr of attributes(html)) expect(attr).not.toMatch(AVOIDED);
  });

  it('con un solo producto no habla de "el mayor"', async () => {
    const deal = product({ price: 55_000, original_price: 100_000 });
    vi.mocked(getRankedDeals).mockResolvedValue({ ranked: [deal], drops: {}, best: deal });
    const read = text(renderToStaticMarkup(await OfertasPage()));
    expect(read).toContain('1 producto con 20% o más de descuento — llega a 45%.');
    expect(read).not.toContain('el mayor');
  });

  it('sin ofertas lo dice con las mismas palabras', async () => {
    vi.mocked(getRankedDeals).mockResolvedValue({ ranked: [], drops: {}, best: null });
    const html = renderToStaticMarkup(await OfertasPage());
    expect(text(html)).toContain('Hoy no hay productos con 20% o más de descuento en el catálogo.');
    expect(html).not.toMatch(AVOIDED);
  });
});
