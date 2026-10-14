import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterestEvidence, InterestProduct, InterestScore } from '@/lib/social/interest';

// La lectura del historial va a Supabase: acá solo se prueba la selección, que es pura.
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
  // La lectura que avisa lo que no pudo leer se arma sobre la misma de mentira: acá se lee todo.
  const getPriceStatsManyChecked = async (ids: string[]) => ({ stats: await getPriceStatsMany(ids), unread: new Set<string>() });
  return { getPriceStatsMany, getPriceStatsManyChecked };
});
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));

/**
 * El puntaje de verdad, salvo lo que cada test fija a mano por producto. Las
 * reglas de la selección (piso, excluidos, avisos, variedad, orden) se
 * prueban así con números puestos acá y no con los pesos de las tablas, que
 * se afinan seguido.
 */
const fixed = vi.hoisted(() => ({
  scores: new Map<string, Partial<InterestScore>>(),
  /** La evidencia con que se pidió el puntaje de cada producto. */
  asked: new Map<string, InterestEvidence>(),
}));
vi.mock('@/lib/social/interest', async (original) => {
  const real = await original<typeof import('@/lib/social/interest')>();
  return {
    ...real,
    interestScore: (product: InterestProduct, evidence: InterestEvidence): InterestScore => {
      fixed.asked.set(product.id, evidence);
      return { ...real.interestScore(product, evidence), ...fixed.scores.get(product.id) };
    },
  };
});

import { estimateCommission } from '@/lib/commission';
import { MIN_INTEREST_POINTS } from '@/lib/social/interest';
import { NETWORK_RULES } from '@/lib/social/networks';
import { STORY_RULES } from '@/lib/social/stories';
import { VIDEO_RULES } from '@/lib/social/videos';
import {
  SOCIAL_BASE_COLUMNS,
  TELEGRAM_RULES,
  pickByRules,
  pickForTelegram,
  type PickOptions,
  type PickRules,
  type SocialProduct,
  type TelegramPick,
} from '@/lib/social/telegram';

const NOW = new Date('2026-10-12T15:00:00Z');
const HOUR = 3600_000;

let seq = 0;
/** Un producto con 20% de descuento de lista y el precio revisado hace 20 minutos. */
function product(over: Partial<SocialProduct> = {}): SocialProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: `Producto de prueba ${seq}`,
    brand: 'Marca',
    category: 'audio',
    price: 80_000,
    original_price: 100_000,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: 'MLC123',
    ml_family_id: null,
    price_checked_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    seller_reputation: 'verde',
    seller_sales_count: 10_000,
    is_active: true,
    is_hidden: false,
    offer_info: { free_shipping: true, is_full: false },
    ml_root_category: null,
    deleted_at: null,
    ...over,
  };
}

/** Bien arriba del piso: para los tests que no tratan de puntos. */
const HIGH = MIN_INTEREST_POINTS + 40;

/**
 * Un producto con el puntaje puesto a mano. Si no se dice otra cosa, sin
 * aviso, sin exclusión y con tipo y marca propios (la variedad no lo frena).
 */
function scored(points: number, over: Partial<SocialProduct> = {}, score: Partial<InterestScore> = {}): SocialProduct {
  const p = product(over);
  fixed.scores.set(p.id, {
    points,
    reason: `motivo de ${p.slug}`,
    warning: null,
    excluded: null,
    typeKey: `tipo-${p.slug}`,
    brandKey: `marca-${p.slug}`,
    ...score,
  });
  return p;
}

/** Reglas sin topes que estorben: 20% de lista o 5% de baja, precio de hace 6 horas como mucho. */
const WIDE: PickRules = { maxPosts: 20, perCategory: 20, minDiscount: 20, minDrop: 5, maxPriceAgeMs: 6 * HOUR };

