import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// lib/settings usa `cache` de React, que solo existe dentro de los
// componentes de servidor de Next. Acá no se necesita: decide y applyPricing
// no leen la configuración.
vi.mock('@/lib/settings', () => ({
  readAffiliateSettings: async () => ({ word: null, tool: null, directLinks: false }),
}));
// Nunca se consulta ML de verdad: cada test dice qué devuelve cada endpoint.
const ml = vi.hoisted(() => ({
  getWinners: vi.fn(),
  getSellers: vi.fn(),
  getRootCategory: vi.fn(),
}));
vi.mock('@/lib/ml-catalog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ml-catalog')>()),
  getWinners: ml.getWinners,
  getSellers: ml.getSellers,
  getRootCategory: ml.getRootCategory,
}));
import {
  applyPricing,
  decide,
  offerInfoFrom,
  priceProducts,
  pricingConcurrency,
  priorityOutcomes,
  salesCountWorthWriting,
  summarizePricing,
  type PricedProduct,
  type PricingOutcome,
} from '@/lib/pricing';
import type { MlOffer, MlSeller, WinnersResult } from '@/lib/ml-catalog';

const NOW = '2026-10-04T12:00:00.000Z';
const EARLIER = '2026-10-01T09:00:00.000Z';

function product(overrides: Partial<PricedProduct> = {}): PricedProduct {
  return {
    id: 'p1',
    ml_product_id: 'MLC100',
    affiliate_url: 'https://meli.la/abc',
    price: 50_000,
    original_price: 60_000,
    seller_id: 7,
    seller_sales_count: 1200,
    is_active: true,
    inactive_reason: null,
    inactive_since: null,
    winner_item_id: 'MLC900',
    link_target_product_id: 'MLC100',
    link_checked_at: EARLIER,
    ...overrides,
  };
}

function offer(overrides: Partial<MlOffer> = {}): MlOffer {
  return {
    item_id: 'MLC900',
    seller_id: 7,
    price: 50_000,
    original_price: 60_000,
    ...overrides,
  };
}

function ok(offers: MlOffer[], total = offers.length): WinnersResult {
  return { status: 'ok', offers, total };
}

const GREEN: MlSeller = { id: 7, nickname: 'TIENDA', levelId: '5_green', salesCount: 1200 };
const ORANGE: MlSeller = { id: 7, nickname: 'TIENDA', levelId: '3_orange', salesCount: 1200 };
const sellers = (s: MlSeller) => new Map([[s.id, s]]);

