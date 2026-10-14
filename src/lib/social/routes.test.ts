import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El plan de publicaciones y el cron de Telegram de punta a punta, con la
 * base y el historial ya leídos: que usen la evidencia de todos, que ordenen
 * por interés y que cada producto salga con sus puntos, su motivo y su aviso.
 */

const SECRET = 'un-secreto-de-prueba-de-mas-de-32-caracteres';

/**
 * Lo que responde cualquier consulta directa a la base: ninguna fila, salvo
 * las que un test deje en `rows` para una tabla (se devuelven sin filtrar).
 */
const fakeAdmin = vi.hoisted(() => {
  const rows: Record<string, unknown[]> = {};
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    // 'range' y 'not' son de la lectura de señales (clics del sitio y más vendidos).
    for (const method of ['select', 'eq', 'neq', 'in', 'not', 'gte', 'order', 'limit', 'range']) builder[method] = () => builder;
    builder.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
    return builder;
  };
  return { from, rows };
});

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => fakeAdmin }));
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
  // La lectura que avisa lo que no pudo leer se arma sobre la misma de mentira: acá se lee todo.
  const getPriceStatsManyChecked = vi.fn(async (ids: string[]) => ({ stats: await getPriceStatsMany(ids), unread: new Set<string>() }));
  return { getPriceStatsMany, getPriceStatsManyChecked };
});
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({
  readAffiliateSettings: vi.fn(async () => ({ word: 'comparatech', tool: '12345', directLinks: true })),
}));
// El catálogo se entrega ya leído; la selección es la de verdad.
vi.mock('@/lib/social/telegram', async (original) => ({
  ...(await original<typeof import('@/lib/social/telegram')>()),
  readFreshSocialProducts: vi.fn(),
}));
vi.mock('@/lib/social/networks', async (original) => ({
  ...(await original<typeof import('@/lib/social/networks')>()),
  postedOnNetworks: vi.fn(async () => new Set<string>()),
  countPostsBetween: vi.fn(async () => 0),
  readPendingIssues: vi.fn(async () => []),
}));

import { NextRequest } from 'next/server';
import type { PriceStats } from '@/lib/deals';
import { getPriceStatsMany, getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { MIN_INTEREST_POINTS, floorPoints, interestScore } from '@/lib/social/interest';
import { postedOnNetworks } from '@/lib/social/networks';
import { readFreshSocialProducts, type SocialProduct } from '@/lib/social/telegram';
import { GET as planRoute } from '@/app/api/social/plan/route';
import { GET as telegramRoute } from '@/app/api/cron/social-telegram/route';

const NOW = new Date('2026-10-12T15:00:00Z');

let seq = 0;
/** Audífonos de marca conocida, de tienda oficial y con 40% de lista: una oferta que cualquier canal publicaría. */
function strong(over: Partial<SocialProduct> = {}): SocialProduct {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    slug: `producto-${seq}`,
    name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
    brand: 'JBL',
    category: 'audio',
    price: 60_000,
    original_price: 100_000,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: 'MLC123',
    ml_family_id: null,
    price_checked_at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
    seller_reputation: 'verde',
    seller_sales_count: 50_000,
    is_active: true,
    is_hidden: false,
    offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true } as SocialProduct['offer_info'],
    ml_root_category: 'MLC1000',
    deleted_at: null,
    ...over,
  };
}

/** Una consola que bajó $150.000 hace dos días, de tienda oficial. */
const gameConsole = (over: Partial<SocialProduct> = {}) =>
  strong({
    name: 'Consola PlayStation 5 Slim Digital 1TB Blanco',
    brand: 'Sony',
    category: 'gaming',
    price: 449_990,
    original_price: null,
    seller_sales_count: 80_000,
    ml_root_category: 'MLC1144',
    ...over,
  });

/** Un cable sin marca con un "60%" de lista: lo que el piso de interés deja fuera. */
const cable = () =>
  strong({
    name: 'Cable Usb Tipo C 2 Metros Carga Rápida',
    brand: 'Genérica',
    category: 'electronica',
    price: 3_990,
    original_price: 9_990,
    seller_sales_count: 800,
    offer_info: { free_shipping: false, is_full: false },
  });