const opts = (over: Partial<PickOptions> = {}): PickOptions => ({ now: NOW, recentlyPosted: new Set<string>(), ...over });
const ids = (picks: TelegramPick<SocialProduct>[]) => picks.map((pick) => pick.product.id);
const seenDrop = (pct: number, price = 80_000): InterestEvidence => ({
  drop: { pct, amount: Math.round((price * pct) / (100 - pct)) },
  min30: price,
  daysTracked: 12,
});

beforeEach(() => {
  fixed.scores.clear();
  fixed.asked.clear();
});

describe('lo que se lee de cada producto', () => {
  it('trae la fecha en que se agregó: sin ella no se sabe si el primer registro del historial es su precio de partida', () => {
    expect(SOCIAL_BASE_COLUMNS.split(',')).toContain('created_at');
  });
});

describe('pickByRules: la puerta de entrada', () => {
  it('solo entra lo que está a la venta y visible', () => {
    const ok = scored(HIGH);
    const rows = [
      scored(HIGH, { is_active: false }),
      scored(HIGH, { is_hidden: true }),
      scored(HIGH, { deleted_at: '2026-10-01T00:00:00Z' }),
      ok,
    ];
    expect(ids(pickByRules(rows, opts(), WIDE))).toEqual([ok.id]);
  });

  it('lo publicado hace poco no vuelve', () => {
    const posted = scored(HIGH + 10);
    const fresh = scored(HIGH);
    expect(ids(pickByRules([posted, fresh], opts({ recentlyPosted: new Set([posted.id]) }), WIDE))).toEqual([fresh.id]);
  });

  it('el precio tiene que estar recién revisado', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    const justInTime = scored(HIGH, { price_checked_at: at(-6 * HOUR) });
    const clockSkew = scored(HIGH, { price_checked_at: at(30_000) });
    const rows = [
      scored(HIGH, { price_checked_at: at(-6 * HOUR - 60_000) }),
      scored(HIGH, { price_checked_at: null }),
      scored(HIGH, { price_checked_at: 'ayer' }),
      // Una hora del futuro no es una revisión: es un dato malo.
      scored(HIGH, { price_checked_at: at(5 * 60_000) }),
      justInTime,
      clockSkew,
    ];
    expect(ids(pickByRules(rows, opts(), WIDE)).sort()).toEqual([justInTime.id, clockSkew.id].sort());
    // Cada canal con su plazo.
    expect(pickByRules(rows, opts(), { ...WIDE, maxPriceAgeMs: HOUR })).toHaveLength(1);
  });

  it('pide el descuento de lista mínimo o una baja comprobada con el historial', () => {
    const at20 = scored(HIGH, { price: 80_000, original_price: 100_000 });
    const at19 = scored(HIGH, { price: 81_000, original_price: 100_000 });
    const noDeal = scored(HIGH, { original_price: null });
    const smallDrop = scored(HIGH, { original_price: null });
    const bigDrop = scored(HIGH, { original_price: null });
    const evidence = new Map([
      [smallDrop.id, seenDrop(4.9)],
      [bigDrop.id, seenDrop(5.4)],
    ]);

    const picks = pickByRules([at19, noDeal, smallDrop, bigDrop, at20], opts({ evidence }), WIDE);
    expect(ids(picks).sort()).toEqual([at20.id, bigDrop.id].sort());
    expect(picks.find((pick) => pick.product.id === at20.id)).toMatchObject({ discount: 20, drop: null });
    // La baja va en %, sin redondear: cada pantalla la redondea a su modo.
    expect(picks.find((pick) => pick.product.id === bigDrop.id)).toMatchObject({ discount: 0, drop: 5.4 });

    // Sin la evidencia, la baja no existe.
    expect(ids(pickByRules([smallDrop, bigDrop, at20], opts(), WIDE))).toEqual([at20.id]);

    // La baja mínima justa entra.
    const exact = scored(HIGH, { original_price: null });
    expect(ids(pickByRules([exact], opts({ evidence: new Map([[exact.id, seenDrop(5)]]) }), WIDE))).toEqual([exact.id]);
  });

  it('una baja con números imposibles no abre la puerta', () => {
    const p = scored(HIGH, { original_price: null });
    for (const pct of [NaN, Infinity, -8, 0]) {
      const evidence = new Map([[p.id, { drop: { pct, amount: 5_000 }, min30: 80_000, daysTracked: 12 }]]);
      expect(pickByRules([p], opts({ evidence }), WIDE)).toEqual([]);
    }
  });

  it('ningún puntaje abre la puerta: 100 puntos sin oferta no se publican', () => {
    const noDeal = scored(100, { original_price: null });
    expect(pickByRules([noDeal], opts(), WIDE)).toEqual([]);
  });
});

