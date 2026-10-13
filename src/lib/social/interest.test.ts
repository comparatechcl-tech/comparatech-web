import { describe, expect, it } from 'vitest';
import { stripDiacritics } from '@/lib/text';
import {
  MIN_INTEREST_POINTS,
  compareByInterest,
  hasForbiddenWord,
  interestBrand,
  interestScore,
  interestType,
  pickVaried,
  type InterestEvidence,
  type InterestProduct,
  type InterestScore,
} from '@/lib/social/interest';
import { FORBIDDEN_WORDS, INTEREST_WEIGHTS as W, MIN_CREDIBLE_PRICE } from '@/lib/social/interest-tables';

// ---------------------------------------------------------------------------
// Productos de prueba. Todos escritos acá: los tests no leen el catálogo.

let seq = 0;
/** Unos audífonos JBL de tienda oficial a $70.000 con 30% de lista: una oferta corriente. */
function product(over: Partial<InterestProduct> = {}): InterestProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
    brand: 'JBL',
    category: 'audio',
    price: 70_000,
    original_price: 100_000,
    seller_sales_count: 50_000,
    ml_root_category: 'MLC1000',
    ml_category_id: 'MLC3697',
    ml_family_id: null,
    offer_info: {
      free_shipping: true,
      is_full: false,
      official_store: true,
      sold_by_ml: false,
      is_lowest: true,
      warranty: null,
    },
    ...over,
  };
}

/** Historial largo y sin novedades: el precio de hoy es el más bajo que se vio. */
function evidence(over: Partial<InterestEvidence> = {}): InterestEvidence {
  return { drop: null, min30: null, daysTracked: 6, ...over };
}

const NO_HISTORY: InterestEvidence = { drop: null, min30: null, daysTracked: 0 };

/** Precio y lista que dan exactamente `pct` de descuento. */
function listed(pct: number): Pick<InterestProduct, 'price' | 'original_price'> {
  return { price: 100_000 - pct * 1000, original_price: 100_000 };
}

// Productos como los del catálogo real, con sus mismos datos.
const TCL_TV = product({
  name: 'SMART TV TCL 55" QLED UHD 4K 55P7L',
  brand: 'TCL',
  category: 'electronica',
  price: 316_131,
  original_price: 499_990,
  seller_sales_count: 29_690,
  ml_category_id: 'MLC1002',
  offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true, warranty: null },
});
const TCL_EVIDENCE: InterestEvidence = { drop: { pct: 36.8, amount: 183_859 }, min30: 316_131, daysTracked: 6 };

const PS5_PRO_SMALL_SELLER = product({
  name: 'Consola PlayStation 5 Pro 2TB Digital color blanco Sony',
  brand: 'Sony',
  category: 'gaming',
  price: 1_199_990,
  original_price: null,
  seller_sales_count: 11,
  ml_root_category: 'MLC1144',
  ml_category_id: 'MLC438566',
  offer_info: {
    free_shipping: true,
    is_full: false,
    official_store: false,
    sold_by_ml: false,
    is_lowest: false,
    warranty: 'Garantía del vendedor: 6 meses',
  },
});
const PS5_PRO_EVIDENCE: InterestEvidence = { drop: { pct: 14.5, amount: 204_000 }, min30: 1_199_990, daysTracked: 3 };

/** Una consola con una baja de verdad y un vendedor de confianza: el "héroe" que tiene que poder llegar arriba. */
const PS5_HERO = product({
  name: 'Consola PlayStation 5 Slim Digital 1TB Blanco',
  brand: 'Sony',
  category: 'gaming',
  price: 549_990,
  original_price: null,
  seller_sales_count: 80_000,
  ml_root_category: 'MLC1144',
  ml_category_id: 'MLC438566',
  offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true, warranty: null },
});
const PS5_HERO_EVIDENCE: InterestEvidence = { drop: { pct: 10, amount: 60_000 }, min30: 549_990, daysTracked: 5 };

/** Lo que sale hoy arriba con el catálogo real (sin el televisor): la competencia de un día normal. */
const USUAL_PICKS: [InterestProduct, InterestEvidence][] = [
  [
    product({
      name: 'Moto G86 power 256GB 256 GB verde 8 GB RAM',
      brand: 'Motorola',
      category: 'celulares',
      price: 219_990,
      original_price: 399_990,
      seller_sales_count: 1_050_069,
      ml_root_category: 'MLC1051',
      ml_category_id: 'MLC1055',
      offer_info: {
        free_shipping: true,
        is_full: true,
        official_store: true,
        sold_by_ml: true,
        is_lowest: true,
        warranty: 'Garantía de fábrica: 12 meses',
      },
    }),
    evidence({ min30: 219_990 }),
  ],
  [
    product({
      name: 'Auriculares Inalámbricos Bluetooth Jbl Tune 730bt 76h Negro',
      price: 52_924,
      original_price: 79_990,
      seller_sales_count: 1_050_069,
      offer_info: {
        free_shipping: true,
        is_full: true,
        official_store: true,
        sold_by_ml: true,
        is_lowest: true,
        warranty: 'Garantía de fábrica: 12 meses',
      },
    }),
    NO_HISTORY,
  ],
  [
    product({
      name: 'Kit Tablet Xiaomi Redmi Pad 2 4gb + 128gb + Cover',
      brand: 'Xiaomi',
      category: 'computacion',
      price: 169_990,
      original_price: 249_990,
      seller_sales_count: 1_050_069,
      ml_root_category: 'MLC1648',
      ml_category_id: 'MLC82085',
      offer_info: {
        free_shipping: true,
        is_full: true,
        official_store: true,
        sold_by_ml: true,
        is_lowest: true,
        warranty: 'Garantía de fábrica: 12 meses',
      },
    }),
    evidence({ min30: 167_140 }),
  ],
  [
    product({
      name: 'Notebook Acer Aspire Lite Al14-31p-31th-1 Intel Core i3 8GB RAM 512GB SSD',
      brand: 'Acer',
      category: 'computacion',
      price: 434_990,
      original_price: 619_990,
      seller_sales_count: 1_050_069,
      ml_root_category: 'MLC1648',
      ml_category_id: 'MLC1652',
      offer_info: {
        free_shipping: true,
        is_full: true,
        official_store: true,
        sold_by_ml: true,
        is_lowest: true,
        warranty: 'Garantía de fábrica: 12 meses',
      },
    }),
    NO_HISTORY,
  ],
  [
    product({
      name: 'Parlante Bluetooth JBL Grip BT Celeste',
      price: 49_990,
      original_price: 99_990,
      seller_sales_count: 101_471,
      ml_category_id: 'MLC1022',
      offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true, warranty: null },
    }),
    evidence({ min30: 49_990 }),
  ],
  [
    product({
      name: 'Samsung Galaxy Fit3 Pink Gold',
      brand: 'Samsung',
      category: 'electronica',
      price: 39_990,
      original_price: 69_990,
      seller_sales_count: 43_272,
      ml_category_id: 'MLC116538',
      offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true, warranty: null },
    }),
    evidence({ min30: 39_990 }),
  ],
  [
    product({
      name: 'The Legend Of Zelda Breath Of The Wild Nintendo Switch',
      brand: 'Nintendo',
      category: 'gaming',
      price: 65_093,
      original_price: 82_990,
      seller_sales_count: 1_050_069,
      ml_root_category: 'MLC1144',
      ml_category_id: 'MLC159270',
      offer_info: {
        free_shipping: true,
        is_full: true,
        official_store: true,
        sold_by_ml: true,
        is_lowest: true,
        warranty: 'Garantía de fábrica: 12 meses',
      },
    }),
    NO_HISTORY,
  ],
  [
    product({
      name: 'Impresora Multifuncional HP Smart Tank 580 Sistema Continuo',
      brand: 'HP',
      category: 'computacion',
      price: 149_700,
      original_price: 194_990,
      seller_sales_count: 1_050_069,
      ml_root_category: 'MLC1648',
      ml_category_id: 'MLC1676',
      offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: true, is_lowest: true, warranty: null },
    }),
    NO_HISTORY,
  ],
  [
    product({
      name: 'Soundbar Samsung Serie B 2.1 Ch. B450f (2025)',
      brand: 'Samsung',
      category: 'electronica',
      price: 129_990,
      original_price: 199_990,
      seller_sales_count: 43_272,
      ml_category_id: 'MLC4632',
      offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true, warranty: null },
    }),
    evidence({ min30: 129_990 }),
  ],
  [
    product({
      name: 'Horno de mesa eléctrico Thomas 25Litros Cocina TH-25N01',
      brand: 'Thomas',
      category: 'electrodomesticos',
      price: 44_990,
      original_price: 59_990,
      seller_sales_count: 1_050_069,
      ml_root_category: 'MLC5726',
      ml_category_id: 'MLC30854',
      offer_info: { free_shipping: false, is_full: true, official_store: true, sold_by_ml: true, is_lowest: true, warranty: null },
    }),
    evidence({ drop: { pct: 8.2, amount: 4_000 }, min30: 44_990, daysTracked: 2 }),
  ],
];

/** Cosas raras que pueden llegar en lugar de una señal. */
const GARBAGE = [NaN, Infinity, -Infinity, -3, 0, 2.5, 1e-9, 1e21, Number.MAX_VALUE];

interface Candidate {
  id: string;
  category: string;
  familyId: string | null;
  commission: number;
  score: InterestScore;
}

function candidate(p: InterestProduct, ev: InterestEvidence): Candidate {
  return {
    id: p.id,
    category: p.category,
    familyId: p.ml_family_id ?? null,
    commission: Math.round(p.price * 0.07),
    score: interestScore(p, ev),
  };
}

/** Un candidato con el puntaje ya puesto, para probar solo la selección. */
function scored(id: string, points: number, over: Partial<Candidate> & { type?: string; brand?: string; excluded?: string } = {}): Candidate {
  const { type, brand, excluded, ...rest } = over;
  return {
    id,
    category: 'audio',
    familyId: null,
    commission: 1000,
    score: {
      points,
      reason: '',
      warning: null,
      excluded: excluded ?? null,
      typeKey: type ?? `tipo-${id}`,
      brandKey: brand ?? `marca-${id}`,
      breakdown: {},
    },
    ...rest,
  };
}

