import { describe, expect, it, vi } from 'vitest';
import { getStore } from './stores';
import {
  USER_AGENT,
  parseSearchResults,
  parseStoreProduct,
  readRobots,
  readStorePrice,
  robotsAllows,
  searchStore,
} from './store-reader';

/*
 * Nunca hay red: la tienda es falsa. Las páginas de ejemplo siguen la forma
 * de las de Paris y MacOnline (revisadas el 26-11-2026):
 *  - Paris: varios bloques JSON-LD, uno de ellos el producto con una, dos o
 *    tres ofertas (normal, oferta, Tarjeta Cencosud) sin nombre; los nombres
 *    van en los datos del producto, con las comillas escapadas, y en la marca
 *    data-cnstrc-item-price. En el buscador, una lista (ItemList).
 *  - MacOnline: un bloque con todas las versiones del modelo, cada una con su
 *    código y su precio.
 */

const PARIS = getStore('paris')!;
const MAC = getStore('maconline')!;
const FICHA = 'https://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html';

function ld(...blocks: unknown[]): string {
  const scripts = blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n');
  return `<!doctype html><html><head><title>Tienda</title>${scripts}</head><body><h1>Página</h1></body></html>`;
}

const ORGANIZATION = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Paris', url: 'https://www.paris.cl' };
const BREADCRUMB = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Tecnología', item: 'https://www.paris.cl/tecnologia/' },
    { '@type': 'ListItem', position: 2, name: 'Consolas', item: 'https://www.paris.cl/tecnologia/consolas/' },
  ],
};

function offer(price: unknown, over: Record<string, unknown> = {}) {
  return { '@type': 'Offer', price, priceCurrency: 'CLP', seller: { '@type': 'Organization', name: 'Paris' }, url: FICHA, ...over };
}

function product(over: Record<string, unknown> = {}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Consola Nintendo Switch 2 Negro',
    brand: { '@type': 'Brand', name: 'Nintendo' },
    sku: 'MK3LFN4PP4',
    offers: [offer(699990, { availability: 'https://schema.org/InStock' })],
    ...over,
  };
}

/** Los datos del producto como los incrusta Paris: dentro de un texto de JavaScript, con las comillas escapadas. */
function parisData(prices: { regular: number; offer?: number; card?: number }, sku = 'MK3LFN4PP4'): string {
  const value = (centAmount: number) => ({ type: 'centPrecision', centAmount, currencyCode: 'CLP', fractionDigits: 0 });
  const data: Record<string, unknown> = { regular: { id: 'a', key: 'b', value: value(prices.regular), custom: { fields: {} } } };
  if (prices.offer) data.offer = { id: 'c', value: value(prices.offer), discountOnRegular: 0.25 };
  if (prices.card) data.paymentMethod = { discountOnRegular: 0.3, id: 'd', value: value(prices.card), custom: { fields: {} }, method: 'cencosudCard' };
  const json = JSON.stringify({ masterVariant: { id: 1, sku, prices: data, images: [{ url: 'https://img/1.jpg', alt: 'Foto' }] } });
  return `<script>self.__next_f.push([1,"${json.replace(/"/g, '\\"')}"])</script>`;
}

/** Una ficha de Paris completa: datos estructurados + datos del producto + la marca del precio. */
function parisPage(prices: { regular: number; offer?: number; card?: number }, mark: number | null = prices.offer ?? prices.regular): string {
  const offers = [prices.regular, prices.offer, prices.card].filter((p): p is number => typeof p === 'number').map((p) => offer(p));
  const marked = mark === null ? '' : `<div class="flex" data-cnstrc-item-price="${mark}"><h2>$</h2></div>`;
  return `${ld(ORGANIZATION, BREADCRUMB, product({ offers }))}${marked}${parisData(prices)}`;
}

function listItem(position: number, name: string, url: string, price: unknown, sku = `SKU${position}`) {
  return {
    '@type': 'ListItem',
    position,
    item: { '@type': 'Product', name, url, sku, image: 'https://www.paris.cl/img.jpg', offers: { '@type': 'Offer', price, priceCurrency: 'CLP' } },
  };
}

