import { describe, expect, it } from 'vitest';
import { priceStats, type PriceStats } from '@/lib/deals';
import { MIN_INTEREST_POINTS, type InterestScore } from '@/lib/social/interest';
import {
  HOME_DEALS_SIZE,
  HOME_LEAD_ROTATION,
  leadBlocker,
  selectHomeDeals,
  type HomeDealProduct,
  type LeadBlocker,
} from '@/lib/home-deals';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Primera hora de un día cuyo número (20.760 desde 1970) es múltiplo de 60:
// con cualquier tamaño de grupo, de 1 a 6, a esta hora le toca encabezar al
// primero, y quedan 23 horas antes de que cambie el día.
const NOW = new Date('2026-11-03T00:20:00Z').getTime();

const minutesAgo = (minutes: number, from: number = NOW) => new Date(from - minutes * 60_000).toISOString();
const NO_STATS = new Map<string, PriceStats>();

// ---------------------------------------------------------------------------
// Ofertas de prueba. Todas escritas acá: los tests no leen el catálogo.

const OFFER = {
  free_shipping: true,
  is_full: false,
  official_store: true,
  sold_by_ml: false,
  is_lowest: true,
  warranty: null,
  offers_count: 1,
};

/** Una oferta sin nada raro: revisada hace 10 minutos, un solo vendedor y categoría propia. */
function deal(id: string, over: Partial<HomeDealProduct> = {}): HomeDealProduct {
  return {
    id,
    name: `Producto ${id}`,
    brand: null,
    category: `categoria-${id}`,
    price: 50_000,
    original_price: 100_000,
    seller_sales_count: 50_000,
    ml_root_category: 'MLC1000',
    ml_family_id: null,
    price_checked_at: minutesAgo(10),
    // Agregada hace 20 días, que es también desde cuando tiene historial (ver history).
    created_at: new Date(NOW - 20 * DAY).toISOString(),
    offer_info: { ...OFFER },
    ...over,
  };
}

/** Un puntaje armado a mano: sin aviso, sin exclusión y sin tipo ni marca que limiten la variedad. */
function scored(points: number, over: Partial<InterestScore> = {}): InterestScore {
  return { points, reason: 'de prueba', warning: null, excluded: null, typeKey: '', brandKey: '', breakdown: {}, ...over };
}

/** Un historial quieto: 20 días al mismo precio. */
function history(over: Partial<PriceStats> = {}): PriceStats {
  return {
    min30: 50_000,
    median30: 50_000,
    max30: 50_000,
    minTracked: 50_000,
    maxTracked: 50_000,
    daysTracked: 20,
    lastPrice: 50_000,
    previousPrice: null,
    lastChangeAt: null,
    lastPriceSeenRecently: false,
    changesLast48h: 0,
    previousIsFirstRecord: false,
    lastPriceNearRecent: false,
    ...over,
    // Salvo que el test diga otra cosa: el mínimo se sostuvo y el precio anterior era el habitual.
    min30Held: over.min30Held ?? over.min30 ?? 50_000,
    usualPriceBefore: 'usualPriceBefore' in over ? over.usualPriceBefore ?? null : over.previousPrice ?? null,
    firstSeenAt: over.firstSeenAt ?? new Date(NOW - 20 * 86_400_000).toISOString(),
    trackedBeforeChangeMs:
      'trackedBeforeChangeMs' in over ? over.trackedBeforeChangeMs ?? null : (over.previousPrice ?? null) === null ? null : 18 * 86_400_000,
  };
}

/** La selección con puntajes armados a mano, por id. */
function select(
  deals: HomeDealProduct[],
  scores: Record<string, InterestScore>,
  now: number = NOW,
  stats: Map<string, PriceStats> = NO_STATS
) {
  return selectHomeDeals(deals, stats, now, { scoreOf: (p) => scores[p.id] });
}

/** Las mismas ofertas con la revisión de precios al día a la hora `now`. */
function recheck(deals: HomeDealProduct[], now: number): HomeDealProduct[] {
  return deals.map((d) => ({ ...d, price_checked_at: minutesAgo(10, now) }));
}

const ids = (products: { id: string }[]) => products.map((p) => p.id);

/** Barajado fijo, sin azar: la misma semilla da siempre el mismo orden. */
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

/** `count` ofertas que pueden encabezar: "s1" con 90 puntos, "s2" con 89, etc. */
function strictGroup(count: number): { deals: HomeDealProduct[]; scores: Record<string, InterestScore> } {
  const deals: HomeDealProduct[] = [];
  const scores: Record<string, InterestScore> = {};
  for (let i = 1; i <= count; i++) {
    deals.push(deal(`s${i}`));
    scores[`s${i}`] = scored(91 - i);
  }
  return { deals, scores };
}