/** Baraja siempre igual para la misma semilla: los tests no usan azar. */
function shuffled<T>(list: T[], seed: number): T[] {
  const copy = [...list];
  let x = seed;
  for (let i = copy.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const ids = (list: { id: string }[]) => list.map((c) => c.id);
const LIMITS = { max: 8, perCategory: 2, perType: 1, perBrand: 2 };

// ---------------------------------------------------------------------------

describe('interestType: qué es el producto', () => {
  it.each([
    ['Consola Nintendo Switch 2', 'gaming', 'Consola', 30],
    ['Ps4 Slim 1 TB 2 controladores + 3 juegos negros', 'gaming', 'Consola', 30],
    ['Samsung Galaxy A17 128GB BLACK', 'celulares', 'Celular', 28],
    ['Apple iPhone 17 (256 GB) - Lavanda', 'celulares', 'Celular', 28],
    ['43\'\' UHD U8000H Vision AI Smart TV (2026)', 'electronica', 'Smart TV', 27],
    ['Audífonos Inalámbricos Sony Wh-ch520', 'audio', 'Audífonos', 24],
    ['Notebook HP 15-fc0079la AMD Ryzen 5 8GB RAM 512GB SSD', 'computacion', 'Notebook', 23],
    ['Galaxy Tab A11+ 128GB Gris', 'computacion', 'Tablet', 23],
    ['Pulsera Inteligente Xiaomi Mi Smart Band 9 Active Verde', 'electronica', 'Reloj inteligente', 21],
    ['Parlante Bluetooth JBL Grip BT Celeste', 'audio', 'Parlante', 21],
    ['Pokemon Legends: Z-a', 'gaming', 'Videojuego', 19],
    ['Refrigerador frigobar Libero LFB-90 color rojo', 'electrodomesticos', 'Frigobar', 12],
    ['Horno De Microondas Oster Ogge3702 Negro 0.7 Pies', 'electrodomesticos', 'Microondas', 12],
    ['Dispensador Agua Fría Y Caliente Sobremesa Escritorio Oficina', 'hogar', 'Dispensador de agua', 7],
  ])('%s es %s', (name, category, label, desire) => {
    const type = interestType({ name, category });
    expect(type.label).toBe(label);
    expect(type.desire).toBe(desire);
    expect(type.recognised).toBe(true);
  });

  it('gana la palabra que aparece primero en el nombre', () => {
    expect(interestType({ name: 'Soporte Tv Rack Movil Con Ruedas 32 A 55', category: 'electronica' }).label).toBe('Soporte');
    expect(interestType({ name: 'Smart TV Samsung 50 4K + Control Remoto', category: 'electronica' }).label).toBe('Smart TV');
    expect(interestType({ name: 'Unidad Lector de discos consola Ps5 Slim', category: 'gaming' }).label).toBe(
      'Lector de discos para consola'
    );
    expect(interestType({ name: 'Control Remoto Universal WiFi IR LinkFOX', category: 'electronica' }).label).toBe('Control remoto');
    expect(interestType({ name: 'Control Inalámbrico Dualsense Ps5 Galactic Purple', category: 'gaming' }).label).toBe(
      'Control para jugar'
    );
  });

  it('lo que viene después de "para" o "compatible" no convierte el producto en algo deseado', () => {
    // Un hub "para Macbook" no es un notebook.
    expect(interestType({ name: 'Hub Adaptador Usb Tipo C 8 En 1 Para Mac Macbook Windows', category: 'computacion' }).label).toBe(
      'Adaptador'
    );
    expect(
      interestType({ name: 'Hub USB Tipo C 4 Puertos 3.0 Adaptador Multipuerto compatible con Macbook', category: 'computacion' }).label
    ).toBe('Adaptador');
    // Un localizador "compatible con iPhone/iPad" no es un celular ni una tablet.
    expect(
      interestType({ name: 'Smart Finder Bluetooth 5.0 UGREEN CM816 compatible con Apple (iPhone/iPad/Mac)', category: 'electronica' }).label
    ).toBe('Localizador');
    expect(interestType({ name: 'Correa Pulsera Texturizada Para Apple Watch 44 45 46', category: 'electronica' }).label).toBe(
      'Accesorio'
    );
    // Si la única pista viene después de "para", no puede salir un tipo de los deseados.
    const mystery = interestType({ name: 'Protector Templado Para iPhone 17 Pro Max', category: 'celulares' });
    expect(mystery.label).not.toBe('Celular');
    expect(mystery.desire).toBeLessThan(19);
  });

  it('no confunde palabras que se parecen (los errores que encontraron los jueces)', () => {
    // "Disipador" contiene "ipad".
    const cooler = interestType({ name: 'Disipador Cpu Be Quiet! Pure Rock 3 Black, 190w Tdp', category: 'computacion' });
    expect(cooler.label).toBe('Componente de computador');
    // Un ventilador de pedestal no es un soporte.
    expect(interestType({ name: 'Ventilador 5 Aspas Metálicas Pedestal', category: 'electrodomesticos' }).label).toBe(
      'Calefactor o ventilador'
    );
    expect(interestType({ name: 'Pedestal Ventilador Industrial 18 Pulgadas', category: 'electrodomesticos' }).label).toBe(
      'Calefactor o ventilador'
    );
    // Un TV Box no es un televisor, aunque el nombre parta con "Smart TV".
    expect(interestType({ name: 'TV Box Android 14 4K UHD WiFi Google Assistant Control Remoto', category: 'electronica' }).label).toBe(
      'Streaming para la TV'
    );
    expect(interestType({ name: 'Smart TV Box Android 4K 64GB', category: 'electronica' }).label).toBe('Streaming para la TV');
    expect(
      interestType({ name: 'Roku Express 3960 HD producto I Tv Streamer I Tv Box I Convertidor de TV a Smart TV', category: 'electronica' })
        .label
    ).toBe('Streaming para la TV');
    // Un adaptador wifi "Dual Band 5" no es una pulsera inteligente.
    expect(interestType({ name: 'Usb Wifi Bluetooth 4.2 600 Mbps Dual Band 2.4 5ghz', category: 'electronica' }).label).toBe('Adaptador');
    expect(interestType({ name: 'Adaptador Antena Wifi USB 3.0 JS Logia 1300 Mbps Dual Band 5 Ghz', category: 'electronica' }).label).toBe(
      'Adaptador'
    );
    // Una tablet con teclado no es un teclado.
    expect(interestType({ name: 'TAB A1 Plus 128GB / 6GB Octa Core 12.2" 2.4k 120Hz + Lapiz + Teclado', category: 'computacion' }).label).toBe(
      'Tablet'
    );
    // El ventilador de un computador no es uno de pie.
    expect(interestType({ name: 'Kit De Ventilador Negro Arctic P12 Pro Pst 120mm Pwm', category: 'computacion' }).label).toBe(
      'Componente de computador'
    );
  });

  it('una "consola" sin plataforma es retro, y un stick con juegos retro no es un aparato de streaming', () => {
    const noPlatform = interestType({ name: 'Hysmart M15 Consola De Televisión Doméstica 2.4g Hdmi Inalámbrica', category: 'gaming' });
    expect(noPlatform.label).toBe('Consola retro');
    expect(noPlatform.desire).toBeLessThan(15);
    expect(
      interestType({ name: 'Dispositivo Stick Hdmi 4k Con Más De 20,000 Juegos Retro Precargados', category: 'electronica' }).label
    ).toBe('Consola retro');
    expect(interestType({ name: 'Miniconsola de videojuegos portátil retro EPS-R36s', category: 'gaming' }).label).toBe('Consola retro');
  });

  it('los audífonos gamer valen un nivel menos que los normales y cuentan como el mismo tipo', () => {
    const normal = interestType({ name: 'Audífonos Inalámbricos Sony Wh-ch520', category: 'audio' });
    const gamer = interestType({ name: 'Audífonos Gamer Logitech G G335 con Micrófono, Over-Ear', category: 'audio' });
    const headset = interestType({ name: 'Headset Onikuma K19 Gamer con Micrófono y Luz LED RGB para PC y Consolas', category: 'audio' });
    expect(gamer.label).toBe('Audífonos gamer');
    expect(headset.label).toBe('Audífonos gamer');
    expect(gamer.desire).toBeLessThan(normal.desire);
    expect(gamer.key).toBe(normal.key);
  });

  it('agrupa los tipos que para el que mira son lo mismo', () => {
    const key = (name: string) => interestType({ name, category: 'electrodomesticos' }).key;
    expect(key('Frigobar 83l Lfb-101n Libero Color Negro')).toBe(key('Refrigerador Mademsa 173L Bottom Freezer'));
    expect(key('Microondas Thomas Th-25dm Digital 25 Litros')).toBe(key('Horno Electrico Thomas Th-38n Negro'));
    expect(key('Silla Gamer Vidita GX2000')).toBe(key('Silla De Escritorio Ergonómica Lumax'));
  });

  it('si el nombre no dice qué es, usa la categoría y la clave es la categoría hoja de Mercado Libre', () => {
    const unknown = interestType({ name: 'Xiaomi Sound Party - Negro', category: 'audio', ml_category_id: 'MLC1022' });
    expect(unknown).toEqual({ label: 'Producto de audio', desire: 10, recognised: false, key: 'MLC1022' });
    // Sin categoría hoja, la del sitio.
    expect(interestType({ name: 'Rotuladora Brother PTH110 Blanco', category: 'computacion' }).key).toBe('computacion');
    expect(interestType({ name: 'Rotuladora Brother PTH110 Blanco', category: 'computacion', ml_category_id: null }).key).toBe(
      'computacion'
    );
    expect(interestType({ name: 'Cosa sin nombre claro', category: 'una-categoria-nueva' }).label).toBe('Producto');
  });

  it('la categoría ayuda con un juego o un celular que no se nombran como tales', () => {
    expect(interestType({ name: 'Star Fox Nintendo Switch 2', category: 'gaming' }).label).toBe('Videojuego');
    expect(interestType({ name: 'Honor Magic8 Lite 8gb 256gb Negro', category: 'celulares' }).label).toBe('Celular');
    // Pero no si la plataforma aparece solo como "para …".
    expect(interestType({ name: 'Volante De Carreras Con Pedales Para Ps5', category: 'gaming' }).label).toBe('Producto gamer');
  });

  describe('un accesorio no toma el tipo del aparato que nombra', () => {
    // Sin precio: acá decide la regla de accesorios, no el piso.
    it.each([
      ['Estuche Rigido Consola Nintendo Switch Oled', 'gaming'],
      ['Base De Carga Consola Ps5 Dualsense', 'gaming'],
      ['Base De Carga Nintendo Switch', 'gaming'],
      ['Dock De Carga Joy Con Nintendo Switch', 'gaming'],
      ['Skin Adhesivo Consola Ps5 Slim', 'gaming'],
      ['Mochila Notebook 15.6 Antirrobo', 'computacion'],
      ['Bolso Notebook 14 Pulgadas Impermeable', 'computacion'],
      ['Maletín Notebook 15.6 Ejecutivo', 'computacion'],
      ['Batería Notebook Lenovo Ideapad 320', 'computacion'],
      ['Pantalla Notebook 15.6 Led', 'computacion'],
      ['Lápiz Tablet Samsung Galaxy Tab S9', 'computacion'],
      ['Stylus Ipad Punta Fina', 'computacion'],
      ['Protector De Pantalla Galaxy A56 Hidrogel', 'celulares'],
      ['Protector Pantalla Samsung Galaxy A55', 'celulares'],
      ['Vidrio Templado iPhone 15 Pro Max', 'celulares'],
      ['Lámina Hidrogel iPhone 13', 'celulares'],
      ['Láminas Hidrogel iPhone 13 Pack 2', 'celulares'],
      ['Mica Galaxy A15 9h', 'celulares'],
      ['Micas Templadas Galaxy A15 Pack 3', 'celulares'],
      ['Estuche Airpods Pro 2', 'audio'],
      ['Estuche Audífonos AirPods Pro 2', 'audio'],
      ['Almohadillas Audifonos Sony', 'audio'],
      ['Canastillo Freidora De Aire Silicona', 'electrodomesticos'],
      ['Repuesto Rodillo Aspiradora Robot Xiaomi', 'electrodomesticos'],
      ['Filtro Hepa Aspiradora Robot Roborock', 'electrodomesticos'],
      ['Bolsas Aspiradora Robot Roborock Q Revo', 'electrodomesticos'],
      ['Case Silicona iPhone 15 Pro Magsafe', 'celulares'],
      ['Cover Tablet Lenovo Tab M11 Con Tapa', 'computacion'],
      ['Display Lcd Tactil Celular Samsung A10', 'celulares'],
      ['Base Enfriadora Notebook 17 Pulgadas', 'computacion'],
      ['Base Cargadora Doble Control Ps5 Consola', 'gaming'],
    ])('%s es un accesorio', (name, category) => {
      const type = interestType({ name, category });
      expect(type.label).toBe('Accesorio');
      expect(type.desire).toBeLessThan(5);
      expect(type.recognised).toBe(true);
    });

    it('un aparato que trae su accesorio sigue siendo el aparato: gana la palabra que aparece primero', () => {
      const label = (name: string, category: string) => interestType({ name, category }).label;
      expect(label('Kit Tablet Xiaomi Redmi Pad 2 4gb + 128gb + Cover', 'computacion')).toBe('Tablet');
      expect(label('Galaxy Tab S10 Lite Plata 128GB + Cover + S Pen', 'computacion')).toBe('Tablet');
      expect(label('Tablet Lenovo Idea Tab 8gb Ram 128gb Mediatek 11 + Lapiz', 'computacion')).toBe('Tablet');
      expect(label('Audífonos Soundcore P40i Inalámbricos 60 Horas De Reproducción Estuche 2-en-1', 'audio')).toBe('Audífonos');
      expect(label('Gamepad Inalámbrico Machenike G3 V2 con Base de Carga y Joysticks Hall', 'gaming')).toBe('Control para jugar');
      // Una batería externa no es el repuesto de la batería de un notebook.
      expect(label('Batería Externa Power Bank 10000 Mah 22.5W', 'electronica')).toBe('Batería externa');
      expect(label('Bateria portatil Power 30000mAh USB/USB-C', 'electronica')).toBe('Batería externa');
    });

    it('el caso que hallaron los verificadores: el estuche ya no sale como "Consola Nintendo" con 71 puntos', () => {
      const score = interestScore(
        product({
          name: 'Estuche Rigido Consola Nintendo Switch Oled',
          brand: 'Nintendo',
          category: 'gaming',
          price: 14_990,
          original_price: 24_990,
          ml_root_category: 'MLC1144',
          offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true },
        }),
        evidence()
      );
      expect(score.reason.startsWith('Accesorio Nintendo,')).toBe(true);
      expect(score.typeKey).toBe('Accesorio');
      expect(score.breakdown.type).toBe(3);
      expect(score.points).toBeLessThan(50);
    });
  });

  describe('precio mínimo creíble de los tipos caros', () => {
    // Nombres que la regla de accesorios no conoce: los frena el precio.
    const CHEAP: [string, string, string, number, number][] = [
      ['Consola', 'Consola Nintendo Switch Oled Grip Silicona', 'gaming', 14_990, 380_990],
      ['Celular', 'Galaxy A56 Hidrogel Frontal Y Trasero', 'celulares', 4_990, 299_990],
      ['Notebook', 'Notebook Enfriador Usb 5 Ventiladores Rgb', 'computacion', 19_990, 449_990],
      ['Smart TV', 'Smart TV Samsung Repisa Flotante Pared', 'electronica', 12_990, 249_990],
      ['Tablet', 'Tablet 10 Pulgadas Goma Antigolpes Niños', 'computacion', 9_990, 169_990],
    ];

    it.each(CHEAP)('bajo el piso, un nombre de %s se trata como no reconocido', (label, name, category, cheap, real) => {
      const tooCheap = interestType({ name, category, ml_category_id: 'MLC9999', price: cheap });
      expect(tooCheap.recognised).toBe(false);
      expect(tooCheap.label).not.toBe(label);
      expect(tooCheap.desire).toBeLessThanOrEqual(12);
      expect(tooCheap.key).toBe('MLC9999');
      // A un precio creíble, o sin precio a la vista, vale el nombre.
      expect(interestType({ name, category, price: real }).label).toBe(label);
      expect(interestType({ name, category }).label).toBe(label);
      expect(interestType({ name, category, price: null }).label).toBe(label);
      // El piso mismo ya es creíble; un peso menos, no.
      const floor = MIN_CREDIBLE_PRICE[label];
      expect(interestType({ name, category, price: floor }).label).toBe(label);
      expect(interestType({ name, category, price: floor - 1 }).recognised).toBe(false);
    });

    it('el piso llega al puntaje: ni el tipo ni la frase nombran el aparato', () => {
      for (const [label, name, category, cheap] of CHEAP) {
        const score = interestScore(product({ name, category, brand: 'Samsung', price: cheap, original_price: cheap * 2 }), evidence());
        expect(score.typeKey).not.toBe(label);
        expect(score.reason.startsWith(label)).toBe(false);
        expect(score.breakdown.type).toBeLessThanOrEqual(12);
      }
    });

    it('un precio que no sirve no decide nada (ese producto ya queda excluido)', () => {
      for (const price of [0, -5, NaN, Infinity]) {
        expect(interestType({ name: 'Consola Nintendo Switch 2', category: 'gaming', price }).label).toBe('Consola');
      }
    });

    it('ningún producto real queda fuera: lo más barato de cada tipo en el catálogo sigue reconocido', () => {
      const CHEAPEST_REAL: [string, string, string, number][] = [
        ['Consola', 'Ps4 Slim 1 TB 2 controladores + 3 juegos negros - Excelente (Reacondicionado)', 'gaming', 284_990],
        ['Celular', 'Celular Motorola Moto G06 128gb 4gb Ram Color Azul', 'celulares', 99_990],
        ['Notebook', 'Notebook HP 245 G10 AMD Ryzen 3 8gb Ram 256GB Ssd Windows 11 Home', 'computacion', 405_990],
        ['Smart TV', 'Smart TV LED Caixun Roku TV 32" HD C32V1HR', 'electronica', 117_990],
        ['Tablet', 'Tablet Xiaomi Redmi Pad 2 9.7 Wifi 2k 120 Hz 4 GB RAM 64 GB 7600 mAh Gris', 'computacion', 119_507],
      ];
      for (const [label, name, category, price] of CHEAPEST_REAL) {
        expect(interestType({ name, category, price }).label).toBe(label);
        // Y con holgura: a mitad de precio todavía se reconoce.
        expect(MIN_CREDIBLE_PRICE[label]).toBeLessThanOrEqual(price / 2);
      }
      expect(Object.keys(MIN_CREDIBLE_PRICE).sort()).toEqual(['Celular', 'Consola', 'Notebook', 'Smart TV', 'Tablet']);
    });
  });

  it('"juego" es un videojuego solo en la categoría gaming', () => {
    expect(interestType({ name: 'Juego De Ollas Tramontina 5 Piezas', category: 'hogar' }).label).toBe('Producto para la casa');
    expect(interestType({ name: 'Juego De Destornilladores De Precisión 115 En 1', category: 'electronica' }).label).toBe(
      'Producto de electrónica'
    );
    // En gaming sí, aunque el nombre no traiga la plataforma ni una saga conocida.
    expect(interestType({ name: 'Juego Hogwarts Legacy Edición Deluxe', category: 'gaming' }).label).toBe('Videojuego');
    expect(interestType({ name: 'Juego Hogwarts Legacy Edición Deluxe', category: 'electronica' }).label).not.toBe('Videojuego');
    // Una saga conocida se reconoce en cualquier categoría.
    expect(interestType({ name: 'Juego Mario Kart 8 Deluxe', category: 'electronica' }).label).toBe('Videojuego');
  });

  it('una Nintendo Switch Lite, OLED o 2 es consola aunque el nombre no diga "consola" ni sus GB', () => {
    for (const name of ['Nintendo Switch Lite Turquesa', 'Nintendo Switch OLED Blanca', 'Nintendo Switch 2 + Mario Kart World Bundle']) {
      const type = interestType({ name, category: 'gaming' });
      expect(type.label).toBe('Consola');
      expect(type.desire).toBe(30);
    }
    const lite = interestScore(
      product({ name: 'Nintendo Switch Lite Turquesa', brand: 'Nintendo', category: 'gaming', price: 229_990, original_price: 279_990 }),
      evidence()
    );
    expect(lite.reason.startsWith('Consola Nintendo,')).toBe(true);
    // Un juego nombra la plataforma al final: sigue siendo un juego.
    expect(interestType({ name: 'Star Fox Nintendo Switch 2', category: 'gaming' }).label).toBe('Videojuego');
    expect(interestType({ name: 'Mando Inalámbrico Nintendo Switch 2 Pro Controller Negro', category: 'gaming' }).label).toBe(
      'Control para jugar'
    );
  });

  it('"Watch Dogs" es un juego, no un reloj', () => {
    expect(interestType({ name: 'Watch Dogs Legion Ps5', category: 'gaming' }).label).toBe('Videojuego');
    expect(interestType({ name: 'Watch Dogs 2 Xbox One Físico', category: 'electronica' }).label).toBe('Videojuego');
    expect(interestType({ name: 'Redmi Watch 5 Active Negro', category: 'electronica' }).label).toBe('Reloj inteligente');
    expect(interestType({ name: 'Honor Choice Watch 2i Black', category: 'electronica' }).label).toBe('Reloj inteligente');
  });

  it('un PC de escritorio no es un notebook', () => {
    for (const name of [
      'Pc Gamer Ryzen 5 5600g 16gb Ssd 512gb',
      'Mini Pc Intel Core I5 16gb Ram 512gb Ssd',
      // También cuando "PC gamer" viene después del procesador.
      'Ryzen 5 5600g 16gb Ssd 512gb Pc Gamer Rgb',
    ]) {
      const type = interestType({ name, category: 'computacion', price: 499_990 });
      expect(type.label).toBe('Computador de escritorio');
      expect(type.key).not.toBe('Notebook');
    }
    // Un notebook que se nombra solo por su procesador y su disco sigue siéndolo.
    expect(interestType({ name: 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX', category: 'computacion' }).label).toBe(
      'Notebook'
    );
    expect(interestType({ name: 'Notebook Gamer Asus Tuf Ryzen 7 16gb Ssd 512gb Rtx 4050', category: 'computacion' }).label).toBe(
      'Notebook'
    );
  });

  it('el control de un televisor es un control remoto, no uno para jugar', () => {
    const remote = interestType({ name: 'Control Smart TV Samsung', category: 'electronica', price: 7_990 });
    expect(remote.label).toBe('Control remoto');
    expect(remote.desire).toBe(3);
    expect(interestType({ name: 'Control Tv Lg Magic Remote', category: 'electronica' }).label).toBe('Control remoto');
    // Si el nombre habla de jugar, es para jugar aunque sirva en un televisor.
    expect(interestType({ name: 'Control Gamepad Bluetooth Android Tv Pc', category: 'gaming' }).label).toBe('Control para jugar');
    expect(interestType({ name: 'Control Inalámbrico Dualsense Ps5 Galactic Purple', category: 'gaming' }).label).toBe(
      'Control para jugar'
    );
    expect(interestType({ name: 'Control 8bitdo Ultimate 2c Wireless Transparent Black Negro', category: 'gaming' }).label).toBe(
      'Control para jugar'
    );
  });

  it('respeta el límite de palabra: "tablet" e "ipad" dentro de otra palabra no son una tablet', () => {
    // "Disipadores" contiene "ipad" y ninguna otra regla lo reconoce antes.
    expect(interestType({ name: 'Disipadores De Calor Ram Aluminio', category: 'computacion' }).label).toBe('Producto de computación');
    expect(interestType({ name: 'Tableta Digitalizadora Wacom One', category: 'computacion' }).label).not.toBe('Tablet');
  });

  it('"band" suelto no es un reloj: hace falta la marca o "smart" delante', () => {
    const adapter = interestType({ name: 'Tp-Link Archer T3U Plus Dual Band 5 Ghz', category: 'computacion' });
    expect(adapter.label).not.toBe('Reloj inteligente');
    expect(adapter.recognised).toBe(false);
    expect(interestType({ name: 'Huawei Band 10 Negro', category: 'electronica' }).label).toBe('Reloj inteligente');
  });

  it('no se cae con datos que faltan', () => {
    const empty = interestType({ name: undefined as unknown as string, category: undefined as unknown as string });
    expect(empty.recognised).toBe(false);
    expect(empty.label).toBe('Producto');
  });
});

describe('interestBrand: de quién es', () => {
  it('distingue marcas deseadas, conocidas, desconocidas y sin marca', () => {
    expect(interestBrand({ name: 'Parlante JBL Flip 7 Negro', brand: 'JBL' })).toEqual({ level: 2, label: 'JBL', key: 'jbl' });
    expect(interestBrand({ name: 'SMART TV TCL 55"', brand: 'TCL' }).level).toBe(1);
    expect(interestBrand({ name: 'Silla Gamer Vidita GX2000', brand: 'Vidita' })).toEqual({ level: 0, label: 'Vidita', key: 'vidita' });
    expect(interestBrand({ name: 'Lámpara De Emergencia Led 2 Focos', brand: 'Genérica' })).toEqual({ level: -1, label: null, key: '' });
    expect(interestBrand({ name: 'Soporte Tv Rack Movil', brand: 'OEM' }).level).toBe(-1);
  });

  it('Razer, HyperX, Redragon y Logitech G son conocidas, no de las que se desean', () => {
    expect(interestBrand({ name: 'Audífonos Gamer Razer Blackshark V2 X', brand: 'Razer' }).level).toBe(1);
    expect(interestBrand({ name: 'Audífonos Gaming HyperX Cloud III', brand: 'HyperX' }).level).toBe(1);
    expect(interestBrand({ name: 'Headset Gamer Redragon Hylas H260', brand: 'Redragon' }).level).toBe(1);
    expect(interestBrand({ name: 'Audífonos Gamer Logitech G G335', brand: 'Logitech G' })).toEqual({
      level: 1,
      label: 'Logitech G',
      key: 'logitech g',
    });
    // Logitech a secas (un mouse de oficina) sigue siendo de las deseadas.
    expect(interestBrand({ name: 'Mouse Logitech M196 Bluetooth Blanco', brand: 'Logitech' }).level).toBe(2);
  });

  it('no toma la marca de un campo que dice "Compatible con…"', () => {
    const cover = { name: 'Funda Transparent+ Mica Kindle Paperwhite 2024 12va Gen 7pul', brand: 'Compatible con Kindle' };
    expect(interestBrand(cover)).toEqual({ level: -1, label: null, key: '' });
    expect(interestBrand({ name: 'Correa Deportiva Apple Watch 45mm', brand: 'Para Apple' }).level).toBe(-1);
    // Y la frase tampoco la nombra: una funda para Kindle no es "Accesorio Amazon".
    const score = interestScore(product({ ...cover, category: 'electronica', price: 9_990, original_price: 14_990 }), evidence());
    expect(score.reason).not.toContain('Amazon');
    expect(score.reason).not.toContain('Kindle');
    expect(score.breakdown.brand).toBe(W.brandGeneric);
  });

  it('una marca real pero desconocida no se cambia por otra que aparece en el nombre', () => {
    // iFFALCON no es Roku.
    const tv = { name: 'Smart TV iFFALCON Roku TV 32" FHD S45AR', brand: 'iFFALCON' };
    expect(interestBrand(tv)).toEqual({ level: 0, label: 'iFFALCON', key: 'iffalcon' });
    const score = interestScore(product({ ...tv, category: 'electronica' }), evidence());
    expect(score.reason.startsWith('Smart TV iFFALCON de 32 pulgadas')).toBe(true);
    expect(score.reason).not.toContain('Roku');
    // Un cargador Energizer no es Duracell.
    expect(interestBrand({ name: 'Cargador Maxi Energizer Aa/aaa + 2 Pilas Aa 1300mah', brand: 'Energizer' }).label).toBe('Energizer');
    // Un disipador Be Quiet! no es Apple.
    expect(interestBrand({ name: 'Disipador Cpu Be Quiet! Pure Rock 3 Black', brand: 'Be quiet!' }).level).toBe(0);
  });

  it('si el vendedor dice "Genérica", no se busca una marca en el nombre', () => {
    expect(interestBrand({ name: 'Cargador Samsung 25w Carga Rápida Tipo C', brand: 'Genérica' }).level).toBe(-1);
    expect(interestBrand({ name: 'Control Inalámbrico Compatible Con Play Station 4', brand: 'Genérica' }).level).toBe(-1);
  });

  it('solo cuando el campo viene vacío o no es una marca se miran las primeras palabras del nombre', () => {
    expect(interestBrand({ name: 'Parlante JBL Go 4 Azul', brand: null })).toEqual({ level: 2, label: 'JBL', key: 'jbl' });
    expect(interestBrand({ name: 'Parlante JBL Go 4 Azul', brand: '   ' }).label).toBe('JBL');
    expect(interestBrand({ name: 'Calefont Mademsa 7 Litros Tiro Natural', brand: 'Calentador De Agua Instantáneo Sin' }).label).toBe(
      'Mademsa'
    );
    // Lo que viene después de "para" no cuenta: una correa PARA Apple Watch no es Apple.
    expect(interestBrand({ name: 'Correa Deportiva Para Apple Watch 45mm', brand: null }).level).toBe(-1);
    // "Alexa" o "Google" en un nombre dicen con qué funciona, no de quién es.
    expect(interestBrand({ name: 'Enchufe Inteligente Alexa Google Home 16A', brand: null }).level).toBe(-1);
    // Sin marca en ninguna parte: sin marca.
    expect(interestBrand({ name: 'Aro de Luz LED 45 cm con Trípode', brand: null }).level).toBe(-1);
    expect(interestBrand({ name: 'Aro de Luz LED 45 cm con Trípode', brand: undefined as unknown as null }).level).toBe(-1);
  });

  it('una marca que el nombre trae solo después de "para" o "compatible" no consta: ni suma ni se nombra', () => {
    const unconfirmed = { level: 0, label: null, key: '' };
    // El cargador por el que reclamó el dueño: campo "Samsung", pero el nombre dice "Para Samsung".
    const charger = { name: 'Cargador Original Ultra Fast 45w Para Samsung USB-C', brand: 'Samsung' };
    expect(interestBrand(charger)).toEqual(unconfirmed);
    expect(interestBrand({ name: 'Cable Usb C Carga Rápida Compatible Con iPhone 15', brand: 'Apple' })).toEqual(unconfirmed);
    // Con el tipo de aparato de por medio, o en una lista de marcas.
    expect(interestBrand({ name: 'Vidrio Templado Para Celular Samsung Galaxy A55', brand: 'Samsung' })).toEqual(unconfirmed);
    expect(interestBrand({ name: 'Cargador 20w Carga Rápida Para iPhone Samsung Xiaomi', brand: 'Xiaomi' })).toEqual(unconfirmed);
    expect(interestBrand({ name: 'Para Samsung Cargador 25w Tipo C', brand: 'Samsung' })).toEqual(unconfirmed);

    // Si la marca también está en la parte que dice qué es el producto, es suya.
    expect(interestBrand({ name: 'Cargador Samsung 45w Para Galaxy S24', brand: 'Samsung' }).level).toBe(2);
    expect(interestBrand({ name: 'Samsung Cargador 25w Para Samsung Galaxy', brand: 'Samsung' }).label).toBe('Samsung');
    expect(interestBrand({ name: 'Audífonos Sony Pulse Elite Para Ps5', brand: 'Sony' }).level).toBe(2);
    // Si el nombre no la trae en ninguna parte, manda el campo.
    expect(interestBrand({ name: 'Smartwatch Watch GT 7 Pro con GPS, para Android y iOS', brand: 'Huawei' }).level).toBe(2);
    // "Para niños" no es "para Mlab": la marca tiene que venir pegada al "para".
    expect(interestBrand({ name: 'My Lil Cámara & Impresora Para Niños Mlab 9571', brand: 'Mlab' })).toEqual({
      level: 1,
      label: 'Mlab',
      key: 'mlab',
    });
    // Una marca que no está en las tablas se deja como viene: nadie hace accesorios "para Linkon".
    expect(interestBrand({ name: 'Microfono Inalambrico Para Celular Linkon Solapa', brand: 'Linkon' })).toEqual({
      level: 0,
      label: 'Linkon',
      key: 'linkon',
    });

    // En el puntaje, con sus datos del catálogo: tenía 44 puntos como "Cargador Samsung" y entraba a las historias.
    const score = interestScore(
      product({
        ...charger,
        category: 'electronica',
        price: 7_990,
        original_price: 19_990,
        seller_sales_count: 2_793,
        ml_root_category: 'MLC1051',
        ml_category_id: 'MLC157684',
        offer_info: {
          free_shipping: false,
          is_full: false,
          official_store: false,
          sold_by_ml: false,
          is_lowest: true,
          warranty: 'Garantía de fábrica: 6 meses',
        },
      }),
      { drop: { pct: 15.8, amount: 1_500 }, min30: 7_990, daysTracked: 3 }
    );
    expect(score.breakdown).toEqual({ type: 9, brand: 0, deal: 5, reach: 15, commission: 0.3, delivery: 1, signals: 0, penalties: 0 });
    expect(score.points).toBe(30.3);
    expect(score.points).toBeLessThan(MIN_INTEREST_POINTS);
    expect(score.brandKey).toBe('');
    expect(score.reason.startsWith('Cargador,')).toBe(true);
    expect(score.reason).not.toContain('Samsung');
  });

  it('no toma la marca de un campo que dice a qué se parece o que no tiene', () => {
    const none = { level: -1, label: null, key: '' };
    // Nombra otra marca sin decir "compatible".
    const NAMES_ANOTHER = [
      'Reemplazo para HP',
      'Reemplazo HP',
      'Cartucho para HP',
      'Alternativo HP',
      'Alternativa Epson',
      'Tipo Apple',
      'Genérico HP',
      'Repuesto Samsung',
      'For Samsung',
    ];
    for (const brand of NAMES_ANOTHER) {
      expect(interestBrand({ name: 'Tinta Negra 664 Botella 70ml', brand }), brand).toEqual(none);
    }
    // Las muchas formas de decir "sin marca".
    const SAYS_NO_BRAND = [
      'Generic',
      'Genérico',
      'Genéricas',
      'Marca Genérica',
      'S/M',
      'N/A',
      'Importado',
      'Importada',
      'Universal',
      'Otras',
      'Otras Marcas',
      'Varias',
      'No tiene',
      'Ninguno',
    ];
    for (const brand of SAYS_NO_BRAND) {
      expect(interestBrand({ name: 'Cargador Samsung 25w Carga Rápida Tipo C', brand }), brand).toEqual(none);
    }
    // Y la frase no las escribe.
    const score = interestScore(product({ name: 'Cargador Carga Rápida 25w Tipo C', brand: 'Marca Genérica' }), evidence());
    expect(score.reason.startsWith('Cargador,')).toBe(true);
    expect(score.breakdown.brand).toBe(W.brandGeneric);
    expect(interestScore(product({ name: 'Tinta Negra 664', brand: 'Alternativo HP' }), evidence()).reason).not.toContain('HP');
    // Una marca de verdad que solo se parece a esas palabras sigue siendo una marca.
    expect(interestBrand({ name: 'Mini Ups Forza 12v', brand: 'Forza' })).toEqual({ level: 0, label: 'Forza', key: 'forza' });
    expect(interestBrand({ name: 'Parlante Universalis Bt', brand: 'Universalis' }).level).toBe(0);
    expect(interestBrand({ name: 'Audífonos Paramax Pro', brand: 'Paramax' }).label).toBe('Paramax');
  });

  it('con el campo vacío, un soporte, un cable o un cargador no toman una marca del nombre', () => {
    const none = { level: -1, label: null, key: '' };
    for (const name of [
      'Soporte Tv Samsung Lg Sony 32 A 75',
      'Cable Cargador iPhone Lightning 2 Metros',
      'Cargador Samsung 25w Carga Rápida Tipo C',
      'Control Remoto Samsung Smart Tv Universal',
      'Funda Kindle Paperwhite 2024 Magnética',
      'Adaptador Apple Lightning A Jack 3.5',
      'Tinta Epson 544 Negra Botella 65ml',
    ]) {
      expect(interestBrand({ name, brand: null }), name).toEqual(none);
      expect(interestBrand({ name, brand: '' }), name).toEqual(none);
    }
    // Si el vendedor sí llenó el campo, se le cree.
    expect(interestBrand({ name: 'Soporte Tv Samsung Lg Sony 32 A 75', brand: 'Samsung' }).level).toBe(2);
    // Y lo que no es de esos tipos sigue tomando la marca del nombre.
    expect(interestBrand({ name: 'Parlante JBL Go 4 Azul', brand: null }).label).toBe('JBL');
    expect(interestBrand({ name: 'Hervidor Oster 1.7 Litros Acero', brand: null }).label).toBe('Oster');
  });

  it('junta las variantes de una misma marca para la regla de variedad', () => {
    const key = (name: string, brand: string) => interestBrand({ name, brand }).key;
    expect(key('Lector E Reader Rakuten Kobo Clara Bw', 'Rakuten Kobo')).toBe(key('Lector E Reader Kobo Libra Colour', 'Kobo'));
    expect(key('Amazon Kindle Paperwhite 12 Gen', 'Kindle')).toBe(key('Amazon Echo Pop', 'Amazon'));
    expect(key('Reloj inteligente Redmi Watch 5 Lite', 'Redmi')).toBe(key('Xiaomi Tv Stick 2k', 'Xiaomi'));
    expect(key('Smart Tv Led 32 Google Tv', 'MasterG')).toBe(key('Monitor Gamer 27 Master-G', 'Master-G'));
    expect(interestBrand({ name: 'Auriculares Redmi Buds 8', brand: 'Xiaomi (completamente nuevo)' }).label).toBe('Xiaomi');
  });
});

describe('interestScore: los puntos, bloque por bloque', () => {
  it('el desglose suma los puntos y trae todos los bloques', () => {
    const score = interestScore(TCL_TV, TCL_EVIDENCE);
    // 27 + 7 + 25 + 10 + 9,3 + 5 = 83,3
    expect(score.breakdown).toEqual({ type: 27, brand: 7, deal: 25, reach: 10, commission: 9.3, delivery: 5, signals: 0, penalties: 0 });
    expect(score.points).toBe(83.3);
    expect(score.warning).toBeNull();
    expect(score.excluded).toBeNull();
    expect(score.typeKey).toBe('Smart TV');
    expect(score.brandKey).toBe('tcl');
  });

  it('la suma cuadra siempre, también con castigos y señales', () => {
    for (const [p, ev] of [
      [TCL_TV, TCL_EVIDENCE],
      [PS5_PRO_SMALL_SELLER, PS5_PRO_EVIDENCE],
      [product({ ...listed(62), brand: 'Genérica', name: 'Lámpara De Emergencia Led' }), evidence({ mlPosition: 4, recentClicks: 9 })],
      [product({ price: 108_000, original_price: 150_000 }), evidence({ min30: 100_000 })],
    ] as [InterestProduct, InterestEvidence][]) {
      const score = interestScore(p, ev);
      const sum = Object.keys(score.breakdown).reduce((total, key) => total + score.breakdown[key], 0);
      expect(score.points).toBeCloseTo(sum, 6);
      expect(Object.keys(score.breakdown).sort()).toEqual(
        ['brand', 'commission', 'deal', 'delivery', 'penalties', 'reach', 'signals', 'type']
      );
    }
  });

  it('sin señales el tope es 100', () => {
    const best = interestScore(
      product({
        name: 'Consola PlayStation 5 Slim',
        brand: 'Sony',
        category: 'gaming',
        // El precio más bajo al que una consola todavía es creíble.
        price: MIN_CREDIBLE_PRICE.Consola,
        original_price: MIN_CREDIBLE_PRICE.Consola * 2,
        ml_root_category: 'MLC1574',
        offer_info: {
          free_shipping: true,
          is_full: true,
          official_store: true,
          sold_by_ml: true,
          is_lowest: true,
          warranty: 'Garantía de fábrica: 12 meses',
        },
      }),
      evidence({ drop: { pct: 40, amount: 500_000 }, min30: MIN_CREDIBLE_PRICE.Consola })
    );
    expect(best.breakdown.type).toBe(30);
    expect(best.breakdown.brand).toBe(12);
    expect(best.breakdown.deal).toBe(25);
    expect(best.breakdown.delivery).toBe(8);
    expect(best.points).toBeLessThanOrEqual(100);
  });

  it('la marca suma 12, 7, 0 o resta 4', () => {
    const brandPoints = (brand: string | null, name = 'Audífonos Bluetooth Over Ear') =>
      interestScore(product({ brand, name }), evidence()).breakdown.brand;
    expect(brandPoints('Sony')).toBe(12);
    expect(brandPoints('Anker')).toBe(7);
    expect(brandPoints('Sleve')).toBe(0);
    expect(brandPoints('Genérica')).toBe(-4);
    expect(brandPoints(null)).toBe(-4);
  });

  describe('la baja que vio el sitio (hasta 20)', () => {
    const noList = { price: 100_000, original_price: null };
    const dealWith = (drop: InterestEvidence['drop'], daysTracked = 6) =>
      interestScore(product(noList), { drop, min30: 100_000, daysTracked }).breakdown.deal;

    it('pesa por su porcentaje y llega al tope con 30%', () => {
      expect(dealWith({ pct: 10, amount: 100_000 })).toBeCloseTo(6.7, 1);
      expect(dealWith({ pct: 30, amount: 100_000 })).toBe(20);
      expect(dealWith({ pct: 55, amount: 100_000 })).toBe(20);
    });

    it('pesa por su monto en pesos: bajar $1.000 no es noticia', () => {
      const small = dealWith({ pct: 15, amount: 1_000 });
      const medium = dealWith({ pct: 15, amount: 10_000 });
      const big = dealWith({ pct: 15, amount: 100_000 });
      expect(small).toBeCloseTo(2.5, 1);
      expect(big).toBe(10);
      expect(small).toBeLessThan(medium);
      expect(medium).toBeLessThan(big);
      // Más de $100.000 no pesa más que el porcentaje entero.
      expect(dealWith({ pct: 15, amount: 900_000 })).toBe(10);
    });

    it('pesa por los días de historial: la mitad con 0, 70% con 1, entera desde 2', () => {
      const drop = { pct: 30, amount: 100_000 };
      expect(dealWith(drop, 0)).toBe(10);
      expect(dealWith(drop, 1)).toBe(14);
      expect(dealWith(drop, 2)).toBe(20);
      expect(dealWith(drop, 40)).toBe(20);
    });

    it('una baja menor que la mínima del sitio (3%) o con números inválidos no cuenta', () => {
      expect(dealWith({ pct: 2.9, amount: 50_000 })).toBe(0);
      expect(dealWith({ pct: NaN, amount: 50_000 })).toBe(0);
      expect(dealWith({ pct: 20, amount: -5 })).toBe(0);
      expect(dealWith({ pct: Infinity, amount: Infinity })).toBe(0);
      expect(dealWith(null)).toBe(0);
    });
  });

  describe('el descuento de lista (hasta 10)', () => {
    const dealOf = (pct: number, over: Partial<InterestProduct> = {}, ev: InterestEvidence = evidence()) =>
      interestScore(product({ ...listed(pct), ...over }), ev).breakdown.deal;
    const seller = (official_store: boolean, sold_by_ml: boolean) => ({
      offer_info: { free_shipping: true, is_full: false, official_store, sold_by_ml, is_lowest: true, warranty: null },
    });

    it('se cuenta desde 10% y llega al tope con 40%', () => {
      const top = seller(true, true);
      expect(dealOf(5, top)).toBe(0);
      expect(dealOf(10, top)).toBe(0);
      expect(dealOf(20, top)).toBeCloseTo(3.3, 1);
      expect(dealOf(30, top)).toBeCloseTo(6.7, 1);
      expect(dealOf(40, top)).toBe(10);
      expect(dealOf(45, top)).toBe(10);
    });

    it('se le cree según la marca y según quién vende', () => {
      // Marca deseada: sola vale la mitad; con tienda oficial o Mercado Libre sube; con las dos, entero.
      expect(dealOf(40, seller(false, false))).toBe(5);
      expect(dealOf(40, seller(true, false))).toBe(7.5);
      expect(dealOf(40, seller(false, true))).toBe(7.5);
      expect(dealOf(40, seller(true, true))).toBe(10);
      // La misma oferta dicha por una marca desconocida o genérica vale menos.
      const unknown = dealOf(40, { ...seller(false, false), brand: 'Sleve' });
      const generic = dealOf(40, { ...seller(false, false), brand: 'Genérica' });
      const known = dealOf(40, { ...seller(false, false), brand: 'Anker' });
      expect(generic).toBeLessThan(unknown);
      expect(unknown).toBeLessThan(known);
      expect(known).toBeLessThan(dealOf(40, seller(false, false)));
    });

    it('a un vendedor chico que no es tienda oficial no se le cree más que a una marca desconocida', () => {
      const plain = seller(false, false);
      const unknown = dealOf(40, { ...plain, brand: 'Sleve' });
      // Una marca deseada sola vale la mitad (5 de 10)…
      expect(dealOf(40, { ...plain, seller_sales_count: 1_000 })).toBe(5);
      expect(dealOf(40, { ...plain, seller_sales_count: 50_000 })).toBe(5);
      // …pero con menos de 1.000 ventas la marca no le presta su confianza.
      for (const seller_sales_count of [0, 192, 358, 999]) {
        expect(dealOf(40, { ...plain, seller_sales_count })).toBe(unknown);
        expect(dealOf(40, { ...plain, seller_sales_count })).toBe(2.5);
        expect(dealOf(40, { ...plain, seller_sales_count, brand: 'Anker' })).toBe(unknown);
      }
      // Si no se sabe cuánto vendió, no se afirma que sea chico.
      for (const seller_sales_count of [null, undefined, NaN, -1] as (number | null | undefined)[]) {
        expect(dealOf(40, { ...plain, seller_sales_count })).toBe(5);
      }
      // A una tienda oficial o a Mercado Libre no se les mira el contador.
      expect(dealOf(40, { ...seller(true, false), seller_sales_count: 192 })).toBe(7.5);
      expect(dealOf(40, { ...seller(false, true), seller_sales_count: 192 })).toBe(7.5);
      // Es un tope, no un piso: a un genérico no le sube la confianza.
      expect(dealOf(40, { ...plain, seller_sales_count: 192, brand: 'Genérica' })).toBe(1.5);
    });

    it('los tres parlantes del catálogo que subían por una lista que nadie respalda ahora llevan aviso', () => {
      const info = { free_shipping: true, is_full: true, official_store: false, sold_by_ml: false, is_lowest: true, warranty: null };
      const seen = (price: number) => evidence({ min30: price, daysTracked: 4 });
      // El mismo Charge 6 estaba en el catálogo a $129.990 sin descuento: el 44% es de la lista, no del precio.
      const charge = interestScore(
        product({
          name: 'Parlante Jbl Chargue 6 Color Blanco',
          price: 133_868,
          original_price: 239_051,
          seller_sales_count: 192,
          offer_info: info,
        }),
        NO_HISTORY
      );
      expect(charge.points).toBe(54.2);
      expect(charge.warning).toBe('descuento de lista con poco respaldo');

      const go5 = product({
        name: 'Jbl Go 5 - Speaker - Blue',
        price: 34_253,
        original_price: 57_171,
        seller_sales_count: 358,
        ml_root_category: 'MLC1182',
        offer_info: info,
      });
      const go = interestScore(go5, seen(34_253));
      expect(go.points).toBe(58.4);
      expect(go.warning).toBe('descuento de lista con poco respaldo');

      const spot = interestScore(
        product({
          name: 'Amazon Echo Spot Bocina Inteligente 2024 Color Negro',
          brand: 'Alexa',
          price: 71_790,
          original_price: 175_104,
          seller_sales_count: 192,
          offer_info: info,
        }),
        seen(71_790)
      );
      expect(spot.points).toBe(49.1);
      expect(spot.warning).toBe('descuento de lista con poco respaldo');

      // El mismo parlante de un vendedor con trayectoria no lleva aviso.
      expect(interestScore({ ...go5, seller_sales_count: 6_455 }, seen(34_253)).warning).toBeNull();
    });

    it('sobre 50% va perdiendo de a poco, sin saltos', () => {
      const top = seller(true, true);
      expect(dealOf(50, top)).toBe(dealOf(40, top));
      let previous = dealOf(50, top);
      for (let pct = 51; pct <= 80; pct++) {
        const now = dealOf(pct, top);
        // Cada punto de descuento resta un tercio de punto: nunca un escalón.
        expect(previous - now).toBeGreaterThan(0.2);
        expect(previous - now).toBeLessThan(0.5);
        previous = now;
      }
      expect(dealOf(80, top)).toBe(0);
      expect(dealOf(95, top)).toBe(0);
      // Un punto de descuento no mueve un producto de arriba a abajo (antes: 13 puntos entre 54% y 55%).
      expect(Math.abs(dealOf(54, top) - dealOf(55, top))).toBeLessThan(0.5);
    });

    it('vale 0,9 mientras hay menos de dos días de historial', () => {
      const top = seller(true, true);
      expect(dealOf(40, top, evidence({ daysTracked: 0 }))).toBe(9);
      expect(dealOf(40, top, evidence({ daysTracked: 1 }))).toBe(9);
      expect(dealOf(40, top, evidence({ daysTracked: 2 }))).toBe(10);
      expect(dealOf(40, top, NO_HISTORY)).toBe(9);
    });

    it('baja y lista juntas no pasan de 25', () => {
      const both = interestScore(product({ ...listed(45), ...seller(true, true) }), evidence({ drop: { pct: 35, amount: 200_000 } }));
      expect(both.breakdown.deal).toBe(25);
    });
  });

  describe('el alcance (0-15)', () => {
    const reachOf = (price: number) => interestScore(product({ price, original_price: null }), evidence()).breakdown.reach;

    it('lo que mucha gente puede pagar vale más', () => {
      expect(reachOf(9_990)).toBe(15);
      expect(reachOf(30_000)).toBe(15);
      expect(reachOf(100_000)).toBeCloseTo(10.1, 1);
      expect(reachOf(300_000)).toBeCloseTo(5.6, 1);
      expect(reachOf(1_200_000)).toBe(1);
      expect(reachOf(5_000_000)).toBe(1);
      expect(reachOf(50_000)).toBeGreaterThan(reachOf(150_000));
    });

    it('algo caro y deseado con una baja de verdad y un vendedor de confianza no baja de 10', () => {
      expect(interestScore(PS5_HERO, PS5_HERO_EVIDENCE).breakdown.reach).toBe(W.heroReach);
      expect(interestScore(TCL_TV, TCL_EVIDENCE).breakdown.reach).toBe(W.heroReach);
      // Sin la baja, el alcance es el de su precio.
      expect(interestScore(PS5_HERO, evidence({ min30: 549_990 })).breakdown.reach).toBeLessThan(4);
    });

    it('el trato de héroe exige cada una de sus condiciones', () => {
      const plain = interestScore(PS5_HERO, evidence({ min30: 549_990 })).breakdown.reach;
      const reach = (over: Partial<InterestProduct>, ev: Partial<InterestEvidence> = {}) =>
        interestScore({ ...PS5_HERO, ...over }, { ...PS5_HERO_EVIDENCE, ...ev }).breakdown.reach;
      const info = PS5_HERO.offer_info;
      // Vendedor chico y sin tienda oficial (el caso de la PlayStation 5 Pro del catálogo).
      expect(reach({ seller_sales_count: 11, offer_info: { ...info, official_store: false } })).toBe(plain);
      // Sin dato de ventas y sin tienda oficial: no se puede decir que sea de confianza.
      expect(reach({ seller_sales_count: null, offer_info: { ...info, official_store: false } })).toBe(plain);
      // Con 1.000 ventas o más alcanza aunque no sea tienda oficial.
      expect(reach({ seller_sales_count: 2_500, offer_info: { ...info, official_store: false } })).toBe(W.heroReach);
      // Otro vendedor lo tiene más barato en la misma publicación.
      expect(reach({ offer_info: { ...info, is_lowest: false } })).toBe(plain);
      // Menos de dos días de historial, baja chica o de pocos pesos.
      expect(reach({}, { daysTracked: 1 })).toBe(plain);
      expect(reach({}, { drop: { pct: 4, amount: 60_000 } })).toBe(plain);
      expect(reach({}, { drop: { pct: 10, amount: 8_000 } })).toBe(plain);
      // El sitio lo vio más barato hace poco.
      expect(reach({}, { min30: 520_000 })).toBe(plain);
      // El precio se ha estado moviendo: la noticia puede durar horas.
      expect(reach({}, { recentChanges: 3 })).toBe(plain);
      expect(reach({}, { seesaw: true })).toBe(plain);
      expect(reach({}, { recentChanges: 1, seesaw: false })).toBe(W.heroReach);
      // Cambió hace poco y no se sabe desde cuánto: no hay noticia que dar.
      expect(reach({}, { changedFromUnknown: true })).toBe(plain);
      // Un refrigerador caro con la misma baja no es un héroe.
      expect(reach({ name: 'Refrigerador Side by Side 578 lt Samsung', brand: 'Samsung', category: 'electrodomesticos' })).toBe(plain);
    });

    it('el héroe llega a las 8 historias de un día normal, y el de vendedor dudoso no', () => {
      const usual = USUAL_PICKS.map(([p, ev]) => candidate(p, ev));
      const hero = candidate(PS5_HERO, PS5_HERO_EVIDENCE);
      const doubtful = candidate(PS5_PRO_SMALL_SELLER, PS5_PRO_EVIDENCE);
      const picks = pickVaried([...usual, hero, doubtful], LIMITS);
      expect(picks).toHaveLength(8);
      expect(ids(picks).indexOf(hero.id)).toBeGreaterThanOrEqual(0);
      expect(ids(picks).indexOf(hero.id)).toBeLessThan(3);
      expect(ids(picks)).not.toContain(doubtful.id);
      // Y no llega por la comisión sola: sin la baja queda fuera.
      const noDrop = candidate(PS5_HERO, evidence({ min30: 549_990 }));
      expect(ids(pickVaried([...usual, noDrop], LIMITS))).not.toContain(noDrop.id);
    });
  });

  it('la comisión suma en escala logarítmica, con la tasa de la categoría raíz', () => {
    const commissionOf = (price: number, root: string | null = 'MLC1000') =>
      interestScore(product({ price, original_price: null, ml_root_category: root }), evidence()).breakdown.commission;
    // $7.000 al 7% son $490: no suma.
    expect(commissionOf(7_000)).toBe(0);
    expect(commissionOf(60_000)).toBeCloseTo(5.2, 1);
    expect(commissionOf(500_000)).toBe(10);
    expect(commissionOf(5_000_000)).toBe(10);
    // Hogar y Muebles paga 11%: el mismo precio deja más.
    expect(commissionOf(60_000, 'MLC1574')).toBeGreaterThan(commissionOf(60_000));
    // Sin raíz conocida se asume la tasa más baja.
    expect(commissionOf(60_000, null)).toBe(commissionOf(60_000));
    expect(interestScore(product({ ml_root_category: undefined }), evidence()).breakdown.commission).toBeGreaterThan(0);
  });

  it('entrega y confianza: envío gratis 3, Full 2, lo vende Mercado Libre 2, garantía 1', () => {
    const deliveryOf = (info: InterestProduct['offer_info']) => interestScore(product({ offer_info: info }), evidence()).breakdown.delivery;
    expect(deliveryOf({})).toBe(0);
    expect(deliveryOf(null)).toBe(0);
    expect(deliveryOf({ free_shipping: true })).toBe(3);
    expect(deliveryOf({ is_full: true })).toBe(2);
    expect(deliveryOf({ sold_by_ml: true })).toBe(2);
    expect(deliveryOf({ warranty: 'Garantía de fábrica: 6 meses' })).toBe(1);
    expect(deliveryOf({ warranty: 'Garantía del vendedor: 12 meses' })).toBe(1);
    expect(deliveryOf({ warranty: 'Garantía del vendedor: 2 años' })).toBe(1);
    expect(deliveryOf({ warranty: 'Garantía del vendedor: 6 meses' })).toBe(0);
    expect(deliveryOf({ warranty: 'Garantía del vendedor: 30 días' })).toBe(0);
    expect(deliveryOf({ free_shipping: true, is_full: true, sold_by_ml: true, warranty: 'Garantía de fábrica: 12 meses' })).toBe(8);
  });

  describe('las señales opcionales', () => {
    const base = interestScore(TCL_TV, TCL_EVIDENCE);
    const withSignals = (signals: Partial<InterestEvidence>) => interestScore(TCL_TV, { ...TCL_EVIDENCE, ...signals });

    it('suman poco y con tope', () => {
      expect(withSignals({ mlPosition: 1 }).breakdown.signals).toBe(4);
      expect(withSignals({ mlPosition: 10 }).breakdown.signals).toBe(3);
      expect(withSignals({ mlPosition: 20 }).breakdown.signals).toBe(2);
      expect(withSignals({ mlPosition: 50 }).breakdown.signals).toBe(1);
      expect(withSignals({ mlPosition: 51 }).breakdown.signals).toBe(0);
      expect(withSignals({ recentClicks: 3 }).breakdown.signals).toBe(1);
      expect(withSignals({ recentClicks: 6 }).breakdown.signals).toBe(2);
      expect(withSignals({ recentClicks: 500 }).breakdown.signals).toBe(3);
      expect(withSignals({ mlPosition: 1, recentClicks: 500 }).breakdown.signals).toBe(W.signals);
      expect(withSignals({ mlPosition: 1, recentClicks: 500 }).points).toBe(base.points + W.signals);
    });

    it('menos de 3 clics no cuentan', () => {
      for (const recentClicks of [1, 2, 2.9]) {
        const score = withSignals({ recentClicks });
        expect(score.points).toBe(base.points);
        expect(score.reason).toBe(base.reason);
      }
    });

    it('si faltan no restan', () => {
      expect(withSignals({ mlPosition: null, recentClicks: null })).toEqual(base);
      expect(withSignals({ mlPosition: undefined, recentClicks: undefined })).toEqual(base);
    });

    it('lo que no es un número válido se ignora y nunca se escribe', () => {
      for (const value of GARBAGE) {
        for (const signals of [{ mlPosition: value }, { recentClicks: value }, { mlPosition: value, recentClicks: value }]) {
          const score = withSignals(signals);
          expect(score.points).toBe(base.points);
          expect(score.breakdown.signals).toBe(0);
          expect(score.reason).toBe(base.reason);
          expect(score.warning).toBe(base.warning);
        }
      }
      const text = (value: unknown) => {
        const score = withSignals({ mlPosition: value as number, recentClicks: value as number });
        return `${score.reason} ${score.warning}`;
      };
      expect(text('7')).not.toMatch(/figuró|clics/);
      expect(text(2.5)).not.toMatch(/2\.5|figuró/);
      expect(text(Infinity)).not.toMatch(/Infinity|clics/);
      expect(text(NaN)).not.toMatch(/NaN/);
      // Un número absurdo de clics no se escribe, y menos en notación científica.
      expect(text(1e21)).not.toMatch(/e\+|clics|figuró/);
      expect(text(Number.MAX_VALUE)).not.toMatch(/e\+|clics|figuró/);
      expect(withSignals({ recentClicks: 1_000_001 }).breakdown.signals).toBe(0);
      expect(withSignals({ recentClicks: 1_000_000 }).breakdown.signals).toBe(3);
    });

    it('cuando son válidas se dicen en la frase, con números enteros', () => {
      const cheap = product({ offer_info: { is_lowest: true } });
      expect(interestScore(cheap, evidence({ mlPosition: 3 })).reason).toContain('figuró 3.º entre los más vendidos de su categoría');
      expect(interestScore(cheap, evidence({ recentClicks: 14.7 })).reason).toContain('lleva 14 clics recientes en el sitio');
      // Pasado el puesto 20 suma algo, pero no es para contarlo.
      expect(interestScore(cheap, evidence({ mlPosition: 35 })).reason).not.toContain('figuró');
    });
  });

  describe('los castigos, cada uno con su aviso', () => {
    const clean = interestScore(product(), evidence());

    it('una oferta corriente no tiene avisos', () => {
      expect(clean.warning).toBeNull();
      expect(clean.breakdown.penalties).toBe(0);
    });

    it('el nombre parte con un código de modelo', () => {
      const coded = interestScore(product({ name: 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX', brand: 'Asus' }), evidence());
      expect(coded.breakdown.penalties).toBe(-W.penaltyCodeName);
      expect(coded.warning).toBe('el nombre parte con un código');
      // Un nombre que parte con una palabra, una marca o un tamaño no es un código.
      for (const name of ['Audífonos Sony Wh-ch520', 'Ps4 Slim 1 TB', '55" Crystal UHD U8500H 4K Samsung Smart TV', 'Smartwatch Huawei Band 10']) {
        expect(interestScore(product({ name }), evidence()).warning).toBeNull();
      }
    });

    it('otro vendedor lo ofrece a menos en la misma publicación', () => {
      const score = interestScore(product({ offer_info: { ...product().offer_info, is_lowest: false } }), evidence());
      expect(score.breakdown.penalties).toBe(-W.penaltyNotLowest);
      expect(score.warning).toBe('otro vendedor lo ofrece a menos');
      // Solo cuando consta: sin el dato no se dice nada.
      expect(interestScore(product({ offer_info: { ...product().offer_info, is_lowest: null } }), evidence()).warning).toBeNull();
      expect(interestScore(product({ offer_info: { free_shipping: true, official_store: true } }), evidence()).warning).toBeNull();
    });

    it('vendedor con menos de 100 ventas que no es tienda oficial ni Mercado Libre', () => {
      const info = { free_shipping: true, is_lowest: true, official_store: false, sold_by_ml: false };
      // Con una baja vista por el sitio, para que el único castigo posible sea este.
      const proven = evidence({ drop: { pct: 30, amount: 100_000 } });
      const few = interestScore(product({ seller_sales_count: 42, offer_info: info }), proven);
      expect(few.breakdown.penalties).toBe(-W.penaltyFewSales);
      expect(few.warning).toBe('vendedor con pocas ventas (42)');
      expect(few.excluded).toBeNull();
      // Con 100 ventas ya no.
      expect(interestScore(product({ seller_sales_count: 100, offer_info: info }), proven).warning).toBeNull();
      // Tienda oficial o Mercado Libre: no se castiga aunque el contador sea bajo.
      expect(
        interestScore(product({ seller_sales_count: 5, offer_info: { ...info, official_store: true } }), evidence()).warning
      ).toBeNull();
      expect(interestScore(product({ seller_sales_count: 5, offer_info: { ...info, sold_by_ml: true } }), evidence()).warning).toBeNull();
    });

    it('si no se sabe cuánto ha vendido, no se castiga ni se afirma', () => {
      const info = { free_shipping: true, is_lowest: true, official_store: false, sold_by_ml: false };
      const known = interestScore(product({ seller_sales_count: 5_000, offer_info: info, ...listed(45) }), evidence());
      for (const seller_sales_count of [null, undefined, NaN, -1] as (number | null | undefined)[]) {
        const score = interestScore(product({ seller_sales_count, offer_info: info, ...listed(45) }), evidence());
        expect(score.points).toBe(known.points);
        expect(score.warning).toBeNull();
        // "(cifra del vendedor)" habla del descuento, no de cuánto ha vendido.
        expect(score.reason).not.toMatch(/ventas|vendedor con/);
      }
    });

    it('precio movido: dos o más cambios en 48 horas, o un precio que va y vuelve', () => {
      const calm = interestScore(product(), evidence({ recentChanges: 1, seesaw: false }));
      expect(calm.warning).toBeNull();
      expect(calm.points).toBe(clean.points);

      const moving = interestScore(product(), evidence({ recentChanges: 5 }));
      expect(moving.warning).toBe('el precio cambió 5 veces en dos días');
      expect(moving.breakdown.penalties).toBe(-W.penaltyMovingPrice);

      const seesaw = interestScore(product(), evidence({ recentChanges: 1, seesaw: true }));
      expect(seesaw.warning).toBe('el precio va y vuelve entre los mismos valores');
      expect(seesaw.points).toBe(moving.points);
      // Las dos cosas a la vez son un solo castigo, y se dice la cuenta.
      const both = interestScore(product(), evidence({ recentChanges: 4, seesaw: true }));
      expect(both.warning).toBe('el precio cambió 4 veces en dos días');
      expect(both.points).toBe(moving.points);

      // Un dato que no es un número válido no se escribe ni se castiga.
      for (const recentChanges of [NaN, -3, Infinity, null, undefined] as (number | null | undefined)[]) {
        expect(interestScore(product(), evidence({ recentChanges })).warning).toBeNull();
      }
      expect(interestScore(product(), evidence({ recentChanges: 1e21 })).warning).toBe('el precio cambió 99 veces en dos días');
    });

    it('muchos vendedores en la ficha: se avisa desde cuatro', () => {
      const info = product().offer_info;
      expect(interestScore(product({ offer_info: { ...info, offers_count: 3 } }), evidence()).warning).toBeNull();
      const many = interestScore(product({ offer_info: { ...info, offers_count: 11 } }), evidence());
      expect(many.warning).toBe('11 vendedores en la ficha: el precio puede cambiar');
      expect(many.breakdown.penalties).toBe(-W.penaltyManySellers);
      expect(interestScore(product({ offer_info: { ...info, offers_count: 4 } }), evidence()).warning).toBe(
        '4 vendedores en la ficha: el precio puede cambiar'
      );
      // Sin el dato no se afirma nada.
      for (const offers_count of [null, undefined, NaN, -2] as (number | null | undefined)[]) {
        expect(interestScore(product({ offer_info: { ...info, offers_count } }), evidence()).warning).toBeNull();
      }
    });

    it('si cambió hace poco desde un precio que no quedó anotado se avisa, sin quitar puntos', () => {
      const known = interestScore(product(), evidence());
      const unknown = interestScore(product(), evidence({ changedFromUnknown: true }));
      expect(unknown.warning).toBe('cambió de precio y no sabemos cuánto costaba antes');
      expect(unknown.points).toBe(known.points);
      expect(unknown.excluded).toBeNull();
      expect(interestScore(product(), evidence({ changedFromUnknown: false })).warning).toBeNull();
      expect(interestScore(product(), evidence({ changedFromUnknown: null })).warning).toBeNull();
    });

    it('una cantidad de vendedores absurda se trata como si no viniera', () => {
      const info = product().offer_info;
      for (const offers_count of [1e21, Number.MAX_VALUE, 1_000_000]) {
        expect(interestScore(product({ offer_info: { ...info, offers_count } }), evidence()).warning).toBeNull();
      }
      expect(interestScore(product({ offer_info: { ...info, offers_count: 43 } }), evidence()).warning).toBe(
        '43 vendedores en la ficha: el precio puede cambiar'
      );
    });

    it('si hoy no se pudo leer el historial se avisa, sin quitar puntos', () => {
      const none = interestScore(product(), NO_HISTORY);
      const unread = interestScore(product(), { ...NO_HISTORY, historyUnread: true });
      expect(none.warning).toBeNull();
      expect(unread.warning).toBe('hoy no se pudo leer su historial de precios');
      expect(unread.points).toBe(none.points);
      expect(unread.excluded).toBeNull();
    });

    it('el sitio lo vio más barato: 4 puntos por cada 1% pasado 3%, con tope 30, y lo dice', () => {
      // Con una baja grande de por medio, para que el único castigo posible sea este.
      const penaltyAt = (price: number) => {
        const score = interestScore(
          product({ price, original_price: null }),
          evidence({ min30: 100_000, drop: { pct: 30, amount: 100_000 } })
        );
        return { penalty: score.breakdown.penalties, warning: score.warning };
      };
      expect(penaltyAt(100_000)).toEqual({ penalty: 0, warning: null });
      // Hasta 3% no se cuenta, ni por un redondeo.
      expect(penaltyAt(103_000)).toEqual({ penalty: 0, warning: null });
      expect(penaltyAt(104_000)).toEqual({ penalty: -4, warning: 'hace poco estuvo a $100.000' });
      expect(penaltyAt(105_500)).toEqual({ penalty: -10, warning: 'hace poco estuvo a $100.000' });
      expect(penaltyAt(109_000).penalty).toBe(-24);
      expect(penaltyAt(112_000).penalty).toBe(-30);
      expect(penaltyAt(180_000).penalty).toBe(-30);
    });

    it('el castigo por "ya estuvo más barato" vale para toda oferta, no solo para las bajas', () => {
      // Solo descuento de lista (el hueco de la propuesta "audiencia").
      const listOnly = interestScore(product({ price: 34_990, original_price: 59_990, brand: 'Sony' }), evidence({ min30: 32_990 }));
      expect(listOnly.warning).toBe('hace poco estuvo a $32.990');
      expect(listOnly.breakdown.penalties).toBeLessThan(-10);
      // Y con una baja confirmada también.
      const withDrop = interestScore(
        product({ price: 245_990, original_price: 359_990 }),
        evidence({ drop: { pct: 29.7, amount: 104_000 }, min30: 229_990 })
      );
      expect(withDrop.warning).toBe('hace poco estuvo a $229.990');
      expect(withDrop.breakdown.penalties).toBeCloseTo(-15.8, 1);
    });

    it('sin historial no hay con qué comparar: no se castiga ni se afirma', () => {
      const score = interestScore(product(), NO_HISTORY);
      expect(score.warning).toBeNull();
      expect(score.excluded).toBeNull();
      for (const min30 of [NaN, Infinity, 0, -5, undefined] as (number | undefined)[]) {
        const garbage = interestScore(product(), { drop: null, min30: min30 as number, daysTracked: 6 });
        expect(garbage.warning).toBeNull();
        expect(garbage.excluded).toBeNull();
        expect(garbage.points).toBe(clean.points);
      }
    });

    it('lo que no es nuevo se avisa: reacondicionado, usado, caja abierta, segunda selección, seminuevo', () => {
      for (const name of [
        'Ps4 Slim 1 TB 2 controladores + 3 juegos negros - Excelente (Reacondicionado)',
        'Audífonos Sony WH-1000XM4 Refurbished',
        'Audífonos Sony Wh-ch520 Usados',
        'Parlante Jbl Flip 6 Usado En Buen Estado',
        'Audífonos Bose QuietComfort Open Box',
        'Audífonos Sony Caja Abierta',
        'Refrigerador Samsung Segunda Selección',
        'Parlante Jbl Charge 5 Seminuevo',
        'Parlante Jbl Charge 5 Semi Nuevo',
        'Monitor Samsung 24 De Segunda Mano',
      ]) {
        const score = interestScore(product({ name, brand: 'Sony', category: 'audio', price: 300_000, original_price: 430_000 }), evidence());
        expect(score.warning, name).toBe('no es nuevo');
        expect(score.breakdown.penalties, name).toBe(-W.penaltyRefurbished);
      }
      // Un celular o un notebook usados, con sus nombres de verdad.
      const used = (name: string, category: string) =>
        interestScore(product({ name, brand: 'Samsung', category, price: 300_000, original_price: 430_000 }), evidence()).warning;
      expect(used('Celular Samsung Galaxy A15 Usado', 'celulares')).toBe('no es nuevo');
      expect(used('Notebook Lenovo Open Box', 'computacion')).toBe('no es nuevo');
      // Un producto nuevo no lleva el aviso, aunque el nombre hable de su caja o diga "nuevo".
      for (const name of ['Audífonos Sony Wh-ch520 Nuevos Sellados', 'Audífonos Sony Caja Sellada', 'Audífonos Sony Nuevo Modelo 2026']) {
        expect(interestScore(product({ name, brand: 'Sony' }), evidence()).warning, name).toBeNull();
      }
    });

    it('una oferta chica pierde puntos: lo deseable no alcanza sin oferta que mostrar', () => {
      // Los Redmi Buds del catálogo: 12% de lista y una baja de $1.000.
      const buds = interestScore(
        product({
          name: 'Auriculares Xiaomi Redmi Buds 8 Active Bluetooth Color Negro',
          brand: 'Xiaomi',
          price: 18_990,
          original_price: 21_490,
          offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: true, is_lowest: true },
        }),
        evidence({ drop: { pct: 5, amount: 1_000 }, min30: 18_490 })
      );
      expect(buds.breakdown.deal).toBeLessThan(W.weakDealBelow);
      expect(buds.warning).toBe('la oferta es chica');
      expect(buds.breakdown.penalties).toBeCloseTo(-W.penaltyWeakDealPerPoint * (W.weakDealBelow - buds.breakdown.deal), 0);
      // Un 40% de lista dicho por una marca desconocida y un vendedor cualquiera: no es chico, es que nadie lo respalda.
      const unbacked = interestScore(
        product({ ...listed(40), brand: 'Sleve', offer_info: { free_shipping: true, is_lowest: true } }),
        evidence()
      );
      expect(unbacked.warning).toBe('descuento de lista con poco respaldo');
      // Sin descuento ni baja.
      const nothing = interestScore(product({ original_price: null }), evidence());
      expect(nothing.warning).toBe('sin oferta que mostrar');
      expect(nothing.breakdown.penalties).toBe(-W.penaltyWeakDealPerPoint * W.weakDealBelow);
    });

    it('varios castigos se suman y el aviso los dice del más grave al menos grave', () => {
      const score = interestScore(PS5_PRO_SMALL_SELLER, PS5_PRO_EVIDENCE);
      expect(score.warning).toBe('otro vendedor lo ofrece a menos; vendedor con pocas ventas (11)');
      expect(score.breakdown.penalties).toBe(-(W.penaltyNotLowest + W.penaltyFewSales));
      // Con todo en contra, el aviso sigue siendo corto y dice cuántos quedaron sin nombrar.
      const worst = interestScore(
        product({
          name: 'XR5000PRO-2024 Consola Reacondicionada Para Juegos',
          brand: 'Genérica',
          price: 1_234_567,
          original_price: 1_300_000,
          seller_sales_count: 11,
          offer_info: { is_lowest: false, official_store: false, sold_by_ml: false },
        }),
        evidence({ min30: 1_150_000 })
      );
      expect(worst.warning).toMatch(/^hace poco estuvo a \$1\.150\.000; otro vendedor lo ofrece a menos; vendedor con pocas ventas \(11\)/);
      expect(worst.warning).toMatch(/\(y \d más\)$/);
      expect((worst.warning ?? '').length).toBeLessThanOrEqual(120);
    });
  });

  describe('lo que no se publica', () => {
    it('precio 10% o más sobre el mínimo de 30 días: excluido, con los puntos calculados igual', () => {
      const at = (price: number) => interestScore(product({ price, original_price: 200_000 }), evidence({ min30: 100_000 }));
      expect(at(109_900).excluded).toBeNull();
      expect(at(110_000).excluded).toBe('hoy cuesta 10% más de lo que llegó a costar en 30 días ($100.000)');
      expect(at(137_000).excluded).toBe('hoy cuesta 37% más de lo que llegó a costar en 30 días ($100.000)');
      expect(Number.isFinite(at(137_000).points)).toBe(true);
      expect(at(137_000).warning).toContain('hace poco estuvo a $100.000');
    });

    it('el 10% se compara sin redondear: 9,999% arriba todavía se puede publicar', () => {
      const at = (price: number, min30: number) => interestScore(product({ price, original_price: price * 2 }), evidence({ min30 })).excluded;
      expect(at(109_999, 100_000)).toBeNull();
      expect(at(110_000, 100_000)).not.toBeNull();
      // 9,9988% arriba: redondeado a dos decimales daría 10,00.
      expect(at(54_995, 49_996)).toBeNull();
      expect(at(54_996, 49_996)).toBe('hoy cuesta 10% más de lo que llegó a costar en 30 días ($49.996)');
    });

    it('vendedor con pocas ventas y además otro vendedor lo ofrece a menos: no se publica', () => {
      // La PlayStation 5 Pro del catálogo: 47,7 puntos, sobre el piso, y llegaba a las historias el día 6.
      const both = interestScore(PS5_PRO_SMALL_SELLER, PS5_PRO_EVIDENCE);
      expect(both.excluded).toBe('vendedor con pocas ventas y otro vendedor lo ofrece a menos');
      expect(both.points).toBeGreaterThan(MIN_INTEREST_POINTS);
      expect(both.warning).toBe('otro vendedor lo ofrece a menos; vendedor con pocas ventas (11)');
      expect(hasForbiddenWord(both.excluded ?? '')).toBe(false);
      // Ni siquiera un día sin nada más que publicar.
      expect(pickVaried([candidate(PS5_PRO_SMALL_SELLER, PS5_PRO_EVIDENCE)], LIMITS)).toEqual([]);

      // Cada alerta por separado es solo un castigo.
      const info = PS5_PRO_SMALL_SELLER.offer_info;
      expect(interestScore({ ...PS5_PRO_SMALL_SELLER, offer_info: { ...info, is_lowest: true } }, PS5_PRO_EVIDENCE).excluded).toBeNull();
      expect(interestScore({ ...PS5_PRO_SMALL_SELLER, offer_info: { ...info, is_lowest: null } }, PS5_PRO_EVIDENCE).excluded).toBeNull();
      expect(interestScore({ ...PS5_PRO_SMALL_SELLER, seller_sales_count: 100 }, PS5_PRO_EVIDENCE).excluded).toBeNull();
      expect(interestScore({ ...PS5_PRO_SMALL_SELLER, seller_sales_count: null }, PS5_PRO_EVIDENCE).excluded).toBeNull();
      // Una tienda oficial con el contador bajo no es un vendedor con pocas ventas.
      expect(interestScore({ ...PS5_PRO_SMALL_SELLER, offer_info: { ...info, official_store: true } }, PS5_PRO_EVIDENCE).excluded).toBeNull();
      // Si además está caro contra su mínimo, se dice eso, que es lo que el dueño puede comprobar.
      expect(interestScore(PS5_PRO_SMALL_SELLER, { ...PS5_PRO_EVIDENCE, min30: 1_000_000 }).excluded).toBe(
        'hoy cuesta 20% más de lo que llegó a costar en 30 días ($1.000.000)'
      );
    });

    it('precio 0, negativo o que no es un número: excluido y sin puntaje inflado', () => {
      const normal = interestScore(product(), evidence());
      for (const price of [0, -100, NaN, Infinity, undefined as unknown as number]) {
        const score = interestScore(product({ price }), evidence({ drop: { pct: 30, amount: 50_000 }, min30: 50_000 }));
        expect(score.excluded).toBe('sin precio válido');
        expect(Number.isFinite(score.points)).toBe(true);
        expect(score.breakdown.reach).toBe(0);
        expect(score.breakdown.commission).toBe(0);
        expect(score.breakdown.deal).toBe(0);
        expect(score.points).toBeLessThan(normal.points);
        expect(`${score.reason} ${score.warning}`).not.toMatch(/NaN|Infinity|undefined/);
      }
    });

    it('un precio de lista que no sirve no inventa un descuento', () => {
      for (const original_price of [null, 0, -1, NaN, 50_000, 70_000]) {
        const score = interestScore(product({ original_price }), evidence());
        expect(score.breakdown.deal).toBe(0);
        expect(score.reason).toContain('sin descuento ni baja registrada');
      }
    });
  });

  it('aguanta un producto casi sin datos', () => {
    const bare = { id: 'x', name: 'Cosa', brand: null, category: 'hogar', price: 19_990, original_price: null } as InterestProduct;
    const score = interestScore(bare, NO_HISTORY);
    expect(Number.isFinite(score.points)).toBe(true);
    expect(score.breakdown).toEqual({ type: 7, brand: -4, deal: 0, reach: 15, commission: 2.5, delivery: 0, signals: 0, penalties: -9 });
    expect(score.reason).toBe('Producto para la casa, sin descuento ni baja registrada');
    expect(score.warning).toBe('sin oferta que mostrar');
    expect(score.excluded).toBeNull();
    expect(score.typeKey).toBe('hogar');
    expect(score.brandKey).toBe('');

    // Y evidencia rota o ausente.
    const broken = { drop: { pct: 'x', amount: null }, min30: 'y', daysTracked: -4 } as unknown as InterestEvidence;
    expect(interestScore(bare, broken)).toEqual(score);
    expect(interestScore(bare, undefined as unknown as InterestEvidence)).toEqual(score);
    expect(interestScore(bare, {} as InterestEvidence)).toEqual(score);
  });

  it('da lo mismo para la misma entrada', () => {
    expect(interestScore(TCL_TV, TCL_EVIDENCE)).toEqual(interestScore({ ...TCL_TV }, { ...TCL_EVIDENCE }));
  });
});

describe('interestScore: la frase', () => {
  it('dice qué es, de qué marca, las pulgadas y la prueba', () => {
    expect(interestScore(TCL_TV, TCL_EVIDENCE).reason).toBe(
      'Smart TV TCL de 55 pulgadas, bajó 37% según nuestro historial ($183.859 menos) y está 37% por debajo del precio de lista'
    );
    expect(interestScore(USUAL_PICKS[0][0], USUAL_PICKS[0][1]).reason).toBe(
      'Celular Motorola, 45% por debajo del precio de lista, llega con Full y envío gratis, lo vende Mercado Libre'
    );
  });

  it('el monto de la baja se dice solo desde $5.000', () => {
    const reasonWith = (amount: number) =>
      interestScore(product({ original_price: null }), evidence({ drop: { pct: 12, amount }, min30: 70_000 })).reason;
    expect(reasonWith(4_999)).toBe('Audífonos JBL, bajó 12% según nuestro historial, con envío gratis, de tienda oficial');
    expect(reasonWith(5_000)).toBe('Audífonos JBL, bajó 12% según nuestro historial ($5.000 menos), con envío gratis, de tienda oficial');
  });

  it('va primero la prueba que más pesa', () => {
    // Una baja de pocos pesos junto a un buen descuento de lista: manda la lista.
    const listFirst = interestScore(product({ ...listed(40) }), evidence({ drop: { pct: 3, amount: 1_800 }, min30: 60_000 })).reason;
    expect(listFirst).toBe(
      'Audífonos JBL, 40% por debajo del precio de lista y bajó 3% según nuestro historial, con envío gratis, de tienda oficial'
    );
    // Una baja grande: manda la baja.
    const dropFirst = interestScore(product({ ...listed(20) }), evidence({ drop: { pct: 25, amount: 26_000 }, min30: 80_000 })).reason;
    expect(dropFirst.startsWith('Audífonos JBL, bajó 25% según nuestro historial ($26.000 menos) y está 20% por debajo del precio de lista')).toBe(
      true
    );
  });

  it('dice "por debajo del", nunca "bajo el" (sin el acento se lee "bajó")', () => {
    for (const pct of [12, 25, 40, 55, 70]) {
      const reason = interestScore(product(listed(pct)), evidence()).reason;
      expect(reason).toContain(`${pct}% por debajo del precio de lista`);
      expect(reason).not.toMatch(/bajo el|bajo su/);
    }
  });

  it('si no vende una tienda oficial ni Mercado Libre, la cifra es del vendedor ya desde 40%', () => {
    const other = { ...product().offer_info, official_store: false, sold_by_ml: false };
    const reason = (pct: number, offer_info: InterestProduct['offer_info']) =>
      interestScore(product({ ...listed(pct), offer_info }), evidence()).reason;
    expect(reason(39, other)).not.toContain('cifra del vendedor');
    expect(reason(40, other)).toContain('40% por debajo del precio de lista (cifra del vendedor)');
    expect(reason(45, other)).toContain('45% por debajo del precio de lista (cifra del vendedor)');
    // Tienda oficial o Mercado Libre: recién desde 50%.
    expect(reason(45, { ...other, official_store: true })).not.toContain('cifra del vendedor');
    expect(reason(45, { ...other, sold_by_ml: true })).not.toContain('cifra del vendedor');
  });

  it('desde 50% de lista aclara que la cifra es del vendedor, también cuando la baja va primero', () => {
    expect(interestScore(product(listed(49)), evidence()).reason).not.toContain('cifra del vendedor');
    expect(interestScore(product(listed(50)), evidence()).reason).toContain('50% por debajo del precio de lista (cifra del vendedor)');
    expect(interestScore(product(listed(73)), evidence()).reason).toContain('73% por debajo del precio de lista (cifra del vendedor)');
    // Con la baja primero: o la lista sale con su aclaración, o no sale.
    for (const amount of [1_000, 6_000, 120_000]) {
      for (const daysTracked of [0, 6]) {
        const reason = interestScore(product(listed(65)), { drop: { pct: 12, amount }, min30: 35_000, daysTracked }).reason;
        if (reason.includes('precio de lista')) expect(reason).toContain('65% por debajo del precio de lista (cifra del vendedor)');
      }
    }
  });

  it('dice "llega con Full" y "con envío gratis"', () => {
    const reasonWith = (free_shipping: boolean, is_full: boolean) =>
      interestScore(product({ offer_info: { free_shipping, is_full, is_lowest: true } }), evidence()).reason;
    expect(reasonWith(true, false)).toBe('Audífonos JBL, 30% por debajo del precio de lista, con envío gratis');
    expect(reasonWith(false, true)).toBe('Audífonos JBL, 30% por debajo del precio de lista, llega con Full');
    expect(reasonWith(true, true)).toBe('Audífonos JBL, 30% por debajo del precio de lista, llega con Full y envío gratis');
    expect(reasonWith(false, false)).toBe('Audífonos JBL, 30% por debajo del precio de lista');
  });

  it('dice a lo más dos razones extra, aunque haya más que contar', () => {
    // Clics, envío gratis y tienda oficial: la tercera no se dice.
    const radio = interestScore(
      product({
        name: 'Radio Portátil AM FM Recargable',
        brand: 'Genérica',
        category: 'electronica',
        price: 70_000,
        original_price: 100_000,
        offer_info: { free_shipping: true, official_store: true, is_lowest: true },
      }),
      evidence({ recentClicks: 14 })
    );
    expect(radio.reason).toBe('Radio, 30% por debajo del precio de lista, lleva 14 clics recientes en el sitio, con envío gratis');
    expect(radio.reason.length).toBeLessThan(100);
    expect(radio.reason).not.toContain('tienda oficial');
  });

  it('una consola se nombra por su plataforma: "Consola PlayStation", no "Consola Sony"', () => {
    const ps5 = interestScore(PS5_HERO, PS5_HERO_EVIDENCE);
    expect(ps5.reason).toBe('Consola PlayStation, bajó 10% según nuestro historial ($60.000 menos), con envío gratis, de tienda oficial');
    expect(ps5.reason).not.toContain('Sony');
    expect(ps5.brandKey).toBe('playstation');
    const nintendo = interestScore(
      product({ name: 'Consola Nintendo Switch 2', brand: 'Nintendo', category: 'gaming', price: 530_762, original_price: 600_000 }),
      evidence()
    );
    expect(nintendo.reason.startsWith('Consola Nintendo,')).toBe(true);
    const xbox = interestScore(
      product({ name: 'Consola Xbox Series S 512GB', brand: 'Microsoft', category: 'gaming', price: 349_990, original_price: 399_990 }),
      evidence()
    );
    expect(xbox.reason.startsWith('Consola Xbox,')).toBe(true);
    // Unos audífonos Sony siguen siendo Sony.
    expect(interestScore(product({ name: 'Audífonos Inalámbricos Sony Wh-ch520', brand: 'Sony' }), evidence()).brandKey).toBe('sony');
  });

  it('conserva la marca aunque no sea de las conocidas', () => {
    const caixun = interestScore(
      product({ name: 'Smart TV LED Xyzon Roku TV 43" Full HD C43V1FR', brand: 'Xyzon', category: 'electronica' }),
      evidence()
    );
    expect(caixun.reason.startsWith('Smart TV Xyzon de 43 pulgadas,')).toBe(true);
    // Sin marca no se inventa una.
    const generic = interestScore(product({ name: 'Proyector mini 800lm cyber yellow', brand: 'Genérica', category: 'electronica' }), evidence());
    expect(generic.reason.startsWith('Proyector,')).toBe(true);
  });

  it('cuando usa una baja con menos de dos días de historial, lo dice', () => {
    const drop = { pct: 36.5, amount: 23_000 };
    const short = interestScore(product({ original_price: null }), { drop, min30: 70_000, daysTracked: 1 }).reason;
    expect(short).toContain('bajó 37% según nuestro historial ($23.000 menos), pero lo seguimos hace menos de dos días');
    expect(interestScore(product({ original_price: null }), { drop, min30: 70_000, daysTracked: 0 }).reason).toContain(
      'pero lo seguimos hace menos de dos días'
    );
    expect(interestScore(product({ original_price: null }), { drop, min30: 70_000, daysTracked: 2 }).reason).not.toContain('lo seguimos');
    // Sin baja no hay nada que aclarar.
    expect(interestScore(product(), NO_HISTORY).reason).not.toContain('lo seguimos');
    // Si la baja se nombra en segundo lugar, también lleva la aclaración.
    const second = interestScore(product(listed(40)), { drop: { pct: 4, amount: 2_000 }, min30: 60_000, daysTracked: 0 }).reason;
    if (second.includes('bajó')) expect(second).toContain('pero lo seguimos hace menos de dos días');
  });

  it('las pulgadas se dicen solo si están en el nombre', () => {
    const reasonOf = (name: string, category = 'electronica') => interestScore(product({ name, brand: 'Samsung', category }), evidence()).reason;
    expect(reasonOf('43\'\' UHD U8000H Vision AI Smart TV (2026)')).toContain('Smart TV Samsung de 43 pulgadas');
    expect(reasonOf('Samsung Un55u8000h Smart Tv 100-240 V 55in Procesador Crystal')).toContain('de 55 pulgadas');
    expect(reasonOf('Smart TV 50 Samsung Full HD QLED')).toContain('de 50 pulgadas');
    expect(reasonOf('22 Essential Monitor S30gd 100hz Plano Fhd Negro 22', 'computacion')).toContain('Monitor Samsung de 22 pulgadas');
    expect(reasonOf('Smart TV Samsung Crystal UHD 4K')).not.toContain('pulgadas');
    // Las pulgadas de la pantalla de un reloj no se dicen.
    expect(reasonOf('Smartwatch Samsung Galaxy Watch con pantalla de 44 pulgadas')).not.toContain('pulgadas');
  });

  it('no inventa pulgadas: ni los decimales, ni los Hz, ni los meses de garantía', () => {
    const reasonOf = (name: string, category: string) =>
      interestScore(product({ name, brand: 'Samsung', category, price: 150_000, original_price: 215_000 }), evidence()).reason;
    // Con decimales se lee el número entero, no lo que viene después de la coma.
    expect(reasonOf('Monitor Xiaomi A22i 21.45" FHD 75Hz', 'computacion')).toContain('Monitor Samsung de 21 pulgadas');
    expect(reasonOf('Monitor Lenovo L22e-40 21,45" Full HD', 'computacion')).toContain('de 21 pulgadas');
    expect(reasonOf('Monitor Samsung 23.80" IPS', 'computacion')).toContain('de 24 pulgadas');
    expect(reasonOf('Monitor Samsung Led 23.8 Ips Full Hd', 'computacion')).toContain('de 24 pulgadas');
    expect(reasonOf('Monitor Gamer Curvo 31,5 Pulgadas 165hz', 'computacion')).toContain('de 32 pulgadas');
    // Un número seguido de otra unidad no son pulgadas.
    for (const [name, category] of [
      ['Monitor LED 75 Hz Full HD VGA HDMI', 'computacion'],
      ['Smart TV Led 60 Hz Hisense 43A4N', 'electronica'],
      ['24 Meses Garantía Monitor Aoc', 'computacion'],
      ['Smart TV 120 Hz Gaming Vrr Hdmi 2.1', 'electronica'],
      ['Monitor Led 24 W Bajo Consumo', 'computacion'],
      // 7,25 pulgadas no son 25.
      ['Monitor Táctil Hdmi 7.25 Pulgadas Raspberry', 'computacion'],
    ]) {
      expect(reasonOf(name, category), name).not.toContain('pulgadas');
    }
    // Y lo de siempre sigue saliendo.
    expect(reasonOf('Smart TV Led 32 Google Tv Hd', 'electronica')).toContain('de 32 pulgadas');
    expect(reasonOf('24 Meses Garantía Monitor Aoc 27"', 'computacion')).toContain('de 27 pulgadas');
  });

  it('cabe en unos 120 caracteres aunque la marca o el tipo sean largos', () => {
    const long = interestScore(
      product({
        name: 'Unidad Lector de discos consola Ps5 Slim 55" edición especial',
        brand: 'Sony Interactive Entertainment',
        category: 'gaming',
        ...listed(65),
        offer_info: { free_shipping: true, is_full: true, official_store: true, sold_by_ml: true, is_lowest: true },
      }),
      { drop: { pct: 38.4, amount: 1_183_859 }, min30: 35_000, daysTracked: 0, mlPosition: 12, recentClicks: 40 }
    );
    expect(long.reason.length).toBeLessThanOrEqual(120);
    expect(long.reason).toContain('bajó 38% según nuestro historial');
    expect(long.reason).toContain('pero lo seguimos hace menos de dos días');
    // Una marca desconocida y larguísima no se escribe.
    const endless = interestScore(product({ brand: 'Distribuidora Importadora Tecnológica Limitada', name: 'Audífonos Bluetooth Over Ear' }), evidence());
    expect(endless.reason.startsWith('Audífonos,')).toBe(true);
  });

  it('nunca menciona la comisión', () => {
    for (const [p, ev] of USUAL_PICKS) {
      expect(interestScore(p, ev).reason.toLowerCase()).not.toMatch(/comisi|deja \$/);
    }
  });
});

describe('las palabras que el sitio no usa', () => {
  // La lista del sitio, con sus tildes, revisada acá por separado del módulo.
  const BANNED = [
    'mejor precio',
    'el más barato',
    'imperdible',
    'ofertón',
    'solo hoy',
    'últimas unidades',
    'antes',
    'rebajado',
    'precio normal',
    'ahorra',
    'recomendado',
    'Publicidad',
  ];
  const plain = (text: string) => stripDiacritics(text).toLowerCase();
  const hasBanned = (text: string) =>
    BANNED.some((word) => new RegExp(`(^|[^a-z0-9])${plain(word)}([^a-z0-9]|$)`).test(plain(text)));

  // Productos como los del catálogo: de todo tipo, con datos buenos, malos y vacíos.
  const REALISTIC: InterestProduct[] = [
    TCL_TV,
    PS5_PRO_SMALL_SELLER,
    PS5_HERO,
    ...USUAL_PICKS.map(([p]) => p),
    product({ name: '55" Mini LED M70H 4K Samsung Vision AI Smart TV (2026)', brand: 'Samsung', category: 'electronica', price: 349_990, original_price: 624_990 }),
    product({ name: 'FA607NUQ-RL060W AMD Ryzen 7 170C 16GB 512GB 16" 4050 RTX', brand: 'Asus', category: 'computacion', price: 1_044_990, original_price: 1_979_990 }),
    product({ name: 'Horno Xl Rotisserie Oster, 60 L, Manual, Gris, Tssttv60mns', brand: 'Oster', category: 'electrodomesticos', price: 87_990, original_price: 249_990 }),
    product({ name: 'Lámpara De Emergencia Led 2 Focos 18 Leds Recargable Blanco', brand: 'Genérica', category: 'hogar', price: 6_990, original_price: 17_990, seller_sales_count: 37 }),
    product({ name: 'Funda Transparent+ Mica Kindle Paperwhite 2024 12va Gen 7pul', brand: 'Compatible con Kindle', category: 'electronica', price: 9_990, original_price: 12_990 }),
    product({ name: 'Smart TV iFFALCON Roku TV 32" FHD S45AR', brand: 'iFFALCON', category: 'electronica', price: 119_990, original_price: 179_990 }),
    product({ name: 'Audífonos Inalámbricos Redragon Zeus Pro Gamer 7.1 Sonido Envolvente', brand: 'ZEUS X WIRELESS', price: 49_990, original_price: 69_990 }),
    product({ name: 'Cocina A Gas 4 Platos Limpiafácil Y Tapa Vidrio Fm4lp Negra', brand: 'Mademsa', category: 'electrodomesticos', price: 199_990, original_price: 249_990, offer_info: { is_lowest: false, official_store: true } }),
    product({ name: 'Ps4 Slim 1 TB 2 controladores + 3 juegos negros - Excelente (Reacondicionado)', brand: 'Sony', category: 'gaming', price: 284_990, original_price: 299_990 }),
    product({ name: 'Kingston ValueRAM KVR32S22S8/8 Memoria RAM color verde 8GB', brand: 'Kingston', category: 'computacion', price: 59_990, original_price: null, seller_sales_count: 773, offer_info: null }),
    product({ name: 'Xiaomi Sound Party - Negro', brand: 'Xiaomi', price: 129_990, original_price: null, offer_info: undefined, seller_sales_count: undefined }),
    product({ name: 'Cosa', brand: null, category: 'hogar', price: 0, original_price: null }),
    // Los casos de los arreglos: accesorio con nombre de aparato, marca solo "para", vendedor chico, usado.
    product({ name: 'Estuche Rigido Consola Nintendo Switch Oled', brand: 'Nintendo', category: 'gaming', price: 14_990, original_price: 24_990 }),
    product({ name: 'Consola Nintendo Switch Oled Grip Silicona', brand: 'Nintendo', category: 'gaming', price: 9_990, original_price: 19_990 }),
    product({ name: 'Cargador Original Ultra Fast 45w Para Samsung USB-C', brand: 'Samsung', category: 'electronica', price: 7_990, original_price: 19_990, seller_sales_count: 2_793, offer_info: { is_lowest: true } }),
    product({ name: 'Parlante Jbl Chargue 6 Color Blanco', price: 133_868, original_price: 239_051, seller_sales_count: 192, offer_info: { free_shipping: true, is_full: true, is_lowest: true } }),
    product({ name: 'Celular Samsung Galaxy A15 Usado', brand: 'Samsung', category: 'celulares', price: 89_990, original_price: 129_990, seller_sales_count: 12, offer_info: { is_lowest: false } }),
    // Nombres y marcas que traen justo las palabras que el sitio no usa.
    product({ name: 'Audífonos Antes Pro Recomendado', brand: 'Antes' }),
    product({ name: 'Parlante Imperdible Solo Hoy', brand: 'Imperdible' }),
    product({ name: 'Smart TV Ahorra 50" Precio Normal', brand: 'Ahorra', category: 'electronica' }),
    product({ name: 'Monitor Publicidad 24" Rebajado', brand: 'PUBLICIDAD', category: 'computacion' }),
    product({ name: 'Cámara De Seguridad Mejor Precio', brand: 'Mejor Precio', category: 'electronica' }),
  ];
  const EVIDENCES: InterestEvidence[] = [
    NO_HISTORY,
    evidence(),
    evidence({ drop: { pct: 36.8, amount: 183_859 } }),
    evidence({ drop: { pct: 5, amount: 1_000 }, daysTracked: 0 }),
    evidence({ drop: { pct: 12, amount: 12_000 }, daysTracked: 1, mlPosition: 2, recentClicks: 14 }),
    evidence({ mlPosition: 18, recentClicks: 3 }),
    evidence({ mlPosition: 2.5, recentClicks: Infinity }),
    evidence({ mlPosition: -3, recentClicks: NaN }),
  ];
  /** El mínimo de 30 días un poco, bastante y mucho más abajo que el precio de hoy. */
  const MIN_RATIOS = [null, 1, 0.96, 0.92, 0.7];

  it('nunca aparecen en la frase, en el aviso ni en el motivo de exclusión, y ninguno pasa de 120 caracteres', () => {
    let checked = 0;
    const exclusions = new Set<string>();
    for (const p of REALISTIC) {
      for (const ev of EVIDENCES) {
        for (const ratio of MIN_RATIOS) {
          const score = interestScore(p, { ...ev, min30: ratio === null ? null : Math.round(p.price * ratio) });
          for (const text of [score.reason, score.warning ?? '', score.excluded ?? '']) {
            expect(hasBanned(text), text).toBe(false);
            expect(hasForbiddenWord(text), text).toBe(false);
            expect(text.length, text).toBeLessThanOrEqual(120);
            expect(text, text).not.toMatch(/NaN|Infinity|undefined|null|e\+\d|\$-|-\$/);
          }
          expect(score.reason.length).toBeGreaterThan(10);
          expect(Number.isFinite(score.points)).toBe(true);
          // El desglose suma los puntos, también en los casos raros.
          const sum = Object.keys(score.breakdown).reduce((total, key) => total + score.breakdown[key], 0);
          expect(score.points).toBeCloseTo(sum, 6);
          if (score.excluded) exclusions.add(score.excluded.replace(/\d+% más|\$[\d.]+/g, 'N'));
          checked++;
        }
      }
    }
    expect(checked).toBe(REALISTIC.length * EVIDENCES.length * MIN_RATIOS.length);
    // Pasaron por acá los tres motivos por los que algo no se publica.
    expect([...exclusions].sort()).toEqual([
      'hoy cuesta N de lo que llegó a costar en 30 días (N)',
      'sin precio válido',
      'vendedor con pocas ventas y otro vendedor lo ofrece a menos',
    ]);
    // Recorre miles de combinaciones: con la máquina ocupada pasa de los 5 segundos de siempre.
  }, 30_000);

  it('si la marca trae una de esas palabras, la frase sale sin la marca', () => {
    const score = interestScore(product({ name: 'Audífonos Bluetooth Over Ear', brand: 'Antes' }), evidence());
    expect(score.reason).toBe('Audífonos, 30% por debajo del precio de lista, con envío gratis, de tienda oficial');
    // Como parte de otra palabra no es la palabra: "Guantes" no es "antes".
    const gloves = interestScore(product({ name: 'Audífonos Bluetooth Over Ear', brand: 'Guantes' }), evidence());
    expect(gloves.reason.startsWith('Audífonos Guantes,')).toBe(true);
  });

  it('hasForbiddenWord compara palabra por palabra, sin importar tildes ni mayúsculas', () => {
    for (const word of BANNED) {
      expect(hasForbiddenWord(`Esto es ${word}, dicen`)).toBe(true);
      expect(hasForbiddenWord(word.toUpperCase())).toBe(true);
    }
    expect(hasForbiddenWord('OFERTON de la semana')).toBe(true);
    expect(hasForbiddenWord('Sólo hoy')).toBe(true);
    for (const fine of ['Guantes brillantes', 'por debajo del precio de lista', 'hace poco estuvo a $100.000', 'bajó 37% según nuestro historial']) {
      expect(hasForbiddenWord(fine)).toBe(false);
    }
    // La lista del módulo es la misma que la del sitio.
    expect([...FORBIDDEN_WORDS].sort()).toEqual(BANNED.map(plain).sort());
  });
});

describe('compareByInterest: el orden', () => {
  it('ordena por puntos, después por comisión y después por id', () => {
    const list = [
      scored('c', 50, { commission: 100 }),
      scored('b', 60, { commission: 100 }),
      scored('a', 60, { commission: 100 }),
      scored('d', 60, { commission: 900 }),
      scored('e', 70, { commission: 1 }),
    ];
    expect(ids([...list].sort(compareByInterest))).toEqual(['e', 'd', 'a', 'b', 'c']);
    expect(compareByInterest(list[0], list[0])).toBe(0);
  });
});

describe('pickVaried: qué se publica', () => {
  it('toma los de más puntos, en orden de puntos', () => {
    const list = [scored('a', 50), scored('b', 80), scored('c', 65), scored('d', 72)];
    expect(ids(pickVaried(list, { ...LIMITS, max: 3, perCategory: 9 }))).toEqual(['b', 'd', 'c']);
  });

  it('deja fuera los excluidos y los que no llegan al piso', () => {
    const list = [
      scored('caro', 90, { excluded: 'hoy cuesta 37% más de lo que llegó a costar en 30 días ($189.990)' }),
      scored('bueno', 70),
      scored('justo', MIN_INTEREST_POINTS),
      scored('fondo', MIN_INTEREST_POINTS - 0.1),
      scored('roto', NaN),
    ];
    expect(ids(pickVaried(list, { ...LIMITS, perCategory: 9 }))).toEqual(['bueno', 'justo']);
    // El piso se puede cambiar, pero los excluidos no entran nunca.
    expect(ids(pickVaried(list, { ...LIMITS, perCategory: 9, minPoints: 0 }))).toEqual(['bueno', 'justo', 'fondo']);
    expect(ids(pickVaried(list, { ...LIMITS, perCategory: 9, minPoints: 75 }))).toEqual([]);
  });

  it('el piso existe y deja fuera el fondo de la lista', () => {
    expect(MIN_INTEREST_POINTS).toBeGreaterThanOrEqual(30);
    expect(MIN_INTEREST_POINTS).toBeLessThanOrEqual(50);
    // Una lámpara genérica con un descuento que nadie respalda queda bajo el piso; una oferta corriente de marca, sobre él.
    const lamp = interestScore(
      product({ name: 'Lámpara De Emergencia Led 2 Focos 18 Leds', brand: 'Genérica', category: 'hogar', price: 6_990, original_price: 17_990, offer_info: { is_lowest: true } }),
      evidence()
    );
    expect(lamp.points).toBeLessThan(MIN_INTEREST_POINTS);
    expect(interestScore(product(), evidence()).points).toBeGreaterThan(MIN_INTEREST_POINTS);
  });

  it('a lo más perCategory por categoría del sitio', () => {
    const list = [
      scored('a1', 90),
      scored('a2', 85),
      scored('a3', 80),
      scored('g1', 70, { category: 'gaming' }),
      scored('g2', 60, { category: 'gaming' }),
      scored('g3', 55, { category: 'gaming' }),
    ];
    expect(ids(pickVaried(list, LIMITS))).toEqual(['a1', 'a2', 'g1', 'g2']);
    expect(ids(pickVaried(list, { ...LIMITS, perCategory: 1 }))).toEqual(['a1', 'g1']);
  });

  it('a lo más perType por tipo y perBrand por marca', () => {
    const list = [
      scored('tv1', 90, { category: 'electronica', type: 'Smart TV', brand: 'samsung' }),
      scored('tv2', 88, { category: 'electronica', type: 'Smart TV', brand: 'lg' }),
      scored('fon1', 80, { type: 'Audífonos', brand: 'jbl' }),
      scored('par1', 78, { type: 'Parlante', brand: 'jbl' }),
      scored('bar1', 76, { category: 'electronica', type: 'Barra de sonido', brand: 'jbl' }),
      scored('cel1', 70, { category: 'celulares', type: 'Celular', brand: 'samsung' }),
      scored('rel1', 60, { category: 'celulares', type: 'Reloj inteligente', brand: 'samsung' }),
    ];
    // tv2 repite tipo, bar1 sería el tercer JBL y rel1 el tercer Samsung.
    expect(ids(pickVaried(list, { max: 4, perCategory: 2, perType: 1, perBrand: 2 }))).toEqual(['tv1', 'fon1', 'par1', 'cel1']);
    // Con una por marca (Telegram) tampoco entra el segundo JBL ni el segundo Samsung.
    expect(ids(pickVaried(list, { max: 2, perCategory: 2, perType: 1, perBrand: 1 }))).toEqual(['tv1', 'fon1']);
    expect(ids(pickVaried([...list, scored('not1', 50, { category: 'computacion', type: 'Notebook', brand: 'acer' })], { max: 3, perCategory: 2, perType: 1, perBrand: 1 }))).toEqual(
      ['tv1', 'fon1', 'not1']
    );
  });

  it('uno solo por familia: dos colores del mismo modelo son el mismo post', () => {
    const list = [
      scored('negro', 80, { familyId: 'F1' }),
      scored('blanco', 79, { familyId: 'F1' }),
      scored('otro', 60, { category: 'gaming', familyId: 'F2' }),
      scored('suelto1', 50, { category: 'gaming', familyId: null }),
      scored('suelto2', 45, { category: 'hogar', familyId: null }),
    ];
    expect(ids(pickVaried(list, LIMITS))).toEqual(['negro', 'otro', 'suelto1', 'suelto2']);
  });

  it('los productos sin marca no se limitan entre sí', () => {
    const list = [
      scored('a', 80, { brand: '', category: 'hogar' }),
      scored('b', 70, { brand: '', category: 'audio' }),
      scored('c', 60, { brand: '', category: 'gaming' }),
    ];
    expect(ids(pickVaried(list, { ...LIMITS, perBrand: 1 }))).toEqual(['a', 'b', 'c']);
    // Sin cupo para todos se nota: si "sin marca" contara como una marca, el segundo cedería su lugar al tercero.
    const tight = [scored('a', 80, { brand: '' }), scored('b', 70, { brand: '' }), scored('z', 60, { brand: 'x' })];
    expect(ids(pickVaried(tight, { max: 2, perCategory: 2, perType: 1, perBrand: 1 }))).toEqual(['a', 'b']);
  });

  it('si faltan, la segunda vuelta deja repetir tipo y marca', () => {
    const list = [
      scored('tv1', 90, { category: 'electronica', type: 'Smart TV', brand: 'samsung' }),
      scored('tv2', 85, { category: 'electronica', type: 'Smart TV', brand: 'samsung' }),
      scored('fon1', 80, { type: 'Audífonos', brand: 'samsung' }),
      scored('fon2', 75, { type: 'Audífonos', brand: 'samsung' }),
    ];
    // Primera vuelta: tv1 y fon1 (tv2 y fon2 repiten tipo). Faltan dos: entran en la segunda.
    const picks = pickVaried(list, { max: 4, perCategory: 2, perType: 1, perBrand: 2 });
    expect(ids(picks)).toEqual(['tv1', 'tv2', 'fon1', 'fon2']);
    // Si no hace falta, no se relaja nada.
    expect(ids(pickVaried(list, { max: 2, perCategory: 2, perType: 1, perBrand: 2 }))).toEqual(['tv1', 'fon1']);
  });

  it('la segunda vuelta no suelta la categoría, la familia, los excluidos ni el piso', () => {
    const list = [
      scored('a1', 90, { type: 'Audífonos', brand: 'jbl', familyId: 'F1' }),
      scored('a2', 85, { type: 'Audífonos', brand: 'jbl', familyId: 'F1' }),
      scored('a3', 80, { type: 'Audífonos', brand: 'jbl' }),
      scored('a4', 75, { type: 'Audífonos', brand: 'jbl' }),
      scored('x1', 95, { category: 'gaming', excluded: 'sin precio válido' }),
      scored('x2', 20, { category: 'hogar' }),
    ];
    // a2 es de la misma familia que a1; a4 sería el tercero de la categoría; x1 está excluido; x2 no llega al piso.
    expect(ids(pickVaried(list, LIMITS))).toEqual(['a1', 'a3']);
  });

  it('el resultado va en orden de puntos aunque algo entre en la segunda vuelta', () => {
    const list = [
      scored('tv1', 90, { category: 'electronica', type: 'Smart TV' }),
      scored('tv2', 85, { category: 'electronica', type: 'Smart TV' }),
      scored('fon1', 60, { type: 'Audífonos' }),
    ];
    const picks = pickVaried(list, { max: 3, perCategory: 2, perType: 1, perBrand: 2 });
    expect(ids(picks)).toEqual(['tv1', 'tv2', 'fon1']);
    expect(picks.map((c) => c.score.points)).toEqual([90, 85, 60]);
  });

  it('no depende del orden de entrada', () => {
    const real = [
      candidate(TCL_TV, TCL_EVIDENCE),
      candidate(PS5_HERO, PS5_HERO_EVIDENCE),
      candidate(PS5_PRO_SMALL_SELLER, PS5_PRO_EVIDENCE),
      ...USUAL_PICKS.map(([p, ev]) => candidate(p, ev)),
    ];
    // Empates de puntos y de comisión, para que decida el id.
    const ties = ['m', 'c', 'x', 'a', 'k', 'f'].map((id, i) => scored(id, 61.5, { category: `cat-${i % 3}`, commission: 500 }));
    const list = [...real, ...ties];
    const expected = ids(pickVaried(list, LIMITS));
    expect(expected).toHaveLength(8);
    for (let seed = 1; seed <= 25; seed++) {
      expect(ids(pickVaried(shuffled(list, seed), LIMITS))).toEqual(expected);
      expect(ids(pickVaried(shuffled(list, seed), { ...LIMITS, max: 5, perBrand: 1 }))).toEqual(
        ids(pickVaried(list, { ...LIMITS, max: 5, perBrand: 1 }))
      );
    }
    // Entre empatados gana el id menor.
    const tied = pickVaried(shuffled(ties, 7), { ...LIMITS, perCategory: 9 });
    expect(ids(tied)).toEqual(['a', 'c', 'f', 'k', 'm', 'x']);
  });

  it('no muta la entrada, no repite un producto y aguanta listas vacías o topes en cero', () => {
    const list = [scored('b', 60), scored('a', 70), scored('a', 70)];
    const before = ids(list);
    expect(ids(pickVaried(list, { ...LIMITS, perCategory: 9 }))).toEqual(['a', 'b']);
    expect(ids(list)).toEqual(before);
    expect(pickVaried([], LIMITS)).toEqual([]);
    expect(pickVaried(list, { ...LIMITS, max: 0 })).toEqual([]);
    expect(pickVaried(list, { ...LIMITS, perCategory: 0 })).toEqual([]);
  });

  it('con productos de verdad: variado, sin excluidos y con el héroe', () => {
    const tooHigh = candidate(
      product({ name: '43\'\' UHD U8000H Vision AI Smart TV (2026)', brand: 'Samsung', category: 'electronica', price: 259_626, original_price: 369_990 }),
      evidence({ min30: 189_990 })
    );
    expect(tooHigh.score.excluded).toBe('hoy cuesta 37% más de lo que llegó a costar en 30 días ($189.990)');
    const list = [
      tooHigh,
      candidate(TCL_TV, TCL_EVIDENCE),
      candidate(PS5_HERO, PS5_HERO_EVIDENCE),
      ...USUAL_PICKS.map(([p, ev]) => candidate(p, ev)),
    ];
    const picks = pickVaried(list, LIMITS);
    expect(picks).toHaveLength(8);
    expect(picks[0].id).toBe(TCL_TV.id);
    expect(ids(picks)).not.toContain(tooHigh.id);
    // Un tipo por historia y a lo más dos por categoría y por marca.
    const count = (keys: string[]) => Math.max(...keys.map((k) => keys.filter((other) => other === k).length));
    expect(count(picks.map((c) => c.score.typeKey))).toBe(1);
    expect(count(picks.map((c) => c.category))).toBeLessThanOrEqual(2);
    expect(count(picks.map((c) => c.score.brandKey))).toBeLessThanOrEqual(2);
    // Telegram: una por marca.
    const telegram = pickVaried(list, { max: 5, perCategory: 2, perType: 1, perBrand: 1 });
    expect(telegram).toHaveLength(5);
    expect(count(telegram.map((c) => c.score.brandKey))).toBe(1);
  });
});