describe('decide', () => {
  it('un error de la API deja el patch vacío', () => {
    const out = decide(product(), { status: 'error', detail: 'HTTP 500' }, new Map(), NOW, true);
    expect(out.result).toBe('error_transitorio');
    expect(out.patch).toEqual({});
    expect(out.observation).toBeUndefined();
  });

  it('sin ganador en un activo lo pausa con inactive_since', () => {
    const out = decide(product(), { status: 'no_winner' }, new Map(), NOW, true);
    expect(out.result).toBe('sin_ganador');
    expect(out.patch).toMatchObject({
      is_active: false,
      inactive_reason: 'sin_ganador',
      inactive_since: NOW,
      price_checked_at: NOW,
    });
    expect(out.deactivated).toBe(true);
  });

  it('sin ganador en un inactivo no pisa inactive_since', () => {
    const out = decide(
      product({ is_active: false, inactive_reason: 'sin_ganador', inactive_since: EARLIER }),
      { status: 'no_winner' },
      new Map(),
      NOW,
      true
    );
    expect(out.result).toBe('sin_ganador');
    expect(out.patch).not.toHaveProperty('inactive_since');
    expect(out.patch).not.toHaveProperty('is_active');
    expect(out.patch).not.toHaveProperty('inactive_reason');
    expect(out.deactivated).toBe(false);
  });

  it('sin la reputación del vendedor no decide nada', () => {
    const out = decide(product(), ok([offer({ seller_id: 99 })]), sellers(GREEN), NOW, true);
    expect(out.result).toBe('error_transitorio');
    expect(out.patch).toEqual({});
  });

  it('ganador no verde: pausa el producto pero actualiza el precio', () => {
    const out = decide(product(), ok([offer({ price: 45_000 })]), sellers(ORANGE), NOW, true);
    expect(out.result).toBe('ganador_no_verde');
    expect(out.patch).toMatchObject({ price: 45_000, is_active: false, inactive_reason: 'ganador_no_verde' });
    expect(out.priceChanged).toBe(true);
  });

  it('link cruzado: lo pausa si se revisa el link, y no si los links son directos', () => {
    const crossed = product({ link_target_product_id: 'MLC555' });
    const checked = decide(crossed, ok([offer()]), sellers(GREEN), NOW, true);
    expect(checked.result).toBe('link_otro_producto');
    expect(checked.patch).toMatchObject({ is_active: false, inactive_reason: 'link_otro_producto' });

    const direct = decide(crossed, ok([offer()]), sellers(GREEN), NOW, false);
    expect(direct.result).toBe('activo');
    expect(direct.patch).not.toHaveProperty('is_active');
  });

  it('la reactivación limpia los campos de pausa', () => {
    const out = decide(
      product({ is_active: false, inactive_reason: 'sin_ganador', inactive_since: EARLIER }),
      ok([offer()]),
      sellers(GREEN),
      NOW,
      true
    );
    expect(out.result).toBe('activo');
    expect(out.reactivated).toBe(true);
    expect(out.patch).toMatchObject({ is_active: true, inactive_reason: null, inactive_since: null });
  });

  it('un precio de lista igual o menor al precio queda en null', () => {
    const same = decide(product(), ok([offer({ original_price: 50_000 })]), sellers(GREEN), NOW, true);
    expect(same.patch.original_price).toBeNull();

    const lower = decide(product(), ok([offer({ original_price: 40_000 })]), sellers(GREEN), NOW, true);
    expect(lower.patch.original_price).toBeNull();
  });

  it('sin cambios de precio no agrega nada al historial', () => {
    const out = decide(product(), ok([offer()]), sellers(GREEN), NOW, true);
    expect(out.priceChanged).toBe(false);
    expect(out.observation).toBeUndefined();
    expect(out.patch).not.toHaveProperty('price');
  });

  it('un cambio de precio arma la fila del historial', () => {
    const out = decide(product(), ok([offer({ price: 47_990, item_id: 'MLC901' })]), sellers(GREEN), NOW, true);
    expect(out.observation).toEqual({
      product_id: 'p1',
      ml_product_id: 'MLC100',
      price: 47_990,
      original_price: 60_000,
      seller_id: 7,
      winner_item_id: 'MLC901',
      observed_at: NOW,
    });
  });

  it('escribe offer_info, la categoría y su raíz', () => {
    const roots = new Map([['MLC3697', 'MLC1000']]);
    const out = decide(
      product(),
      ok([offer({ category_id: 'MLC3697', shipping: { free_shipping: true, logistic_type: 'fulfillment' } })]),
      sellers(GREEN),
      NOW,
      true,
      roots
    );
    expect(out.patch).toMatchObject({
      ml_category_id: 'MLC3697',
      ml_root_category: 'MLC1000',
      offer_info: { free_shipping: true, is_full: true },
    });
  });

  it('no reescribe la categoría ni offer_info si no cambiaron', () => {
    const info = offerInfoFrom([offer({ category_id: 'MLC3697' })], 1);
    const out = decide(
      product({ ml_category_id: 'MLC3697', ml_root_category: 'MLC1000', offer_info: info }),
      ok([offer({ category_id: 'MLC3697' })]),
      sellers(GREEN),
      NOW,
      true,
      new Map([['MLC3697', 'MLC1000']])
    );
    expect(out.patch).not.toHaveProperty('ml_category_id');
    expect(out.patch).not.toHaveProperty('ml_root_category');
    expect(out.patch).not.toHaveProperty('offer_info');
  });
});