describe('pickByRules: el puntaje de interés decide entre los que entran', () => {
  it('bajo el piso no sale nada, aunque sobren cupos', () => {
    const justEnough = scored(MIN_INTEREST_POINTS);
    const almost = scored(MIN_INTEREST_POINTS - 0.1);
    const low = scored(5);
    expect(ids(pickByRules([almost, low, justEnough], opts(), WIDE))).toEqual([justEnough.id]);
    // Mejor nada que rellenar con el fondo de la lista.
    expect(pickByRules([almost, low], opts(), WIDE)).toEqual([]);
  });

  it('lo que el puntaje excluye no sale, por más puntos que tenga', () => {
    const excluded = scored(HIGH + 30, {}, { excluded: 'hoy cuesta 25% más de lo que llegó a costar en 30 días ($64.000)' });
    const ok = scored(HIGH);
    expect(ids(pickByRules([excluded, ok], opts(), WIDE))).toEqual([ok.id]);
    expect(pickByRules([excluded], opts(), WIDE)).toEqual([]);
  });

  it('cleanOnly deja fuera lo que trae un aviso; sin cleanOnly sale con el aviso a la vista', () => {
    const warned = scored(HIGH + 10, {}, { warning: 'otro vendedor lo ofrece a menos' });
    const clean = scored(HIGH);

    expect(ids(pickByRules([warned, clean], opts(), { ...WIDE, cleanOnly: true }))).toEqual([clean.id]);

    const seen = pickByRules([warned, clean], opts(), { ...WIDE, cleanOnly: false });
    expect(ids(seen)).toEqual([warned.id, clean.id]);
    expect(seen[0].score.warning).toBe('otro vendedor lo ofrece a menos');
    expect(seen[1].score.warning).toBeNull();
    // Si la regla no lo pide, no filtra.
    expect(ids(pickByRules([warned, clean], opts(), WIDE))).toEqual([warned.id, clean.id]);
  });

  it('anyScore (elegido a mano) pasa por alto el piso, la exclusión y los avisos, y deja el puntaje a la vista', () => {
    const warning = 'vendedor con pocas ventas (4)';
    const excluded = 'hoy cuesta 30% más de lo que llegó a costar en 30 días ($61.000)';
    const p = scored(3, {}, { warning, excluded });

    expect(pickByRules([p], opts(), { ...WIDE, cleanOnly: true })).toEqual([]);
    expect(pickByRules([p], opts(), WIDE)).toEqual([]);

    const [pick] = pickByRules([p], opts(), { ...WIDE, cleanOnly: true, anyScore: true });
    expect(pick.product.id).toBe(p.id);
    // Quien lo eligió tiene que poder leer por qué el puntaje no lo habría elegido.
    expect(pick.score).toMatchObject({ points: 3, warning, excluded });
  });

  it('anyScore no salta la puerta de entrada', () => {
    const rules = { ...WIDE, anyScore: true };
    const posted = scored(HIGH);
    const rows = [
      scored(HIGH, { is_hidden: true }),
      scored(HIGH, { price_checked_at: new Date(NOW.getTime() - 7 * HOUR).toISOString() }),
      posted,
    ];
    expect(pickByRules(rows, opts({ recentlyPosted: new Set([posted.id]) }), rules)).toEqual([]);

    // El plan de un producto pedido por su id además pone en cero el descuento y la baja mínimos.
    const noDeal = scored(2, { original_price: null });
    expect(pickByRules([noDeal], opts(), rules)).toEqual([]);
    expect(ids(pickByRules([noDeal], opts(), { ...rules, minDiscount: 0, minDrop: 0 }))).toEqual([noDeal.id]);
  });

  it('el orden es el de interés, no el de la comisión', () => {
    // El más caro, que es el que más comisión deja, es el que menos interesa.
    const pricey = scored(MIN_INTEREST_POINTS + 5, { price: 1_600_000, original_price: 2_000_000, category: 'electrodomesticos' });
    const mid = scored(MIN_INTEREST_POINTS + 25, { price: 160_000, original_price: 200_000, category: 'gaming' });
    const cheap = scored(MIN_INTEREST_POINTS + 45, { price: 16_000, original_price: 20_000 });

    for (const rows of [[pricey, mid, cheap], [cheap, pricey, mid], [mid, cheap, pricey]]) {
      const picks = pickByRules(rows, opts(), WIDE);
      expect(ids(picks)).toEqual([cheap.id, mid.id, pricey.id]);
      expect(picks[0].commission).toBeLessThan(picks[1].commission);
      expect(picks[1].commission).toBeLessThan(picks[2].commission);
    }
    // Con un solo cupo sale el que más interesa, no el más caro.
    expect(ids(pickByRules([pricey, mid, cheap], opts(), { ...WIDE, maxPosts: 1 }))).toEqual([cheap.id]);
  });

  it('a igual puntaje, primero el que más comisión deja', () => {
    const small = scored(HIGH, { price: 40_000, original_price: 50_000 });
    const big = scored(HIGH, { price: 400_000, original_price: 500_000 });
    expect(ids(pickByRules([small, big], opts(), WIDE))).toEqual([big.id, small.id]);
  });

  it('cada elegido lleva su puntaje; el motivo es la frase del puntaje', () => {
    const p = scored(HIGH, { price: 70_000, original_price: 100_000, ml_root_category: 'MLC1574' }, { reason: 'Parlante JBL, bajó 12% según nuestro historial' });
    const evidence = new Map([[p.id, seenDrop(12, 70_000)]]);
    const [pick] = pickByRules([p], opts({ evidence }), WIDE);
    expect(pick.product).toBe(p);
    expect(pick.score).toMatchObject({ points: HIGH, reason: 'Parlante JBL, bajó 12% según nuestro historial', warning: null, excluded: null });
    expect(pick.reason).toBe(pick.score.reason);
    expect(pick.discount).toBe(30);
    expect(pick.drop).toBe(12);
    expect(pick.commission).toBe(estimateCommission(70_000, 'MLC1574'));
  });

  it('el puntaje recibe lo que el historial dice de cada producto; sin dato, "sin historial"', () => {
    const tracked = scored(HIGH);
    const unknown = scored(HIGH);
    const evidence = new Map([[tracked.id, { drop: null, min30: 76_000, daysTracked: 21 }]]);
    pickByRules([tracked, unknown], opts({ evidence }), WIDE);
    expect(fixed.asked.get(tracked.id)).toBe(evidence.get(tracked.id));
    expect(fixed.asked.get(unknown.id)).toEqual({ drop: null, min30: null, daysTracked: 0 });
  });
});