const SEARCH = ld(ORGANIZATION, {
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name: 'Resultados',
  mainEntity: {
    '@type': 'ItemList',
    itemListElement: [
      listItem(1, 'Consola Nintendo Switch 2 Negro', `${FICHA}?utm_source=buscador`, 699990, 'MK3LFN4PP4'),
      listItem(2, 'Consola Nintendo Switch 2 + Mario Kart World', 'https://www.paris.cl/consola-switch-2-mario-kart-MK7ABC.html', '749990'),
      // Repetido: no se muestra dos veces.
      listItem(3, 'Consola Nintendo Switch 2 Negro', FICHA, 699990, 'MK3LFN4PP4'),
      // De otro sitio: no es de esta tienda.
      listItem(4, 'Otra cosa', 'https://www.otra-tienda.cl/producto.html', 10000),
      // Sin precio legible: se muestra igual, sin precio.
      listItem(5, 'Funda Switch 2', 'https://www.paris.cl/funda-switch-2-FU1.html', 'consultar'),
    ],
  },
});

const MAC_FICHA = 'https://www.maconline.com/products/iphone-17';
function macVersion(name: string, sku: string, price: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    brand: { '@type': 'Brand', name: 'Apple' },
    sku,
    offers: { '@type': 'Offer', url: `https://maconline.com/products/iphone-17#default_sku=${sku}`, priceCurrency: 'CLP', price },
  };
}
const MAC_PAGE = ld([
  macVersion('iPhone 17 de 256 GB - Negro', 'MG6J4BE/A', '1099990.0'),
  macVersion('iPhone 17 de 256 GB - Blanco', 'MG6K4BE/A', '1099990.0'),
  macVersion('iPhone 17 de 512 GB - Negro', 'MG6P4BE/A', '1349990.0'),
]);

function page(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init });
}

describe('parseStoreProduct', () => {
  it('lee el producto de la ficha entre los demás bloques', () => {
    expect(parseStoreProduct(PARIS, ld(ORGANIZATION, BREADCRUMB, product()))).toEqual({
      ok: true,
      value: { title: 'Consola Nintendo Switch 2 Negro', price: 699990, sku: 'MK3LFN4PP4', seller: 'Paris', available: true },
    });
  });

  it('acepta la oferta sola (sin lista), el precio como texto y los productos dentro de @graph', () => {
    const single = product({ offers: { '@type': 'Offer', price: '699990.00', priceCurrency: 'CLP' } });
    expect(parseStoreProduct(PARIS, ld(single))).toMatchObject({ ok: true, value: { price: 699990, seller: null } });
    expect(parseStoreProduct(PARIS, ld({ '@context': 'https://schema.org', '@graph': [ORGANIZATION, product()] }))).toMatchObject({
      ok: true,
      value: { price: 699990, sku: 'MK3LFN4PP4' },
    });
    const dotted = product({ offers: { '@type': 'Offer', price: '699.990', priceCurrency: 'CLP' } });
    expect(parseStoreProduct(PARIS, ld(dotted))).toMatchObject({ ok: true, value: { price: 699990 } });
  });

  it('un precio sin moneda, en otra moneda o con decimales de verdad no se toma', () => {
    for (const bad of [
      { '@type': 'Offer', price: 699990 },
      { '@type': 'Offer', price: 699, priceCurrency: 'USD' },
      { '@type': 'Offer', price: '699.5', priceCurrency: 'CLP' },
      { '@type': 'Offer', price: 0, priceCurrency: 'CLP' },
      { '@type': 'Offer', price: 'consultar', priceCurrency: 'CLP' },
      { '@type': 'Offer', price: 100000000, priceCurrency: 'CLP' },
    ]) {
      expect(parseStoreProduct(PARIS, ld(product({ offers: bad })))).toEqual({ ok: false, reason: 'sin_datos' });
    }
  });

  it('varios precios sin forma de saber cuál es el de cualquiera: no elige ninguno', () => {
    const two = product({ offers: [offer(699990), offer(749990)] });
    expect(parseStoreProduct(PARIS, ld(two))).toEqual({ ok: false, reason: 'varios_precios' });
    const range = product({ offers: { '@type': 'AggregateOffer', lowPrice: 699990, highPrice: 749990, priceCurrency: 'CLP' } });
    expect(parseStoreProduct(PARIS, ld(range))).toEqual({ ok: false, reason: 'varios_precios' });
  });

  it('varias ofertas al mismo precio, o un rango de un solo precio, sí valen', () => {
    const same = product({ offers: [offer(699990), offer('699990')] });
    expect(parseStoreProduct(PARIS, ld(same))).toMatchObject({ ok: true, value: { price: 699990 } });
    const range = product({ offers: { '@type': 'AggregateOffer', lowPrice: 699990, highPrice: 699990, priceCurrency: 'CLP' } });
    expect(parseStoreProduct(PARIS, ld(range))).toMatchObject({ ok: true, value: { price: 699990 } });
  });

  it('dice cuando la tienda no lo tiene', () => {
    const gone = product({ offers: offer(699990, { availability: 'https://schema.org/OutOfStock' }) });
    expect(parseStoreProduct(PARIS, ld(gone))).toMatchObject({ ok: true, value: { available: false } });
  });

  it('una página de resultados no es una ficha: no toma el primer producto de la lista', () => {
    expect(parseStoreProduct(PARIS, SEARCH)).toEqual({ ok: false, reason: 'es_lista' });
    // Una ficha con su producto y, además, una lista de "también te puede interesar": vale el propio.
    const withRelated = ld(product(), {
      '@type': 'ItemList',
      itemListElement: [listItem(1, 'Otro producto', 'https://www.paris.cl/otro-OT1.html', 19990)],
    });
    expect(parseStoreProduct(PARIS, withRelated)).toMatchObject({ ok: true, value: { price: 699990, sku: 'MK3LFN4PP4' } });
  });

  it('sin datos estructurados, o con un bloque roto, no inventa nada', () => {
    expect(parseStoreProduct(PARIS, '<html><body>$699.990</body></html>')).toEqual({ ok: false, reason: 'sin_datos' });
    expect(parseStoreProduct(PARIS, '')).toEqual({ ok: false, reason: 'sin_datos' });
    const broken = `<script type="application/ld+json">{"@type":"Product",</script>${ld(product())}`;
    expect(parseStoreProduct(PARIS, broken)).toMatchObject({ ok: true, value: { price: 699990 } });
  });
});