// ---------------------------------------------------------------------------

describe('la hora de los tests', () => {
  it('es turno del primero para cualquier tamaño de grupo', () => {
    const hours = Math.floor(NOW / HOUR);
    expect(hours % 24).toBe(0);
    expect(Math.floor(hours / 24) % 60).toBe(0);
  });
});

describe('leadBlocker: cada regla por separado', () => {
  const clean = deal('a');
  const good = scored(60);

  it('una oferta sin nada raro puede encabezar, con historial quieto o sin historial', () => {
    expect(leadBlocker(clean, good, history(), NOW)).toBeNull();
    expect(leadBlocker(clean, good, null, NOW)).toBeNull();
    expect(leadBlocker(clean, good, undefined, NOW)).toBeNull();
  });

  it('con aviso no encabeza', () => {
    expect(leadBlocker(clean, scored(90, { warning: 'otro vendedor lo ofrece a menos' }), history(), NOW)).toBe('warning');
  });

  it('excluida no encabeza', () => {
    expect(leadBlocker(clean, scored(90, { excluded: 'sin precio válido' }), history(), NOW)).toBe('excluded');
  });

  it('bajo el piso de puntos no encabeza; justo en el piso sí', () => {
    expect(leadBlocker(clean, scored(MIN_INTEREST_POINTS - 0.1), history(), NOW)).toBe('low-interest');
    expect(leadBlocker(clean, scored(MIN_INTEREST_POINTS), history(), NOW)).toBeNull();
    expect(leadBlocker(clean, scored(NaN), history(), NOW)).toBe('low-interest');
  });

  it('con el precio revisado hace dos horas o más no encabeza', () => {
    expect(leadBlocker(deal('a', { price_checked_at: minutesAgo(119) }), good, history(), NOW)).toBeNull();
    expect(leadBlocker(deal('a', { price_checked_at: minutesAgo(120) }), good, history(), NOW)).toBe('stale-check');
    expect(leadBlocker(deal('a', { price_checked_at: minutesAgo(60 * 30) }), good, history(), NOW)).toBe('stale-check');
  });

  it('sin fecha de revisión, o con una que no sirve, no encabeza', () => {
    expect(leadBlocker(deal('a', { price_checked_at: null }), good, history(), NOW)).toBe('stale-check');
    expect(leadBlocker(deal('a', { price_checked_at: undefined }), good, history(), NOW)).toBe('stale-check');
    expect(leadBlocker(deal('a', { price_checked_at: 'ayer' }), good, history(), NOW)).toBe('stale-check');
    // Una fecha del futuro es un dato malo; un par de minutos de diferencia entre relojes, no.
    expect(leadBlocker(deal('a', { price_checked_at: minutesAgo(-90) }), good, history(), NOW)).toBe('stale-check');
    expect(leadBlocker(deal('a', { price_checked_at: minutesAgo(-2) }), good, history(), NOW)).toBeNull();
    expect(leadBlocker(clean, good, history(), NaN)).toBe('stale-check');
  });

  it('con más de un cambio de precio en 48 horas no encabeza', () => {
    expect(leadBlocker(clean, good, history({ changesLast48h: 1 }), NOW)).toBeNull();
    expect(leadBlocker(clean, good, history({ changesLast48h: 2 }), NOW)).toBe('recent-changes');
    expect(leadBlocker(clean, good, history({ changesLast48h: 7 }), NOW)).toBe('recent-changes');
  });

  it('si el historial no trae la cuenta de cambios, no se da por quieto', () => {
    const broken = { ...history(), changesLast48h: undefined } as unknown as PriceStats;
    expect(leadBlocker(clean, good, broken, NOW)).toBe('recent-changes');
  });

  it('un precio que no es el último registrado cuenta como un cambio más', () => {
    // El historial dice $55.000 y la ficha $50.000: cambió y todavía no se anotó.
    expect(leadBlocker(clean, good, history({ lastPrice: 55_000 }), NOW)).toBeNull();
    expect(leadBlocker(clean, good, history({ lastPrice: 55_000, changesLast48h: 1 }), NOW)).toBe('recent-changes');
  });

  it('un precio que va y vuelve no encabeza, hasta que lleva una semana quieto', () => {
    const seesaw = (days: number) =>
      history({ lastPriceSeenRecently: true, previousPrice: 55_000, lastChangeAt: new Date(NOW - days * DAY).toISOString() });
    expect(leadBlocker(clean, good, seesaw(3), NOW)).toBe('seesaw');
    expect(leadBlocker(clean, good, seesaw(10), NOW)).toBeNull();
  });

  it('si su único precio conocido empezó con un cambio, no encabeza por 30 días: no se sabe desde qué precio', () => {
    const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
    const single = history({ firstSeenAt: hoursAgo(5), daysTracked: 0 });
    // Agregado hace tres días, con un solo registro de hace cinco horas: pudo subir.
    expect(leadBlocker(deal('a', { created_at: hoursAgo(72) }), good, single, NOW)).toBe('recent-changes');
    // Sin fecha de alta se supone lo mismo.
    expect(leadBlocker(deal('a', { created_at: null }), good, single, NOW)).toBe('recent-changes');
    // Si ese registro es el de cuando se agregó, es su precio de partida.
    expect(leadBlocker(deal('a', { created_at: hoursAgo(5) }), good, single, NOW)).toBeNull();
    // No caduca a los dos días: mientras pueda haber estado más barato sin que conste, no encabeza.
    const old = deal('a', { created_at: new Date(NOW - 40 * DAY).toISOString() });
    expect(leadBlocker(old, good, history({ firstSeenAt: hoursAgo(49) }), NOW)).toBe('recent-changes');
    expect(leadBlocker(old, good, history({ firstSeenAt: new Date(NOW - 25 * DAY).toISOString() }), NOW)).toBe('recent-changes');
    expect(leadBlocker(old, good, history({ firstSeenAt: new Date(NOW - 31 * DAY).toISOString() }), NOW)).toBeNull();
  });

  it('si estuvo más barato un día o más en los últimos 30, no encabeza, aunque sea por poco', () => {
    // La ficha está a $50.000 y se sostuvo a $49.500: 1% arriba, que el puntaje perdona.
    expect(leadBlocker(clean, good, history({ min30: 49_500 }), NOW)).toBe('above-minimum');
    // Un precio más bajo que duró horas no cuenta: no se sostuvo.
    expect(leadBlocker(clean, good, history({ min30: 45_000, min30Held: 50_000 }), NOW)).toBeNull();
    expect(leadBlocker(clean, good, history({ min30: 50_000 }), NOW)).toBeNull();
  });

  it('reconoce los cambios y el vaivén en un historial de verdad', () => {
    const at = (hours: number) => new Date(NOW - hours * HOUR).toISOString();
    const twoChanges = priceStats(
      [
        { price: 60_000, observed_at: at(24 * 5) },
        { price: 55_000, observed_at: at(30) },
        { price: 50_000, observed_at: at(5) },
      ],
      NOW
    );
    expect(leadBlocker(clean, good, twoChanges, NOW)).toBe('recent-changes');

    const backAndForth = priceStats(
      [
        { price: 50_000, observed_at: at(24 * 10) },
        { price: 55_000, observed_at: at(24 * 4) },
        { price: 50_000, observed_at: at(60) },
      ],
      NOW
    );
    expect(leadBlocker(clean, good, backAndForth, NOW)).toBe('seesaw');

    const oneOldDrop = priceStats(
      [
        { price: 60_000, observed_at: at(24 * 10) },
        { price: 50_000, observed_at: at(24 * 4) },
      ],
      NOW
    );
    expect(leadBlocker(clean, good, oneOldDrop, NOW)).toBeNull();
  });

  it('con más de tres vendedores en la ficha no encabeza', () => {
    const withSellers = (count: number | null) => deal('a', { offer_info: { ...OFFER, offers_count: count } });
    expect(leadBlocker(withSellers(3), good, history(), NOW)).toBeNull();
    expect(leadBlocker(withSellers(4), good, history(), NOW)).toBe('many-sellers');
    expect(leadBlocker(withSellers(20), good, history(), NOW)).toBe('many-sellers');
  });

  it('si no se sabe cuántos vendedores hay, se permite', () => {
    expect(leadBlocker(deal('a', { offer_info: { ...OFFER, offers_count: null } }), good, history(), NOW)).toBeNull();
    expect(leadBlocker(deal('a', { offer_info: null }), good, history(), NOW)).toBeNull();
    expect(leadBlocker(deal('a', { offer_info: undefined }), good, history(), NOW)).toBeNull();
  });
});

