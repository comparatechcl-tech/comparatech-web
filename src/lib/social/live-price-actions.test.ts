import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La seguridad de la revisión en vivo (app/admin/live-price-actions): fuera
 * del sitio publicado no pregunta a Mercado Libre, no lee la base ni escribe
 * nada; en el sitio publicado escribe solo lo que cambió, por el mismo camino
 * que el refresco de precios (applyPricing), sin verifyLink ni el link de
 * afiliado, y deja una sola entrada en la bitácora. Todo lo que podría salir
 * a la red o escribir es un doble que anota lo que le piden.
 */

const spy = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => 'cristopher'),
  getMlToken: vi.fn(async () => 'token-de-prueba'),
  priceProducts: vi.fn(),
  applyPricing: vi.fn(async () => 0),
  getSupabaseAdmin: vi.fn(),
  logAdminEvent: vi.fn(async () => {}),
  readAffiliateSettings: vi.fn(async () => ({ word: 'comparatech', tool: '12345', directLinks: true })),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  fetch: vi.fn(async () => {
    throw new Error('sin red en las pruebas');
  }),
}));

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: spy.requireAdmin }));
vi.mock('@/lib/ml-enrichment', () => ({ getMlToken: spy.getMlToken }));
vi.mock('@/lib/pricing', () => ({
  PRICED_COLUMNS: 'id, ml_product_id, affiliate_url, price, original_price',
  priceProducts: spy.priceProducts,
  applyPricing: spy.applyPricing,
}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: spy.getSupabaseAdmin }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: spy.logAdminEvent }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: spy.readAffiliateSettings }));
vi.mock('next/cache', () => ({ revalidatePath: spy.revalidatePath, revalidateTag: spy.revalidateTag }));

import { checkLivePrices } from '@/app/admin/live-price-actions';
import type { PricingOutcome } from '@/lib/pricing';
import { LIVE_TEXT, type ShownOffer } from '@/lib/social/live-price';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHOWN: ShownOffer = { price: 49_990, listPrice: 99_990, freeShipping: true, full: false };
const CHECKED = '2026-10-17T15:00:05.000Z';

type Row = Record<string, unknown>;

/** Un producto como lo devuelve la base: a la venta, $49.990, sin descuento $99.990, envío gratis. */
function product(n: number, over: Row = {}): Row {
  return {
    id: ID(n),
    ml_product_id: `MLC${n}`,
    affiliate_url: `https://meli.la/afiliado-${n}`,
    price: 49_990,
    original_price: 99_990,
    is_active: true,
    is_hidden: false,
    deleted_at: null,
    offer_info: { free_shipping: true, is_full: false },
    ...over,
  };
}

/**
 * La base de mentira: solo sabe leer (from → select → in). Anota cada lectura;
 * no tiene cómo escribir, así que cualquier escritura directa reventaría.
 */
function fakeDb(rows: Row[], firstError: { code: string; message: string } | null = null) {
  const reads: { table: string; columns: string; ids: unknown[] }[] = [];
  let failed = false;
  const admin = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            async in(column: string, ids: unknown[]) {
              reads.push({ table, columns, ids });
              if (firstError && !failed) {
                failed = true;
                return { data: null, error: firstError };
              }
              expect(column).toBe('id');
              return { data: rows.filter((row) => ids.includes(row.id)), error: null };
            },
          };
        },
      };
    },
  };
  return { admin, reads };
}

const outcome = (id: string, over: Partial<PricingOutcome> = {}): PricingOutcome => ({
  id,
  result: 'activo',
  patch: { price_checked_at: CHECKED },
  priceChanged: false,
  reactivated: false,
  deactivated: false,
  ...over,
});

/** Lo que nunca puede pasar fuera del sitio publicado. */
function expectNothingTouched() {
  expect(spy.getMlToken).not.toHaveBeenCalled();
  expect(spy.priceProducts).not.toHaveBeenCalled();
  expect(spy.getSupabaseAdmin).not.toHaveBeenCalled();
  expect(spy.applyPricing).not.toHaveBeenCalled();
  expect(spy.logAdminEvent).not.toHaveBeenCalled();
  expect(spy.readAffiliateSettings).not.toHaveBeenCalled();
  expect(spy.revalidatePath).not.toHaveBeenCalled();
  expect(spy.revalidateTag).not.toHaveBeenCalled();
  expect(spy.fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubGlobal('fetch', spy.fetch);
  // Sin ninguna marca de Vercel: cada test pone las suyas.
  vi.stubEnv('VERCEL', undefined);
  vi.stubEnv('VERCEL_ENV', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const fn of Object.values(spy)) fn.mockClear();
  spy.requireAdmin.mockImplementation(async () => 'cristopher');
  spy.getMlToken.mockImplementation(async () => 'token-de-prueba');
  spy.applyPricing.mockImplementation(async () => 0);
  spy.priceProducts.mockReset();
  spy.getSupabaseAdmin.mockReset();
});

