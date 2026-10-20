import { describe, expect, it } from 'vitest';
import {
  GUIDES,
  GUIDE_MIN_POINTS,
  buildGuide,
  fitsSection,
  getGuide,
  guideCandidates,
  guidePath,
  hasDedicatedGpu,
  historyBlocker,
  memoryBlocker,
  memoryOf,
  sectionRange,
  sectionSummary,
  staticBlocker,
  type GuideDef,
} from '@/lib/guides';
import { PLACEMENTS, placementFromPath } from '@/lib/clicks';
import { isTypeSlug, typeSlug } from '@/lib/product-types';
import { SEO_TITLE_MAX } from '@/lib/seo-title';
import { priceStats, type PricePoint, type PriceStats } from '@/lib/deals';
import { interestEvidence } from '@/lib/social/evidence';
import { floorPoints, interestScore } from '@/lib/social/interest';
import type { Product } from '@/lib/types';

const NOW = Date.parse('2026-12-01T15:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

let seq = 0;
function product(over: Partial<Product> = {}): Product {
  seq++;
  return {
    id: `id-${String(seq).padStart(4, '0')}`,
    slug: `producto-${seq}`,
    name: `Audífonos Bluetooth Sony WH-CH520 Color ${seq}`,
    brand: 'Sony',
    category: 'audio',
    price: 39_990,
    original_price: 49_990,
    image_url: `https://http2.mlstatic.com/D_NQ_NP_${seq}-F.webp`,
    affiliate_url: 'https://meli.la/abc',
    description: '',
    specs: {},
    seller_reputation: 'verde',
    seller_sales_count: 5_000,
    is_featured: false,
    is_active: true,
    is_hidden: false,
    ml_product_id: `MLC${seq}`,
    ml_domain_id: 'MLC-HEADPHONES',
    ml_family_id: `FAM${seq}`,
    seller_id: 1,
    rrss_status: 'sin_usar',
    created_at: ago(40 * DAY),
    inactive_reason: null,
    inactive_since: null,
    price_checked_at: ago(10 * 60_000),
    winner_item_id: null,
    link_target_product_id: null,
    link_checked_at: null,
    offer_info: {
      free_shipping: true,
      is_full: true,
      sold_by_ml: false,
      official_store: false,
      warranty: 'Garantía de fábrica: 12 meses',
      offers_count: 1,
      is_lowest: true,
    },
    ...over,
  };
}

/** Un precio que no cambia desde hace 40 días. */
function quiet(p: Product): PriceStats {
  return priceStats([{ price: p.price, observed_at: p.created_at }], NOW)!;
}

function statsFor(products: Product[], history: Record<string, PricePoint[]> = {}): Map<string, PriceStats> {
  return new Map(products.map((p) => [p.id, history[p.id] ? priceStats(history[p.id], NOW)! : quiet(p)]));
}

const regalos = getGuide('regalos-tecnologicos')!;
const notebooks = getGuide('notebook-para-la-universidad')!;
/** Una guía de una sola sección para probar la variedad sin depender de los montos de verdad. */
const oneSection: GuideDef = {
  ...regalos,
  sections: [{ id: 'todo', title: 'Todo', above: 0, upTo: 1_000_000, types: ['Audífonos', 'Parlantes', 'Smartwatch', 'Juegos', 'Controles'], size: 8 }],
  variety: { perType: 2, perBrand: 2 },
};

/** Lo que el sitio no dice nunca (CLAUDE.md, voz de marca). */
const AVOIDED =
  /precio de lista|recomendad|verificad|mejor|m[aá]s barat|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebaj|precio normal|comisi[oó]n|publicidad|probad|revisad|elegid/i;

describe('la lista de guías', () => {
  it('cada guía tiene dirección fija, sin año, y secciones con ancla propia', () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const guide of GUIDES) {
      expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(guide.slug).not.toMatch(/20\d\d/);
      expect(guidePath(guide.slug)).toBe(`/guias/${guide.slug}`);
      const ids = guide.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of guide.sections) {
        expect(s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(s.above).toBeLessThan(s.upTo);
        expect(s.size).toBeGreaterThan(0);
        // Los tipos son los de lib/product-types: uno mal escrito dejaría la sección vacía sin avisar.
        for (const type of s.types) expect(isTypeSlug(typeSlug(type)), type).toBe(true);
      }
    }
  });

  it('cada guía cuenta sus clics aparte, y la dirección de la guía da ese origen', () => {
    const placements = GUIDES.map((g) => g.placement);
    expect(new Set(placements).size).toBe(placements.length);
    for (const guide of GUIDES) {
      expect(PLACEMENTS).toContain(guide.placement);
      expect(placementFromPath(guidePath(guide.slug))).toBe(guide.placement);
    }
  });

  it('título que cabe en Google, descripción corta y textos con la voz de la marca', () => {
    for (const guide of GUIDES) {
      expect(guide.title.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
      expect(guide.description.length).toBeLessThanOrEqual(160);
      for (const line of [guide.title, guide.heading, guide.description, guide.intro, ...guide.method]) {
        expect(line).not.toMatch(AVOIDED);
      }
      for (const s of guide.sections) expect(s.title).not.toMatch(AVOIDED);
    }
  });

  it('regalos: tres presupuestos seguidos, hasta $20.000, $50.000 y $100.000', () => {
    expect(regalos.sections.map((s) => [s.id, s.above, s.upTo])).toEqual([
      ['hasta-20000', 0, 20_000],
      ['hasta-50000', 20_000, 50_000],
      ['hasta-100000', 50_000, 100_000],
    ]);
    expect(regalos.sections.map((s) => s.title)).toEqual(['Hasta $20.000', 'Hasta $50.000', 'Hasta $100.000']);
    // Lo de la casa y los repuestos no son regalo.
    for (const s of regalos.sections) {
      for (const notAGift of ['Routers', 'Cargadores', 'Refrigeradores', 'Cámaras de seguridad', 'Discos y SSD']) {
        expect(s.types).not.toContain(notAGift);
      }
    }
    expect(getGuide('no-existe')).toBeUndefined();
  });
});