describe('selectHomeDeals: quién puede encabezar', () => {
  // La oferta "x" tiene 90 puntos y un solo defecto; "y" llega justo al piso y no tiene ninguno.
  const DEFECTS: [string, LeadBlocker, { product?: Partial<HomeDealProduct>; score?: InterestScore; stats?: PriceStats }][] = [
    ['lleva aviso', 'warning', { score: scored(90, { warning: 'hace poco estuvo a $45.000' }) }],
    ['está excluida', 'excluded', { score: scored(90, { excluded: 'hoy cuesta 12% más que el mínimo' }) }],
    ['no llega al piso', 'low-interest', { score: scored(MIN_INTEREST_POINTS - 1) }],
    ['tiene la revisión de precio atrasada', 'stale-check', { product: { price_checked_at: minutesAgo(180) } }],
    ['cambió dos veces de precio en 48 horas', 'recent-changes', { stats: history({ changesLast48h: 2 }) }],
    [
      'tiene un precio que va y vuelve',
      'seesaw',
      { stats: history({ lastPriceSeenRecently: true, previousPrice: 55_000, lastChangeAt: new Date(NOW - 3 * DAY).toISOString() }) },
    ],
    ['la venden muchos', 'many-sellers', { product: { offer_info: { ...OFFER, offers_count: 12 } } }],
  ];

  it.each(DEFECTS)('si %s, no encabeza a ninguna hora, pero sí puede completar el bloque', (_label, blocker, defect) => {
    const x = deal('x', defect.product);
    const y = deal('y');
    const scores = { x: defect.score ?? scored(90), y: scored(MIN_INTEREST_POINTS) };
    const stats = new Map<string, PriceStats>(defect.stats ? [['x', defect.stats]] : []);

    expect(leadBlocker(x, scores.x, stats.get('x'), NOW)).toBe(blocker);

    const alone = select([x], scores, NOW, stats);
    expect(alone.spotlight).toBeNull();
    expect(ids(alone.block)).toEqual(['x']);

    for (let hour = 0; hour < 12; hour++) {
      const now = NOW + hour * HOUR;
      // La revisión sigue al día; el defecto de "x" se mantiene.
      const current = recheck([x, y], now).map((d) => (d.id === 'x' ? { ...d, ...defect.product } : d));
      const both = select(current, scores, now, stats);
      expect(both.spotlight?.id).toBe('y');
      expect(ids(both.block)).toEqual(['y', 'x']);
    }
  });

  it('sin ninguna oferta que pase las reglas no hay destacada, a ninguna hora', () => {
    const deals = [
      deal('aviso'),
      deal('vendedores', { offer_info: { ...OFFER, offers_count: 9 } }),
      deal('vieja', { price_checked_at: null }),
    ];
    const scores = {
      aviso: scored(95, { warning: 'la oferta es chica' }),
      vendedores: scored(90),
      vieja: scored(85),
    };
    for (let hour = 0; hour < 24; hour++) {
      const result = select(deals, scores, NOW + hour * HOUR);
      expect(result.spotlight).toBeNull();
      // Primero la que solo falla por la revisión; después, por interés.
      expect(ids(result.block)).toEqual(['vieja', 'aviso', 'vendedores']);
    }
  });

  it('sin ofertas no hay bloque', () => {
    expect(select([], {})).toEqual({ spotlight: null, block: [] });
  });
});