function stats(price: number, over: Partial<PriceStats> = {}): PriceStats {
  return {
    min30: price,
    median30: price,
    max30: price,
    minTracked: price,
    maxTracked: price,
    daysTracked: 20,
    lastPrice: price,
    previousPrice: null,
    lastChangeAt: null,
    lastPriceSeenRecently: false,
    changesLast48h: 0,
    previousIsFirstRecord: false,
    lastPriceNearRecent: false,
    ...over,
    // Salvo que el test diga otra cosa: el mínimo se sostuvo y el precio anterior era el habitual.
    min30Held: over.min30Held ?? over.min30 ?? price,
    usualPriceBefore: 'usualPriceBefore' in over ? over.usualPriceBefore ?? null : over.previousPrice ?? null,
    firstSeenAt: over.firstSeenAt ?? new Date(NOW.getTime() - 20 * 86_400_000).toISOString(),
    trackedBeforeChangeMs:
      'trackedBeforeChangeMs' in over ? over.trackedBeforeChangeMs ?? null : (over.previousPrice ?? null) === null ? null : 18 * 86_400_000,
  };
}

const droppedFrom = (price: number, previous: number) =>
  stats(price, {
    max30: previous,
    maxTracked: previous,
    previousPrice: previous,
    lastChangeAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
  });

function request(path: string) {
  return new NextRequest(`https://sitio.test${path}`, { headers: { authorization: `Bearer ${SECRET}` } });
}

interface PlanRow {
  id: string;
  puntos: number;
  motivo: string;
  aviso: string | null;
  [key: string]: unknown;
}

async function selection(response: Response): Promise<{ status: number; body: Record<string, unknown>; rows: PlanRow[] }> {
  const body = (await response.json()) as Record<string, unknown>;
  return { status: response.status, body, rows: (body.seleccion ?? []) as PlanRow[] };
}

beforeAll(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
  // Solo el reloj: las rutas toman la hora por su cuenta.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  for (const table of Object.keys(fakeAdmin.rows)) delete fakeAdmin.rows[table];
  vi.mocked(readFreshSocialProducts).mockReset();
  vi.mocked(getPriceStatsMany).mockReset();
  vi.mocked(getPriceStatsMany).mockResolvedValue(new Map());
  vi.mocked(postedOnNetworks).mockReset();
  vi.mocked(postedOnNetworks).mockResolvedValue(new Set<string>());
});

/** Deja en la base de mentira un puesto entre los más vendidos y clics recientes para ese producto. */
function withSignals(p: SocialProduct, position: number | null, clicks: number) {
  const recent = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
  fakeAdmin.rows.product_candidates =
    position === null
      ? []
      : [{ ml_product_id: p.ml_product_id, highlight_position: position, prospected_at: recent, checked_at: recent }];
  fakeAdmin.rows.outbound_clicks = Array.from({ length: clicks }, () => ({ product_id: p.id, client_key: null }));
}