describe('fitsSection', () => {
  const [hasta20, hasta50] = regalos.sections;

  it('el monto de arriba es parte de la sección; el de abajo, de la anterior', () => {
    expect(fitsSection(product({ price: 20_000 }), hasta20)).toBe(true);
    expect(fitsSection(product({ price: 20_000 }), hasta50)).toBe(false);
    expect(fitsSection(product({ price: 20_001 }), hasta50)).toBe(true);
    expect(fitsSection(product({ price: 50_001 }), hasta50)).toBe(false);
  });

  it('solo los tipos de la sección', () => {
    expect(fitsSection(product({ price: 15_000, ml_domain_id: 'MLC-ROUTERS_AND_WIRELESS_SYSTEMS' }), hasta20)).toBe(false);
    expect(fitsSection(product({ price: 15_000, ml_domain_id: null }), hasta20)).toBe(false);
  });
});

describe('staticBlocker', () => {
  it('un producto sin avisos entra', () => {
    expect(staticBlocker(product())).toBeNull();
  });

  it('nombre que parte con un código, reacondicionado o sin marca', () => {
    expect(staticBlocker(product({ name: 'FA607NUQ-RL060W AMD Ryzen 7 16GB 512GB' }))).toBe('code-name');
    expect(staticBlocker(product({ name: 'Audífonos Sony WH-1000XM4 Reacondicionado' }))).toBe('not-new');
    expect(staticBlocker(product({ name: 'Audífonos Bluetooth M10', brand: 'Genérica' }))).toBe('no-brand');
  });

  it('vendedor con pocas ventas, salvo tienda oficial o Mercado Libre', () => {
    expect(staticBlocker(product({ seller_sales_count: 40 }))).toBe('few-sales');
    const official = product({ seller_sales_count: 40 });
    official.offer_info = { ...official.offer_info!, official_store: true };
    expect(staticBlocker(official)).toBeNull();
  });

  it('otro vendedor de la misma ficha lo ofrece a menos', () => {
    const p = product();
    p.offer_info = { ...p.offer_info!, is_lowest: false };
    expect(staticBlocker(p)).toBe('other-cheaper');
  });
});

