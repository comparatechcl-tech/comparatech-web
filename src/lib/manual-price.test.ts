import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Precios revisados a mano (admin: "Precios de hoy"). Desde el 23-11-2026
 * Mercado Libre no entrega precios, y esta es la única forma de que un
 * producto vuelva a mostrar el precio de hoy. Lo que importa: que un error de
 * tipeo no llegue al sitio, que el cambio entre al historial igual que uno
 * automático, y que del vendedor, el envío y la garantía no se afirme nada.
 */

// ── La base y lo demás que tocan las acciones ────────────────────────────

type Op = { table: string; method: 'select' | 'update' | 'insert' | 'delete'; patch?: unknown; filters: [string, string, unknown][] };

const db = vi.hoisted(() => ({
  product: null as Record<string, unknown> | null,
  /** Filas que ya tiene price_history para el producto. */
  history: [] as unknown[],
  ops: [] as Op[],
  failUpdate: false,
  /** Lo anotado en Actividad (admin_audit_log) para el producto, del más nuevo al más viejo. */
  audit: [] as unknown[],
}));

vi.mock('@/lib/supabase/server', () => {
  const from = (table: string) => {
    const op: Op = { table, method: 'select', filters: [] };
    const run = () => {
      db.ops.push(op);
      if (table === 'products' && op.method === 'select') {
        // La acción lee una fila (maybeSingle); applyPricing, las fechas de alta (lista).
        return { data: db.product, error: null };
      }
      if (table === 'products' && op.method === 'update') {
        return db.failUpdate ? { data: null, error: { message: 'caída' } } : { data: null, error: null };
      }
      if (table === 'price_history' && op.method === 'select') return { data: db.history, error: null };
      if (table === 'admin_audit_log' && op.method === 'select') return { data: db.audit, error: null };
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      update: (patch: unknown) => {
        op.method = 'update';
        op.patch = patch;
        return b;
      },
      insert: (patch: unknown) => {
        op.method = 'insert';
        op.patch = patch;
        return Promise.resolve(run());
      },
      maybeSingle: () => Promise.resolve(run()),
      limit: () => b,
      order: () => b,
      delete: () => {
        op.method = 'delete';
        return b;
      },
      then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
    };
    for (const f of ['eq', 'in', 'is']) {
      b[f] = (col: string, value: unknown) => {
        op.filters.push([f, col, value]);
        return b;
      };
    }
    return b;
  };
  return { getSupabaseAdmin: () => ({ from }) };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn(async () => 'cristopher') }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/indexnow', () => ({ notifyIndexNow: vi.fn(async () => ({ omitido: 'prueba' })) }));
// lib/pricing importa la lectura de la configuración, que usa cache() de React.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn(async () => ({ directLinks: true })) }));

import { revalidatePath, revalidateTag } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { notifyIndexNow } from '@/lib/indexnow';
import { markUnavailable, saveManualPrice, undoManualPrice } from '@/app/admin/precios/actions';
import {
  MANUAL_OFFER_INFO,
  canUndoManual,
  canValidateByHand,
  checkManualPrice,
  manualPriceBefore,
  manualPriceOutcome,
  manualUnavailableOutcome,
  manualUndoPatch,
  parseManualBefore,
  parsePesos,
  rankForValidation,
  type ManualPriceProduct,
  type ValidationRow,
} from '@/lib/manual-price';
import { isManualPrice } from '@/lib/price-freshness';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const NOW = '2026-11-24T21:30:00.000Z';

function product(over: Partial<ManualPriceProduct> = {}): ManualPriceProduct {
  return {
    id: ID,
    ml_product_id: 'MLC123',
    price: 545_337,
    original_price: null,
    seller_id: 99,
    winner_item_id: 'MLC-ITEM-1',
    is_active: true,
    inactive_reason: null,
    inactive_since: null,
    ...over,
  };
}

// ── Lo que escribe la persona ────────────────────────────────────────────

describe('parsePesos', () => {
  it('acepta el monto con o sin puntos y con el signo peso', () => {
    expect(parsePesos('545337')).toBe(545_337);
    expect(parsePesos('545.337')).toBe(545_337);
    expect(parsePesos(' $ 1.053.363 ')).toBe(1_053_363);
    expect(parsePesos(59_990)).toBe(59_990);
  });

  it('vacío es "no hay" (null); lo que no es un monto entero no se entiende (undefined)', () => {
    expect(parsePesos('')).toBeNull();
    expect(parsePesos('   ')).toBeNull();
    expect(parsePesos(null)).toBeNull();
    expect(parsePesos(undefined)).toBeNull();
    for (const bad of ['545,337', '54k', '-100', '0', '12.5.x', '9999999999', 12.5, {}, true]) {
      expect(parsePesos(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('checkManualPrice', () => {
  it('el mismo precio, sin tachado: pasa sin preguntar nada', () => {
    expect(checkManualPrice(545_337, '545337', '')).toEqual({
      ok: true,
      input: { price: 545_337, listPrice: null },
      confirm: null,
    });
  });

  it('con precio tachado mayor que el precio', () => {
    expect(checkManualPrice(59_990, '49.990', '79.990')).toEqual({
      ok: true,
      input: { price: 49_990, listPrice: 79_990 },
      confirm: null,
    });
  });

  it('un tachado igual o menor que el precio no es un descuento: se rechaza y dice qué hacer', () => {
    const res = checkManualPrice(59_990, '59990', '59990');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain('tiene que ser mayor que el precio de hoy');
    expect(checkManualPrice(59_990, '59990', '40000').ok).toBe(false);
  });

  it('sin precio, o con algo que no es un monto, lo dice', () => {
    expect(checkManualPrice(59_990, '', '')).toMatchObject({ ok: false, error: 'Escribe el precio que muestra Mercado Libre.' });
    expect(checkManualPrice(59_990, 'cincuenta', '')).toMatchObject({ ok: false });
    expect(checkManualPrice(59_990, '59990', 'x')).toMatchObject({ ok: false });
  });

  it('un cambio muy grande (un dígito de más o de menos) se pregunta antes de guardar', () => {
    const less = checkManualPrice(545_337, '54533', '');
    expect(less).toMatchObject({ ok: true, input: { price: 54_533 } });
    expect(less.ok && less.confirm).toContain('El precio guardado era $545.337 y escribiste $54.533');
    expect(checkManualPrice(54_533, '545337', '')).toMatchObject({ ok: true, confirm: expect.stringContaining('muy grande') });
    // Una baja o una subida normal no se pregunta.
    expect(checkManualPrice(545_337, '496150', '')).toMatchObject({ ok: true, confirm: null });
    expect(checkManualPrice(545_337, '599990', '')).toMatchObject({ ok: true, confirm: null });
    // Un tachado de más del triple también llama la atención.
    expect(checkManualPrice(20_000, '20000', '79990')).toMatchObject({
      ok: true,
      confirm: expect.stringContaining('más del triple'),
    });
    // Sin precio guardado no hay con qué comparar.
    expect(checkManualPrice(0, '59990', '')).toMatchObject({ ok: true, confirm: null });
  });
});

// ── Lo que cambia en el producto ─────────────────────────────────────────

describe('manualPriceOutcome', () => {
  it('mismo precio: solo la hora de revisión y la marca de que lo revisó una persona; nada al historial', () => {
    const outcome = manualPriceOutcome(product(), { price: 545_337, listPrice: null }, NOW);
    expect(outcome).toEqual({
      id: ID,
      result: 'activo',
      patch: { price_checked_at: NOW, offer_info: MANUAL_OFFER_INFO },
      priceChanged: false,
      reactivated: false,
      deactivated: false,
    });
    expect(isManualPrice({ offer_info: outcome.patch.offer_info })).toBe(true);
  });

  it('otro precio: se guarda, va al historial sin vendedor y deja la fila de partida', () => {
    const outcome = manualPriceOutcome(product(), { price: 496_150, listPrice: 599_990 }, NOW);
    expect(outcome.patch).toEqual({
      price_checked_at: NOW,
      offer_info: MANUAL_OFFER_INFO,
      price: 496_150,
      original_price: 599_990,
    });
    expect(outcome.priceChanged).toBe(true);
    expect(outcome.observation).toEqual({
      product_id: ID,
      ml_product_id: 'MLC123',
      price: 496_150,
      original_price: 599_990,
      seller_id: null,
      winner_item_id: null,
      observed_at: NOW,
    });
    expect(outcome.previous).toMatchObject({ price: 545_337, original_price: null, winner_item_id: 'MLC-ITEM-1' });
  });

  it('quitar el tachado (la ficha ya no lo muestra) también es un cambio', () => {
    const outcome = manualPriceOutcome(product({ original_price: 699_990 }), { price: 545_337, listPrice: null }, NOW);
    expect(outcome.patch).toMatchObject({ original_price: null });
    expect('price' in outcome.patch).toBe(false);
    expect(outcome.priceChanged).toBe(true);
  });

  it('un producto que nunca tuvo un ganador revisado no deja fila de partida', () => {
    const outcome = manualPriceOutcome(product({ winner_item_id: null }), { price: 500_000, listPrice: null }, NOW);
    expect(outcome.observation).toBeDefined();
    expect(outcome.previous).toBeUndefined();
  });

  it('en pausa por no tener vendedor: al guardar un precio vuelve al sitio', () => {
    const paused = product({ is_active: false, inactive_reason: 'sin_ganador', inactive_since: '2026-11-20T10:00:00Z' });
    const outcome = manualPriceOutcome(paused, { price: 545_337, listPrice: null }, NOW);
    expect(outcome.reactivated).toBe(true);
    expect(outcome.patch).toMatchObject({ is_active: true, inactive_reason: null, inactive_since: null });
  });

  it('no afirma nada de la oferta: ni envío, ni Full, ni tienda, ni garantía', () => {
    expect(MANUAL_OFFER_INFO).toEqual({
      free_shipping: false,
      is_full: false,
      sold_by_ml: false,
      official_store: false,
      warranty: null,
      offers_count: null,
      is_lowest: null,
      source: 'manual',
    });
  });
});

describe('manualUnavailableOutcome y canValidateByHand', () => {
  it('ya no se vende: queda en pausa como cuando no había vendedor', () => {
    expect(manualUnavailableOutcome(product(), NOW)).toEqual({
      id: ID,
      result: 'sin_ganador',
      patch: { price_checked_at: NOW, is_active: false, inactive_reason: 'sin_ganador', inactive_since: NOW },
      priceChanged: false,
      reactivated: false,
      deactivated: true,
    });
  });

  it('si ya estaba en pausa no cambia desde cuándo', () => {
    const paused = product({ is_active: false, inactive_reason: 'sin_ganador', inactive_since: '2026-11-20T10:00:00Z' });
    expect(manualUnavailableOutcome(paused, NOW)).toMatchObject({ patch: { price_checked_at: NOW }, deactivated: false });
  });

  it('lo que está fuera del sitio por su link no vuelve por revisar el precio', () => {
    expect(canValidateByHand({ is_active: true, inactive_reason: null })).toBe(true);
    expect(canValidateByHand({ is_active: false, inactive_reason: 'sin_ganador' })).toBe(true);
    expect(canValidateByHand({ is_active: false, inactive_reason: 'ganador_no_verde' })).toBe(true);
    expect(canValidateByHand({ is_active: false, inactive_reason: 'link_otro_producto' })).toBe(false);
  });
});

describe('rankForValidation', () => {
  const row = (id: string, over: Partial<ValidationRow> = {}): ValidationRow => ({
    id,
    slug: id,
    name: id,
    brand: null,
    image_url: '',
    price: 10_000,
    original_price: null,
    price_checked_at: '2026-11-23T16:33:00Z',
    ml_product_id: `MLC${id}`,
    is_active: true,
    is_hidden: false,
    inactive_reason: null,
    ...over,
  });

  it('primero lo que más se abre; a igual cantidad, lo que lleva más tiempo sin revisar', () => {
    const rows = [
      row('a'),
      row('b', { price_checked_at: '2026-11-24T20:00:00Z' }),
      row('c', { price_checked_at: null }),
      row('d'),
    ];
    const clicks = new Map([
      ['a', 3],
      ['b', 3],
      ['c', 3],
      ['d', 82],
    ]);
    expect(rankForValidation(rows, clicks).map((r) => [r.row.id, r.clicks])).toEqual([
      ['d', 82],
      ['c', 3],
      ['a', 3],
      ['b', 3],
    ]);
  });

  it('fuera lo oculto, lo eliminado y lo que no tiene ficha', () => {
    const rows = [
      row('a'),
      row('b', { is_hidden: true }),
      row('c', { deleted_at: '2026-11-01T00:00:00Z' }),
      row('d', { ml_product_id: null }),
    ];
    expect(rankForValidation(rows, new Map()).map((r) => r.row.id)).toEqual(['a']);
  });
});

// ── Las acciones del admin ───────────────────────────────────────────────

describe('saveManualPrice', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    ...product(),
    slug: 'consola-nintendo-switch-2',
    name: 'Consola Nintendo Switch 2',
    category: 'gaming',
    is_hidden: false,
    price_checked_at: '2026-11-23T16:33:00Z',
    affiliate_url: 'https://meli.la/abc',
    seller_sales_count: 1200,
    link_target_product_id: null,
    link_checked_at: null,
    deleted_at: null,
    ...over,
  });
  const updates = () => db.ops.filter((o) => o.table === 'products' && o.method === 'update');
  const historyInserts = () => db.ops.filter((o) => o.table === 'price_history' && o.method === 'insert');

  beforeEach(() => {
    db.product = stored();
    db.history = [{ id: 1 }];
    db.ops = [];
    db.failUpdate = false;
    db.audit = [];
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue('cristopher');
    vi.mocked(logAdminEvent).mockClear();
    vi.mocked(notifyIndexNow).mockClear();
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('guarda el precio de hoy, lo anota en el historial, rearma el sitio y avisa a Bing', async () => {
    const res = await saveManualPrice(ID, '496.150', '599990');
    expect(res).toMatchObject({ ok: true, price: 496_150, listPrice: 599_990, changed: true, reactivated: false });

    expect(updates()).toHaveLength(1);
    expect(updates()[0].patch).toMatchObject({
      price: 496_150,
      original_price: 599_990,
      offer_info: MANUAL_OFFER_INFO,
    });
    expect(updates()[0].filters).toEqual([['eq', 'id', ID]]);
    expect(historyInserts()).toHaveLength(1);
    expect(historyInserts()[0].patch).toEqual([
      expect.objectContaining({ product_id: ID, price: 496_150, original_price: 599_990, seller_id: null }),
    ]);

    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('catalog');
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/', 'layout');
    expect(vi.mocked(notifyIndexNow)).toHaveBeenCalledWith([
      expect.stringMatching(/\/producto\/consola-nintendo-switch-2$/),
    ]);
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({
      actor: 'cristopher',
      action: 'precio_manual',
      target: ID,
      before: { precio: 545_337, tachado: null, a_la_venta: true },
      after: { nombre: 'Consola Nintendo Switch 2', precio: 496_150, tachado: 599_990, a_la_venta: true },
    });
  });

  it('con el mismo precio no escribe en el historial, pero el precio queda como de hoy', async () => {
    const res = await saveManualPrice(ID, '545337', '');
    expect(res).toMatchObject({ ok: true, price: 545_337, listPrice: null, changed: false });
    expect(updates()[0].patch).toMatchObject({ offer_info: MANUAL_OFFER_INFO });
    expect(Object.keys(updates()[0].patch as object).sort()).toEqual(['offer_info', 'price_checked_at']);
    expect(historyInserts()).toHaveLength(0);
  });

  it('un cambio muy grande no se guarda hasta confirmarlo', async () => {
    const first = await saveManualPrice(ID, '54533', '');
    expect(first).toEqual({ ok: false, confirm: expect.stringContaining('es un cambio muy grande') });
    expect(updates()).toHaveLength(0);
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();

    const second = await saveManualPrice(ID, '54533', '', true);
    expect(second).toMatchObject({ ok: true, price: 54_533 });
    expect(updates()).toHaveLength(1);
  });

  it('lo que no se entiende no se guarda', async () => {
    expect(await saveManualPrice(ID, 'mucho', '')).toMatchObject({ ok: false, error: expect.stringContaining('no se entiende') });
    expect(await saveManualPrice(ID, '59990', '59990')).toMatchObject({ ok: false });
    expect(await saveManualPrice('no-es-un-id', '59990', '')).toEqual({ ok: false, error: 'Producto no válido.' });
    expect(updates()).toHaveLength(0);
  });

  it('no toca un producto oculto, eliminado, sin ficha o fuera del sitio por su link', async () => {
    for (const over of [
      { is_hidden: true },
      { deleted_at: '2026-11-01T00:00:00Z' },
      { ml_product_id: null },
      { is_active: false, inactive_reason: 'link_otro_producto' },
    ]) {
      db.product = stored(over);
      const res = await saveManualPrice(ID, '545337', '');
      expect(res.ok, JSON.stringify(over)).toBe(false);
    }
    db.product = null;
    expect(await saveManualPrice(ID, '545337', '')).toEqual({ ok: false, error: 'Ese producto ya no existe.' });
    expect(updates()).toHaveLength(0);
  });

  it('si la base no guarda, lo dice y no anota nada como hecho', async () => {
    db.failUpdate = true;
    expect(await saveManualPrice(ID, '500000', '')).toEqual({
      ok: false,
      error: 'No se pudo guardar en la base. Intenta de nuevo.',
    });
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect(historyInserts()).toHaveLength(0);
  });

  it('un producto en pausa por falta de vendedor vuelve al sitio al guardar su precio', async () => {
    db.product = stored({ is_active: false, inactive_reason: 'sin_ganador', inactive_since: '2026-11-20T10:00:00Z' });
    const res = await saveManualPrice(ID, '545337', '');
    expect(res).toMatchObject({ ok: true, reactivated: true });
    expect(updates()[0].patch).toMatchObject({ is_active: true, inactive_reason: null, inactive_since: null });
  });

  it('sin sesión de admin no lee ni escribe', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('No autorizado'));
    await expect(saveManualPrice(ID, '545337', '')).rejects.toThrow('No autorizado');
    await expect(markUnavailable(ID)).rejects.toThrow('No autorizado');
    expect(db.ops).toHaveLength(0);
  });

  it('"Ya no se vende" deja el producto en pausa y lo anota', async () => {
    const res = await markUnavailable(ID);
    expect(res).toEqual({ ok: true, wasOnSale: true });
    expect(updates()[0].patch).toMatchObject({ is_active: false, inactive_reason: 'sin_ganador' });
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({
      action: 'precio_manual',
      after: { a_la_venta: false },
    });
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('catalog');
  });

  it('anota en Actividad todo lo que hace falta para deshacer', async () => {
    db.product = stored({ original_price: 589_990, offer_info: { free_shipping: true } });
    await saveManualPrice(ID, '545337', '');
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({
      before: {
        precio: 545_337,
        tachado: 589_990,
        revisado: '2026-11-23T16:33:00Z',
        a_la_venta: true,
        oferta: { free_shipping: true },
        motivo_pausa: null,
        en_pausa_desde: null,
      },
    });
  });
});

// ── Deshacer un precio mal guardado ──────────────────────────────────────

describe('lo que hace falta para deshacer', () => {
  const SAVED_AT = '2026-11-26T11:58:03.000Z';
  const now = Date.parse('2026-11-26T12:10:00Z');

  it('manualPriceBefore junta cómo estaba el producto', () => {
    expect(
      manualPriceBefore({
        ...product({ original_price: 589_990 }),
        price_checked_at: '2026-11-23T16:33:00Z',
        offer_info: { free_shipping: true },
      })
    ).toEqual({
      precio: 545_337,
      tachado: 589_990,
      revisado: '2026-11-23T16:33:00Z',
      a_la_venta: true,
      oferta: { free_shipping: true },
      motivo_pausa: null,
      en_pausa_desde: null,
    });
  });

  it('parseManualBefore lee lo anotado, también lo de antes de que se guardara la oferta', () => {
    expect(parseManualBefore({ precio: 545_337, tachado: null, revisado: '2026-11-23T16:33:00Z', a_la_venta: true })).toEqual({
      precio: 545_337,
      tachado: null,
      revisado: '2026-11-23T16:33:00Z',
      a_la_venta: true,
      motivo_pausa: null,
      en_pausa_desde: null,
    });
    // Un tachado que no es mayor que el precio, o una fecha que no se entiende, no se toman.
    expect(parseManualBefore({ precio: 545_337, tachado: 500_000, revisado: 'ayer', a_la_venta: true })).toMatchObject({
      tachado: null,
      revisado: null,
    });
    for (const bad of [null, 'x', {}, { precio: '545337', a_la_venta: true }, { precio: 0, a_la_venta: true }, { precio: 100 }]) {
      expect(parseManualBefore(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('canUndoManual: solo si lo último anotado es lo que dejó al producto como está, y fue hace menos de un día', () => {
    const saved = { price_checked_at: SAVED_AT };
    expect(canUndoManual(saved, { at: '2026-11-26T11:58:04.200Z' }, now)).toBe(true);
    // Otra cosa lo tocó después (el canal, otra revisión): la hora ya no calza.
    expect(canUndoManual({ price_checked_at: '2026-11-26T12:05:00Z' }, { at: '2026-11-26T11:58:04Z' }, now)).toBe(false);
    expect(canUndoManual(saved, { at: '2026-11-26T12:30:00Z' }, now)).toBe(false);
    expect(canUndoManual(saved, null, now)).toBe(false);
    expect(canUndoManual({ price_checked_at: null }, { at: SAVED_AT }, now)).toBe(false);
    // Lo de ayer ya no se deshace.
    expect(canUndoManual(saved, { at: '2026-11-26T11:58:04Z' }, Date.parse('2026-11-27T12:30:00Z'))).toBe(false);
  });

  it('manualUndoPatch deja el producto como estaba', () => {
    expect(
      manualUndoPatch({ precio: 545_337, tachado: null, revisado: '2026-11-23T16:33:00Z', a_la_venta: true }, NOW)
    ).toEqual({
      price: 545_337,
      original_price: null,
      price_checked_at: '2026-11-23T16:33:00Z',
      is_active: true,
      inactive_reason: null,
      inactive_since: null,
    });
    // Con la oferta anotada, vuelve también.
    expect(
      manualUndoPatch({ precio: 1, tachado: null, revisado: null, a_la_venta: true, oferta: { free_shipping: true } }, NOW)
    ).toMatchObject({ offer_info: { free_shipping: true } });
    // Estaba en pausa: vuelve a la pausa, con su motivo.
    expect(
      manualUndoPatch(
        { precio: 1, tachado: null, revisado: null, a_la_venta: false, motivo_pausa: 'ganador_no_verde', en_pausa_desde: '2026-11-20T10:00:00Z' },
        NOW
      )
    ).toMatchObject({ is_active: false, inactive_reason: 'ganador_no_verde', inactive_since: '2026-11-20T10:00:00Z' });
    expect(manualUndoPatch({ precio: 1, tachado: null, revisado: null, a_la_venta: false }, NOW)).toMatchObject({
      is_active: false,
      inactive_reason: 'sin_ganador',
      inactive_since: NOW,
    });
  });
});

describe('undoManualPrice', () => {
  // Guardado hace 5 minutos, con un dígito de menos.
  const SAVED_AT = new Date(Date.now() - 5 * 60_000).toISOString();
  const stored = (over: Record<string, unknown> = {}) => ({
    ...product({ price: 54_533 }),
    slug: 'consola-nintendo-switch-2',
    name: 'Consola Nintendo Switch 2',
    category: 'gaming',
    is_hidden: false,
    price_checked_at: SAVED_AT,
    offer_info: MANUAL_OFFER_INFO,
    affiliate_url: 'https://meli.la/abc',
    seller_sales_count: 1200,
    link_target_product_id: null,
    link_checked_at: null,
    deleted_at: null,
    ...over,
  });
  const event = (over: Record<string, unknown> = {}) => ({
    at: new Date(Date.parse(SAVED_AT) + 1500).toISOString(),
    before: { precio: 545_337, tachado: 589_990, revisado: '2026-11-23T16:33:00Z', a_la_venta: true },
    ...over,
  });
  const updates = () => db.ops.filter((o) => o.table === 'products' && o.method === 'update');
  const deletes = () => db.ops.filter((o) => o.table === 'price_history' && o.method === 'delete');

  beforeEach(() => {
    db.product = stored();
    db.audit = [event()];
    db.history = [{ id: 1 }];
    db.ops = [];
    db.failUpdate = false;
    vi.mocked(requireAdmin).mockReset();
    vi.mocked(requireAdmin).mockResolvedValue('cristopher');
    vi.mocked(logAdminEvent).mockClear();
    vi.mocked(notifyIndexNow).mockClear();
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('deja el producto como estaba, borra del historial la fila equivocada, rearma el sitio y lo anota', async () => {
    const res = await undoManualPrice(ID);
    expect(res).toEqual({ ok: true, price: 545_337, listPrice: 589_990, checkedAt: '2026-11-23T16:33:00Z', active: true });

    expect(updates()).toHaveLength(1);
    expect(updates()[0].patch).toEqual({
      price: 545_337,
      original_price: 589_990,
      price_checked_at: '2026-11-23T16:33:00Z',
      is_active: true,
      inactive_reason: null,
      inactive_since: null,
    });
    expect(updates()[0].filters).toEqual([['eq', 'id', ID]]);
    // Solo la fila que dejó ese guardado: misma hora y sin vendedor.
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].filters).toEqual([
      ['eq', 'product_id', ID],
      ['eq', 'observed_at', SAVED_AT],
      ['is', 'seller_id', null],
    ]);

    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith('catalog');
    expect(vi.mocked(notifyIndexNow)).toHaveBeenCalledWith([expect.stringMatching(/\/producto\/consola-nintendo-switch-2$/)]);
    expect(vi.mocked(logAdminEvent).mock.calls[0][1]).toMatchObject({
      actor: 'cristopher',
      action: 'precio_deshacer',
      target: ID,
      before: { precio: 54_533, revisado: SAVED_AT },
      after: { nombre: 'Consola Nintendo Switch 2', precio: 545_337, tachado: 589_990, a_la_venta: true },
    });
  });

  it('si lo último que tocó el producto no fue ese guardado, no deshace nada', async () => {
    const nothing = { ok: false, error: expect.stringContaining('No hay nada que deshacer') };
    // Nunca se guardó a mano.
    db.audit = [];
    expect(await undoManualPrice(ID)).toEqual(nothing);
    // Lo anotado es de otro momento: después lo cambió otra cosa.
    db.audit = [event({ at: new Date(Date.parse(SAVED_AT) + 10 * 60_000).toISOString() })];
    expect(await undoManualPrice(ID)).toEqual(nothing);
    // El precio guardado es de hace días.
    db.audit = [event()];
    db.product = stored({ price_checked_at: '2026-11-20T10:00:00Z' });
    expect(await undoManualPrice(ID)).toEqual(nothing);
    // Lo anotado no dice cómo estaba.
    db.product = stored();
    db.audit = [event({ before: { nada: true } })];
    expect(await undoManualPrice(ID)).toEqual(nothing);

    expect(updates()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
  });

  it('si la base no guarda, lo dice y no borra nada del historial', async () => {
    db.failUpdate = true;
    expect(await undoManualPrice(ID)).toEqual({ ok: false, error: 'No se pudo deshacer. Intenta de nuevo.' });
    expect(deletes()).toHaveLength(0);
    expect(vi.mocked(logAdminEvent)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });

  it('un "Ya no se vende" equivocado vuelve a dejar el producto a la venta', async () => {
    db.product = stored({ price: 545_337, is_active: false, inactive_reason: 'sin_ganador', inactive_since: SAVED_AT, offer_info: null });
    db.audit = [event({ before: { precio: 545_337, tachado: null, revisado: '2026-11-23T16:33:00Z', a_la_venta: true } })];
    const res = await undoManualPrice(ID);
    expect(res).toMatchObject({ ok: true, active: true });
    expect(updates()[0].patch).toMatchObject({ is_active: true, inactive_reason: null, inactive_since: null });
  });

  it('no acepta un id raro ni un producto que ya no existe, y sin sesión no hace nada', async () => {
    expect(await undoManualPrice('no-es-un-id')).toEqual({ ok: false, error: 'Producto no válido.' });
    db.product = null;
    expect(await undoManualPrice(ID)).toEqual({ ok: false, error: 'Ese producto ya no existe.' });
    db.ops = [];
    vi.mocked(requireAdmin).mockRejectedValue(new Error('No autorizado'));
    await expect(undoManualPrice(ID)).rejects.toThrow('No autorizado');
    expect(db.ops).toHaveLength(0);
  });
});