describe('offerInfoFrom', () => {
  it('lee las señales del ganador (caso JBL Grip)', () => {
    const info = offerInfoFrom(
      [
        offer({
          price: 64_990,
          shipping: { free_shipping: true, logistic_type: 'fulfillment' },
          official_store_id: 1234,
          sale_terms: [
            { id: 'WARRANTY_TYPE', value_name: 'Garantía de fábrica' },
            { id: 'WARRANTY_TIME', value_name: '2 años' },
          ],
          tags: [],
        }),
        offer({ seller_id: 8, price: 69_990 }),
      ],
      2
    );
    expect(info).toEqual({
      free_shipping: true,
      is_full: true,
      sold_by_ml: false,
      official_store: true,
      warranty: 'Garantía de fábrica: 2 años',
      offers_count: 2,
      is_lowest: true,
    });
  });

  it('no supone nada que ML no diga', () => {
    const info = offerInfoFrom([offer()], 1);
    expect(info).toEqual({
      free_shipping: false,
      is_full: false,
      sold_by_ml: false,
      official_store: false,
      warranty: null,
      offers_count: 1,
      is_lowest: true,
    });
  });

  it('prefiere el texto de warranty y descarta "Sin garantía"', () => {
    expect(offerInfoFrom([offer({ warranty: 'Garantía del vendedor: 6 meses' })], 1).warranty).toBe(
      'Garantía del vendedor: 6 meses'
    );
    expect(offerInfoFrom([offer({ warranty: 'Sin garantía' })], 1).warranty).toBeNull();
    expect(
      offerInfoFrom([offer({ sale_terms: [{ id: 'WARRANTY_TYPE', value_name: 'Sin garantía' }] })], 1).warranty
    ).toBeNull();
    expect(offerInfoFrom([offer({ warranty: '  ' })], 1).warranty).toBeNull();
  });

  it('vendido por Mercado Libre con el tag first_party', () => {
    expect(offerInfoFrom([offer({ tags: ['first_party'] })], 1).sold_by_ml).toBe(true);
  });

  it('is_lowest compara contra la oferta más barata', () => {
    expect(offerInfoFrom([offer({ price: 55_000 }), offer({ seller_id: 8, price: 50_000 })], 2).is_lowest).toBe(
      false
    );
  });

  it('is_lowest queda sin saber si ML no mandó todas las ofertas', () => {
    expect(offerInfoFrom([offer()], 15).is_lowest).toBeNull();
  });
});

/** Respuesta de una consulta que se queda colgada. */
const HANG = Symbol('sin respuesta');

/**
 * Cliente falso de Supabase: registra cada update e insert y responde lo
 * que diga `respond`.
 */
function fakeAdmin(respond: {
  update?: (patch: Record<string, unknown>) => { code: string; message: string } | null;
  bulk?: () => { code: string; message: string } | null;
  insert?: () => { code: string; message: string } | null;
  /** Cuántas filas de historial tiene el producto (por defecto, alguna). Un error: la consulta falla. */
  historyRows?: (productId: string) => number | { code: string; message: string };
  /** Cuándo se agregó cada producto al sitio. Un error: la consulta falla. HANG: nunca responde. */
  createdAt?: (ids: string[]) => Record<string, string> | { code: string; message: string } | typeof HANG;
}) {
  const updates: Record<string, unknown>[] = [];
  const bulk: { patch: Record<string, unknown>; ids: string[] }[] = [];
  const inserts: { table: string; rows: unknown[] }[] = [];
  const client = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq: async () => {
              updates.push(patch);
              return { error: respond.update?.(patch) ?? null };
            },
            in: async (_column: string, ids: string[]) => {
              bulk.push({ patch, ids });
              return { error: respond.bulk?.() ?? null };
            },
          };
        },
        insert: async (rows: unknown[]) => {
          inserts.push({ table, rows });
          return { error: respond.insert?.() ?? null };
        },
        select() {
          return {
            // price_history: ¿tiene alguna fila este producto?
            eq: (_column: string, productId: string) => ({
              limit: async () => {
                const rows = respond.historyRows ? respond.historyRows(productId) : 1;
                if (typeof rows !== 'number') return { data: null, error: rows };
                return { data: Array.from({ length: Math.min(rows, 1) }, (_, i) => ({ id: i + 1 })), error: null };
              },
            }),
            // products: desde cuándo están en el sitio.
            in: async (_column: string, ids: string[]) => {
              const answer = respond.createdAt ? respond.createdAt(ids) : {};
              if (answer === HANG) return new Promise<never>(() => {});
              if ('code' in answer && 'message' in answer) return { data: null, error: answer };
              const dates = answer as Record<string, string>;
              return { data: ids.filter((id) => dates[id]).map((id) => ({ id, created_at: dates[id] })), error: null };
            },
          };
        },
      };
    },
  };
  return { admin: client as unknown as SupabaseClient, updates, bulk, inserts };
}