describe('historyBlocker', () => {
  it('precio quieto: entra; sin historial y con pocos vendedores, también', () => {
    const p = product();
    expect(historyBlocker(p, quiet(p), NOW, false)).toBeNull();
    expect(historyBlocker(p, null, NOW, false)).toBeNull();
  });

  it('historial que hoy no se pudo leer', () => {
    const p = product();
    expect(historyBlocker(p, quiet(p), NOW, true)).toBe('history-unread');
  });

  it('dos cambios en 48 horas, o un precio que va y vuelve', () => {
    const p = product({ price: 39_990 });
    const moving = priceStats(
      [
        { price: 39_990, observed_at: ago(40 * DAY) },
        { price: 41_990, observed_at: ago(30 * HOUR) },
        { price: 39_990, observed_at: ago(5 * HOUR) },
      ],
      NOW,
    );
    expect(historyBlocker(p, moving, NOW, false)).toBe('moving-price');
  });

  it('con 4 o más vendedores solo entra si el precio no cambió en 48 horas', () => {
    const p = product({ price: 37_990 });
    p.offer_info = { ...p.offer_info!, offers_count: 6 };
    expect(historyBlocker(p, quiet(p), NOW, false)).toBeNull();
    const once = priceStats(
      [
        { price: 39_990, observed_at: ago(40 * DAY) },
        { price: 37_990, observed_at: ago(20 * HOUR) },
      ],
      NOW,
    );
    expect(historyBlocker(p, once, NOW, false)).toBe('many-sellers');
    // Sin historial no se sabe si se queda quieto.
    expect(historyBlocker(p, null, NOW, false)).toBe('many-sellers');
  });

  it('hoy cuesta 10% o más sobre el más bajo que se sostuvo en 30 días', () => {
    const p = product({ price: 44_990 });
    const wasCheaper = priceStats(
      [
        { price: 39_990, observed_at: ago(40 * DAY) },
        { price: 44_990, observed_at: ago(5 * DAY) },
      ],
      NOW,
    );
    expect(historyBlocker(p, wasCheaper, NOW, false)).toBe('above-minimum');
  });
});