describe('selectHomeDeals: el relleno', () => {
  const dropped = (price: number) =>
    history({ lastPrice: price, min30: price, previousPrice: price * 2, lastChangeAt: new Date(NOW - 3 * DAY).toISOString() });

  const deals = [
    deal('estricta-1'),
    deal('estricta-2'),
    deal('aviso'),
    deal('vendedores', { offer_info: { ...OFFER, offers_count: 8 } }),
    deal('cambios'),
    deal('vieja', { price_checked_at: minutesAgo(600) }),
    deal('floja'),
    // Excluidas: solo entran al final, en el orden de /ofertas (primero la que
    // bajó según el historial, después por descuento sobre el precio de lista).
    deal('excluida-30', { price: 70_000, original_price: 100_000 }),
    deal('excluida-60', { price: 40_000, original_price: 100_000 }),
    deal('excluida-40-bajo', { price: 60_000, original_price: 100_000 }),
  ];
  const excluded = scored(99, { excluded: 'hoy cuesta 15% más que el mínimo' });
  const scores: Record<string, InterestScore> = {
    'estricta-1': scored(50),
    'estricta-2': scored(45),
    aviso: scored(95, { warning: 'otro vendedor lo ofrece a menos' }),
    vendedores: scored(80),
    cambios: scored(70),
    vieja: scored(60),
    floja: scored(12),
    'excluida-30': excluded,
    'excluida-60': excluded,
    'excluida-40-bajo': excluded,
  };
  const stats = new Map<string, PriceStats>([
    ['cambios', history({ changesLast48h: 3 })],
    ['excluida-40-bajo', dropped(60_000)],
  ]);

  it('primero las que pueden encabezar, después las de revisión atrasada, por interés y al final el orden de /ofertas', () => {
    const result = select(deals, scores, NOW, stats);
    expect(result.spotlight?.id).toBe('estricta-1');
    expect(ids(result.block)).toEqual([
      'estricta-1',
      'estricta-2',
      'vieja',
      'aviso',
      'vendedores',
      'cambios',
      'floja',
      'excluida-40-bajo',
      'excluida-60',
    ]);
  });

  it('el relleno por interés no deja entrar a las excluidas mientras quede otra', () => {
    const result = selectHomeDeals(deals, stats, NOW, { size: 7, scoreOf: (p) => scores[p.id] });
    expect(ids(result.block)).toEqual(['estricta-1', 'estricta-2', 'vieja', 'aviso', 'vendedores', 'cambios', 'floja']);
  });

  it('la primera nunca sale del relleno, aunque el relleno tenga más puntos', () => {
    for (let hour = 0; hour < 24; hour++) {
      const now = NOW + hour * HOUR;
      // La revisión sigue al día para todas menos para "vieja".
      const current = recheck(deals, now).map((d) => (d.id === 'vieja' ? { ...d, price_checked_at: minutesAgo(600, now) } : d));
      const result = select(current, scores, now, stats);
      expect(['estricta-1', 'estricta-2']).toContain(result.spotlight?.id);
      expect(result.block[0]).toBe(result.spotlight);
      expect(ids(result.block).slice(2)).toEqual([
        'vieja',
        'aviso',
        'vendedores',
        'cambios',
        'floja',
        'excluida-40-bajo',
        'excluida-60',
      ]);
    }
  });

  it('si la revisión de precios se atrasa, se queda sin destacada y el bloque sigue lleno', () => {
    const late = NOW + 3 * HOUR;
    const result = select(deals, scores, late, stats);
    expect(result.spotlight).toBeNull();
    expect(result.block).toHaveLength(HOME_DEALS_SIZE);
    // Siguen arriba las que pasarían todo si la revisión estuviera al día, por
    // puntos; las de muchos vendedores o precio movido no se cuelan entre ellas.
    expect(ids(result.block).slice(0, 6)).toEqual(['vieja', 'estricta-1', 'estricta-2', 'aviso', 'vendedores', 'cambios']);
  });

  it('una oferta cuyo historial no se pudo leer no encabeza y solo entra al final', () => {
    const unread = new Set(['estricta-1']);
    const result = selectHomeDeals(deals, stats, NOW, { unread, scoreOf: (p) => scores[p.id] });
    expect(result.spotlight?.id).toBe('estricta-2');
    // Ni en el relleno por interés: recién con el orden de /ofertas, si sobra lugar.
    expect(ids(result.block).slice(0, 6)).toEqual(['estricta-2', 'vieja', 'aviso', 'vendedores', 'cambios', 'floja']);
    expect(ids(result.block).indexOf('estricta-1')).toBeGreaterThanOrEqual(6);
    // Con el puntaje de verdad, además, queda con su aviso.
    expect(leadBlocker(deals[0], scores['estricta-1'], undefined, NOW, true)).toBe('history-unread');
    expect(leadBlocker(deals[0], scores['estricta-1'], undefined, NOW, false)).toBeNull();
  });

  it('si no se pudo leer el historial de ninguna, no hay destacada y el bloque va por interés, no por descuento', () => {
    const unread = new Set(deals.map((d) => d.id));
    const result = selectHomeDeals(deals, new Map(), NOW, { unread, scoreOf: (p) => scores[p.id] });
    expect(result.spotlight).toBeNull();
    // Las de más puntos primero, también las que quedarían bajo el piso; las excluidas, al final.
    expect(ids(result.block).slice(0, 7)).toEqual(['aviso', 'vendedores', 'cambios', 'vieja', 'estricta-1', 'estricta-2', 'floja']);
  });

  it('una no leída no pasa delante de una leída, aunque tenga más puntos', () => {
    const unread = new Set(['aviso', 'vendedores']);
    const result = selectHomeDeals(deals, stats, NOW, { size: 7, unread, scoreOf: (p) => scores[p.id] });
    expect(ids(result.block)).toEqual(['estricta-1', 'estricta-2', 'vieja', 'cambios', 'floja', 'aviso', 'vendedores']);
  });

  it('el bloque no pasa de su tamaño ni repite ofertas', () => {
    const { deals: many, scores: manyScores } = strictGroup(30);
    const result = select([...many, ...many], manyScores);
    expect(result.block).toHaveLength(HOME_DEALS_SIZE);
    expect(new Set(ids(result.block)).size).toBe(HOME_DEALS_SIZE);

    const few = select(many.slice(0, 4), manyScores);
    expect(ids(few.block)).toEqual(['s1', 's2', 's3', 's4']);
  });
});