describe('parseStoreProduct en Paris: normal, oferta y Tarjeta Cencosud', () => {
  it('con oferta, vale la oferta y no el precio normal', () => {
    expect(parseStoreProduct(PARIS, parisPage({ regular: 299990, offer: 224990 }))).toMatchObject({ ok: true, value: { price: 224990 } });
  });

  it('el precio con la tarjeta de la tienda nunca se toma, aunque sea el más bajo', () => {
    expect(parseStoreProduct(PARIS, parisPage({ regular: 1109990, offer: 699990, card: 679990 }))).toMatchObject({
      ok: true,
      value: { price: 699990, seller: 'Paris' },
    });
    // Sin oferta: normal y tarjeta. Vale el normal.
    expect(parseStoreProduct(PARIS, parisPage({ regular: 500000, card: 450000 }))).toMatchObject({ ok: true, value: { price: 500000 } });
  });

  it('si los nombres y la marca del precio se contradicen, no se toma ninguno', () => {
    expect(parseStoreProduct(PARIS, parisPage({ regular: 1109990, offer: 699990, card: 679990 }, 679990))).toEqual({
      ok: false,
      reason: 'varios_precios',
    });
  });

  it('con una sola de las dos señales alcanza, si calza con los datos estructurados', () => {
    // Sin la marca: mandan los nombres.
    expect(parseStoreProduct(PARIS, parisPage({ regular: 299990, offer: 224990 }, null))).toMatchObject({ ok: true, value: { price: 224990 } });
    // Sin los nombres: manda la marca.
    const offers = [offer(299990), offer(224990)];
    const onlyMark = `${ld(product({ offers }))}<div data-cnstrc-item-price="224990"></div>`;
    expect(parseStoreProduct(PARIS, onlyMark)).toMatchObject({ ok: true, value: { price: 224990 } });
    // Una marca que no es ninguno de los precios publicados no sirve.
    const stray = `${ld(product({ offers }))}<div data-cnstrc-item-price="199990"></div>`;
    expect(parseStoreProduct(PARIS, stray)).toEqual({ ok: false, reason: 'varios_precios' });
  });

  it('sin ninguna señal, o con dos juegos de precios distintos en la página, no elige', () => {
    const offers = [offer(299990), offer(224990)];
    expect(parseStoreProduct(PARIS, ld(product({ offers })))).toEqual({ ok: false, reason: 'varios_precios' });
    const twoSets = `${ld(product({ offers }))}${parisData({ regular: 299990, offer: 224990 })}${parisData({ regular: 299990, offer: 199990 }, 'OTRO')}`;
    expect(parseStoreProduct(PARIS, twoSets)).toEqual({ ok: false, reason: 'varios_precios' });
  });

  it('esa regla es solo de Paris: en otra tienda dos precios distintos quedan sin elegir', () => {
    const html = parisPage({ regular: 299990, offer: 224990 });
    expect(parseStoreProduct(MAC, html)).toEqual({ ok: false, reason: 'varios_precios' });
  });
});

