import { describe, expect, it } from 'vitest';
import { pickAlternatives, readSearchQuery, searchHref, searchProducts, singularize, tokenize } from './search';
import { normalizeName, shortProductName } from './text';
import { jsonLdString } from '@/components/seo/ProductJsonLd';

// Nombres, marcas, dominios y specs reales del catálogo (octubre 2026).
interface Fixture {
  id: string;
  name: string;
  brand: string;
  category: string;
  ml_domain_id: string | null;
  ml_family_id: string | null;
  specs: Record<string, string | number>;
  price: number;
  original_price: number | null;
}

let seq = 0;
function fx(
  name: string,
  brand: string,
  category: string,
  domain: string,
  extra: Partial<Fixture> = {}
): Fixture {
  seq += 1;
  return {
    id: `p${seq}`,
    name,
    brand,
    category,
    ml_domain_id: domain,
    ml_family_id: null,
    specs: {},
    price: 10000 * seq,
    original_price: null,
    ...extra,
  };
}

const JBL_GO5 = fx('Parlante Portable Jbl Go 5 Bluetooth 4.8w Pro Sound Auracast Negro', 'JBL', 'audio', 'MLC-SPEAKERS', {
  specs: { Color: 'Negro', Modelo: 'Go 5', 'Tipos de parlante': 'Monoaural' },
});
const JBL_GRIP = fx('Parlante Bluetooth JBL Grip bt Squad', 'JBL', 'audio', 'MLC-SPEAKERS', {
  specs: { Color: 'Verde', 'Formato del parlante': 'Parlante Bluetooth portátil' },
});
const JBL_GO5_EN = fx('Jbl Go 5 Bt Speaker-white Blanco', 'JBL', 'audio', 'MLC-SPEAKERS');
const JBL_WAVE = fx('Audífonos Inalámbricos JBL Wave Buds 2 con Bluetooth 5.3 y Cancelación de Ruido en Azul', 'JBL', 'audio', 'MLC-HEADPHONES');
const SONY_CH520 = fx('Audífonos Inalámbricos Sony Wh-ch520', 'Sony', 'audio', 'MLC-HEADPHONES', {
  price: 40000,
  original_price: 60000,
});
const SONY_NO_BRAND_IN_NAME = fx('Audífonos Inalámbricos Wh-ch520', 'Sony', 'audio', 'MLC-HEADPHONES');
const SONY_WF = fx('Sony WF-c510 Tws Wireless Audífonos Azul', 'Sony', 'audio', 'MLC-HEADPHONES');
const XIAOMI_BUDS = fx('Auriculares Redmi Buds 6 Play Inalámbricos Xiaomi Negro', 'Xiaomi', 'audio', 'MLC-HEADPHONES');
const GALAXY_S26 = fx('Galaxy S26 Ultra 256GB Cobalt Violet', 'Samsung', 'celulares', 'MLC-CELLPHONES');
const GALAXY_A07 = fx(
  'Samsung Galaxy A07 128 GB, teléfono celular de 4 GB, cámara de 50 MP, pantalla 6.7, protección IP54, procesador de 6 nm, violeta',
  'Samsung',
  'celulares',
  'MLC-CELLPHONES'
);
const GALAXY_FIT = fx('Samsung Galaxy Fit3 Pink Gold', 'Samsung', 'electronica', 'MLC-SMARTWATCHES');
const SAMSUNG_CHARGER = fx('Cargador de pared Samsung de carga superrápida de 45 W', 'Samsung', 'electronica', 'MLC-MOBILE_DEVICE_CHARGERS');
const ANKER_POWERBANK = fx(
  'Cargador Portátil Powerbank Anker Zolo 20000mAh, 22.5W Carga Rápida, Bateria Externa con Cable USB-C Integrado, para iPhone/Samsung/Motorola Celular/Tablet, Blanco',
  'Anker',
  'electronica',
  'MLC-MOBILE_DEVICE_CHARGERS'
);
const POCO = fx('Xiaomi Poco C85 Negro 128 GB ROM 6 GB RAM', 'Xiaomi', 'celulares', 'MLC-CELLPHONES');
const IPHONE_17_PRO_MAX = fx('Apple iPhone 17 Pro Max (256 GB) - Color plata - Distribuidor Autorizado', 'Apple', 'celulares', 'MLC-CELLPHONES');
const IPHONE_17_PRO = fx('Apple iPhone 17 Pro (256 GB) - Color plata - Distribuidor Autorizado', 'Apple', 'celulares', 'MLC-CELLPHONES');
const IPHONE_17 = fx('Apple iPhone 17 (256 GB) - Lavanda - Distribuidor Autorizado', 'Apple', 'celulares', 'MLC-CELLPHONES');