describe('buildGuide', () => {
  it('como mucho dos del mismo tipo, y la sección queda corta antes que repetir', () => {
    const headphones = Array.from({ length: 5 }, (_, i) =>
      product({ brand: ['Sony', 'JBL', 'Philips', 'Anker', 'Xiaomi'][i] }),
    );
    const view = buildGuide(oneSection, headphones, statsFor(headphones), new Set(), NOW);
    expect(view.sections[0].products).toHaveLength(2);
  });

  it('como mucho dos de la misma marca, y un solo color de cada modelo', () => {
    const jbl = [
      product({ name: 'Parlante JBL Go 4 Azul', brand: 'JBL', ml_domain_id: 'MLC-SPEAKERS' }),
      product({ name: 'Audífonos JBL Tune 520BT', brand: 'JBL' }),
      product({ name: 'Parlante JBL Flip 6', brand: 'JBL', ml_domain_id: 'MLC-SPEAKERS' }),
    ];
    const sameFamily = [
      product({ name: 'Reloj Inteligente Xiaomi Redmi Watch 5 Negro', brand: 'Xiaomi', ml_domain_id: 'MLC-SMARTWATCHES', ml_family_id: 'FAM-W5' }),
      product({ name: 'Reloj Inteligente Xiaomi Redmi Watch 5 Plata', brand: 'Xiaomi', ml_domain_id: 'MLC-SMARTWATCHES', ml_family_id: 'FAM-W5' }),
    ];
    const all = [...jbl, ...sameFamily];
    const picked = buildGuide(oneSection, all, statsFor(all), new Set(), NOW).sections[0].products;
    expect(picked.filter((p) => p.brand === 'JBL')).toHaveLength(2);
    expect(picked.filter((p) => p.ml_family_id === 'FAM-W5')).toHaveLength(1);
  });

  it('el tope por categoría reparte la sección, y si falta con qué llenarla se suelta', () => {
    // Cinco productos con el mismo puntaje: el orden lo decide el id, y la de audio queda última.
    const domains = ['MLC-HEADPHONES', 'MLC-SPEAKERS', 'MLC-SMARTWATCHES', 'MLC-GAMEPADS_AND_JOYSTICKS', 'MLC-VIDEO_GAMES'];
    const brands = ['Sony', 'JBL', 'Samsung', 'Xiaomi', 'Apple'];
    const all = domains.map((domain, i) =>
      product({ name: 'Audífonos Bluetooth Modelo X', brand: brands[i], ml_domain_id: domain, category: i < 4 ? 'gaming' : 'audio' }),
    );
    const gaming = all.slice(0, 4);
    const audio = all[4];
    const section = { ...oneSection.sections[0], size: 4, types: ['Audífonos', 'Parlantes', 'Smartwatch', 'Controles', 'Juegos'] };
    const free: GuideDef = { ...oneSection, sections: [section], variety: { perType: 2, perBrand: 2 } };
    const capped: GuideDef = { ...free, variety: { ...free.variety, perCategory: 3 } };
    const ids = (guide: GuideDef, list: Product[]) => buildGuide(guide, list, statsFor(list), new Set(), NOW).products.map((p) => p.id);

    expect(ids(free, all)).toEqual(gaming.map((p) => p.id));
    expect(ids(capped, all)).toEqual([...gaming.slice(0, 3), audio].map((p) => p.id));
    // Sin otra categoría con qué llenar, la segunda vuelta completa con la misma.
    expect(ids(capped, gaming)).toEqual(gaming.map((p) => p.id));
    expect(regalos.variety).toEqual({ perType: 2, perBrand: 2, perCategory: 3 });
  });

  it('cada producto en su presupuesto, una sola vez, y nada de lo que trae aviso', () => {
    const cheap = product({ name: 'Audífonos Philips TAT1209', brand: 'Philips', price: 16_990 });
    const mid = product({ name: 'Parlante Sony SRS-XB100', brand: 'Sony', price: 43_990, ml_domain_id: 'MLC-SPEAKERS' });
    const top = product({ name: 'Reloj Inteligente Xiaomi Redmi Watch 6', brand: 'Xiaomi', price: 89_990, ml_domain_id: 'MLC-SMARTWATCHES' });
    const coded = product({ name: 'TWS-M10PRO2024 Audífonos', brand: 'Lenovo', price: 15_990 });
    const router = product({ name: 'Router TP-Link Archer C6', brand: 'TP-Link', price: 29_990, ml_domain_id: 'MLC-ROUTERS_AND_WIRELESS_SYSTEMS' });
    const all = [cheap, mid, top, coded, router];
    const view = buildGuide(regalos, all, statsFor(all), new Set(), NOW);
    expect(view.sections.map((s) => s.products.map((p) => p.id))).toEqual([[cheap.id], [mid.id], [top.id]]);
    expect(view.products.map((p) => p.id)).toEqual([cheap.id, mid.id, top.id]);
    // Al router ni se le lee el historial: no es de ningún presupuesto de la guía.
    expect(guideCandidates(regalos, all).map((p) => p.id)).toEqual([cheap.id, mid.id, top.id]);
  });

  it(`deja fuera lo que no llega a ${GUIDE_MIN_POINTS} puntos de interés`, () => {
    const weak = product({
      name: 'Cinta Led Cob Luz Fría Continua 24v',
      brand: 'Demasled',
      price: 9_281,
      original_price: null,
      ml_domain_id: 'MLC-LED_STRIPS',
    });
    weak.offer_info = { ...weak.offer_info!, free_shipping: false, is_full: false };
    const score = interestScore(weak, interestEvidence(weak, quiet(weak), NOW));
    expect(floorPoints(score)).toBeLessThan(GUIDE_MIN_POINTS);
    const guide: GuideDef = { ...oneSection, sections: [{ ...oneSection.sections[0], types: ['Tiras LED'] }] };
    expect(buildGuide(guide, [weak], statsFor([weak]), new Set(), NOW).products).toEqual([]);
  });

  it('el orden no depende de cómo llega el catálogo', () => {
    const list = [
      product({ name: 'Audífonos Sony WH-CH520', brand: 'Sony' }),
      product({ name: 'Parlante JBL Go 4', brand: 'JBL', ml_domain_id: 'MLC-SPEAKERS' }),
      product({ name: 'Reloj Inteligente Xiaomi Redmi Watch 5', brand: 'Xiaomi', ml_domain_id: 'MLC-SMARTWATCHES' }),
      product({ name: 'Audífonos Philips TAT1209', brand: 'Philips', price: 16_990 }),
    ];
    const stats = statsFor(list);
    const a = buildGuide(oneSection, list, stats, new Set(), NOW).products.map((p) => p.id);
    const b = buildGuide(oneSection, [...list].reverse(), stats, new Set(), NOW).products.map((p) => p.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
  });

  it('"Bajó $X" solo con la baja que confirma el historial', () => {
    const dropped = product({ name: 'Parlante JBL Go 4', brand: 'JBL', price: 34_990, ml_domain_id: 'MLC-SPEAKERS' });
    const steady = product({ name: 'Audífonos Sony WH-CH520', brand: 'Sony', price: 39_990 });
    const stats = statsFor([dropped, steady], {
      [dropped.id]: [
        { price: 39_990, observed_at: ago(40 * DAY) },
        { price: 34_990, observed_at: ago(3 * DAY) },
      ],
    });
    const view = buildGuide(oneSection, [dropped, steady], stats, new Set(), NOW);
    expect(view.sections[0].drops[dropped.id]).toMatchObject({ amount: 5_000 });
    expect(view.sections[0].drops[steady.id]).toBeUndefined();
  });

  it('si hoy no se pudo leer el historial, no entra', () => {
    const p = product();
    expect(buildGuide(oneSection, [p], statsFor([p]), new Set([p.id]), NOW).products).toEqual([]);
  });
});

describe('textos de cada sección', () => {
  it('el rango y el resumen con los precios del día', () => {
    expect(sectionRange({ above: 0, upTo: 20_000 })).toBe('Hasta $20.000');
    expect(sectionRange({ above: 20_000, upTo: 50_000 })).toBe('De $20.000 a $50.000');
    expect(sectionRange({ above: 500_000, upTo: Infinity })).toBe('Más de $500.000');
    expect(sectionRange({ above: 0, upTo: Infinity })).toBe('Cualquier precio');
    const section = regalos.sections[1];
    const two = [product({ price: 24_990 }), product({ price: 43_990 })];
    expect(sectionSummary({ section, products: two, drops: {} }, regalos.unit)).toBe('2 ideas de $24.990 a $43.990, con el precio de hoy.');
    expect(sectionSummary({ section, products: [two[0]], drops: {} }, regalos.unit)).toBe('1 idea a $24.990, con el precio de hoy.');
    expect(sectionSummary({ section, products: [], drops: {} }, regalos.unit)).toBeNull();
    expect(sectionSummary({ section: notebooks.sections[0], products: two, drops: {} }, notebooks.unit)).toBe(
      '2 notebooks de $24.990 a $43.990, con el precio de hoy.',
    );
  });
});

describe('memoryOf', () => {
  it('la RAM y el disco salen de la ficha, en GB', () => {
    expect(memoryOf({ name: 'Notebook X', specs: { 'Capacidad total del módulo de memoria RAM': '16 GB', 'Capacidad de disco SSD': '512 GB' } })).toEqual({ ramGb: 16, storageGb: 512 });
    expect(memoryOf({ name: 'Celular X', specs: { 'Memoria RAM': '6 GB', 'Memoria interna': '128 GB' } })).toEqual({ ramGb: 6, storageGb: 128 });
    expect(memoryOf({ name: 'Teléfono Senior', specs: { 'Memoria interna': '128 MB' } }).storageGb).toBeCloseTo(0.125);
    expect(memoryOf({ name: 'Notebook X', specs: { 'Capacidad del disco rígido': '1 TB' } }).storageGb).toBe(1024);
  });

  it('si la ficha no lo dice, del nombre; si tampoco, no se sabe', () => {
    expect(memoryOf({ name: 'Notebook HP 245 G10 AMD Ryzen 3 8gb Ram 256GB Ssd', specs: {} })).toEqual({ ramGb: 8, storageGb: 256 });
    expect(memoryOf({ name: 'Xiaomi Redmi Note 15 Negro 256 GB ROM 8 GB RAM', specs: {} })).toEqual({ ramGb: 8, storageGb: 256 });
    expect(memoryOf({ name: 'Notebook Lenovo Ideapad 14IRH10 i5-13420H 8Gb 512Gb', specs: {} })).toEqual({ ramGb: null, storageGb: null });
  });
});

describe('hasDedicatedGpu', () => {
  it('reconoce la tarjeta de video en el nombre, con o sin espacio', () => {
    expect(hasDedicatedGpu('Notebook Gamer Loq Gen 9 Core R5 16gb 512gb + Rtx 3050 6gb')).toBe(true);
    expect(hasDedicatedGpu('Notebook HP Gamer Victus 15-fb3032la Ryzen 5 RTX3050 6gb')).toBe(true);
    expect(hasDedicatedGpu('Notebook Asus TUF Gaming Radeon RX 6500M')).toBe(true);
    expect(hasDedicatedGpu('Notebook Acer Nitro GTX 1650')).toBe(true);
  });

  it('los gráficos integrados no cuentan', () => {
    expect(hasDedicatedGpu('Notebook ASUS Vivobook Go 15 AMD Ryzen 5 Radeon Graphics')).toBe(false);
    expect(hasDedicatedGpu('Notebook HP 14 Intel Core 3 8GB 512GB SSD')).toBe(false);
  });
});

describe('la guía de notebooks', () => {
  const laptop = (over: Partial<Product>) =>
    product({
      name: 'Notebook Lenovo Ideapad Slim 3 Ryzen 5 8gb Ram 512gb Ssd',
      brand: 'Lenovo',
      category: 'computacion',
      ml_domain_id: 'MLC-NOTEBOOKS',
      price: 459_990,
      original_price: 549_990,
      ...over,
    });

  it('tres secciones: hasta $500.000, más de $500.000 y con tarjeta de video', () => {
    expect(notebooks.sections.map((s) => [s.id, s.title, s.gpu])).toEqual([
      ['hasta-500000', 'Hasta $500.000', false],
      ['mas-de-500000', 'Más de $500.000', false],
      ['con-tarjeta-de-video', 'Con tarjeta de video', true],
    ]);
    expect(notebooks).toMatchObject({ minRamGb: 8, minStorageGb: 256, variety: { perBrand: 2 } });
    expect(notebooks.tips?.items.length).toBeGreaterThan(0);
    for (const line of notebooks.tips?.items ?? []) expect(line).not.toMatch(AVOIDED);
  });

  it('cada notebook en su sección: los de tarjeta de video van aparte, a cualquier precio', () => {
    const cheap = laptop({});
    const pricey = laptop({ name: 'Notebook Samsung Galaxy Book4 i7 16gb Ram 512gb Ssd', brand: 'Samsung', price: 749_990 });
    const gamer = laptop({ name: 'Notebook Gamer Lenovo LOQ Ryzen 5 16gb 512gb Rtx 3050', price: 799_990 });
    const cheapGamer = laptop({ name: 'Notebook HP Victus Ryzen 5 8gb Ram 512gb Ssd RTX3050', brand: 'HP', price: 489_990 });
    const all = [cheap, pricey, gamer, cheapGamer];
    const view = buildGuide(notebooks, all, statsFor(all), new Set(), NOW);
    expect(view.sections.map((s) => s.products.map((p) => p.id).sort())).toEqual([
      [cheap.id],
      [pricey.id],
      [gamer.id, cheapGamer.id].sort(),
    ]);
  });

  it('fuera los de menos de 8 GB de RAM o menos de 256 GB de disco; sin el dato, entran', () => {
    const small = laptop({ name: 'Notebook Chuwi Celeron 4gb Ram 128gb Ssd', brand: 'Chuwi' });
    const emmc = laptop({ specs: { 'Capacidad total del módulo de memoria RAM': '8 GB', 'Capacidad de disco SSD': '128 GB' } });
    const unknown = laptop({ name: 'Notebook Lenovo Ideapad 14IRH10 i5-13420H 8Gb 512Gb' });
    expect(memoryBlocker(notebooks, small)).toBe('low-memory');
    expect(memoryBlocker(notebooks, emmc)).toBe('low-memory');
    expect(memoryBlocker(notebooks, unknown)).toBeNull();
    expect(memoryBlocker(regalos, small)).toBeNull();
    expect(guideCandidates(notebooks, [small, emmc, unknown]).map((p) => p.id)).toEqual([unknown.id]);
  });
});