describe('/api/social/plan', () => {
  it('sin el secreto no entrega nada', async () => {
    const res = await planRoute(new NextRequest('https://sitio.test/api/social/plan'));
    expect(res.status).toBe(401);
    expect(vi.mocked(readFreshSocialProducts)).not.toHaveBeenCalled();
  });

  it('propone en orden de interés, con puntos, motivo y aviso, y deja fuera lo que no llega al piso', async () => {
    const headphones = strong();
    const bigDrop = gameConsole();
    const filler = cable();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [filler, headphones, bigDrop], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [headphones.id, stats(60_000)],
        [bigDrop.id, droppedFrom(449_990, 599_990)],
        [filler.id, stats(3_990)],
      ])
    );

    const { status, body, rows } = await selection(await planRoute(request('/api/social/plan?n=5')));
    expect(status).toBe(200);
    expect(rows.map((row) => row.id)).toEqual([bigDrop.id, headphones.id]);
    for (const row of rows) {
      expect(row.puntos).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
      expect(row.motivo.length).toBeGreaterThan(10);
      // Lo que se programa sale solo: al plan no llega nada con aviso.
      expect(row.aviso).toBeNull();
    }
    expect(rows[0].puntos).toBeGreaterThan(rows[1].puntos);
    expect(rows[0]).toMatchObject({ baja_historial: 25, descuento: 0 });

    // Lo que lee scripts/redes.mjs sigue donde estaba.
    expect(body).toMatchObject({ ok: true, sitio: expect.any(String), con_precio_fresco: 3, pendientes_con_problemas: [] });
    for (const row of rows) {
      expect(String(row.pieza)).toContain(`/social/pieza/${row.id}/feed-`);
      expect(String(row.historia)).toContain(`/social/pieza/${row.id}/story-`);
    }
  });

  it('lee el historial de todos los que pueden salir, no solo de los que no llegan al descuento', async () => {
    const posted = strong();
    const deal = strong({ category: 'gaming' });
    const flat = strong({ category: 'hogar', original_price: null });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [posted, deal, flat], error: null });
    vi.mocked(postedOnNetworks).mockResolvedValue(new Set([posted.id]));

    const { rows } = await selection(await planRoute(request('/api/social/plan')));
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([deal.id, flat.id]);
    expect(rows.map((row) => row.id)).toEqual([deal.id]);
  });

  it('una oferta de lista que el sitio vio mucho más barata hace poco no se propone', async () => {
    const inflated = strong();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [inflated], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[inflated.id, stats(60_000, { min30: 40_000, minTracked: 40_000 })]]));
    expect((await selection(await planRoute(request('/api/social/plan')))).rows).toEqual([]);
  });

  it('lo que trae un aviso no se propone solo, pero pedido por su id sale con el aviso', async () => {
    // La misma consola, de un vendedor casi sin ventas.
    const doubtful = gameConsole({
      seller_sales_count: 4,
      offer_info: { free_shipping: true, is_full: false, official_store: false, is_lowest: true } as SocialProduct['offer_info'],
    });
    const other = strong();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [doubtful, other], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[doubtful.id, droppedFrom(449_990, 599_990)]]));

    const usual = await selection(await planRoute(request('/api/social/plan?n=5')));
    expect(usual.rows.map((row) => row.id)).toEqual([other.id]);

    vi.mocked(getPriceStatsMany).mockClear();
    const asked = await selection(await planRoute(request(`/api/social/plan?producto=${doubtful.id}`)));
    expect(asked.rows.map((row) => row.id)).toEqual([doubtful.id]);
    expect(asked.rows[0].aviso).toEqual(expect.any(String));
    expect(asked.rows[0].motivo.length).toBeGreaterThan(10);
    expect(asked.body.aviso).toBeUndefined();
    // Solo hace falta el historial del producto pedido.
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([doubtful.id]);
  });

  it('pedido por su id, un producto sale aunque no llegue al piso, ya se haya publicado o no tenga descuento', async () => {
    const filler = cable();
    const plain = strong({ original_price: null });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [filler, plain], error: null });
    vi.mocked(postedOnNetworks).mockResolvedValue(new Set([filler.id, plain.id]));

    for (const p of [filler, plain]) {
      const { rows } = await selection(await planRoute(request(`/api/social/plan?producto=${p.id}`)));
      expect(rows.map((row) => row.id)).toEqual([p.id]);
      expect(typeof rows[0].puntos).toBe('number');
      // Lo que no llega al piso lo dice en su propio campo, con los puntos que tiene.
      if (rows[0].puntos < MIN_INTEREST_POINTS) {
        expect(rows[0].no_publicar).toBe(
          `no llega al piso de interés (${String(rows[0].puntos).replace('.', ',')} de ${MIN_INTEREST_POINTS} puntos)`
        );
      } else {
        expect(rows[0].no_publicar).toBeNull();
      }
    }
    // El cable sin marca es justo lo que el piso deja fuera.
    const cableRow = (await selection(await planRoute(request(`/api/social/plan?producto=${filler.id}`)))).rows[0];
    expect(cableRow.puntos).toBeLessThan(MIN_INTEREST_POINTS);
    expect((await selection(await planRoute(request('/api/social/plan')))).rows).toEqual([]);
  });

  it('si el historial de un producto no se pudo leer, no se propone y la respuesta lo dice', async () => {
    const lost = strong();
    const fine = strong({ category: 'gaming' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [lost, fine], error: null });
    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({
      stats: new Map([[fine.id, stats(60_000)]]),
      unread: new Set([lost.id]),
    });

    const { body, rows } = await selection(await planRoute(request('/api/social/plan?n=5')));
    // Sin su historial no se sabe si estuvo más barato: no se programa solo.
    expect(rows.map((row) => row.id)).toEqual([fine.id]);
    expect(body.historial_sin_leer).toBe(1);

    // Con todo leído, el campo va en cero y salen los dos.
    const complete = await selection(await planRoute(request('/api/social/plan?n=5')));
    expect(complete.body.historial_sin_leer).toBe(0);
    expect(complete.rows).toHaveLength(2);
  });

  it('pedido por su id, lo que el puntaje excluye sale diciendo por qué no publicarlo', async () => {
    // Hoy a $60.000; hace unos días estuvo (más de un día) a $40.000.
    const inflated = strong();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [inflated], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[inflated.id, stats(60_000, { min30: 40_000, minTracked: 40_000 })]]));

    const { rows } = await selection(await planRoute(request(`/api/social/plan?producto=${inflated.id}`)));
    expect(rows.map((row) => row.id)).toEqual([inflated.id]);
    expect(rows[0].aviso).toEqual(expect.stringContaining('hace poco estuvo a $40.000'));
    expect(rows[0].no_publicar).toEqual(expect.stringContaining('más de lo que llegó a costar'));

    // En el plan normal lo excluido no llega, y lo que llega no trae ese campo con texto.
    const clean = strong({ category: 'gaming' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [inflated, clean], error: null });
    const usual = await selection(await planRoute(request('/api/social/plan?n=5')));
    expect(usual.rows.map((row) => row.id)).toEqual([clean.id]);
    expect(usual.rows[0].no_publicar).toBeNull();
  });

  it('con señales de ganador y de tendencia, el producto suma puntos y el motivo lo dice', async () => {
    const headphones = strong({ ml_product_id: 'MLC777' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [headphones], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[headphones.id, stats(60_000)]]));

    const plain = (await selection(await planRoute(request('/api/social/plan')))).rows[0];
    expect(plain.motivo).not.toMatch(/figuró|clics/);

    withSignals(headphones, 3, 0);
    const ranked = (await selection(await planRoute(request('/api/social/plan')))).rows[0];
    expect(ranked.motivo).toContain('figuró 3.º entre los más vendidos de su categoría');
    expect(ranked.puntos).toBeGreaterThan(plain.puntos);

    withSignals(headphones, null, 14);
    const clicked = (await selection(await planRoute(request('/api/social/plan')))).rows[0];
    expect(clicked.motivo).toContain('lleva 14 clics recientes en el sitio');
    expect(clicked.puntos).toBeGreaterThan(plain.puntos);

    // Pedido por su id también: es el mismo puntaje.
    const asked = (await selection(await planRoute(request(`/api/social/plan?producto=${headphones.id}`)))).rows[0];
    expect(asked.motivo).toBe(clicked.motivo);
  });

  it('pedido por su id, igual tiene que tener el precio recién revisado', async () => {
    const stale = strong({ price_checked_at: new Date(NOW.getTime() - 7 * 3600_000).toISOString() });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [stale], error: null });
    const { rows, body } = await selection(await planRoute(request(`/api/social/plan?producto=${stale.id}`)));
    expect(rows).toEqual([]);
    expect(body.aviso).toEqual(expect.stringContaining('no está a la venta'));
  });
});