const CATALOG = [
  JBL_GO5,
  JBL_GRIP,
  JBL_GO5_EN,
  JBL_WAVE,
  SONY_CH520,
  SONY_NO_BRAND_IN_NAME,
  SONY_WF,
  XIAOMI_BUDS,
  GALAXY_S26,
  GALAXY_A07,
  GALAXY_FIT,
  SAMSUNG_CHARGER,
  ANKER_POWERBANK,
  POCO,
  IPHONE_17_PRO_MAX,
  IPHONE_17_PRO,
  IPHONE_17,
];

const ids = (list: Fixture[]) => list.map((p) => p.id);

describe('singularize', () => {
  it('quita "es" tras consonante y la "s" final en el resto', () => {
    expect(singularize('celulares')).toBe('celular');
    expect(singularize('parlantes')).toBe('parlant');
    expect(singularize('audifonos')).toBe('audifono');
    expect(singularize('gps')).toBe('gps');
    expect(singularize('max')).toBe('max');
  });
});

describe('tokenize', () => {
  it('normaliza, quita tildes y stopwords', () => {
    expect(tokenize('Audífonos de la marca Sony')).toEqual(['audifono', 'marca', 'sony']);
    expect(tokenize('Wh-ch520')).toEqual(['wh', 'ch520']);
  });
});