describe('fuera del sitio publicado no pregunta, no lee y no escribe', () => {
  const cases: [string, Record<string, string | undefined>][] = [
    ['sin VERCEL_ENV (el PC del dueño o las pruebas)', {}],
    ['en una vista previa de Vercel', { VERCEL: '1', VERCEL_ENV: 'preview' }],
    ['con el .env bajado de Vercel (development)', { VERCEL: '1', VERCEL_ENV: 'development' }],
    ['con solo VERCEL=1', { VERCEL: '1' }],
    ['con un VERCEL_ENV que no es exactamente "production"', { VERCEL: '1', VERCEL_ENV: 'Production ' }],
  ];

  for (const [name, env] of cases) {
    it(name, async () => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      // De verdad sin las variables que no se pusieron (no el texto "undefined").
      if (!('VERCEL_ENV' in env)) expect('VERCEL_ENV' in process.env).toBe(false);
      if (!('VERCEL' in env)) expect('VERCEL' in process.env).toBe(false);
      // Aunque hubiera base: no se pide.
      spy.getSupabaseAdmin.mockReturnValue(fakeDb([product(1)]).admin);
      const out = await checkLivePrices([
        { productId: ID(1), shown: SHOWN },
        { productId: ID(2), shown: SHOWN },
      ]);
      expect(out).toEqual({
        [ID(1)]: { status: 'unknown', what: 'La revisión en vivo funciona solo en el sitio publicado.' },
        [ID(2)]: { status: 'unknown', what: LIVE_TEXT.offline },
      });
      // Igual exige la sesión del admin.
      expect(spy.requireAdmin).toHaveBeenCalledTimes(1);
      expectNothingTouched();
    });
  }

  it('lo que llega mal se contesta igual sin tocar nada: id que no es uuid, precio que no sirve, más de 16', async () => {
    const out = await checkLivePrices([
      { productId: 'no-es-un-id', shown: SHOWN },
      { productId: ID(1), shown: { price: -1 } as unknown as ShownOffer },
      ...Array.from({ length: 17 }, (_, i) => ({ productId: ID(i + 2), shown: SHOWN })),
    ]);
    expect(out['no-es-un-id']).toBeUndefined();
    expect(out[ID(1)]).toEqual({ status: 'unknown', what: LIVE_TEXT.badCard });
    expect(out[ID(18)]).toEqual({ status: 'unknown', what: LIVE_TEXT.tooMany });
    expect(out[ID(2)]).toEqual({ status: 'unknown', what: LIVE_TEXT.offline });
    expect(Object.keys(out)).toHaveLength(18);
    expectNothingTouched();
  });
});

describe('sin sesión de admin no hace nada', () => {
  it('ni en el sitio publicado: no lee, no pregunta y no escribe', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    spy.requireAdmin.mockRejectedValueOnce(new Error('No autorizado'));
    spy.getSupabaseAdmin.mockReturnValue(fakeDb([product(1)]).admin);
    await expect(checkLivePrices([{ productId: ID(1), shown: SHOWN }])).rejects.toThrow('No autorizado');
    expectNothingTouched();
  });
});