describe('pickByRules: variedad', () => {
  /** De más a menos puntos, cada uno en su categoría. */
  function lineup() {
    return {
      jblHeadphones: scored(90, { category: 'audio' }, { typeKey: 'Audífonos', brandKey: 'jbl' }),
      sonyHeadphones: scored(85, { category: 'gaming' }, { typeKey: 'Audífonos', brandKey: 'sony' }),
      jblSpeaker: scored(80, { category: 'electronica' }, { typeKey: 'Parlante', brandKey: 'jbl' }),
      jblSoundbar: scored(75, { category: 'hogar' }, { typeKey: 'Barra de sonido', brandKey: 'jbl' }),
      lenovoTablet: scored(70, { category: 'computacion' }, { typeKey: 'Tablet', brandKey: 'lenovo' }),
    };
  }

  it('si la regla no dice otra cosa: uno por tipo de producto y dos por marca', () => {
    const l = lineup();
    const picks = pickByRules(Object.values(l), opts(), { ...WIDE, maxPosts: 3 });
    // Los segundos audífonos y el tercer JBL esperan.
    expect(ids(picks)).toEqual([l.jblHeadphones.id, l.jblSpeaker.id, l.lenovoTablet.id]);
  });

  it('perBrand y perType cambian esos topes', () => {
    const l = lineup();
    const rows = Object.values(l);
    expect(ids(pickByRules(rows, opts(), { ...WIDE, maxPosts: 2, perBrand: 1 }))).toEqual([l.jblHeadphones.id, l.lenovoTablet.id]);
    expect(ids(pickByRules(rows, opts(), { ...WIDE, maxPosts: 3, perType: 2 }))).toEqual([
      l.jblHeadphones.id,
      l.sonyHeadphones.id,
      l.jblSpeaker.id,
    ]);
    expect(ids(pickByRules(rows, opts(), { ...WIDE, maxPosts: 4, perBrand: 3 }))).toEqual([
      l.jblHeadphones.id,
      l.jblSpeaker.id,
      l.jblSoundbar.id,
      l.lenovoTablet.id,
    ]);
  });

  it('si con variedad no se juntan, se repiten tipo y marca antes que dejar cupos vacíos', () => {
    const l = lineup();
    const picks = pickByRules(Object.values(l), opts(), { ...WIDE, maxPosts: 5 });
    expect(ids(picks)).toEqual([l.jblHeadphones.id, l.sonyHeadphones.id, l.jblSpeaker.id, l.jblSoundbar.id, l.lenovoTablet.id]);
  });

  it('la categoría nunca pasa de su tope, ni salen dos colores del mismo modelo', () => {
    const audio = [scored(90), scored(85), scored(80), scored(75)];
    const gaming = scored(60, { category: 'gaming' });
    const picks = pickByRules([...audio, gaming], opts(), { ...WIDE, perCategory: 2 });
    expect(ids(picks)).toEqual([audio[0].id, audio[1].id, gaming.id]);

    const black = scored(90, { ml_family_id: 'F1' });
    const white = scored(85, { ml_family_id: 'F1', category: 'gaming' });
    expect(ids(pickByRules([white, black], opts(), WIDE))).toEqual([black.id]);
  });

  it('del mismo modelo solo sale la versión más barata, se haya publicado esa o no', () => {
    const cheap = scored(60, { ml_family_id: 'F2', price: 39_990, original_price: 69_990 });
    const dear = scored(90, { ml_family_id: 'F2', price: 49_990, original_price: 79_990, category: 'gaming' });
    expect(ids(pickByRules([dear, cheap], opts(), WIDE))).toEqual([cheap.id]);
    // Aunque la barata ya se haya publicado, la cara no sale como oferta.
    expect(pickByRules([dear, cheap], opts({ recentlyPosted: new Set([cheap.id]) }), WIDE)).toEqual([]);
    // Elegida a mano sí sale: quien la pidió sabe cuál quiere.
    const byHand = pickByRules([dear, cheap], opts({ recentlyPosted: new Set([cheap.id]) }), { ...WIDE, anyScore: true });
    expect(ids(byHand)).toEqual([dear.id]);

    // Dos colores casi al mismo precio: valen los dos, y sale el de más puntos.
    const near = scored(90, { ml_family_id: 'F3', price: 41_000, original_price: 69_990, category: 'hogar' });
    const base = scored(60, { ml_family_id: 'F3', price: 39_990, original_price: 69_990, category: 'hogar' });
    expect(ids(pickByRules([near, base], opts(), WIDE))).toEqual([near.id]);

    // Una versión que ya no está a la venta no cuenta como "la más barata".
    const gone = scored(60, { ml_family_id: 'F4', price: 20_000, original_price: 69_990, is_active: false });
    const left = scored(70, { ml_family_id: 'F4', price: 49_990, original_price: 79_990 });
    expect(ids(pickByRules([gone, left], opts(), WIDE))).toEqual([left.id]);
  });

  it('respeta la cantidad pedida', () => {
    const rows = [scored(90), scored(80, { category: 'gaming' }), scored(70, { category: 'hogar' })];
    expect(pickByRules(rows, opts(), { ...WIDE, maxPosts: 2 })).toHaveLength(2);
    expect(pickByRules(rows, opts(), { ...WIDE, maxPosts: 0 })).toEqual([]);
  });
});

