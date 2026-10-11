import { describe, expect, it } from 'vitest';
import { priceStats } from '@/lib/deals';
import type { Product } from '@/lib/types';
import {
  betterSpec,
  compareListUrl,
  compareOptionsForB,
  compareProductUrl,
  compareSummary,
  defaultComparePair,
  groupByCategory,
  groupByType,
  parseCompareQuery,
  sharedSpecKeys,
  toCompareCandidate,
  toCompareDetail,
  topSeller,
  type CompareCandidate,
} from '@/lib/compare';

function p(slug: string, domain: string | null, sales: number, category = 'audio', name = slug): CompareCandidate {
  return { slug, name, category, ml_domain_id: domain, seller_sales_count: sales };
}

describe('defaultComparePair', () => {
  it('elige los dos más vendidos del dominio con más productos', () => {
    const products = [
      p('parlante', 'MLC-SPEAKERS', 9000),
      p('iphone', 'MLC-CELLPHONES', 8000, 'celulares'),
      p('aud-1', 'MLC-HEADPHONES', 50),
      p('aud-2', 'MLC-HEADPHONES', 700),
      p('aud-3', 'MLC-HEADPHONES', 300),
      p('parlante-2', 'MLC-SPEAKERS', 10),
    ];
    expect(defaultComparePair(products)).toEqual(['aud-2', 'aud-3']);
  });

  it('nunca arma un par de dominios distintos si hay un dominio con dos', () => {
    const products = [p('a', 'X', 1), p('b', 'Y', 100), p('c', 'Y', 5)];
    expect(defaultComparePair(products)).toEqual(['b', 'c']);
  });

  it('cae a los dos primeros si ningún dominio tiene dos productos', () => {
    expect(defaultComparePair([p('a', 'X', 1), p('b', null, 2)])).toEqual(['a', 'b']);
    expect(defaultComparePair([p('a', 'X', 1)])).toEqual(['a', 'a']);
    expect(defaultComparePair([])).toEqual(['', '']);
  });
});

describe('compareOptionsForB', () => {
  const products = [p('a1', 'A', 1), p('a2', 'A', 2), p('b1', 'B', 3), p('n', null, 4)];

  it('limita B al mismo dominio que A, sin A', () => {
    const { options, restricted } = compareOptionsForB(products, products[0], false);
    expect(options.map((x) => x.slug)).toEqual(['a2']);
    expect(restricted).toBe(true);
  });

  it('muestra todo con el toggle', () => {
    const { options, restricted } = compareOptionsForB(products, products[0], true);
    expect(options.map((x) => x.slug)).toEqual(['a2', 'b1', 'n']);
    expect(restricted).toBe(false);
  });

  it('muestra todo si A no tiene dominio o es el único de su dominio', () => {
    expect(compareOptionsForB(products, products[3], false).options).toHaveLength(3);
    expect(compareOptionsForB(products, products[2], false).restricted).toBe(false);
  });

  it('topSeller devuelve el más vendido', () => {
    expect(topSeller(products)?.slug).toBe('n');
    expect(topSeller([])).toBeUndefined();
  });
});