describe('searchProducts', () => {
  it('"parlante jbl" encuentra los parlantes JBL y no los audífonos', () => {
    const result = searchProducts(CATALOG, 'parlante jbl');
    expect(ids(result)).toEqual(expect.arrayContaining([JBL_GO5.id, JBL_GRIP.id]));
    expect(ids(result)).not.toContain(JBL_WAVE.id);
  });

  it('el orden de las palabras no importa', () => {
    expect(ids(searchProducts(CATALOG, 'jbl parlante')).sort()).toEqual(
      ids(searchProducts(CATALOG, 'parlante jbl')).sort()
    );
  });

  it('"audifonos sony" encuentra los Sony aunque el nombre no diga la marca', () => {
    const result = ids(searchProducts(CATALOG, 'audifonos sony'));
    expect(result).toEqual(expect.arrayContaining([SONY_CH520.id, SONY_NO_BRAND_IN_NAME.id, SONY_WF.id]));
    expect(result).not.toContain(JBL_WAVE.id);
    expect(result).not.toContain(XIAOMI_BUDS.id);
    // El que tiene "Sony" en el nombre va antes que el que solo lo tiene en la marca.
    expect(result.indexOf(SONY_CH520.id)).toBeLessThan(result.indexOf(SONY_NO_BRAND_IN_NAME.id));
  });

  it('"parlantes" (plural) encuentra los parlantes', () => {
    const result = ids(searchProducts(CATALOG, 'parlantes'));
    expect(result).toEqual(expect.arrayContaining([JBL_GO5.id, JBL_GRIP.id]));
    expect(result).not.toContain(JBL_WAVE.id);
  });

  it('"celular samsung" encuentra los Galaxy por categoría y marca, no otros celulares', () => {
    const result = ids(searchProducts(CATALOG, 'celular samsung'));
    expect(result).toEqual(expect.arrayContaining([GALAXY_S26.id, GALAXY_A07.id]));
    expect(result).not.toContain(POCO.id);
    expect(result).not.toContain(GALAXY_FIT.id);
    expect(result).not.toContain(SAMSUNG_CHARGER.id);
  });

  it('"celular samsung" pone los celulares antes que un accesorio "para Samsung Celular"', () => {
    const result = ids(searchProducts(CATALOG, 'celular samsung'));
    expect(result).toContain(ANKER_POWERBANK.id);
    expect(result.indexOf(GALAXY_S26.id)).toBeLessThan(result.indexOf(ANKER_POWERBANK.id));
    expect(result.indexOf(GALAXY_A07.id)).toBeLessThan(result.indexOf(ANKER_POWERBANK.id));
  });

  it('"iphone pro max" encuentra solo los Pro Max', () => {
    expect(ids(searchProducts(CATALOG, 'iphone pro max'))).toEqual([IPHONE_17_PRO_MAX.id]);
  });

  it('"samsung" encuentra los Galaxy aunque el nombre no diga Samsung', () => {
    const result = ids(searchProducts(CATALOG, 'samsung'));
    expect(result).toEqual(
      expect.arrayContaining([GALAXY_S26.id, GALAXY_A07.id, GALAXY_FIT.id, SAMSUNG_CHARGER.id])
    );
    expect(result).not.toContain(POCO.id);
    // Los que dicen Samsung en el nombre van primero.
    expect(result.indexOf(GALAXY_A07.id)).toBeLessThan(result.indexOf(GALAXY_S26.id));
  });

  it('busca por prefijo, sin tildes y con mayúsculas', () => {
    expect(ids(searchProducts(CATALOG, 'AUDÍF son'))).toEqual(expect.arrayContaining([SONY_CH520.id]));
  });

  it('a igual relevancia, primero el de mayor descuento', () => {
    const result = ids(searchProducts(CATALOG, 'wh ch520'));
    expect(result[0]).toBe(SONY_CH520.id);
  });

  it('una consulta vacía o solo con stopwords no devuelve nada', () => {
    expect(searchProducts(CATALOG, '')).toEqual([]);
    expect(searchProducts(CATALOG, 'de la')).toEqual([]);
  });

  it('una palabra que no existe deja la búsqueda en cero', () => {
    expect(searchProducts(CATALOG, 'parlante marshall')).toEqual([]);
  });
});

describe('dirección de la búsqueda', () => {
  it('lee el texto y los filtros, sin espacios ni vacíos', () => {
    expect(readSearchQuery({ q: '  parlante jbl ', brand: '', maxPrice: '50000', otro: 'x' })).toEqual({
      q: 'parlante jbl',
      maxPrice: '50000',
    });
    expect(readSearchQuery({})).toEqual({});
  });

  it('de un parámetro repetido toma el primero', () => {
    expect(readSearchQuery({ q: ['sony', 'jbl'], brand: [] })).toEqual({ q: 'sony' });
  });

  it('"ver más" conserva el texto y todos los filtros', () => {
    const query = { q: 'audífonos sony', brand: 'Sony', maxPrice: '50000', minDiscount: '20' };
    const href = searchHref(query, 2);
    const params = new URL(href, 'https://x.cl').searchParams;
    expect(href.startsWith('/buscar?')).toBe(true);
    expect(readSearchQuery(Object.fromEntries(params))).toEqual(query);
    expect(params.get('pagina')).toBe('2');
  });

  it('la primera tanda no lleva ?pagina=, y sin nada que buscar es /buscar', () => {
    expect(searchHref({ q: 'jbl' })).toBe('/buscar?q=jbl');
    expect(searchHref({}, 1)).toBe('/buscar');
    expect(searchHref({}, 3)).toBe('/buscar?pagina=3');
  });
});