describe('las reglas de cada canal', () => {
  it('Telegram publica solo: 15% o más, sin avisos y una por marca', () => {
    expect(TELEGRAM_RULES).toMatchObject({ minDiscount: 15, minDrop: 5, maxPosts: 5, perCategory: 2, perBrand: 1, cleanOnly: true });

    const at15 = scored(90, { price: 85_000, original_price: 100_000 }, { brandKey: 'jbl' });
    const at14 = scored(95, { price: 86_000, original_price: 100_000, category: 'gaming' });
    const warned = scored(99, { category: 'hogar' }, { warning: 'hace poco estuvo a $70.000' });
    const sameBrand = scored(85, { category: 'celulares' }, { brandKey: 'jbl' });
    const others = [
      scored(80, { category: 'computacion' }),
      scored(75, { category: 'electronica' }),
      scored(70, { category: 'electrodomesticos' }),
      scored(65, { category: 'gaming' }),
    ];
    const rows = [at14, warned, sameBrand, at15, ...others];

    const picks = pickForTelegram(rows, opts());
    expect(ids(picks)).toEqual([at15.id, ...others.map((p) => p.id)]);
    expect(pickByRules(rows, opts(), TELEGRAM_RULES)).toEqual(picks);
  });

  it('el feed se programa solo y va sin avisos; las historias las sube el dueño, que ve el aviso', () => {
    expect(NETWORK_RULES.cleanOnly).toBe(true);
    expect(STORY_RULES.cleanOnly).toBe(false);

    const warned = scored(95, {}, { warning: 'otro vendedor lo ofrece a menos' });
    const clean = scored(80, { category: 'gaming' });
    expect(ids(pickByRules([warned, clean], opts(), NETWORK_RULES))).toEqual([clean.id]);
    expect(ids(pickByRules([warned, clean], opts(), STORY_RULES))).toEqual([warned.id, clean.id]);
  });

  it('ninguna regla de canal salta el piso ni la exclusión', () => {
    const low = scored(MIN_INTEREST_POINTS - 15);
    const excluded = scored(95, { category: 'gaming' }, { excluded: 'sin precio válido' });
    for (const rules of [TELEGRAM_RULES, NETWORK_RULES, STORY_RULES, VIDEO_RULES]) {
      expect(pickByRules([low, excluded], opts(), rules)).toEqual([]);
    }
  });

  // Los clics del sitio y el puesto entre los más vendidos se pueden fabricar
  // desde afuera. Ordenan lo que ya entra, pero no hacen entrar nada.
  describe('las señales no habilitan en ningún canal', () => {
    /** Un producto con `own` puntos propios más `signals` de señales: lo que se ve es la suma. */
    const lifted = (own: number, signals: number, over: Partial<SocialProduct> = {}) =>
      scored(own + signals, over, { breakdown: { signals } });
    const CHANNELS: [string, PickRules][] = [
      ['Telegram, que publica solo', TELEGRAM_RULES],
      ['el feed', NETWORK_RULES],
      ['las historias', STORY_RULES],
      ['los videos', VIDEO_RULES],
    ];

    it.each(CHANNELS)('en %s, 39 puntos con la señal máxima no entran; 41 sí, y la señal lo sube en el orden', (_channel, rules) => {
      const below = lifted(MIN_INTEREST_POINTS - 1, 6, { category: 'audio' });
      const above = lifted(MIN_INTEREST_POINTS + 1, 6, { category: 'gaming' });
      const rival = scored(MIN_INTEREST_POINTS + 4, { category: 'hogar' });

      // El de 39 suma 45 con las señales, más que el rival, y aun así no entra.
      const picks = pickByRules([below, rival, above], opts(), rules);
      expect(ids(picks)).toEqual([above.id, rival.id]);
      expect(picks.map((pick) => pick.score.points)).toEqual([MIN_INTEREST_POINTS + 7, MIN_INTEREST_POINTS + 4]);
      // Solo y con cupos de sobra, tampoco.
      expect(pickByRules([below], opts(), rules)).toEqual([]);

      // El mismo de 41 sin la señal va después del rival: la señal ordena.
      const plain = scored(MIN_INTEREST_POINTS + 1, { category: 'gaming' });
      expect(ids(pickByRules([plain, rival], opts(), rules))).toEqual([rival.id, plain.id]);
    });

    it.each(CHANNELS)('en %s, el piso se mide justo: 40 propios entran con o sin señales, 39,9 no', (_channel, rules) => {
      const exact = lifted(MIN_INTEREST_POINTS, 3.4, { category: 'audio' });
      const short = lifted(MIN_INTEREST_POINTS - 0.1, 6, { category: 'gaming' });
      expect(ids(pickByRules([short, exact], opts(), rules))).toEqual([exact.id]);
    });

    it('lo elegido a mano sale igual: ahí no corre el piso, y el puntaje va a la vista con sus señales', () => {
      const below = lifted(MIN_INTEREST_POINTS - 1, 6);
      const [pick] = pickByRules([below], opts(), { ...NETWORK_RULES, anyScore: true });
      expect(pick.product.id).toBe(below.id);
      expect(pick.score.points).toBe(MIN_INTEREST_POINTS + 5);
      expect(pick.score.breakdown.signals).toBe(6);
    });
  });
});