describe('/api/cron/social-telegram?dry=1', () => {
  it('sin el secreto no entrega nada', async () => {
    const res = await telegramRoute(new NextRequest('https://sitio.test/api/cron/social-telegram?dry=1'));
    expect(res.status).toBe(401);
    expect(vi.mocked(readFreshSocialProducts)).not.toHaveBeenCalled();
  });

  it('lo que ya salió en el canal hace poco no vuelve', async () => {
    const fresh = strong();
    const already = strong({
      category: 'gaming',
      rrss_channel: 'telegram',
      rrss_published_at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
    });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [already, fresh], error: null });

    const { rows, body } = await selection(await telegramRoute(request('/api/cron/social-telegram?dry=1')));
    expect(rows.map((row) => row.id)).toEqual([fresh.id]);
    expect(body.historial_sin_leer).toBe(0);
    // Ni se lee el historial de lo que no puede salir.
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([fresh.id]);
  });

  it('el bot también cuenta las señales: entre dos ofertas iguales va primero la que figura entre los más vendidos', async () => {
    const plain = strong({ ml_product_id: 'MLC100' });
    const winner = strong({ category: 'gaming', ml_product_id: 'MLC200' });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [plain, winner], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [plain.id, stats(60_000)],
        [winner.id, stats(60_000)],
      ])
    );
    // Solo la ficha del segundo tiene puesto; la base de mentira no filtra, el código sí.
    withSignals(winner, 2, 0);

    const { rows } = await selection(await telegramRoute(request('/api/cron/social-telegram?dry=1')));
    expect(rows.map((row) => row.id)).toEqual([winner.id, plain.id]);
    expect(rows[0].motivo).toContain('figuró 2.º entre los más vendidos de su categoría');
    expect(rows[1].motivo).not.toContain('figuró');
    expect(rows[0].puntos).toBeGreaterThan(rows[1].puntos);
  });

  it('muestra lo que publicaría: en orden de interés, sin avisos, con puntos y motivo', async () => {
    const headphones = strong();
    const bigDrop = gameConsole();
    const doubtful = gameConsole({
      seller_sales_count: 4,
      ml_family_id: 'OTRA',
      offer_info: { free_shipping: true, is_full: false, official_store: false, is_lowest: true } as SocialProduct['offer_info'],
    });
    const filler = cable();
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [filler, doubtful, headphones, bigDrop], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [bigDrop.id, droppedFrom(449_990, 599_990)],
        [doubtful.id, droppedFrom(449_990, 599_990)],
        [headphones.id, stats(60_000)],
      ])
    );

    const { status, body, rows } = await selection(await telegramRoute(request('/api/cron/social-telegram?dry=1')));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, dry: true, con_precio_fresco: 4 });
    expect(rows.map((row) => row.id)).toEqual([bigDrop.id, headphones.id]);
    for (const row of rows) {
      expect(row.puntos).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
      expect(row.motivo.length).toBeGreaterThan(10);
      expect(row.aviso).toBeNull();
    }
    // El historial se lee de todos, también de los que ya traen descuento de lista.
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([filler.id, doubtful.id, headphones.id, bigDrop.id]);
  });
});