describe('selectHomeDeals: variedad', () => {
  it('a lo más tres por categoría, una por tipo y dos por marca', () => {
    const make = (id: string, category: string, typeKey: string, brandKey: string, points: number) => ({
      deal: deal(id, { category }),
      score: scored(points, { typeKey, brandKey }),
    });
    const rows = [
      make('audio-1', 'audio', 'Parlante', '', 99),
      make('audio-2', 'audio', 'Audífonos', '', 98),
      make('audio-3', 'audio', 'Barra de sonido', '', 97),
      make('audio-4', 'audio', 'Radio', '', 96),
      make('tv-1', 'electronica', 'Smart TV', '', 95),
      make('tv-2', 'electronica', 'Smart TV', '', 94),
      make('jbl-1', 'c1', 'Tipo 1', 'jbl', 93),
      make('jbl-2', 'c2', 'Tipo 2', 'jbl', 92),
      make('jbl-3', 'c3', 'Tipo 3', 'jbl', 91),
      make('otra-1', 'c4', 'Tipo 4', '', 80),
      make('otra-2', 'c5', 'Tipo 5', '', 79),
      make('otra-3', 'c6', 'Tipo 6', '', 78),
      make('otra-4', 'c7', 'Tipo 7', '', 77),
    ];
    const scores: Record<string, InterestScore> = {};
    for (const row of rows) scores[row.deal.id] = row.score;

    const result = select(rows.map((row) => row.deal), scores);
    // Quedan fuera audio-4 (cuarta de su categoría), tv-2 (segundo televisor)
    // y jbl-3 (tercera de la marca), aunque tengan más puntos que las últimas.
    expect(ids(result.block)).toEqual(['audio-1', 'audio-2', 'audio-3', 'tv-1', 'jbl-1', 'jbl-2', 'otra-1', 'otra-2', 'otra-3']);
  });
});