// Sin puntajes puestos a mano: productos inventados cuyo lugar se ve a simple vista.
describe('pickByRules con el puntaje de verdad', () => {
  const official = { free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true };
  const info = (value: Record<string, unknown>) => value as SocialProduct['offer_info'];

  /** Una consola deseada, de tienda oficial, que el sitio vio bajar $150.000 hace días. */
  const consoleRow = (over: Partial<SocialProduct> = {}) =>
    product({
      name: 'Consola PlayStation 5 Slim Digital 1TB Blanco',
      brand: 'Sony',
      category: 'gaming',
      price: 449_990,
      original_price: null,
      seller_sales_count: 80_000,
      ml_root_category: 'MLC1144',
      offer_info: info(official),
      ...over,
    });
  const consoleEvidence: InterestEvidence = { drop: { pct: 25, amount: 150_000 }, min30: 449_990, daysTracked: 12 };

  /** Audífonos de marca conocida, de tienda oficial, con 40% de lista y sin novedades en el historial. */
  const headphonesRow = (over: Partial<SocialProduct> = {}) =>
    product({
      name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
      brand: 'JBL',
      category: 'audio',
      price: 60_000,
      original_price: 100_000,
      seller_sales_count: 50_000,
      ml_root_category: 'MLC1000',
      offer_info: info(official),
      ...over,
    });
  const steady = (price: number): InterestEvidence => ({ drop: null, min30: price, daysTracked: 12 });
  const loose = { ...STORY_RULES, cleanOnly: false };

  it('manda lo que la gente quiere y se puede comprobar, no lo que más comisión deja', () => {
    const fridge = product({
      name: 'Refrigerador Side by Side 578 lt Samsung',
      brand: 'Samsung',
      category: 'electrodomesticos',
      price: 899_990,
      original_price: 1_124_990,
      seller_sales_count: 80_000,
      ml_root_category: 'MLC5726',
      offer_info: info(official),
    });
    const gameConsole = consoleRow();
    const headphones = headphonesRow();
    const evidence = new Map([
      [gameConsole.id, consoleEvidence],
      [headphones.id, steady(60_000)],
      [fridge.id, steady(899_990)],
    ]);

    // Por comisión, el refrigerador iba primero y los audífonos al final.
    const commission = (p: SocialProduct) => estimateCommission(p.price, p.ml_root_category ?? null);
    expect(commission(fridge)).toBeGreaterThan(commission(gameConsole));
    expect(commission(gameConsole)).toBeGreaterThan(commission(headphones));

    const picks = pickByRules([fridge, headphones, gameConsole], opts({ evidence }), loose);
    expect(ids(picks).slice(0, 2)).toEqual([gameConsole.id, headphones.id]);
    for (const pick of picks) {
      expect(pick.score.points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
      expect(pick.reason.length).toBeGreaterThan(10);
    }
  });

  it('un cable genérico con 60% de "descuento" no llega al piso, aunque sobren cupos', () => {
    const cable = product({
      name: 'Cable Usb Tipo C 2 Metros Carga Rápida',
      brand: 'Genérica',
      category: 'electronica',
      price: 3_990,
      original_price: 9_990,
      seller_sales_count: 800,
      ml_root_category: 'MLC1000',
      offer_info: info({ free_shipping: false, is_full: false, official_store: false, sold_by_ml: false, is_lowest: true }),
    });
    expect(pickByRules([cable], opts({ evidence: new Map([[cable.id, steady(3_990)]]) }), loose)).toEqual([]);
  });

  it('lo que el sitio vio mucho más barato hace poco no sale, por bueno que sea el descuento de lista', () => {
    const headphones = headphonesRow();
    expect(pickByRules([headphones], opts({ evidence: new Map([[headphones.id, steady(60_000)]]) }), loose)).toHaveLength(1);
    // Hace poco estuvo a $40.000: hoy cuesta la mitad más.
    expect(pickByRules([headphones], opts({ evidence: new Map([[headphones.id, steady(40_000)]]) }), loose)).toEqual([]);
  });

  it('un vendedor casi sin ventas: fuera de lo que se publica solo, y con aviso donde el dueño decide', () => {
    const doubtful = consoleRow({
      seller_sales_count: 4,
      offer_info: info({ ...official, official_store: false }),
    });
    const evidence = new Map([[doubtful.id, consoleEvidence]]);

    expect(pickByRules([doubtful], opts({ evidence }), TELEGRAM_RULES)).toEqual([]);
    expect(pickByRules([doubtful], opts({ evidence }), NETWORK_RULES)).toEqual([]);

    const [pick] = pickByRules([doubtful], opts({ evidence }), STORY_RULES);
    expect(pick.product.id).toBe(doubtful.id);
    expect(pick.score.warning).toEqual(expect.any(String));
    expect(pick.score.excluded).toBeNull();
  });

  it('una oferta limpia sale en todos los canales', () => {
    const gameConsole = consoleRow();
    const evidence = new Map([[gameConsole.id, consoleEvidence]]);
    for (const rules of [TELEGRAM_RULES, NETWORK_RULES, STORY_RULES]) {
      const [pick] = pickByRules([gameConsole], opts({ evidence }), rules);
      expect(pick.product.id).toBe(gameConsole.id);
      expect(pick.score.warning).toBeNull();
      expect(pick.drop).toBe(25);
    }
  });
});