describe('en el sitio publicado (VERCEL_ENV=production)', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  it('pregunta a Mercado Libre como el refresco, sin verifyLink, y escribe solo lo que cambió, con applyPricing', async () => {
    const db = fakeDb([product(1), product(2), product(3), product(4, { is_hidden: true }), product(5)]);
    spy.getSupabaseAdmin.mockReturnValue(db.admin);
    const changed = outcome(ID(2), { patch: { price_checked_at: CHECKED, price: 45_990 }, priceChanged: true });
    const gone = outcome(ID(5), { result: 'sin_ganador', patch: { price_checked_at: CHECKED, is_active: false }, deactivated: true });
    spy.priceProducts.mockImplementation(async ([row]: Row[]) => {
      if (row.id === ID(2)) return [changed];
      if (row.id === ID(3)) throw new Error('ML 500');
      if (row.id === ID(5)) return [gone];
      // Otro vendedor con el mismo precio: algo que escribir, pero no lo que la tarjeta muestra.
      return [outcome(String(row.id), { patch: { price_checked_at: CHECKED, seller_id: 99 } })];
    });

    const out = await checkLivePrices([1, 2, 3, 4, 5].map((n) => ({ productId: ID(n), shown: SHOWN })));
    expect(out[ID(1)]).toEqual({ status: 'same', checkedAt: CHECKED });
    expect(out[ID(2)]).toMatchObject({ status: 'changed', price: 45_990, saved: true });
    // Una falla de un producto no arrastra a los demás.
    expect(out[ID(3)]).toEqual({ status: 'unknown', what: LIVE_TEXT.mlDown });
    // Ocultado a mano: se sabe sin preguntar a Mercado Libre.
    expect(out[ID(4)]).toEqual({ status: 'unavailable', checkedAt: expect.any(String), what: LIVE_TEXT.notOnSale });
    expect(out[ID(5)]).toEqual({ status: 'unavailable', checkedAt: CHECKED, what: LIVE_TEXT.noWinner });

    // Una lectura de la base, de esos productos, con las columnas que necesita priceProducts.
    expect(db.reads).toHaveLength(1);
    expect(db.reads[0].table).toBe('products');
    expect(db.reads[0].ids).toEqual([1, 2, 3, 4, 5].map(ID));
    expect(db.reads[0].columns).toContain('offer_info');
    expect(db.reads[0].columns).toContain('is_hidden');
    expect(db.reads[0].columns).toContain('deleted_at');

    // priceProducts, de a un producto, con el token y SIN verifyLink: nunca se abre el link de afiliado.
    expect(spy.getMlToken).toHaveBeenCalledTimes(1);
    expect(spy.priceProducts).toHaveBeenCalledTimes(4);
    for (const [rows, token, opts] of spy.priceProducts.mock.calls as [Row[], string, Record<string, unknown>][]) {
      expect(rows).toHaveLength(1);
      expect(token).toBe('token-de-prueba');
      expect(opts).toEqual({ concurrency: 1, directLinks: true, resolveRoots: true });
      expect(opts).not.toHaveProperty('verifyLink');
    }
    expect((spy.priceProducts.mock.calls as [Row[]][]).map(([rows]) => rows[0].id)).not.toContain(ID(4));
    // La configuración de links se lee una vez para todas.
    expect(spy.readAffiliateSettings).toHaveBeenCalledTimes(1);

    // Se escribe solo lo que la tarjeta muestra distinto (y lo que ya no está a la venta), por el camino del refresco.
    expect(spy.applyPricing.mock.calls).toEqual([
      [db.admin, [changed], 1],
      [db.admin, [gone], 1],
    ]);
    // Sin regenerar páginas (rearmaría la lista bajo el dedo) y sin ninguna salida a la red.
    expect(spy.revalidatePath).not.toHaveBeenCalled();
    expect(spy.revalidateTag).not.toHaveBeenCalled();
    expect(spy.fetch).not.toHaveBeenCalled();
  });

  it('deja una sola entrada en la bitácora, con quién revisó y solo los cambios encontrados', async () => {
    const db = fakeDb([product(1), product(2), product(3)]);
    spy.getSupabaseAdmin.mockReturnValue(db.admin);
    spy.priceProducts.mockImplementation(async ([row]: Row[]) => {
      if (row.id === ID(2)) return [outcome(ID(2), { patch: { price_checked_at: CHECKED, price: 52_990 }, priceChanged: true })];
      if (row.id === ID(3)) return [outcome(ID(3), { result: 'ganador_no_verde', patch: { price_checked_at: CHECKED, is_active: false } })];
      return [outcome(String(row.id))];
    });
    // El guardado del primero falla: la bitácora lo dice.
    spy.applyPricing.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const out = await checkLivePrices([1, 2, 3].map((n) => ({ productId: ID(n), shown: SHOWN })));
    expect(out[ID(2)]).toMatchObject({ status: 'changed', saved: false });
    expect(spy.logAdminEvent).toHaveBeenCalledTimes(1);
    const [admin, event] = spy.logAdminEvent.mock.calls[0] as unknown as [unknown, Row];
    expect(admin).toBe(db.admin);
    expect(event).toEqual({
      actor: 'cristopher',
      action: 'reverificar',
      target: `${ID(2)},${ID(3)}`,
      after: {
        revisados: 3,
        en_vivo: true,
        cambios: [
          {
            id: ID(2),
            estado: 'changed',
            detalle: 'El precio cambió de $49.990 a $52.990. El descuento cambió: ahora es 47%.',
            guardado: false,
            precio_tarjeta: 49_990,
            precio_ahora: 52_990,
          },
          { id: ID(3), estado: 'unavailable', detalle: LIVE_TEXT.notGreen, guardado: true, precio_tarjeta: 49_990, precio_ahora: null },
        ],
      },
    });
  });

  it('sin cambios no escribe ni deja nada en la bitácora', async () => {
    spy.getSupabaseAdmin.mockReturnValue(fakeDb([product(1), product(2)]).admin);
    spy.priceProducts.mockImplementation(async ([row]: Row[]) => [outcome(String(row.id))]);
    const out = await checkLivePrices([1, 2].map((n) => ({ productId: ID(n), shown: SHOWN })));
    expect(Object.values(out).map((check) => check.status)).toEqual(['same', 'same']);
    expect(spy.applyPricing).not.toHaveBeenCalled();
    expect(spy.logAdminEvent).not.toHaveBeenCalled();
  });

  it('no vuelve a publicar un producto en pausa: eso lo decide el refresco, que antes verifica el link', async () => {
    spy.getSupabaseAdmin.mockReturnValue(fakeDb([product(1, { is_active: false })]).admin);
    spy.priceProducts.mockResolvedValue([
      outcome(ID(1), { patch: { price_checked_at: CHECKED, is_active: true, price: 45_990 }, reactivated: true, priceChanged: true }),
    ]);
    const out = await checkLivePrices([{ productId: ID(1), shown: SHOWN }]);
    expect(out[ID(1)]).toMatchObject({ status: 'changed', saved: false });
    expect(spy.applyPricing).not.toHaveBeenCalled();
  });

  it('sin las columnas nuevas (migración 0016) lee las de antes y no busca la categoría raíz', async () => {
    const db = fakeDb([product(1)], { code: '42703', message: 'column offer_info does not exist' });
    spy.getSupabaseAdmin.mockReturnValue(db.admin);
    spy.priceProducts.mockResolvedValue([outcome(ID(1))]);
    const out = await checkLivePrices([{ productId: ID(1), shown: SHOWN }]);
    expect(db.reads.map((read) => read.columns.includes('offer_info'))).toEqual([true, false]);
    expect(spy.priceProducts.mock.calls[0][2]).toEqual({ concurrency: 1, directLinks: true, resolveRoots: false });
    expect(out[ID(1)]).toMatchObject({ status: 'same' });
  });

  it('si la base falla, ninguna se puede revisar y no se pregunta a Mercado Libre', async () => {
    spy.getSupabaseAdmin.mockReturnValue(fakeDb([], { code: '500', message: 'se cayó' }).admin);
    const out = await checkLivePrices([{ productId: ID(1), shown: SHOWN }]);
    expect(out[ID(1)]).toEqual({ status: 'unknown', what: LIVE_TEXT.siteDown });
    expect(spy.getMlToken).not.toHaveBeenCalled();
    expect(spy.applyPricing).not.toHaveBeenCalled();
  });

  it('sin el cliente de la base lo dice, sin preguntar a Mercado Libre', async () => {
    spy.getSupabaseAdmin.mockReturnValue(null);
    const out = await checkLivePrices([{ productId: ID(1), shown: SHOWN }]);
    expect(out[ID(1)]).toEqual({ status: 'unknown', what: LIVE_TEXT.siteDown });
    expect(spy.getMlToken).not.toHaveBeenCalled();
  });

  it('sin token de Mercado Libre, todo queda "no me pude conectar" y no se escribe nada', async () => {
    spy.getSupabaseAdmin.mockReturnValue(fakeDb([product(1)]).admin);
    spy.getMlToken.mockResolvedValueOnce(null as unknown as string);
    const out = await checkLivePrices([{ productId: ID(1), shown: SHOWN }]);
    expect(out[ID(1)]).toEqual({ status: 'unknown', what: LIVE_TEXT.mlConnect });
    expect(spy.priceProducts).not.toHaveBeenCalled();
    expect(spy.applyPricing).not.toHaveBeenCalled();
  });

  it('revisa 16 como mucho; los demás vuelven sin revisar y no se leen', async () => {
    const db = fakeDb(Array.from({ length: 20 }, (_, i) => product(i + 1)));
    spy.getSupabaseAdmin.mockReturnValue(db.admin);
    spy.priceProducts.mockImplementation(async ([row]: Row[]) => [outcome(String(row.id))]);
    const out = await checkLivePrices(Array.from({ length: 20 }, (_, i) => ({ productId: ID(i + 1), shown: SHOWN })));
    expect(db.reads[0].ids).toHaveLength(16);
    expect(spy.priceProducts).toHaveBeenCalledTimes(16);
    for (let n = 17; n <= 20; n++) expect(out[ID(n)]).toEqual({ status: 'unknown', what: LIVE_TEXT.tooMany });
  });

  it('sin nada válido que revisar, ni siquiera pide la base', async () => {
    const out = await checkLivePrices([{ productId: 'x', shown: SHOWN }] as never);
    expect(out).toEqual({});
    expect(spy.getSupabaseAdmin).not.toHaveBeenCalled();
    expect(spy.getMlToken).not.toHaveBeenCalled();
  });
});
