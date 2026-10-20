import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * La página de una guía (/guias/[guia]) dibujada a HTML, con datos fijos:
 * qué dice, qué enlaza, desde dónde cuenta los clics y el dato estructurado.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/guias/regalos-tecnologicos',
  useSearchParams: () => null,
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
// La lectura usa cache() de React 19 y Supabase.
vi.mock('@/lib/queries/guides', () => ({ getGuideView: vi.fn() }));
// lib/category-listing (el ItemList) importa lib/queries/products, que usa cache() de React 19.
vi.mock('@/lib/queries/products', async () => {
  const { MIN_DEAL_DISCOUNT, discountOf } = await import('@/lib/deal-rank');
  return { MIN_DEAL_DISCOUNT, discountPercent: discountOf };
});
// La grilla de siempre, espiada para ver con qué origen de clics la llama la página.
vi.mock('@/components/product/ProductGrid', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/product/ProductGrid')>();
  return { ProductGrid: vi.fn(real.ProductGrid) };
});

import GuiaPage, { generateMetadata, generateStaticParams } from '@/app/guias/[guia]/page';
import { getGuideView } from '@/lib/queries/guides';
import { ProductGrid } from '@/components/product/ProductGrid';
import { GUIDES, getGuide, type GuideView } from '@/lib/guides';
import type { Product } from '@/lib/types';