/** Un producto revisado sin ningún cambio: solo hay que anotar la hora. */
function touchedOutcome(id: string): PricingOutcome {
  return {
    id,
    result: 'activo',
    patch: { price_checked_at: NOW },
    priceChanged: false,
    reactivated: false,
    deactivated: false,
  };
}

function changedOutcome(id: string): PricingOutcome {
  return decide(
    product({ id }),
    ok([offer({ price: 45_000, category_id: 'MLC3697' })]),
    sellers(GREEN),
    NOW,
    true,
    new Map([['MLC3697', 'MLC1000']])
  );
}

describe('applyPricing', () => {
  it('con un precio cambiado inserta 1 fila en price_history', async () => {
    const unchanged = decide(product({ id: 'p2' }), ok([offer()]), sellers(GREEN), NOW, true);
    const { admin, updates, inserts } = fakeAdmin({});

    const failed = await applyPricing(admin, [changedOutcome('p1'), unchanged]);

    expect(failed).toBe(0);
    expect(updates).toHaveLength(2);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('price_history');
    expect(inserts[0].rows).toHaveLength(1);
    expect(inserts[0].rows[0]).toMatchObject({ product_id: 'p1', price: 45_000 });
  });

  it('sin la migración 0016 reintenta sin las columnas nuevas y sigue funcionando', async () => {
    const missingColumn = { code: 'PGRST204', message: "Could not find the 'offer_info' column" };
    const missingTable = { code: 'PGRST205', message: "Could not find the table 'public.price_history'" };
    const { admin, updates, inserts } = fakeAdmin({
      update: (patch) => ('offer_info' in patch || 'ml_category_id' in patch ? missingColumn : null),
      insert: () => missingTable,
    });

    const failed = await applyPricing(admin, [changedOutcome('p1'), changedOutcome('p2')], 1);

    expect(failed).toBe(0);
    // p1: intento con columnas nuevas + reintento; p2: ya va sin ellas.
    expect(updates).toHaveLength(3);
    const last = updates[updates.length - 1];
    expect(last).toHaveProperty('price', 45_000);
    expect(last).not.toHaveProperty('offer_info');
    expect(last).not.toHaveProperty('ml_root_category');
    expect(inserts).toHaveLength(1);
  });

  it('los que no cambiaron se anotan en bloque, no de a uno', async () => {
    const same = Array.from({ length: 250 }, (_, i) => touchedOutcome(`t${i}`));
    const { admin, updates, bulk, inserts } = fakeAdmin({});

    const failed = await applyPricing(admin, [...same, changedOutcome('p1')]);

    expect(failed).toBe(0);
    // El que cambió va con su propia escritura; los 250 iguales, en 3 consultas.
    expect(updates).toHaveLength(1);
    expect(bulk.map((b) => b.ids.length)).toEqual([100, 100, 50]);
    expect(bulk.every((b) => Object.keys(b.patch).join() === 'price_checked_at')).toBe(true);
    expect(new Set(bulk.flatMap((b) => b.ids)).size).toBe(250);
    expect(inserts).toHaveLength(1);
  });

  it('si falla una escritura en bloque, cuenta todos sus productos como fallidos', async () => {
    const { admin } = fakeAdmin({ bulk: () => ({ code: '500', message: 'caído' }) });
    const failed = await applyPricing(
      admin,
      Array.from({ length: 120 }, (_, i) => touchedOutcome(`t${i}`))
    );
    expect(failed).toBe(120);
  });

  describe('la fila de partida', () => {
    const DAYS_AGO = new Date(Date.now() - 3 * 86_400_000).toISOString();

    it('el primer cambio de un producto sin historial guarda también el precio que tenía, con la fecha en que se agregó', async () => {
      const { admin, inserts } = fakeAdmin({ historyRows: () => 0, createdAt: () => ({ p1: DAYS_AGO }) });

      await applyPricing(admin, [changedOutcome('p1')]);

      // Dos escrituras: primero el cambio, después la partida. Una partida mal armada no puede llevarse el cambio.
      expect(inserts.map((insert) => insert.table)).toEqual(['price_history', 'price_history']);
      expect(inserts[0].rows).toEqual([expect.objectContaining({ product_id: 'p1', price: 45_000, observed_at: NOW })]);
      // Lo que tenía desde que se agregó: sin esto no se sabría si subió o bajó.
      expect(inserts[1].rows).toEqual([
        { product_id: 'p1', ml_product_id: 'MLC100', price: 50_000, original_price: 60_000, seller_id: 7, winner_item_id: 'MLC900', observed_at: DAYS_AGO },
      ]);
    });

    it('si el producto nunca tuvo un ganador revisado, su precio de alta no es una partida', async () => {
      // Recién aprobado trae el precio del candidato; nadie lo comparó todavía con Mercado Libre.
      const unverified = decide(
        product({ id: 'p1', winner_item_id: null }),
        ok([offer({ price: 45_000 })]),
        sellers(GREEN),
        NOW,
        true
      );
      expect(unverified.observation).toMatchObject({ price: 45_000 });
      expect(unverified.previous).toBeUndefined();
      const { admin, inserts } = fakeAdmin({ historyRows: () => 0, createdAt: () => ({ p1: DAYS_AGO }) });
      await applyPricing(admin, [unverified]);
      expect(inserts).toHaveLength(1);
      expect(inserts[0].rows).toHaveLength(1);
      // Tampoco con precio 0.
      expect(decide(product({ price: 0 }), ok([offer({ price: 45_000 })]), sellers(GREEN), NOW, true).previous).toBeUndefined();
    });

    it('si la consulta por las partidas falla de golpe o no responde, el cambio se anota igual', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const rejecting = fakeAdmin({
        historyRows: () => {
          throw new Error('fetch failed');
        },
      });
      await applyPricing(rejecting.admin, [changedOutcome('p1')]);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
      expect(rejecting.inserts).toHaveLength(1);
      expect(rejecting.inserts[0].rows).toEqual([expect.objectContaining({ product_id: 'p1', price: 45_000 })]);

      // Una consulta que nunca responde: pasado el tope, la corrida sigue sin partidas.
      vi.useFakeTimers();
      try {
        const hanging = fakeAdmin({ historyRows: () => 0, createdAt: () => HANG });
        const run = applyPricing(hanging.admin, [changedOutcome('p1')]);
        await vi.advanceTimersByTimeAsync(3_500);
        await expect(run).resolves.toBe(0);
        expect(hanging.inserts).toHaveLength(1);
        expect(hanging.inserts[0].rows).toEqual([expect.objectContaining({ product_id: 'p1', price: 45_000 })]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('si ya tiene historial, solo se anota el cambio', async () => {
      const { admin, inserts } = fakeAdmin({ historyRows: () => 12, createdAt: () => ({ p1: DAYS_AGO }) });
      await applyPricing(admin, [changedOutcome('p1')]);
      expect(inserts[0].rows).toHaveLength(1);
      expect(inserts[0].rows[0]).toMatchObject({ product_id: 'p1', price: 45_000 });
    });

    it('cada producto por separado: partida solo para el que no tenía registros', async () => {
      const { admin, inserts } = fakeAdmin({
        historyRows: (id) => (id === 'p2' ? 0 : 3),
        createdAt: () => ({ p1: DAYS_AGO, p2: DAYS_AGO }),
      });
      await applyPricing(admin, [changedOutcome('p1'), changedOutcome('p2')], 1);
      const pairs = (rows: unknown[]) => (rows as { product_id: string; price: number }[]).map((row) => [row.product_id, row.price]);
      expect(pairs(inserts[0].rows)).toEqual([
        ['p1', 45_000],
        ['p2', 45_000],
      ]);
      expect(pairs(inserts[1].rows)).toEqual([['p2', 50_000]]);
    });

    it('justo en el borde: a los 9 minutos de agregado no hay partida; a los 11, sí', async () => {
      const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
      const early = fakeAdmin({ historyRows: () => 0, createdAt: () => ({ p1: minutesAgo(9) }) });
      await applyPricing(early.admin, [changedOutcome('p1')]);
      expect(early.inserts).toHaveLength(1);
      const later = fakeAdmin({ historyRows: () => 0, createdAt: () => ({ p1: minutesAgo(11) }) });
      await applyPricing(later.admin, [changedOutcome('p1')]);
      expect(later.inserts).toHaveLength(2);
    });

    it('un producto agregado hace minutos no lleva partida: su precio de alta viene del candidato', async () => {
      const justNow = new Date(Date.now() - 2 * 60_000).toISOString();
      const { admin, inserts } = fakeAdmin({ historyRows: () => 0, createdAt: () => ({ p1: justNow }) });
      await applyPricing(admin, [changedOutcome('p1')]);
      expect(inserts[0].rows).toHaveLength(1);
    });

    it('ante cualquier duda no se inventa una partida, y el cambio se anota igual', async () => {
      const failing = { code: '57014', message: 'canceling statement due to statement timeout' };
      // No se pudo saber si tenía historial.
      const noHistory = fakeAdmin({ historyRows: () => failing, createdAt: () => ({ p1: DAYS_AGO }) });
      await applyPricing(noHistory.admin, [changedOutcome('p1')]);
      expect(noHistory.inserts[0].rows).toHaveLength(1);
      // No se pudo saber desde cuándo está en el sitio.
      const noDate = fakeAdmin({ historyRows: () => 0, createdAt: () => failing });
      await applyPricing(noDate.admin, [changedOutcome('p1')]);
      expect(noDate.inserts[0].rows).toHaveLength(1);
      // El producto no trae fecha.
      const missing = fakeAdmin({ historyRows: () => 0, createdAt: () => ({}) });
      await applyPricing(missing.admin, [changedOutcome('p1')]);
      expect(missing.inserts[0].rows).toHaveLength(1);
    });

    it('si lo primero que cambia es solo el precio de lista, la partida se guarda igual', async () => {
      // El precio que regía es igual de cierto, y sin la partida ese registro parecería un cambio desde no se sabe cuánto.
      const onlyList = decide(product({ id: 'p1' }), ok([offer({ original_price: 70_000 })]), sellers(GREEN), NOW, true);
      expect(onlyList.observation).toMatchObject({ price: 50_000, original_price: 70_000 });
      expect(onlyList.previous).toMatchObject({ price: 50_000, original_price: 60_000 });
      const { admin, inserts } = fakeAdmin({ historyRows: () => 0, createdAt: () => ({ p1: DAYS_AGO }) });
      await applyPricing(admin, [onlyList]);
      expect(inserts[1].rows).toEqual([expect.objectContaining({ price: 50_000, original_price: 60_000, observed_at: DAYS_AGO })]);
    });

    it('sin cambio de precio ni de lista no hay nada que anotar ni partida que buscar', () => {
      const same = decide(product({ id: 'p1' }), ok([offer()]), sellers(GREEN), NOW, true);
      expect(same.observation).toBeUndefined();
      expect(same.previous).toBeUndefined();
    });

    it('no se pregunta por la partida de lo que no se pudo escribir en products', async () => {
      let asked = 0;
      const { admin, inserts } = fakeAdmin({
        update: () => ({ code: '500', message: 'caído' }),
        historyRows: () => {
          asked++;
          return 0;
        },
      });
      await applyPricing(admin, [changedOutcome('p1')]);
      expect(inserts).toHaveLength(0);
      expect(asked).toBe(0);
    });
  });

  it('no agrega al historial lo que no se pudo escribir en products', async () => {
    const { admin, inserts } = fakeAdmin({ update: () => ({ code: '500', message: 'caído' }) });
    const failed = await applyPricing(admin, [changedOutcome('p1')]);
    expect(failed).toBe(1);
    expect(inserts).toHaveLength(0);
  });
});

describe('priceProducts: raíces de categoría', () => {
  function setup() {
    ml.getWinners.mockReset().mockResolvedValue(ok([offer({ category_id: 'MLC1055' })]));
    ml.getSellers.mockReset().mockResolvedValue(sellers(GREEN));
    ml.getRootCategory.mockReset().mockResolvedValue('MLC1051');
  }

  it('busca la raíz de una categoría que no se conoce', async () => {
    setup();
    const [o] = await priceProducts([product()], 'token', { directLinks: true });
    expect(ml.getRootCategory).toHaveBeenCalledTimes(1);
    expect(o.patch).toMatchObject({ ml_category_id: 'MLC1055', ml_root_category: 'MLC1051' });
  });

  it('sin la migración 0016 (resolveRoots: false) no consulta raíces', async () => {
    setup();
    await priceProducts([product()], 'token', { directLinks: true, resolveRoots: false });
    expect(ml.getRootCategory).not.toHaveBeenCalled();
  });

  it('no consulta raíces pasado el corte de enriquecimiento, pero sí ganadores', async () => {
    setup();
    const [o] = await priceProducts([product()], 'token', { directLinks: true, stopEnrichment: () => true });
    expect(ml.getWinners).toHaveBeenCalledTimes(1);
    expect(ml.getRootCategory).not.toHaveBeenCalled();
    expect(o.result).toBe('activo');
  });

  it('con las categorías ya guardadas no vuelve a consultar', async () => {
    setup();
    await priceProducts([product({ ml_category_id: 'MLC1055', ml_root_category: 'MLC1051' })], 'token', {
      directLinks: true,
    });
    expect(ml.getRootCategory).not.toHaveBeenCalled();
  });
});

describe('decide: las ventas del vendedor', () => {
  // Sin cambios de oferta ni de categoría: lo único que cambia es el contador.
  const settled = () => product({ offer_info: offerInfoFrom([offer()], 1) });
  const withSales = (salesCount: number) => new Map([[7, { ...GREEN, salesCount }]]);

  it('dos ventas más no obligan a escribir el producto: queda solo la hora de revisión', () => {
    const out = decide(settled(), ok([offer()]), withSales(1202), NOW, true);
    expect(out.patch).toEqual({ price_checked_at: NOW });
  });

  it('si el producto se escribe igual, el número nuevo va en la misma escritura', () => {
    const out = decide(settled(), ok([offer({ price: 45_000 })]), withSales(1202), NOW, true);
    expect(out.patch).toMatchObject({ price: 45_000, seller_sales_count: 1202 });
  });

  it('con otro vendedor también se guarda', () => {
    const other = new Map([[8, { ...GREEN, id: 8, salesCount: 90 }]]);
    const out = decide(settled(), ok([offer({ seller_id: 8, item_id: 'MLC901' })]), other, NOW, true);
    expect(out.patch).toMatchObject({ seller_id: 8, seller_sales_count: 90 });
  });

  it('con 5% o más de diferencia, o sin dato guardado, se guarda solo', () => {
    expect(decide(settled(), ok([offer()]), withSales(1260), NOW, true).patch).toMatchObject({
      seller_sales_count: 1260,
    });
    const unknown = product({ offer_info: offerInfoFrom([offer()], 1), seller_sales_count: 0 });
    expect(decide(unknown, ok([offer()]), withSales(3), NOW, true).patch).toMatchObject({ seller_sales_count: 3 });
  });

  it('salesCountWorthWriting', () => {
    expect(salesCountWorthWriting(1200, 1202)).toBe(false);
    expect(salesCountWorthWriting(1200, 1259)).toBe(false);
    expect(salesCountWorthWriting(1200, 1260)).toBe(true);
    expect(salesCountWorthWriting(1200, 1100)).toBe(true);
    expect(salesCountWorthWriting(0, 3)).toBe(true);
    expect(salesCountWorthWriting(0, 0)).toBe(false);
    expect(salesCountWorthWriting(null, 10)).toBe(true);
  });
});

describe('priceProducts y summarizePricing: lo que no alcanza por tiempo', () => {
  it('marca sin tiempo lo que no se consultó, sin tocarlo ni contarlo como error', async () => {
    ml.getWinners.mockReset().mockResolvedValue(ok([offer()]));
    ml.getSellers.mockReset().mockResolvedValue(sellers(GREEN));
    ml.getRootCategory.mockReset().mockResolvedValue(null);
    let calls = 0;
    const outcomes = await priceProducts(
      [product({ id: 'a' }), product({ id: 'b' }), product({ id: 'c' })],
      'token',
      // En serie: el tiempo se acaba después de consultar el primero.
      { directLinks: true, concurrency: 1, outOfTime: () => calls++ >= 1 }
    );
    expect(ml.getWinners).toHaveBeenCalledTimes(1);
    expect(outcomes.map((o) => [o.id, o.result, o.sinTiempo ?? false])).toEqual([
      ['a', 'activo', false],
      ['b', 'error_transitorio', true],
      ['c', 'error_transitorio', true],
    ]);
    expect(outcomes[1].patch).toEqual({});

    const summary = summarizePricing(outcomes);
    expect(summary).toMatchObject({ revisados: 1, sin_tiempo: 2, activos: 1, errores_transitorios: 0 });
  });

  it('un tropiezo de ML sí cuenta como error transitorio', async () => {
    ml.getWinners.mockReset().mockResolvedValue({ status: 'error', detail: 'HTTP 500' });
    ml.getSellers.mockReset().mockResolvedValue(new Map());
    const outcomes = await priceProducts([product()], 'token', { directLinks: true });
    expect(summarizePricing(outcomes)).toMatchObject({ revisados: 1, sin_tiempo: 0, errores_transitorios: 1 });
  });
});

describe('priorityOutcomes', () => {
  const base = { patch: { price_checked_at: NOW }, priceChanged: false, reactivated: false, deactivated: false };
  it('se queda con bajas, vueltas y cambios de precio', () => {
    const outcomes: PricingOutcome[] = [
      { ...base, id: 'igual', result: 'activo' },
      { ...base, id: 'baja', result: 'sin_ganador', deactivated: true },
      { ...base, id: 'vuelve', result: 'activo', reactivated: true },
      { ...base, id: 'precio', result: 'activo', priceChanged: true },
      { ...base, id: 'error', result: 'error_transitorio', patch: {} },
    ];
    expect(priorityOutcomes(outcomes).map((o) => o.id)).toEqual(['baja', 'vuelve', 'precio']);
  });
});

describe('pricingConcurrency', () => {
  it('parte en 6 y sube con el catálogo, con tope en 12', () => {
    expect(pricingConcurrency(0)).toBe(6);
    expect(pricingConcurrency(254)).toBe(6);
    expect(pricingConcurrency(500)).toBe(10);
    expect(pricingConcurrency(600)).toBe(12);
    expect(pricingConcurrency(5000)).toBe(12);
  });
});