describe('parseStoreProduct con varias versiones en una ficha (MacOnline)', () => {
  it('sin decir cuál, entrega las versiones para elegir', () => {
    expect(parseStoreProduct(MAC, MAC_PAGE)).toEqual({
      ok: false,
      reason: 'varias_versiones',
      variants: [
        { title: 'iPhone 17 de 256 GB - Negro', sku: 'MG6J4BE/A', price: 1099990 },
        { title: 'iPhone 17 de 256 GB - Blanco', sku: 'MG6K4BE/A', price: 1099990 },
        { title: 'iPhone 17 de 512 GB - Negro', sku: 'MG6P4BE/A', price: 1349990 },
      ],
    });
  });

  it('con el código, lee esa versión y ninguna otra', () => {
    expect(parseStoreProduct(MAC, MAC_PAGE, 'MG6P4BE/A')).toEqual({
      ok: true,
      value: { title: 'iPhone 17 de 512 GB - Negro', price: 1349990, sku: 'MG6P4BE/A', seller: null, available: true },
    });
    expect(parseStoreProduct(MAC, MAC_PAGE, 'mg6j4be/a')).toMatchObject({ ok: true, value: { price: 1099990 } });
  });

  it('si la versión guardada ya no está, no toma otra en su lugar', () => {
    expect(parseStoreProduct(MAC, MAC_PAGE, 'MG6Z4BE/A')).toEqual({ ok: false, reason: 'sin_datos' });
    // También en una ficha de un solo producto: si el código cambió, es otro producto.
    expect(parseStoreProduct(PARIS, ld(product()), 'OTRO123')).toEqual({ ok: false, reason: 'sin_datos' });
    expect(parseStoreProduct(PARIS, ld(product()), 'MK3LFN4PP4')).toMatchObject({ ok: true });
  });

  it('una ficha de un solo producto se lee sin código', () => {
    const one = ld(macVersion('AirPods Pro 3', 'MFHP4AM/A', '249990.0'));
    expect(parseStoreProduct(MAC, one)).toMatchObject({ ok: true, value: { title: 'AirPods Pro 3', price: 249990, sku: 'MFHP4AM/A' } });
  });
});

describe('parseSearchResults', () => {
  it('entrega los productos de la tienda, sin repetidos y con la dirección limpia', () => {
    expect(parseSearchResults(SEARCH, PARIS)).toEqual([
      { title: 'Consola Nintendo Switch 2 Negro', url: FICHA, price: 699990, sku: 'MK3LFN4PP4' },
      {
        title: 'Consola Nintendo Switch 2 + Mario Kart World',
        url: 'https://www.paris.cl/consola-switch-2-mario-kart-MK7ABC.html',
        price: 749990,
        sku: 'SKU2',
      },
      { title: 'Funda Switch 2', url: 'https://www.paris.cl/funda-switch-2-FU1.html', price: null, sku: 'SKU5' },
    ]);
  });

  it('respeta el tope y no confunde una ficha con resultados', () => {
    expect(parseSearchResults(SEARCH, PARIS, 1)).toHaveLength(1);
    expect(parseSearchResults(ld(product({ url: FICHA })), PARIS)).toEqual([]);
    expect(parseSearchResults('', PARIS)).toEqual([]);
  });
});