let seq = 0;
function product(over: Partial<Product> = {}): Product {
  seq++;
  return {
    id: `id-${seq}`,
    slug: `parlante-jbl-go-4-${seq}`,
    name: `Parlante JBL Go 4 Color ${seq}`,
    brand: 'JBL',
    category: 'audio',
    price: 34_990,
    original_price: 39_990,
    image_url: `https://http2.mlstatic.com/D_NQ_NP_${seq}-F.webp`,
    affiliate_url: 'https://meli.la/abc',
    outbound_url: `https://www.mercadolibre.cl/p/MLC${seq}?matt_word=comparatech`,
    description: '',
    specs: {},
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: `MLC${seq}`,
    ml_domain_id: 'MLC-SPEAKERS',
    ml_family_id: `FAM${seq}`,
    seller_id: 99,
    rrss_status: 'sin_usar',
    created_at: '2026-10-05T00:00:00Z',
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: new Date().toISOString(),
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

function jsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

describe('/guias/[guia]', () => {
  const params = (guia: string) => ({ params: Promise.resolve({ guia }) });
  const regalos = getGuide('regalos-tecnologicos')!;

  const philips = product({ name: 'Audífonos Philips TAT1209', brand: 'Philips', price: 16_570, ml_domain_id: 'MLC-HEADPHONES' });
  const jbl = product({ name: 'Parlante JBL Go 5', price: 34_321 });
  const sony = product({ name: 'Parlante Sony SRS-XB100', brand: 'Sony', price: 43_990 });

  function view(over: Partial<Record<string, Product[]>> = {}): GuideView {
    const bySection: Record<string, Product[]> = {
      'hasta-20000': [philips],
      'hasta-50000': [jbl, sony],
      'hasta-100000': [],
      ...over,
    };
    const sections = regalos.sections.map((section) => ({
      section,
      products: bySection[section.id] ?? [],
      drops: section.id === 'hasta-50000' ? { [jbl.id]: { amount: 3_669, pct: 9.7, since: '2026-10-16T00:00:00Z' } } : {},
    }));
    return { sections, products: sections.flatMap((s) => s.products) };
  }

  beforeEach(() => {
    vi.mocked(getGuideView).mockReset();
    vi.mocked(getGuideView).mockResolvedValue(view());
  });

  it('se arma una página por cada guía de la lista', () => {
    expect(generateStaticParams()).toEqual(GUIDES.map((g) => ({ guia: g.slug })));
  });

  it('el título que aprobó el dueño, la descripción y el canonical', async () => {
    const meta = await generateMetadata(params('regalos-tecnologicos'));
    expect(meta.title).toEqual({ absolute: regalos.title });
    expect(meta.description).toBe(regalos.description);
    expect(meta.alternates).toEqual({ canonical: '/guias/regalos-tecnologicos' });
    expect(await generateMetadata(params('no-existe'))).toEqual({});
  });

  it('las secciones con sus productos, el chip "Bajó" y cómo se armó la lista', async () => {
    const html = renderToStaticMarkup(await GuiaPage(params('regalos-tecnologicos')));
    const read = text(html);

    expect(read).toContain('Regalos tecnológicos por presupuesto');
    expect(read).toMatch(/Inicio\s*›\s*Regalos tecnológicos/);
    // Un índice con las anclas de cada presupuesto.
    for (const id of ['hasta-20000', 'hasta-50000', 'hasta-100000']) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(read).toContain('1 idea a $16.570, con el precio de hoy.');
    expect(read).toContain('2 ideas de $34.321 a $43.990, con el precio de hoy.');
    // Las tarjetas llevan a la ficha; la baja comprobada va como "Bajó".
    expect(html).toContain(`href="/producto/${jbl.slug}"`);
    expect(read).toContain('Bajó $3.669');
    // Una sección sin productos lo dice, sin inventar nada.
    expect(read).toContain('Hoy ningún producto cumple las reglas de esta sección.');
    // Cómo se armó: sin decir que alguien eligió o probó cada producto.
    expect(read).toContain('Cómo armamos esta lista');
    expect(read).toContain('No probamos los productos.');
    expect(html).toContain('href="/como-funciona"');
    expect(html).toContain('href="/black-friday"');

    const [list] = jsonLd(html).filter((d) => d['@type'] === 'ItemList');
    expect(list).toMatchObject({ name: 'Regalos tecnológicos por presupuesto', numberOfItems: 3 });
    expect(jsonLd(html).some((d) => d['@type'] === 'BreadcrumbList')).toBe(true);

    expect(read).not.toMatch(AVOIDED);
  });

  it('los clics de las tarjetas se cuentan como de esta guía', async () => {
    vi.mocked(ProductGrid).mockClear();
    renderToStaticMarkup(await GuiaPage(params('regalos-tecnologicos')));
    const calls = vi.mocked(ProductGrid).mock.calls;
    // Dos grillas: la sección vacía no dibuja ninguna.
    expect(calls).toHaveLength(2);
    for (const [props] of calls) expect(props.placement).toBe('guia-regalos');
    // Solo la primera sección pide sus primeras fotos sin esperar.
    expect(calls.map(([props]) => props.eagerImages)).toEqual([4, 0]);
  });

  it('sin ningún producto hoy, la página sale igual y sin lista en el dato estructurado', async () => {
    vi.mocked(getGuideView).mockResolvedValue(view({ 'hasta-20000': [], 'hasta-50000': [] }));
    const html = renderToStaticMarkup(await GuiaPage(params('regalos-tecnologicos')));
    expect(jsonLd(html).some((d) => d['@type'] === 'ItemList')).toBe(false);
    expect(text(html)).toContain('Hoy ningún producto cumple las reglas de esta sección.');
    // Sin productos no hay resumen de precios que mostrar.
    expect(text(html)).not.toMatch(/\bideas? (de|a) \$/);
  });

  it('la guía de notebooks: "Qué mirar", sus secciones y el enlace a la otra guía', async () => {
    const notebooks = getGuide('notebook-para-la-universidad')!;
    const laptop = product({ name: 'Notebook Lenovo Ideapad Slim 3 Ryzen 3 8gb Ram 512gb Ssd', brand: 'Lenovo', price: 459_990, ml_domain_id: 'MLC-NOTEBOOKS', category: 'computacion' });
    vi.mocked(getGuideView).mockResolvedValue({
      sections: notebooks.sections.map((section, i) => ({ section, products: i === 0 ? [laptop] : [], drops: {} })),
      products: [laptop],
    });
    vi.mocked(ProductGrid).mockClear();
    const html = renderToStaticMarkup(await GuiaPage(params('notebook-para-la-universidad')));
    const read = text(html);
    expect(read).toContain('Notebook para la universidad');
    expect(read).toContain('1 notebook a $459.990, con el precio de hoy.');
    expect(read).toContain('Qué mirar');
    expect(read).toContain('Memoria RAM: 8 GB alcanzan');
    for (const id of ['hasta-500000', 'mas-de-500000', 'con-tarjeta-de-video']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('href="/guias/regalos-tecnologicos"');
    for (const [props] of vi.mocked(ProductGrid).mock.calls) expect(props.placement).toBe('guia-notebook');
    expect(read).not.toMatch(AVOIDED);
  });

  it('una guía que no está en la lista no tiene página', async () => {
    await expect(GuiaPage(params('no-existe'))).rejects.toThrow('NOT_FOUND');
  });
});
