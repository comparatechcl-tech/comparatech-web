import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Las acciones escriben en la base (y la revisión en vivo consulta Mercado Libre): acá solo se mira lo que se dibuja.
vi.mock('@/app/admin/historias/carrusel/actions', () => ({ markCarouselPublished: vi.fn(), undoCarouselPublished: vi.fn() }));
vi.mock('@/app/admin/historias/actions', () => ({ markStoryPublished: vi.fn(), undoStoryPublished: vi.fn() }));
vi.mock('@/app/admin/live-price-actions', () => ({ checkLivePrices: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(), getPriceStatsManyChecked: vi.fn() }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
// La página recibe lo que lee ya armado.
vi.mock('@/lib/social/carousel', async (original) => ({
  ...(await original<typeof import('@/lib/social/carousel')>()),
  readCarouselPage: vi.fn(),
}));

import CarruselPage from '@/app/admin/historias/carrusel/page';
import { CarouselView } from '@/app/admin/historias/carrusel/CarouselView';
import { buildCarouselCaptions } from '@/lib/content/captions';
import { readCarouselPage, type CarouselEntry, type CarouselPage, type WeeklyCarousel } from '@/lib/social/carousel';

const NOW = new Date('2026-10-18T21:00:00Z');
const SECRET = 'un-secreto-de-prueba-de-mas-de-32-caracteres';

function entry(rank: number, over: Partial<CarouselEntry> = {}): CarouselEntry {
  const id = `00000000-0000-4000-8000-00000000000${rank}`;
  return {
    id,
    rank,
    slug: `producto-${rank}`,
    name: `Smart TV Samsung ${rank}`,
    brand: 'Samsung',
    price: 349_990,
    listPrice: 499_990,
    dropAmount: 80_000,
    dropPct: 19,
    since: '2026-10-15T14:00:00.000Z',
    checkedAt: '2026-10-18T20:30:00.000Z',
    freeShipping: true,
    full: false,
    image: `/social/carrusel/ids/${rank}-bajas-20261018-x.jpg`,
    fileName: `comparatech-top3-2026-10-18-${rank}-producto-${rank}.jpg`,
    mlUrl: `https://www.mercadolibre.cl/p/MLC${rank}`,
    ...over,
  };
}

function carousel(entries = [entry(1), entry(2), entry(3)]): WeeklyCarousel {
  return {
    kind: 'bajas',
    day: 20261018,
    rangeLabel: 'del 12 al 18 de octubre',
    cover: { image: '/social/carrusel/ids/portada-bajas-20261018-x.jpg', fileName: 'comparatech-top3-2026-10-18-0-portada.jpg' },
    entries,
    closing: { image: '/social/carrusel/ids/cierre-bajas-20261018-x.jpg', fileName: 'comparatech-top3-2026-10-18-4-cierre.jpg' },
    captions: buildCarouselCaptions(
      entries.map((e) => ({ name: e.name, price: e.price, dropAmount: e.dropAmount, price_checked_at: e.checkedAt })),
      { rangeLabel: 'del 12 al 18 de octubre', siteUrl: 'https://www.comparatech.cl' }
    ),
  };
}

const view = (c: WeeklyCarousel) =>
  renderToStaticMarkup(<CarouselView carousel={c} maxPriceAgeMs={6 * 3600_000} renderedAt={NOW.getTime()} />);

/** El texto que se lee: sin etiquetas. */
const text = (html: string) =>
  html
    .replace(/<\/?(?:strong|s|a|em|span)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

function page(over: Partial<CarouselPage> = {}): CarouselPage {
  return { carousel: carousel(), found: 3, qualifying: 3, unread: 0, published: null, nextDay: null, ...over };
}

async function renderPage(search: Record<string, string> = {}) {
  return renderToStaticMarkup(await CarruselPage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.mocked(readCarouselPage).mockReset();
});

describe('CarouselView', () => {
  it('ofrece compartir todo, copiar cada texto, guardar y marcar', () => {
    const t = text(view(carousel()));
    for (const label of ['Preparando las imágenes (0 de 5)', 'Copiar texto (Instagram)', 'Copiar texto (Facebook)', 'Guardar las 5 imágenes', 'Ya lo publiqué']) {
      expect(t).toContain(label);
    }
  });

  it('muestra las láminas en orden, con la dirección firmada y nunca una dirección blob:', () => {
    const html = view(carousel());
    expect(text(html)).toMatch(/1\. Portada .*2\. #1 .*3\. #2 .*4\. #3 .*5\. Cierre/);
    expect(html).not.toContain('blob:');
  });

  it('cada producto dice su precio, cuánto bajó según el historial y desde cuándo, sin llamarlo descuento', () => {
    const t = text(view(carousel()));
    expect(t).toContain('#1 · Smart TV Samsung 1');
    expect(t).toContain('$349.990');
    expect(t).toContain('Bajó $80.000 desde el 15/10 (19% según nuestro historial)');
    // Ni la cifra tachada del vendedor ni la palabra descuento: el carrusel no los muestra.
    expect(t).not.toMatch(/descuento|499\.990|precio de lista|antes \$/i);
  });

  it('"Ver en Mercado Libre" lleva a la ficha sin parámetros de afiliado; sin ficha, no hay botón', () => {
    const html = view(carousel([entry(1), entry(2, { mlUrl: null }), entry(3, { mlUrl: 'https://www.mercadolibre.cl/p/MLC3?matt_word=comparatech' })]));
    expect(html).toContain('href="https://www.mercadolibre.cl/p/MLC1"');
    expect(html).toContain('href="https://www.mercadolibre.cl/p/MLC3"');
    expect(html).not.toContain('matt_word');
    expect(html.match(/Ver en Mercado Libre/g)).toHaveLength(2);
  });

  it('los textos de las dos redes van completos para copiarlos a mano si el botón falla', () => {
    const t = text(view(carousel()));
    expect(t).toContain('📉 Top 3 bajas de la semana (del 12 al 18 de octubre), según nuestro historial de precios:');
    expect(t).toContain('🛒 Link de compra en nuestra bio, o búscalo en comparatech.cl');
    expect(t).toContain('🛒 Links de compra: https://www.comparatech.cl/hoy?src=facebook-carrusel');
  });

  it('antes de la revisión en vivo, cada producto dice que se está revisando', () => {
    expect(text(view(carousel())).match(/Revisando en Mercado Libre…/g)).toHaveLength(3);
  });
});

describe('/admin/historias/carrusel', () => {
  it('con el carrusel listo, lo muestra con la semana y cuántas bajas cumplen', async () => {
    vi.mocked(readCarouselPage).mockResolvedValue(page({ qualifying: 13, carousel: carousel([1, 2, 3, 4, 5].map((r) => entry(r))) }));
    const t = text(await renderPage());
    expect(t).toContain('Carrusel de la semana');
    expect(t).toContain('Bajas del 12 al 18 de octubre.');
    expect(t).toContain('13 bajas cumplen las reglas; van las 5 más grandes');
    expect(t).toContain('Compartir');
  });

  it('con menos de cinco, dice que no rellena', async () => {
    vi.mocked(readCarouselPage).mockResolvedValue(page());
    expect(text(await renderPage())).toContain('Esta semana solo 3 bajas cumplen todas las reglas: sale como Top 3, sin rellenar con otras.');
  });

  it('si no alcanza para armarlo, lo dice y no muestra un carrusel', async () => {
    vi.mocked(readCarouselPage).mockResolvedValue(page({ carousel: null, found: 2, qualifying: 2 }));
    const t = text(await renderPage());
    expect(t).toContain('Esta semana no alcanza para el carrusel: solo 2 bajas cumplen todas las reglas y hacen falta al menos 3.');
    // Sin los botones del carrusel (las instrucciones de arriba sí los nombran).
    expect(t).not.toContain('Copiar texto (Instagram) Copiar texto (Facebook)');
    expect(t).not.toContain('Las 7 imágenes');
  });

  it('con el de esta semana ya publicado, lo muestra con su deshacer y dice desde cuándo se arma el próximo', async () => {
    vi.mocked(readCarouselPage).mockResolvedValue(
      page({
        carousel: null,
        published: {
          postedAt: '2026-10-14T16:00:00.000Z',
          postIds: [1, 2, 3],
          items: [
            { productId: 'a', name: 'Smart TV Samsung 1', postedPrice: 349_990, priceNow: 349_990 },
            { productId: 'b', name: 'Parlante JBL', postedPrice: 99_990, priceNow: 109_990 },
            { productId: 'c', name: 'Notebook HP', postedPrice: 879_990, priceNow: null },
          ],
        },
        nextDay: 20261021,
      })
    );
    const t = text(await renderPage());
    expect(t).toContain('Ya publicaste el carrusel de esta semana');
    expect(t).toContain('Lo marcaste el 14/10 a las 13:00. El próximo se arma desde el miércoles 21/10.');
    expect(t).toContain('#2 · Parlante JBL · publicado a $99.990 · ahora $109.990');
    expect(t).toContain('#3 · Notebook HP · publicado a $879.990 · ya no está a la venta');
    expect(t).toContain('No lo publiqué: deshacer');
    expect(t).toContain('míralo aquí');
    expect(vi.mocked(readCarouselPage).mock.calls[0][3]).toMatchObject({ force: false });
  });

  it('con ?ver=proximo pide el próximo igual', async () => {
    vi.mocked(readCarouselPage).mockResolvedValue(page());
    await renderPage({ ver: 'proximo' });
    expect(vi.mocked(readCarouselPage).mock.calls[0][3]).toMatchObject({ force: true });
  });

  it('avisa si no pudo leer el historial de algunos productos', async () => {
    vi.mocked(readCarouselPage).mockResolvedValue(page({ unread: 40 }));
    expect(text(await renderPage())).toContain('Ahora no pude leer el historial de precios de 40 productos: puede faltar alguna baja.');
  });

  it('sin la clave para firmar las imágenes, no arma nada y lo dice', async () => {
    vi.stubEnv('CRON_SECRET', 'corto');
    const t = text(await renderPage());
    expect(t).toContain('No se pudo preparar el carrusel: CRON_SECRET falta o tiene menos de 32 caracteres');
    expect(vi.mocked(readCarouselPage)).not.toHaveBeenCalled();
  });

  it('si la lectura falla, lo dice', async () => {
    vi.mocked(readCarouselPage).mockRejectedValue(new Error('No se pudo leer el catálogo: se cayó'));
    expect(text(await renderPage())).toContain('No se pudo preparar el carrusel: No se pudo leer el catálogo: se cayó');
  });
});