describe('robotsAllows', () => {
  it('sin reglas, o con "Disallow:" vacío, se puede todo', () => {
    expect(robotsAllows('', '/algo.html')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow:\nSitemap: https://www.paris.cl/sitemap_index.xml', '/search/?q=switch')).toBe(true);
  });

  it('aplica las reglas de todos cuando no hay un grupo con su nombre', () => {
    const txt = ['User-agent: *', 'Disallow: /checkout', 'Disallow: /cart', 'Disallow: /api', '', 'User-agent: Googlebot', 'Disallow: /'].join(
      '\n'
    );
    expect(robotsAllows(txt, '/products/iphone-17')).toBe(true);
    expect(robotsAllows(txt, '/checkout/pago')).toBe(false);
    expect(robotsAllows(txt, '/api/productos')).toBe(false);
  });

  it('si la tienda le pone reglas a ComparaTechBot, valen esas y no las de todos', () => {
    const closed = 'User-agent: *\nDisallow:\n\nUser-agent: ComparaTechBot\nDisallow: /';
    expect(robotsAllows(closed, '/algo.html')).toBe(false);
    const open = 'User-agent: *\nDisallow: /\n\nUser-agent: comparatechbot\nAllow: /';
    expect(robotsAllows(open, '/algo.html')).toBe(true);
  });

  it('una tienda cerrada a todos los programas no se lee', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /', '/algo.html')).toBe(false);
  });

  it('entiende comodines, el fin de dirección y que gana la regla más específica', () => {
    const txt = ['User-agent: *', 'Disallow: /*.pdf', 'Disallow: */modal/*', 'Disallow: /search', 'Allow: /search/marcas$', '# comentario', 'Disallow: /x # otro'].join(
      '\r\n'
    );
    expect(robotsAllows(txt, '/manual.pdf')).toBe(false);
    expect(robotsAllows(txt, '/equipos/modal/detalle')).toBe(false);
    expect(robotsAllows(txt, '/equipos/iphone-17')).toBe(true);
    expect(robotsAllows(txt, '/search/?q=switch')).toBe(false);
    expect(robotsAllows(txt, '/search/marcas')).toBe(true);
    expect(robotsAllows(txt, '/search/marcas/apple')).toBe(false);
    expect(robotsAllows(txt, '/x/y')).toBe(false);
  });

  it('varios User-agent seguidos comparten las reglas', () => {
    const txt = 'User-agent: GPTBot\nUser-agent: *\nDisallow: /privado\n';
    expect(robotsAllows(txt, '/privado/a')).toBe(false);
    expect(robotsAllows(txt, '/publico')).toBe(true);
  });
});