// Los clics del sitio y el puesto entre los más vendidos se pueden fabricar
// desde afuera: ordenan lo que entra, pero no hacen entrar nada. Acá con el
// puntaje de verdad y las dos rutas que publican o programan solas.
describe('las señales no habilitan: ni el plan de publicaciones ni el bot de Telegram', () => {
  const info = (over: Record<string, unknown> = {}) =>
    ({ free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true, ...over }) as SocialProduct['offer_info'];
  /** Una campana de cocina de marca conocida, de tienda oficial y con 45% de lista: sin avisos y justo bajo el piso (39 puntos y fracción). */
  const hood = (over: Partial<SocialProduct> = {}) =>
    strong({
      name: 'Campana De Cocina Retráctil Mademsa 60 cm',
      brand: 'Mademsa',
      category: 'electrodomesticos',
      price: 59_990,
      original_price: 109_990,
      offer_info: info(),
      ...over,
    });
  /** Un frigobar sin envío gratis ni Full: justo sobre el piso (41 puntos). */
  const fridge = (over: Partial<SocialProduct> = {}) =>
    strong({
      name: 'Refrigerador frigobar Libero LFB-90 color rojo',
      brand: 'Libero',
      category: 'electrodomesticos',
      price: 99_990,
      original_price: 149_990,
      offer_info: info({ free_shipping: false, is_full: false }),
      ...over,
    });
  const scoreOf = (p: SocialProduct, signals: { mlPosition?: number; recentClicks?: number } = {}) =>
    interestScore(p, { drop: null, min30: p.price, daysTracked: 20, ...signals });
  const MAX_SIGNAL = { mlPosition: 1, recentClicks: 400 };

  /** Los tres productos, con 20 días de historial quieto. */
  function lineup() {
    const below = hood({ ml_product_id: 'MLC901' });
    const above = fridge({ ml_product_id: 'MLC902' });
    // La misma campana vendida por Mercado Libre, en otra categoría: unos puntos sobre el frigobar.
    const rival = hood({ category: 'hogar', ml_product_id: 'MLC903', offer_info: info({ sold_by_ml: true }) });
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [below, above, rival], error: null });
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([below, above, rival].map((p) => [p.id, stats(p.price)])));
    return { below, above, rival };
  }

  /**
   * La señal más alta que existe (primero entre los más vendidos y 400 clics)
   * para esos productos. La base de mentira no entrega por páginas: con mil
   * filas o más la lectura no terminaría nunca de pedir la siguiente.
   */
  function forgeSignals(products: SocialProduct[]) {
    const recent = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    fakeAdmin.rows.product_candidates = products.map((p) => ({
      ml_product_id: p.ml_product_id,
      highlight_position: 1,
      prospected_at: recent,
      checked_at: recent,
    }));
    const clicks: unknown[] = [];
    for (const p of products) for (let i = 0; i < 400; i++) clicks.push({ product_id: p.id, client_key: null });
    fakeAdmin.rows.outbound_clicks = clicks;
  }

  it('los productos de prueba quedan donde el test los necesita: uno bajo el piso que con señales lo pasaría, y uno justo sobre él', () => {
    // Si los pesos del puntaje se afinan y esto deja de cumplirse, hay que elegir otros productos.
    const { below, above, rival } = lineup();
    expect(scoreOf(below)).toMatchObject({ warning: null, excluded: null });
    expect(scoreOf(below).points).toBeLessThan(MIN_INTEREST_POINTS);
    expect(scoreOf(below).points).toBeGreaterThan(MIN_INTEREST_POINTS - 2);
    expect(scoreOf(below, MAX_SIGNAL).points).toBeGreaterThan(MIN_INTEREST_POINTS + 4);
    expect(floorPoints(scoreOf(below, MAX_SIGNAL))).toBe(scoreOf(below).points);
    expect(scoreOf(above)).toMatchObject({ warning: null, excluded: null });
    expect(scoreOf(above).points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
    expect(scoreOf(above).points).toBeLessThan(scoreOf(rival).points);
    expect(scoreOf(above, MAX_SIGNAL).points).toBeGreaterThan(scoreOf(rival).points);
  });

  it('el plan de publicaciones no propone lo que no llega al piso por más señales que tenga; pedido por su id, dice por qué', async () => {
    const { below, above, rival } = lineup();

    const plain = await selection(await planRoute(request('/api/social/plan?n=5')));
    expect(plain.rows.map((row) => row.id)).toEqual([rival.id, above.id]);

    forgeSignals([below, above]);
    const forged = await selection(await planRoute(request('/api/social/plan?n=5')));
    // El de 39 sigue fuera, aunque con las señales sume más que los otros dos; el de 41 pasa adelante.
    expect(forged.rows.map((row) => row.id)).toEqual([above.id, rival.id]);
    expect(forged.rows[0].puntos).toBe(scoreOf(above, MAX_SIGNAL).points);
    expect(forged.rows[0].puntos).toBeGreaterThan(forged.rows[1].puntos);
    expect(forged.rows[0].motivo).toContain('figuró 1.º entre los más vendidos de su categoría');
    for (const row of forged.rows) expect(row.no_publicar).toBeNull();

    // Pedido por su id sale, con sus puntos a la vista y la explicación de por qué no se publicaría solo.
    const asked = (await selection(await planRoute(request(`/api/social/plan?producto=${below.id}`)))).rows[0];
    expect(asked.id).toBe(below.id);
    expect(asked.puntos).toBeGreaterThan(MIN_INTEREST_POINTS + 4);
    const own = String(scoreOf(below).points).replace('.', ',');
    expect(asked.no_publicar).toBe(
      `no llega al piso de interés (${own} de ${MIN_INTEREST_POINTS} puntos; los clics y el puesto entre los más vendidos no cuentan para el piso)`
    );
    const fine = (await selection(await planRoute(request(`/api/social/plan?producto=${above.id}`)))).rows[0];
    expect(fine.no_publicar).toBeNull();
  });

  it('el bot de Telegram, que publica solo, tampoco: lo que no llega al piso por sí mismo no sale', async () => {
    const { below, above, rival } = lineup();

    const plain = await selection(await telegramRoute(request('/api/cron/social-telegram?dry=1')));
    expect(plain.rows.map((row) => row.id)).toEqual([rival.id, above.id]);

    forgeSignals([below, above]);
    const forged = await selection(await telegramRoute(request('/api/cron/social-telegram?dry=1')));
    expect(forged.rows.map((row) => row.id)).toEqual([above.id, rival.id]);
    expect(forged.rows[0].puntos).toBeGreaterThan(forged.rows[1].puntos);
    for (const row of forged.rows) expect(row.aviso).toBeNull();

    // Solo, con los cinco cupos libres y la señal al máximo: nada.
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [below], error: null });
    expect((await selection(await telegramRoute(request('/api/cron/social-telegram?dry=1')))).rows).toEqual([]);
  });
});