describe('pickAlternatives', () => {
  const base = fx('Smartwatch Xiaomi Redmi 5 Lite - Color Light Gold', 'Xiaomi', 'electronica', 'MLC-SMARTWATCHES', {
    price: 40000,
    ml_family_id: 'FAM1',
  });
  const sibling = fx('Smartwatch Xiaomi Redmi 5 Lite - Color Black', 'Xiaomi', 'electronica', 'MLC-SMARTWATCHES', {
    price: 40000,
    ml_family_id: 'FAM1',
  });
  const sameName = fx('Smartwatch Xiaomi Redmi 5 Lite Color Light Gold', 'Xiaomi', 'electronica', 'MLC-SMARTWATCHES', {
    price: 39000,
  });
  const near = fx('Smartwatch Huawei Band 10', 'Huawei', 'electronica', 'MLC-SMARTWATCHES', { price: 42000 });
  const far = fx('Apple Watch SE 3', 'Apple', 'electronica', 'MLC-SMARTWATCHES', { price: 250000 });
  const charger = fx('Power Bank Xiaomi 20000mah', 'Xiaomi', 'electronica', 'MLC-MOBILE_DEVICE_CHARGERS', {
    price: 41000,
  });
  const phone = fx('Galaxy A07', 'Samsung', 'celulares', 'MLC-CELLPHONES', { price: 40000 });

  it('usa el mismo tipo de producto, sin variantes, por cercanía de precio', () => {
    const result = pickAlternatives(base, [base, sibling, sameName, far, near, charger, phone], 2);
    expect(ids(result)).toEqual([near.id, far.id]);
  });

  it('completa con la misma categoría si el tipo no alcanza', () => {
    const result = pickAlternatives(base, [far, near, charger, phone], 6);
    expect(ids(result)).toEqual([near.id, far.id, charger.id]);
  });

  it('sin nada del mismo tipo, cae a la categoría', () => {
    const result = pickAlternatives(base, [charger, phone], 6);
    expect(ids(result)).toEqual([charger.id]);
  });
});

describe('shortProductName', () => {
  it('quita el sufijo de color', () => {
    expect(shortProductName('Smartwatch Xiaomi Redmi 5 Lite - Color Light Gold')).toBe('Smartwatch Xiaomi Redmi 5 Lite');
    expect(shortProductName('Auriculares Bluetooth Lenovo Le302 Color Rosa')).toBe('Auriculares Bluetooth Lenovo Le302');
    expect(shortProductName('Apple iPhone 17 Pro Max (256 GB) - Color plata - Distribuidor Autorizado')).toBe(
      'Apple iPhone 17 Pro Max (256 GB)'
    );
  });

  it('corta en límite de palabra y sin paréntesis abiertos', () => {
    const long =
      'Smartwatch HUAWEI Band 10, Monitoreo deportivo con IA, Monitoreo de sueño avanzado, Asistente de bienestar emocional';
    const short = shortProductName(long);
    expect(short.length).toBeLessThanOrEqual(55);
    expect(long.startsWith(short)).toBe(true);
    expect(short).toBe('Smartwatch HUAWEI Band 10, Monitoreo deportivo con IA');
    expect(shortProductName('Apple iPhone 18 Pro Max (256 GB) - Borgoña', 30)).toBe('Apple iPhone 18 Pro Max');
  });

  it('no deja colgando un conector al final del corte', () => {
    expect(shortProductName('Audífonos Inalámbricos Blik Soul 250 Over-Ear con 20 Horas de Batería, Verde')).toBe(
      'Audífonos Inalámbricos Blik Soul 250 Over-Ear'
    );
    expect(shortProductName('Smartband Huawei Fit 4 con GPS y Pantalla AMOLED de 1.82"')).toBe(
      'Smartband Huawei Fit 4 con GPS y Pantalla AMOLED'
    );
  });

  it('no deja vacío un nombre que empieza con "Color"', () => {
    expect(shortProductName('Colorímetro X')).toBe('Colorímetro X');
    expect(shortProductName('Color Rosa')).toBe('Color Rosa');
  });

  it('normalizeName ignora tildes y puntuación', () => {
    expect(normalizeName('Audífonos  Blik—Air500!')).toBe('audifonos blik air500');
  });
});

describe('jsonLdString', () => {
  it('escapa "<" para que un nombre no pueda cerrar el <script>', () => {
    const out = jsonLdString({ name: 'Parlante </script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out).name).toBe('Parlante </script><script>alert(1)</script>');
  });
});