describe('selectHomeDeals: la rotación', () => {
  it('cada hora encabeza otra de las seis primeras, y da la vuelta', () => {
    const { deals, scores } = strictGroup(9);
    const leads: string[] = [];
    for (let hour = 0; hour < 13; hour++) {
      const now = NOW + hour * HOUR;
      const result = select(recheck(deals, now), scores, now);
      leads.push(result.spotlight?.id ?? '-');
      // Las demás conservan su orden.
      expect(ids(result.block.slice(1))).toEqual(ids(deals).filter((id) => id !== result.spotlight?.id));
      expect(result.block[0]).toBe(result.spotlight);
    }
    expect(HOME_LEAD_ROTATION).toBe(6);
    expect(leads).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's1', 's2', 's3', 's4', 's5', 's6', 's1']);
  });

  it('con menos candidatas, se turnan las que hay', () => {
    const { deals, scores } = strictGroup(3);
    const leads: string[] = [];
    for (let hour = 0; hour < 7; hour++) {
      const now = NOW + hour * HOUR;
      leads.push(select(recheck(deals, now), scores, now).spotlight?.id ?? '-');
    }
    expect(leads).toEqual(['s1', 's2', 's3', 's1', 's2', 's3', 's1']);

    const one = strictGroup(1);
    for (let hour = 0; hour < 5; hour++) {
      const now = NOW + hour * HOUR;
      expect(select(recheck(one.deals, now), one.scores, now).spotlight?.id).toBe('s1');
    }
  });

  it('con un bloque más chico, se turnan solo las que caben en él', () => {
    const { deals, scores } = strictGroup(9);
    const leads: string[] = [];
    for (let hour = 0; hour < 6; hour++) {
      const now = NOW + hour * HOUR;
      const result = selectHomeDeals(recheck(deals, now), NO_STATS, now, { size: 3, scoreOf: (p) => scores[p.id] });
      leads.push(result.spotlight?.id ?? '-');
      expect(ids(result.block).sort()).toEqual(['s1', 's2', 's3']);
    }
    expect(leads).toEqual(['s1', 's2', 's3', 's1', 's2', 's3']);
  });

  it('dentro de la misma hora sale siempre lo mismo', () => {
    const { deals, scores } = strictGroup(9);
    const start = new Date('2026-11-03T01:00:00.000Z').getTime();
    // Revisadas justo antes de empezar la hora, para que sirvan durante toda ella.
    const current = deals.map((d) => ({ ...d, price_checked_at: minutesAgo(2, start) }));
    const first = select(current, scores, start);
    expect(first.spotlight?.id).toBe('s2');
    for (const offset of [1, 5 * 60_000, 20 * 60_000, 59 * 60_000, HOUR - 1]) {
      expect(select(current, scores, start + offset)).toEqual(first);
    }
    expect(select(current, scores, start + HOUR).spotlight?.id).toBe('s3');
    expect(select(current, scores, start - 1).spotlight?.id).toBe('s1');
  });

  it('a la misma hora del día siguiente encabeza otra', () => {
    for (const count of [2, 3, 4, 5, 6, 9]) {
      const { deals, scores } = strictGroup(count);
      const turns = Math.min(count, HOME_LEAD_ROTATION);
      const leads: string[] = [];
      for (let day = 0; day <= turns; day++) {
        const now = NOW + day * DAY;
        leads.push(select(recheck(deals, now), scores, now).spotlight?.id ?? '-');
      }
      // Cada día parte un puesto más allá, hasta dar la vuelta.
      expect(leads).toEqual(Array.from({ length: turns + 1 }, (_, day) => `s${(day % turns) + 1}`));
    }
  });

  it('al pasar de un día al otro también cambia la que encabeza', () => {
    for (const count of [3, 4, 5, 6, 9]) {
      const { deals, scores } = strictGroup(count);
      let previous = '';
      // Tres días seguidos, hora por hora: nunca la misma dos horas seguidas.
      for (let hour = 0; hour < 72; hour++) {
        const now = NOW + hour * HOUR;
        const lead = select(recheck(deals, now), scores, now).spotlight?.id ?? '-';
        expect(lead).not.toBe(previous);
        previous = lead;
      }
    }
  });

  it('solo se turnan las que pueden encabezar', () => {
    const { deals, scores } = strictGroup(2);
    const withFill = [...deals, deal('relleno', { offer_info: { ...OFFER, offers_count: 15 } })];
    const allScores = { ...scores, relleno: scored(99) };
    const leads = new Set<string>();
    for (let hour = 0; hour < 24; hour++) {
      const now = NOW + hour * HOUR;
      const result = select(recheck(withFill, now), allScores, now);
      leads.add(result.spotlight?.id ?? '-');
      expect(result.block[2].id).toBe('relleno');
    }
    expect([...leads].sort()).toEqual(['s1', 's2']);
  });
});

