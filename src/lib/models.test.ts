import { describe, expect, it } from 'vitest';
import {
  MODELS,
  getModel,
  isVersionOf,
  modelHeading,
  modelIntro,
  modelMetaDescription,
  modelOf,
  modelPath,
  modelPathsForSlugs,
  modelText,
  modelTitle,
  versionLabel,
  versionsOf,
} from './models';
import { SEO_TITLE_MAX } from './seo-title';
import { slugify } from './candidate-slugs';
import { domainLabel, OTHER_TYPE_LABEL } from './product-types';
import { categoryFromDomain } from './categories';

/** Nombres y tipos de producto tal como están en el catálogo (18-10-2026). */
const CATALOG: [name: string, domain: string, model: string | null][] = [
  ['Apple iPhone 17 (256 GB) - Blanco - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-17'],
  ['Apple iPhone 17 (256 GB) - Lavanda - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-17'],
  ['Apple iPhone 17e (256 Gb) - Rosa Pálido - Distribuidor Autorizado', 'MLC-CELLPHONES', null],
  ['Apple iPhone 17 Pro (256 GB) - Naranja cósmico - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-17-pro'],
  ['iPhone 17 Pro Azul profundo 256GB Apple - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-17-pro'],
  ['Apple iPhone 17 Pro Max (256 GB) - Color plata - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-17-pro-max'],
  ['Apple iPhone 18 Pro (256 GB) - Borgoña - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-18-pro'],
  ['Apple iPhone 18 Pro Max (2 TB) - Color plata - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-18-pro-max'],
  ['Apple iPhone 16 (128 GB) - Negro - Distribuidor Autorizado', 'MLC-CELLPHONES', null],
  ['Apple iPhone 15 (128 GB) - Azul - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-15'],
  ['Apple iPhone 15 128 GB Negro - Distribuidor Autorizado', 'MLC-CELLPHONES', 'iphone-15'],
  ['Galaxy S26 Ultra 256GB Cobalt Violet', 'MLC-CELLPHONES', 'galaxy-s26-ultra'],
  ['Galaxy S26 Ultra 512 GB Black', 'MLC-CELLPHONES', 'galaxy-s26-ultra'],
  ['Samsung Galaxy S26 256gb Black', 'MLC-CELLPHONES', 'galaxy-s26'],
  // El "+" de la cámara no es el S26+.
  [
    'Teléfono celular Samsung Galaxy S26 5g, 256 GB, 12 GB de RAM, Galaxy Ai, cámara triple 50+12+10, pantalla plateada 6.3',
    'MLC-CELLPHONES',
    'galaxy-s26',
  ],
  ['Samsung Galaxy S26+ 512GB Navy', 'MLC-CELLPHONES', null],
  ['Samsung Galaxy S25 256G Azul Marino', 'MLC-CELLPHONES', null],
  ['Samsung Galaxy A07 Lte 128gb Negro Negro', 'MLC-CELLPHONES', 'galaxy-a07'],
  ['Samsung Galaxy A07 Dual SIM Negro 64GB', 'MLC-CELLPHONES', 'galaxy-a07'],
  ['Teléfono celular Samsung Galaxy A57 5G de 128 GB, 8 GB de RAM, funciones de IA', 'MLC-CELLPHONES', 'galaxy-a57'],
  ['Galaxy A37 128 GB Awesome Charcoal', 'MLC-CELLPHONES', null],
  ['Consola Playstation 5 Digital Slim + Juego Astro Bot y Gran Turismo 7', 'MLC-GAME_CONSOLES', 'ps5'],
  ['Consola PS5 Slim Standard + Juego Astro Bot Y Gt7', 'MLC-GAME_CONSOLES', 'ps5'],
  ['Consola PlayStation 5 Pro 2TB Digital color blanco Sony', 'MLC-GAME_CONSOLES', 'ps5'],
  // El lector de discos que se vende aparte, y los juegos y controles, no son una PS5.
  ['Unidad Lector de discos consola Ps5 Slim+ps5 pro color blanco', 'MLC-GAME_CONSOLES', null],
  ['Marvels Wolverine Ps5', 'MLC-VIDEO_GAMES', null],
  ['Control Dualsense PS5 Playstation 5 Blanco', 'MLC-GAMEPADS_AND_JOYSTICKS', null],
  ['Consola Nintendo Switch 2', 'MLC-GAME_CONSOLES', null],
  ['Amazon Kindle E-reader 2024 11th Gen 6.0in 16gb Color Negro', 'MLC-E_READERS', 'kindle'],
  ['Ereader Amazon Kindle Paperwhite 7 2024 12 Gen 16 Gb Verde', 'MLC-E_READERS', 'kindle'],
  ['Amazon Kindle Colorsoft 16gb Modelo 2025 A Color Ereader', 'MLC-E_READERS', 'kindle'],
  ['Funda Transparent+ Mica Kindle Paperwhite 2024 12va Gen 7pul Transparente', 'MLC-E_READERS', null],
  ['iPad iPad 11 (A16) 11" 128GB rosa 6GB de memoria RAM', 'MLC-TABLETS', 'ipad-11'],
  ['Apple iPad 11 MD3Y4BZ/A con chip A16 Wi-Fi de 128 GB Color Plata - Distribuidor Autorizado', 'MLC-TABLETS', 'ipad-11'],
  ['Apple iPad Pro 11 M5 256GB', 'MLC-TABLETS', null],
  ['Parlante Jbl Charge 6 Turquesa', 'MLC-SPEAKERS', 'jbl-charge-6'],
  ['Altavoz Bluetooth Jbl Charge 6 azul', 'MLC-SPEAKERS', 'jbl-charge-6'],
  ['Parlante Jbl Charge 5 Jbl Charge 5 Color Rojo', 'MLC-SPEAKERS', null],
  // Un accesorio con el nombre del modelo no es una versión: otro tipo de producto.
  ['Bateria Externa Cargador para Iphone 17 Portatil Linkon Compatible con Magsafe', 'MLC-MOBILE_DEVICE_CHARGERS', null],
];