describe('readRobots', () => {
  it('pide el robots.txt de la tienda identificándose', async () => {
    const fetchImpl = vi.fn(async () => new Response('User-agent: *\nDisallow:', { status: 200 }));
    await expect(readRobots(PARIS, fetchImpl)).resolves.toEqual({ ok: true, txt: 'User-agent: *\nDisallow:' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.paris.cl/robots.txt');
    expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
  });

  it('sin archivo se puede todo; si no se pudo saber, no se lee', async () => {
    await expect(readRobots(PARIS, async () => new Response('no', { status: 404 }))).resolves.toEqual({ ok: true, txt: '' });
    await expect(readRobots(PARIS, async () => new Response('no', { status: 403 }))).resolves.toMatchObject({ ok: false });
    await expect(
      readRobots(PARIS, async () => {
        throw new Error('timeout');
      })
    ).resolves.toEqual({ ok: false, detail: 'timeout' });
  });
});

describe('readStorePrice', () => {
  it('lee el precio de la ficha con un solo pedido, identificándose y sin parámetros de seguimiento', async () => {
    const fetchImpl = vi.fn(async () => page(ld(ORGANIZATION, BREADCRUMB, product())));
    const read = await readStorePrice(`${FICHA}?utm_source=x`, '', { fetchImpl });
    expect(read).toEqual({
      ok: true,
      store: PARIS,
      url: FICHA,
      value: { title: 'Consola Nintendo Switch 2 Negro', price: 699990, sku: 'MK3LFN4PP4', seller: 'Paris', available: true },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(FICHA);
    expect((init.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
    expect(init.redirect).toBe('manual');
  });

  it('en Paris entrega el precio sin tarjeta', async () => {
    const fetchImpl = vi.fn(async () => page(parisPage({ regular: 1109990, offer: 699990, card: 679990 })));
    await expect(readStorePrice(FICHA, '', { fetchImpl })).resolves.toMatchObject({ ok: true, value: { price: 699990 } });
  });

  it('en una ficha de varias versiones pide elegir, y con el código lee esa', async () => {
    const fetchImpl = vi.fn(async () => page(MAC_PAGE));
    const open = await readStorePrice(`${MAC_FICHA}#default_sku=MG6J4BE/A`, '', { fetchImpl });
    expect(open).toMatchObject({ ok: false, reason: 'varias_versiones' });
    expect(open.ok ? [] : open.variants?.map((v) => v.sku)).toEqual(['MG6J4BE/A', 'MG6K4BE/A', 'MG6P4BE/A']);
    // La dirección que se pide nunca lleva el ancla.
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(MAC_FICHA);
    await expect(readStorePrice(MAC_FICHA, '', { fetchImpl, sku: 'MG6P4BE/A' })).resolves.toMatchObject({
      ok: true,
      url: MAC_FICHA,
      value: { price: 1349990, sku: 'MG6P4BE/A' },
    });
    const gone = await readStorePrice(MAC_FICHA, '', { fetchImpl, sku: 'MG6Z4BE/A' });
    expect(gone).toMatchObject({ ok: false, reason: 'sin_precio' });
    expect(gone.ok ? '' : gone.detail).toContain('esa versión');
  });

  it('una dirección que no es de una tienda de la lista no se pide', async () => {
    const fetchImpl = vi.fn(async () => page(ld(product())));
    await expect(readStorePrice('https://www.falabella.com/falabella-cl/product/1', '', { fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'no_es_tienda',
    });
    await expect(readStorePrice('https://www.mercadolibre.cl/p/MLC61403702', '', { fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'no_es_tienda',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('las tiendas que prohíben leer sus páginas, o que van por su conexión oficial, no se piden', async () => {
    const fetchImpl = vi.fn(async () => page(ld(product())));
    await expect(readStorePrice('https://www.samsung.com/cl/smartphones/galaxy-s26/buy/', '', { fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'no_se_lee',
    });
    await expect(readStorePrice('https://www.aliexpress.com/item/1005001234567890.html', '', { fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: 'no_se_lee',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('si el robots.txt no deja, no se pide', async () => {
    const fetchImpl = vi.fn(async () => page(ld(product())));
    await expect(readStorePrice(FICHA, 'User-agent: *\nDisallow: /', { fetchImpl })).resolves.toMatchObject({ ok: false, reason: 'robots' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('un bloqueo se anota y no se reintenta', async () => {
    for (const status of [403, 429, 503, 401]) {
      const fetchImpl = vi.fn(async () => page('Access denied', { status }));
      await expect(readStorePrice(FICHA, '', { fetchImpl })).resolves.toMatchObject({ ok: false, reason: 'bloqueada' });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('una ficha que ya no existe, un error del servidor o una caída de red no se reintentan', async () => {
    const gone = vi.fn(async () => page('no', { status: 404 }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: gone })).resolves.toMatchObject({ ok: false, reason: 'no_existe' });
    const broken = vi.fn(async () => page('no', { status: 500 }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: broken })).resolves.toMatchObject({ ok: false, reason: 'error' });
    const down = vi.fn(async () => {
      throw new Error('timeout');
    });
    await expect(readStorePrice(FICHA, '', { fetchImpl: down })).resolves.toEqual({ ok: false, reason: 'error', detail: 'timeout' });
    for (const fetchImpl of [gone, broken, down]) expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sigue una redirección dentro de la misma tienda, pero nunca a otro sitio', async () => {
    const inside = vi.fn(async (url: string) =>
      url === 'https://paris.cl/algo-AB1.html'
        ? new Response(null, { status: 301, headers: { location: 'https://www.paris.cl/algo-AB1.html' } })
        : page(ld(product()))
    );
    await expect(readStorePrice('https://paris.cl/algo-AB1.html', '', { fetchImpl: inside })).resolves.toMatchObject({
      ok: true,
      value: { price: 699990 },
    });
    expect(inside.mock.calls.map((c) => c[0])).toEqual(['https://paris.cl/algo-AB1.html', 'https://www.paris.cl/algo-AB1.html']);

    const outside = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://verificacion.otro-sitio.com/captcha' } }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: outside })).resolves.toMatchObject({ ok: false, reason: 'bloqueada' });
    expect(outside).toHaveBeenCalledTimes(1);

    const relative = vi.fn(async (url: string) =>
      url === FICHA ? new Response(null, { status: 302, headers: { location: '/consola-nueva-direccion-MK3.html' } }) : page(ld(product()))
    );
    await expect(readStorePrice(FICHA, '', { fetchImpl: relative })).resolves.toMatchObject({ ok: true });
    expect(relative.mock.calls[1][0]).toBe('https://www.paris.cl/consola-nueva-direccion-MK3.html');
  });

  it('una ficha que la tienda manda a su portada dejó de existir, y una vuelta sin fin se corta', async () => {
    const home = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://www.paris.cl/' } }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: home })).resolves.toMatchObject({ ok: false, reason: 'no_existe' });
    expect(home).toHaveBeenCalledTimes(1);

    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: FICHA } }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: loop })).resolves.toMatchObject({ ok: false, reason: 'error' });
    expect(loop.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('una página enorme no se lee entera: el sitio corre con poca memoria', async () => {
    const declared = vi.fn(async () => page('x', { headers: { 'content-length': '50000000' } }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: declared })).resolves.toMatchObject({ ok: false, reason: 'error' });

    // Sin tamaño declarado: se corta al pasar el tope, sin esperar el resto.
    let sent = 0;
    const chunk = new Uint8Array(1_000_000);
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        if (sent > 500) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const huge = vi.fn(async () => new Response(endless, { status: 200 }));
    await expect(readStorePrice(FICHA, '', { fetchImpl: huge })).resolves.toMatchObject({ ok: false, reason: 'error' });
    expect(sent).toBeLessThan(20);
  });

  it('una página sin precio en pesos, con precios sin resolver o que es una lista queda sin precio', async () => {
    await expect(readStorePrice(FICHA, '', { fetchImpl: async () => page('<html></html>') })).resolves.toMatchObject({
      ok: false,
      reason: 'sin_precio',
    });
    const two = await readStorePrice(FICHA, '', { fetchImpl: async () => page(ld(product({ offers: [offer(1), offer(2)] }))) });
    expect(two).toMatchObject({ ok: false, reason: 'sin_precio' });
    expect(two.ok ? '' : two.detail).toContain('más de un precio');
    const list = await readStorePrice(FICHA, '', { fetchImpl: async () => page(SEARCH) });
    expect(list).toMatchObject({ ok: false, reason: 'sin_precio' });
    expect(list.ok ? '' : list.detail).toContain('lista de productos');
  });
});

describe('searchStore', () => {
  it('busca en la tienda con un solo pedido y entrega sus resultados', async () => {
    const fetchImpl = vi.fn(async () => page(SEARCH));
    const result = await searchStore(PARIS, 'nintendo switch 2', '', fetchImpl);
    expect(result.ok && result.hits.map((h) => h.price)).toEqual([699990, 749990, null]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://www.paris.cl/search/?q=nintendo%20switch%202');
  });

  it('no busca donde el robots.txt no deja, ni en tiendas sin buscador legible', async () => {
    const fetchImpl = vi.fn(async () => page(SEARCH));
    await expect(searchStore(PARIS, 'switch', 'User-agent: *\nDisallow: /search', fetchImpl)).resolves.toMatchObject({
      ok: false,
      reason: 'robots',
    });
    await expect(searchStore(getStore('samsung')!, 'galaxy', '', fetchImpl)).resolves.toMatchObject({ ok: false, reason: 'no_se_lee' });
    await expect(searchStore(MAC, 'iphone', '', fetchImpl)).resolves.toMatchObject({ ok: false, reason: 'no_se_lee' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('un bloqueo del buscador no se reintenta', async () => {
    const fetchImpl = vi.fn(async () => page('no', { status: 403 }));
    await expect(searchStore(PARIS, 'switch', '', fetchImpl)).resolves.toMatchObject({ ok: false, reason: 'bloqueada' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