describe('selectHomeDeals: no depende de la entrada ni la toca', () => {
  const { deals: strict, scores: strictScores } = strictGroup(7);
  const deals = [
    ...strict,
    // Dos con los mismos puntos: las ordena el id.
    deal('empate-b'),
    deal('empate-a'),
    deal('aviso'),
    deal('vendedores', { offer_info: { ...OFFER, offers_count: 6 } }),
    deal('excluida-1', { price: 30_000 }),
    deal('excluida-2', { price: 35_000 }),
    deal('excluida-3', { price: 35_000 }),
  ];
  const scores: Record<string, InterestScore> = {
    ...strictScores,
    'empate-a': scored(50),
    'empate-b': scored(50),
    aviso: scored(70, { warning: 'la oferta es chica' }),
    vendedores: scored(65),
    'excluida-1': scored(10, { excluded: 'x' }),
    'excluida-2': scored(10, { excluded: 'x' }),
    'excluida-3': scored(10, { excluded: 'x' }),
  };

  it('la entrada barajada da el mismo resultado', () => {
    for (const size of [HOME_DEALS_SIZE, deals.length]) {
      for (const hour of [0, 1, 5, 6, 17]) {
        const now = NOW + hour * HOUR;
        const current = recheck(deals, now);
        const run = (list: HomeDealProduct[]) => {
          const result = selectHomeDeals(list, NO_STATS, now, { size, scoreOf: (p) => scores[p.id] });
          return { spotlight: result.spotlight?.id ?? null, block: ids(result.block) };
        };
        const expected = run(current);
        expect(expected.block).toHaveLength(size);
        expect(run([...current].reverse())).toEqual(expected);
        for (let seed = 1; seed <= 8; seed++) expect(run(shuffled(current, seed))).toEqual(expected);
      }
    }
  });

  it('con todo el bloque a la vista, el orden es el esperado', () => {
    const result = selectHomeDeals(deals, NO_STATS, NOW, { size: deals.length, scoreOf: (p) => scores[p.id] });
    expect(ids(result.block)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
      's6',
      's7',
      'empate-a',
      'empate-b',
      'aviso',
      'vendedores',
      'excluida-1',
      'excluida-2',
      'excluida-3',
    ]);
  });

  it('no muta la lista, las ofertas ni el historial', () => {
    const stats = new Map<string, PriceStats>([
      ['s1', history()],
      ['s2', history({ changesLast48h: 4 })],
    ]);
    const frozen: HomeDealProduct[] = deals.map((d) =>
      Object.freeze({ ...d, offer_info: d.offer_info ? Object.freeze({ ...d.offer_info }) : d.offer_info })
    );
    const input = Object.freeze([...frozen]) as HomeDealProduct[];
    const before = JSON.stringify(input);
    const statsBefore = JSON.stringify([...stats]);
    Object.freeze(stats.get('s1'));
    Object.freeze(stats.get('s2'));

    const result = select(input, scores, NOW, stats);

    expect(JSON.stringify(input)).toBe(before);
    expect(ids(input)).toEqual(ids(deals));
    expect(JSON.stringify([...stats])).toBe(statsBefore);
    // Devuelve los mismos objetos que recibió, no copias.
    expect(result.block.every((p) => frozen.indexOf(p) >= 0)).toBe(true);
  });
});