describe('groupByCategory', () => {
  it('agrupa en el orden del registro y ordena por nombre', () => {
    const groups = groupByCategory([
      p('z', 'A', 1, 'audio', 'Zeta'),
      p('c', 'C', 1, 'celulares', 'Celu'),
      p('a', 'A', 1, 'audio', 'Alfa'),
      p('x', 'X', 1, 'nueva', 'Nuevo'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Celulares', 'Audio', 'Nueva']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['Alfa', 'Zeta']);
  });
});

describe('groupByType', () => {
  it('agrupa por tipo en orden alfabético, con Otros al final, y ordena por nombre', () => {
    const groups = groupByType([
      p('p2', 'MLC-SPEAKERS', 1, 'audio', 'Parlante Zeta'),
      p('raro', 'MLC-DESCONOCIDO', 1, 'audio', 'Algo raro'),
      p('a1', 'MLC-HEADPHONES', 1, 'audio', 'Audífono Uno'),
      p('p1', 'MLC-SPEAKERS', 1, 'audio', 'Parlante Alfa'),
      p('sin', null, 1, 'audio', 'Sin tipo'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Audífonos', 'Parlantes', 'Otros']);
    expect(groups[1].items.map((i) => i.slug)).toEqual(['p1', 'p2']);
    expect(groups[2].items.map((i) => i.slug)).toEqual(['raro', 'sin']);
  });

  it('junta los dominios que llevan el mismo nombre', () => {
    const groups = groupByType([p('k1', 'MLC-PC_KEYBOARDS', 1), p('k2', 'MLC-LAPTOP_KEYBOARDS', 1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Teclados');
  });
});

describe('lo que viaja al navegador', () => {
  const product: Product = {
    id: 'id-1',
    slug: 'parlante-jbl-go-5',
    name: 'Parlante JBL Go 5',
    brand: 'JBL',
    category: 'audio',
    price: 39990,
    original_price: 59990,
    image_url: 'https://http2.mlstatic.com/D_1.webp',
    affiliate_url: 'https://meli.la/abc',
    outbound_url: 'https://www.mercadolibre.cl/p/MLC123?matt_word=comparatech&matt_tool=15629069',
    description: 'Una descripción larga que la tabla no muestra.',
    specs: { Potencia: '4,8 W', Color: 'Negro' },
    seller_reputation: 'verde',
    seller_sales_count: 1200,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: 'MLC123',
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
  };

  it('para elegir van solo cinco campos', () => {
    expect(toCompareCandidate(product)).toEqual({
      slug: 'parlante-jbl-go-5',
      name: 'Parlante JBL Go 5',
      category: 'audio',
      ml_domain_id: 'MLC-SPEAKERS',
      seller_sales_count: 1200,
    });
  });

  it('para la tabla van las specs, la oferta y el link de compra ya resuelto, nada más', () => {
    const detail = toCompareDetail(product);
    expect(Object.keys(detail).sort()).toEqual(
      [
        'category',
        'href',
        'id',
        'image_url',
        'ml_domain_id',
        'name',
        'offer',
        'price',
        'seller_sales_count',
        'slug',
        'specs',
      ].sort()
    );
    expect(detail.specs).toEqual({ Potencia: '4,8 W', Color: 'Negro' });
    // El mismo destino que las tarjetas: el de lib/outbound, con la cuenta afiliada.
    expect(detail.href).toBe('https://www.mercadolibre.cl/p/MLC123?matt_word=comparatech&matt_tool=15629069');
  });

  it('la oferta lleva solo lo que Mercado Libre informó', () => {
    // Sin offer_info ni precio de lista: nada se da por supuesto.
    expect(toCompareDetail({ ...product, original_price: null }).offer).toEqual({
      list_price: null,
      checked_at: null,
      free_shipping: false,
      is_full: false,
      seller: 'Reputación verde · 1.200 ventas',
      warranty: null,
      change: null,
      lowest: null,
    });

    const full = toCompareDetail({
      ...product,
      original_price: product.price + 10_000,
      price_checked_at: '2026-10-11T18:00:00.000Z',
      offer_info: {
        free_shipping: true,
        is_full: true,
        sold_by_ml: false,
        official_store: true,
        warranty: 'Garantía de fábrica: 1 años',
        offers_count: 3,
        is_lowest: true,
      },
    }).offer;
    expect(full).toMatchObject({
      list_price: product.price + 10_000,
      checked_at: '2026-10-11T18:00:00.000Z',
      free_shipping: true,
      is_full: true,
      seller: 'Tienda oficial · 1.200 ventas',
      warranty: 'De fábrica: 1 año',
    });
  });

  it('el envío gratis y Full son datos distintos', () => {
    const info = { sold_by_ml: false, official_store: false, warranty: null, offers_count: 1, is_lowest: null };
    expect(
      toCompareDetail({ ...product, offer_info: { ...info, free_shipping: true, is_full: false } }).offer
    ).toMatchObject({ free_shipping: true, is_full: false });
    expect(
      toCompareDetail({ ...product, offer_info: { ...info, free_shipping: false, is_full: true } }).offer
    ).toMatchObject({ free_shipping: false, is_full: true });
  });

  it('un campo de offer_info que no es true no cuenta, y una garantía en blanco tampoco', () => {
    const info = {
      sold_by_ml: 'no',
      official_store: 1,
      free_shipping: 'false',
      is_full: 1,
      warranty: '  ',
      offers_count: 1,
      is_lowest: null,
    };
    expect(toCompareDetail({ ...product, offer_info: info as never }).offer).toMatchObject({
      free_shipping: false,
      is_full: false,
      seller: 'Reputación verde · 1.200 ventas',
      warranty: null,
    });
  });

  it('un precio de lista igual o menor que el precio no es un precio de lista', () => {
    expect(toCompareDetail({ ...product, original_price: product.price }).offer.list_price).toBeNull();
    expect(toCompareDetail({ ...product, original_price: product.price - 1 }).offer.list_price).toBeNull();
  });

  it('el vendedor es Mercado Libre antes que tienda oficial, y las ventas van solo si hay', () => {
    const info = { free_shipping: false, is_full: false, warranty: null, offers_count: 1, is_lowest: null };
    expect(
      toCompareDetail({ ...product, offer_info: { ...info, sold_by_ml: true, official_store: true } }).offer.seller
    ).toBe('Mercado Libre');
    expect(toCompareDetail({ ...product, seller_sales_count: 0 }).offer.seller).toBe('Reputación verde');
    expect(
      toCompareDetail({ ...product, seller_sales_count: 0, offer_info: { ...info, sold_by_ml: false, official_store: true } })
        .offer.seller
    ).toBe('Tienda oficial');
    expect(toCompareDetail({ ...product, seller_sales_count: 1 }).offer.seller).toBe('Reputación verde · 1 venta');
  });

  it('con el historial dice el último cambio y si es el precio más bajo registrado', () => {
    // Una fecha pasada: si `now` no llegara al historial, el cambio se vería como viejo.
    const now = new Date('2026-01-20T12:00:00.000Z').getTime();
    const at = (days: number) => new Date(now - days * 86_400_000).toISOString();
    const dropped = priceStats(
      [
        { price: product.price + 5_000, observed_at: at(10) },
        { price: product.price, observed_at: at(2) },
      ],
      now
    );
    expect(toCompareDetail(product, dropped, now).offer).toMatchObject({
      change: { direction: 'down', amount: 5_000, since: at(2) },
      lowest: 'Precio más bajo desde que lo seguimos (10 días)',
    });

    const rose = priceStats(
      [
        { price: product.price - 5_000, observed_at: at(10) },
        { price: product.price, observed_at: at(2) },
      ],
      now
    );
    expect(toCompareDetail(product, rose, now).offer).toMatchObject({
      change: { direction: 'up', amount: 5_000, since: at(2) },
      lowest: null,
    });
  });

  it('sin destino precalculado usa el link guardado, nunca uno fuera de la lista', () => {
    expect(toCompareDetail({ ...product, outbound_url: undefined }).href).toBe('https://meli.la/abc');
    expect(toCompareDetail({ ...product, outbound_url: 'https://otro.com/x', affiliate_url: 'javascript:1' }).href).toBe(
      'https://www.mercadolibre.cl/p/MLC123'
    );
  });
});

describe('dirección de los datos del comparador', () => {
  it('lo que arman las dos direcciones se lee de vuelta igual', () => {
    const read = (url: string) => parseCompareQuery(new URLSearchParams(url.split('?')[1]));
    expect(compareListUrl('audio')).toBe('/comparador/datos?cat=audio');
    expect(read(compareListUrl('electrodomesticos'))).toEqual({ category: 'electrodomesticos' });
    expect(read(compareProductUrl('parlante-jbl-go-5'))).toEqual({ slug: 'parlante-jbl-go-5' });
    // El slug más largo del catálogo tiene cerca de 200 letras.
    const long = 'a'.repeat(200);
    expect(read(compareProductUrl(long))).toEqual({ slug: long });
  });

  it('rechaza todo lo que la página no pide', () => {
    const bad = [
      '',
      'cat=',
      'cat=Audio',
      'cat=../admin',
      'cat=audio&cat=gaming',
      'cat=audio&slug=x',
      'cat=audio&otro=1',
      'slug=',
      'slug=Parlante%20JBL',
      'slug=a/b',
      'slug=x&slug=y',
      `slug=${'a'.repeat(251)}`,
      'utm_source=x',
    ];
    for (const query of bad) {
      expect(parseCompareQuery(new URLSearchParams(query)), query).toBeNull();
    }
  });
});

describe('sharedSpecKeys', () => {
  it('deja solo las claves que tienen ambos, con valor', () => {
    expect(
      sharedSpecKeys(
        { Color: 'Negro', 'Memoria RAM': '8 GB', Modelo: 'X', Vacía: '' },
        { 'Memoria RAM': '6 GB', Color: 'Azul', Batería: '5000 mAh', Vacía: 'algo' }
      )
    ).toEqual(['Color', 'Memoria RAM']);
  });
});

describe('betterSpec', () => {
  it('destaca el valor mayor en la lista blanca', () => {
    expect(betterSpec('Memoria RAM', '8 GB', '6 GB')).toBe('a');
    expect(betterSpec('Memoria interna', '128 GB', '1 TB')).toBe('b');
    expect(betterSpec('Capacidad de la batería', '5000 mAh', '4500 mAh')).toBe('a');
    expect(betterSpec('Potencia de salida (RMS)', '4,8 W', '16 W')).toBe('b');
    expect(betterSpec('Autonomía máxima de la batería', '8 h', '14 h')).toBe('b');
    expect(betterSpec('Duración de la batería del audífono', '1 días', '20 h')).toBe('a');
    expect(betterSpec('Clasificación IP', 'IP67', 'IP54')).toBe('a');
  });

  it('no destaca specs fuera de la lista blanca', () => {
    expect(betterSpec('Tamaño de la caja', '49 mm', '43 mm')).toBeNull();
    expect(betterSpec('Tiempo de carga del audífono', '1.5 h', '2 h')).toBeNull();
    expect(betterSpec('Alcance inalámbrico', '20 m', '10 m')).toBeNull();
  });

  it('nunca destaca el voltaje, aunque diga potencia', () => {
    expect(betterSpec('Voltaje', '220V', '5V')).toBeNull();
    expect(betterSpec('Voltaje de salida', '22.5W', '5V')).toBeNull();
    expect(betterSpec('Potencia y voltaje', '20 W', '10 W')).toBeNull();
  });

  it('no destaca empates, unidades raras ni IP sin ganador claro', () => {
    expect(betterSpec('Memoria RAM', '8 GB', '8 GB')).toBeNull();
    expect(betterSpec('Capacidad de la batería', '5000', '4000 mAh')).toBeNull();
    expect(betterSpec('Tipo de batería', 'Ion de litio', 'Polímero')).toBeNull();
    expect(betterSpec('Clasificación IP', 'IP54', 'IPX7')).toBeNull();
    expect(betterSpec('Memoria RAM', undefined, '8 GB')).toBeNull();
  });
});

describe('compareSummary', () => {
  it('dice quién cuesta menos, por cuánto y qué porcentaje del más caro', () => {
    const a = { price: 639_990 };
    const b = { price: 799_990 };
    expect(compareSummary(a, b)).toEqual({ cheaper: 'a', diff: 160_000, pct: 20 });
    expect(compareSummary(b, a)).toEqual({ cheaper: 'b', diff: 160_000, pct: 20 });
  });

  it('con el mismo precio no hay más barato', () => {
    expect(compareSummary({ price: 100 }, { price: 100 })).toEqual({ cheaper: null, diff: 0, pct: 0 });
  });

  it('el porcentaje se redondea al entero más cercano y nunca llega a 100', () => {
    // $1.960 sobre $10.000 es 19,6%: va 20, no 19.
    expect(compareSummary({ price: 8_040 }, { price: 10_000 }).pct).toBe(20);
    // Un mouse de $3.049 contra un notebook de $759.990: 99,6% no es "100% menos".
    expect(compareSummary({ price: 3_049 }, { price: 759_990 }).pct).toBe(99);
  });

  it('una diferencia chica no se redondea a un porcentaje que no existe', () => {
    // $830 sobre $37.820 es 2%; $100 sobre $1.000.000 queda en 0 y la frase no lo muestra.
    expect(compareSummary({ price: 36_990 }, { price: 37_820 })).toEqual({ cheaper: 'a', diff: 830, pct: 2 });
    expect(compareSummary({ price: 999_900 }, { price: 1_000_000 }).pct).toBe(0);
  });
});