describe('la lista de modelos', () => {
  it('cada modelo tiene una dirección propia, en minúsculas y con guiones', () => {
    const slugs = MODELS.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(getModel('iphone-17')?.name).toBe('iPhone 17');
    expect(getModel('no-existe')).toBeUndefined();
    expect(modelPath('ps5')).toBe('/modelo/ps5');
  });

  it('las reglas no tienen la marca g (con ella, test() recuerda dónde quedó y falla una de cada dos veces)', () => {
    for (const m of MODELS) for (const re of [...m.include, ...(m.exclude ?? [])]) expect(re.global).toBe(false);
  });

  it('los tipos de producto existen en el sitio: tienen nombre y categoría', () => {
    for (const m of MODELS) {
      for (const domain of m.domains) {
        expect(domainLabel(domain)).not.toBe(OTHER_TYPE_LABEL);
        expect(categoryFromDomain(domain)).toBeTruthy();
      }
    }
  });

  it('el título cabe en lo que muestra Google', () => {
    for (const m of MODELS) expect(modelTitle(m).length).toBeLessThanOrEqual(SEO_TITLE_MAX);
  });
});

describe('qué es una versión de cada modelo', () => {
  it.each(CATALOG)('%s → %s', (name, domain, expected) => {
    expect(modelOf({ name, ml_domain_id: domain })?.slug ?? null).toBe(expected);
  });

  it('ningún nombre es versión de dos modelos a la vez', () => {
    for (const [name, domain] of CATALOG) {
      expect(MODELS.filter((m) => isVersionOf(m, { name, ml_domain_id: domain })).length).toBeLessThanOrEqual(1);
    }
  });

  it('sin tipo de producto no es versión de nada', () => {
    expect(modelOf({ name: 'Apple iPhone 17 (256 GB) - Blanco', ml_domain_id: null })).toBeUndefined();
  });

  it('el "+" pegado a un modelo se dice en palabras; entre cifras, no', () => {
    expect(modelText('Galaxy S26+ 512GB')).toBe('galaxy s26 plus 512gb');
    expect(modelText('cámara triple 50+12+10')).toBe('camara triple 50 12 10');
  });

  it('las versiones salen de menor a mayor precio', () => {
    const model = getModel('iphone-17')!;
    const list = [
      { name: 'Apple iPhone 17 (256 GB) - Blanco', ml_domain_id: 'MLC-CELLPHONES', price: 1_074_804 },
      { name: 'Funda iPhone 17', ml_domain_id: 'MLC-CELLPHONE_COVERS', price: 9_990 },
      { name: 'Apple iPhone 17 (256 GB) - Lavanda', ml_domain_id: 'MLC-CELLPHONES', price: 1_073_674 },
    ];
    expect(versionsOf(model, list).map((p) => p.price)).toEqual([1_073_674, 1_074_804]);
  });
});

describe('modelPathsForSlugs (avisos a Bing desde la revisión de precios)', () => {
  it('reconoce las versiones por su slug, sin repetir páginas', () => {
    const slugs = [
      slugify('Apple iPhone 17 (256 GB) - Blanco - Distribuidor Autorizado'),
      slugify('Apple iPhone 17 (256 GB) - Lavanda - Distribuidor Autorizado'),
      slugify('Consola PS5 Slim Standard + Juego Astro Bot Y Gt7'),
      slugify('Parlante Bluetooth Jbl Go Essential 2 Azul'),
    ];
    expect(modelPathsForSlugs(slugs).sort()).toEqual(['/modelo/iphone-17', '/modelo/ps5']);
    expect(modelPathsForSlugs([])).toEqual([]);
  });

  it('con un sufijo de desempate (otro producto con el mismo nombre) también', () => {
    expect(modelPathsForSlugs(['galaxy-s26-ultra-256gb-sky-blue-3f2b8'])).toEqual(['/modelo/galaxy-s26-ultra']);
  });
});

