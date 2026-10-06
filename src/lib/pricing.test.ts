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

/**
 * Cliente falso de Supabase: registra cada update e insert y responde lo
 * que diga `respond`.
 */
function fakeAdmin(respond: {
  update?: (patch: Record<string, unknown>) => { code: string; message: string } | null;
  insert?: () => { code: string; message: string } | null;
}) {
  const updates: Record<string, unknown>[] = [];
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
          };
        },
        insert: async (rows: unknown[]) => {
          inserts.push({ table, rows });
          return { error: respond.insert?.() ?? null };
        },
      };
    },
  };
  return { admin: client as unknown as SupabaseClient, updates, inserts };
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