describe('selectHomeDeals: con el puntaje de verdad', () => {
  /** El cargador del reclamo del dueño, con sus datos del catálogo. */
  const CHARGER = deal('cargador', {
    name: 'Cargador Original Ultra Fast 45w Para Samsung USB-C',
    brand: 'Samsung',
    category: 'electronica',
    price: 7_990,
    original_price: 19_990,
    seller_sales_count: 2_820,
    ml_root_category: 'MLC1051',
    ml_category_id: 'MLC157684',
    offer_info: {
      free_shipping: false,
      is_full: false,
      official_store: false,
      sold_by_ml: false,
      is_lowest: true,
      warranty: 'Garantía de fábrica: 6 meses',
      offers_count: 20,
    },
  });
  /** Cuatro días al mismo precio: sin cambios en 48 horas. */
  const CHARGER_STATS = history({
    min30: 7_990,
    median30: 7_990,
    max30: 7_990,
    minTracked: 7_990,
    maxTracked: 7_990,
    daysTracked: 4,
    lastPrice: 7_990,
  });

  /** Un televisor de marca conocida, de tienda oficial, que bajó hace cinco días. */
  const TV = deal('tv', {
    name: 'Smart TV Samsung 55" Crystal UHD 4K',
    brand: 'Samsung',
    category: 'electronica',
    price: 316_000,
    original_price: 500_000,
    seller_sales_count: 30_000,
    ml_category_id: 'MLC1002',
    offer_info: {
      free_shipping: true,
      is_full: true,
      official_store: true,
      sold_by_ml: false,
      is_lowest: true,
      warranty: 'Garantía de fábrica: 12 meses',
      offers_count: 1,
    },
  });
  const TV_STATS = history({
    min30: 316_000,
    median30: 420_000,
    max30: 420_000,
    minTracked: 316_000,
    maxTracked: 420_000,
    lastPrice: 316_000,
    previousPrice: 420_000,
    lastChangeAt: new Date(NOW - 5 * DAY).toISOString(),
  });

  /** Un cable sin marca con un descuento de lista enorme, de un vendedor chico. */
  const CABLE = deal('cable', {
    name: 'Cable Usb Tipo C Carga Rapida 1 Metro',
    brand: 'Genérica',
    category: 'electronica',
    price: 1_990,
    original_price: 9_990,
    seller_sales_count: 40,
    offer_info: {
      free_shipping: false,
      is_full: false,
      official_store: false,
      sold_by_ml: false,
      is_lowest: false,
      warranty: null,
      offers_count: 1,
    },
  });

  const stats = new Map<string, PriceStats>([
    ['cargador', CHARGER_STATS],
    ['tv', TV_STATS],
  ]);

  it('el cargador del reclamo nunca encabeza: solo, no hay destacada', () => {
    for (let hour = 0; hour < 48; hour++) {
      const now = NOW + hour * HOUR;
      const result = selectHomeDeals(recheck([CHARGER], now), stats, now);
      expect(result.spotlight).toBeNull();
      expect(ids(result.block)).toEqual(['cargador']);
    }
  });

  it('el cargador no encabeza ni con el mejor puntaje posible: lo venden veinte', () => {
    expect(leadBlocker(CHARGER, scored(100), CHARGER_STATS, NOW)).toBe('many-sellers');
    expect(leadBlocker(CHARGER, scored(100), null, NOW)).toBe('many-sellers');
    for (let hour = 0; hour < 48; hour++) {
      const now = NOW + hour * HOUR;
      const result = selectHomeDeals(recheck([CHARGER], now), stats, now, { scoreOf: () => scored(100) });
      expect(result.spotlight).toBeNull();
    }
  });

  it('con una oferta de verdad al lado, encabeza ella y el cargador va detrás', () => {
    for (let hour = 0; hour < 48; hour++) {
      const now = NOW + hour * HOUR;
      // En el orden de antes (por descuento) el cable y el cargador iban primero.
      const result = selectHomeDeals(recheck([CABLE, CHARGER, TV], now), stats, now);
      expect(result.spotlight?.id).toBe('tv');
      expect(result.block[0].id).toBe('tv');
      expect(ids(result.block).sort()).toEqual(['cable', 'cargador', 'tv']);
    }
  });

  it('usa el historial: si hace poco estuvo mucho más barato, no encabeza', () => {
    const cheaperBefore = new Map<string, PriceStats>([
      ['tv', history({ min30: 200_000, median30: 316_000, max30: 316_000, minTracked: 200_000, maxTracked: 316_000, lastPrice: 316_000 })],
    ]);
    const result = selectHomeDeals([TV], cheaperBefore, NOW);
    expect(result.spotlight).toBeNull();
    expect(ids(result.block)).toEqual(['tv']);
  });
});