describe('versionLabel', () => {
  const specs = (s: Record<string, string>) => s;

  it('celulares: capacidad y color de la ficha', () => {
    expect(
      versionLabel(getModel('iphone-18-pro-max')!, {
        name: 'Apple iPhone 18 Pro Max (512 GB) - Negro - Distribuidor Autorizado',
        specs: specs({ Color: 'Negro', 'Memoria interna': '512 GB' }),
      }),
    ).toBe('512 GB · Negro');
    expect(
      versionLabel(getModel('galaxy-s26-ultra')!, { name: 'Galaxy S26 Ultra 256GB Sky Blue', specs: specs({ Color: 'sky blue', 'Memoria interna': '256 GB' }) }),
    ).toBe('256 GB · Sky blue');
  });

  it('una consola: el nombre sin "Consola", la marca ni el modelo', () => {
    const ps5 = getModel('ps5')!;
    expect(versionLabel(ps5, { name: 'Consola Playstation 5 Digital Slim + Juego Astro Bot y Gran Turismo 7', specs: {} })).toBe(
      'Digital Slim + Juego Astro Bot y Gran Turismo 7',
    );
    expect(versionLabel(ps5, { name: 'Consola PlayStation 5 Pro 2TB Digital color blanco Sony', specs: {} })).toBe('Pro 2TB Digital');
  });

  it('el Kindle: el modelo de la ficha sin repetir "Kindle", y el color', () => {
    expect(
      versionLabel(getModel('kindle')!, {
        name: 'Ereader Amazon Kindle Paperwhite 7 2024 12 Gen 16 Gb Verde',
        specs: specs({ Modelo: 'Kindle Paperwhite 12va Gen', Color: 'Verde' }),
      }),
    ).toBe('Paperwhite 12va Gen · Verde');
  });

  it('sin datos en la ficha, el nombre corto', () => {
    expect(versionLabel(getModel('jbl-charge-6')!, { name: 'Parlante Jbl Charge 6 Negro', specs: {} })).toBe('Parlante Jbl Charge 6 Negro');
    expect(versionLabel(getModel('jbl-charge-6')!, { name: 'Parlante Jbl Charge 6 Negro', specs: specs({ Color: 'Negro' }) })).toBe('Negro');
  });
});

/** Lo que el sitio no dice nunca (CLAUDE.md, voz de marca). */
const AVOIDED =
  /precio de lista|lista \$|recomendad|verificad|mejor precio|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|ahorra|comisi[oó]n/i;

describe('textos de la página', () => {
  const iphone = getModel('iphone-17')!;
  const ps5 = getModel('ps5')!;

  it('el título lleva "| ComparaTech" solo si cabe', () => {
    expect(modelTitle(iphone)).toBe('iPhone 17: precio en Chile e historial | ComparaTech');
    expect(modelTitle(getModel('galaxy-s26-ultra')!)).toBe('Samsung Galaxy S26 Ultra: precio en Chile e historial');
  });

  it('el H1 no lleva artículo', () => {
    expect(modelHeading(ps5)).toBe('PS5: precio en Chile');
  });

  it('la introducción dice cuántas hay y entre qué precios', () => {
    expect(modelIntro(ps5, [679_990, 769_990, 1_089_990], 0)).toBe(
      'Encontramos 3 versiones de PS5 (PlayStation 5) a la venta en Mercado Libre, desde $679.990 hasta $1.089.990. Revisamos los precios varias veces al día.',
    );
    expect(modelIntro(iphone, [1_073_674], 2)).toBe(
      'Encontramos 1 versión de iPhone 17 a la venta en Mercado Libre, a $1.073.674. Otras 2 no tienen vendedor con reputación verde hoy. Revisamos los precios varias veces al día.',
    );
    expect(modelIntro(iphone, [1_073_674, 1_074_804], 1)).toContain('Otra no tiene vendedor con reputación verde hoy.');
    expect(modelIntro(iphone, [], 3)).toBe(
      'Hoy ninguna versión de iPhone 17 tiene un vendedor con reputación verde en Mercado Libre. Abajo está el último precio que vimos de cada una.',
    );
  });

  it('la descripción para Google cabe en 155 caracteres en todos los modelos', () => {
    for (const m of MODELS) {
      expect(modelMetaDescription(m, [3_259_990, 9_999_999]).length).toBeLessThanOrEqual(155);
      expect(modelMetaDescription(m, []).length).toBeLessThanOrEqual(155);
    }
    expect(modelMetaDescription(iphone, [1_074_804, 1_073_674])).toBe(
      'iPhone 17: 2 versiones a la venta en Mercado Libre Chile desde $1.073.674. Mira el historial de precios y el más bajo que registramos.',
    );
  });

  it('ningún texto dice lo que el sitio no dice', () => {
    for (const m of MODELS) {
      for (const text of [
        modelTitle(m),
        modelHeading(m),
        modelIntro(m, [10_000, 20_000], 1),
        modelIntro(m, [], 2),
        modelMetaDescription(m, [10_000]),
        modelMetaDescription(m, []),
      ]) {
        expect(text).not.toMatch(AVOIDED);
      }
    }
  });
});
