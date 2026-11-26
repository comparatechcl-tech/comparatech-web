import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStore } from './stores';
import type { StoreRead } from './store-reader';
import {
  MAX_FAILS,
  READ_EVERY_MS,
  RETRY_ERROR_MS,
  RETRY_FAILED_MS,
  blockingStores,
  dueForRead,
  offerPatchAfterRead,
  publicStoreOffers,
  readAllOffers,
  type StoreOfferRow,
} from './store-offers';

const NOW = new Date('2026-11-26T15:00:00Z');
const PARIS = getStore('paris')!;
const FICHA = 'https://www.paris.cl/consola-nintendo-switch-2-negro-MK3LFN4PP4.html';

function row(over: Partial<StoreOfferRow> = {}): StoreOfferRow {
  return {
    id: 1,
    product_id: '11111111-1111-4111-8111-111111111111',
    store: 'paris',
    url: FICHA,
    external_id: 'MK3LFN4PP4',
    title: 'Consola Nintendo Switch 2 Negro',
    seller: 'Paris',
    price: 699990,
    checked_at: '2026-11-26T11:17:00Z',
    tried_at: '2026-11-26T11:17:00Z',
    status: 'activo',
    fail_count: 0,
    last_error: null,
    created_at: '2026-11-26T11:00:00Z',
    ...over,
  };
}

function okRead(over: Partial<{ price: number; available: boolean; sku: string | null; seller: string | null; title: string | null }> = {}): StoreRead {
  return {
    ok: true,
    store: PARIS,
    url: FICHA,
    value: { title: 'Consola Nintendo Switch 2 Negro', price: 699990, sku: 'MK3LFN4PP4', seller: 'Paris', available: true, ...over },
  };
}

const fail = (reason: 'bloqueada' | 'no_existe' | 'error' | 'sin_precio' | 'robots'): StoreRead => ({ ok: false, reason, detail: 'la tienda respondió algo' });

describe('offerPatchAfterRead', () => {
  it('una lectura buena guarda el precio con la hora de ahora y borra las fallas', () => {
    expect(offerPatchAfterRead(row({ fail_count: 3, last_error: 'error: x', status: 'error' }), okRead({ price: 649990 }), NOW)).toEqual({
      price: 649990,
      title: 'Consola Nintendo Switch 2 Negro',
      seller: 'Paris',
      external_id: 'MK3LFN4PP4',
      checked_at: NOW.toISOString(),
      tried_at: NOW.toISOString(),
      status: 'activo',
      fail_count: 0,
      last_error: null,
    });
  });

  it('el código con que se enlazó no se pisa; si no había, se toma el de la tienda', () => {
    expect(offerPatchAfterRead(row({ external_id: 'MG6J4BE/A' }), okRead({ sku: 'OTRO' }), NOW).external_id).toBe('MG6J4BE/A');
    expect(offerPatchAfterRead(row({ external_id: null }), okRead({ sku: 'NUEVO1' }), NOW).external_id).toBe('NUEVO1');
  });

  it('si la tienda dice que no lo tiene, queda sin stock; cuando vuelve, activo', () => {
    expect(offerPatchAfterRead(row(), okRead({ available: false }), NOW).status).toBe('sin_stock');
    expect(offerPatchAfterRead(row({ status: 'sin_stock' }), okRead(), NOW).status).toBe('activo');
  });

  it('una falla no borra el precio ni su fecha: solo anota el intento', () => {
    const patch = offerPatchAfterRead(row(), fail('error'), NOW);
    expect(patch).toEqual({ tried_at: NOW.toISOString(), status: 'activo', fail_count: 1, last_error: 'error: la tienda respondió algo' });
    expect('price' in patch || 'checked_at' in patch).toBe(false);
  });

  it('con el tope de fallas seguidas deja de mostrarse; una ficha que ya no existe, antes', () => {
    expect(offerPatchAfterRead(row({ fail_count: MAX_FAILS - 2 }), fail('bloqueada'), NOW).status).toBe('activo');
    expect(offerPatchAfterRead(row({ fail_count: MAX_FAILS - 1 }), fail('bloqueada'), NOW).status).toBe('error');
    expect(offerPatchAfterRead(row({ fail_count: 0 }), fail('no_existe'), NOW).status).toBe('activo');
    expect(offerPatchAfterRead(row({ fail_count: 1 }), fail('no_existe'), NOW).status).toBe('error');
  });

  it('una ficha en pausa sigue en pausa, se lea bien o mal', () => {
    expect(offerPatchAfterRead(row({ status: 'pausado' }), okRead(), NOW).status).toBe('pausado');
    expect(offerPatchAfterRead(row({ status: 'pausado', fail_count: 10 }), fail('error'), NOW).status).toBe('pausado');
  });

  it('el motivo guardado no crece sin límite', () => {
    const long: StoreRead = { ok: false, reason: 'error', detail: 'x'.repeat(2000) };
    expect(offerPatchAfterRead(row(), long, NOW).last_error).toHaveLength(300);
  });
});

describe('dueForRead', () => {
  const now = NOW.getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('una ficha nunca intentada toca siempre; una en pausa, nunca', () => {
    expect(dueForRead(row({ tried_at: null }), now)).toBe(true);
    expect(dueForRead(row({ status: 'pausado', tried_at: null }), now)).toBe(false);
  });

  it('una que se leyó bien se vuelve a leer dos veces al día', () => {
    expect(dueForRead(row({ tried_at: ago(READ_EVERY_MS - 60_000) }), now)).toBe(false);
    expect(dueForRead(row({ tried_at: ago(READ_EVERY_MS) }), now)).toBe(true);
  });

  it('una que falló se reintenta antes; una en error, una vez al día', () => {
    expect(dueForRead(row({ fail_count: 1, tried_at: ago(RETRY_FAILED_MS - 60_000) }), now)).toBe(false);
    expect(dueForRead(row({ fail_count: 1, tried_at: ago(RETRY_FAILED_MS) }), now)).toBe(true);
    expect(dueForRead(row({ status: 'error', fail_count: 6, tried_at: ago(RETRY_FAILED_MS) }), now)).toBe(false);
    expect(dueForRead(row({ status: 'error', fail_count: 6, tried_at: ago(RETRY_ERROR_MS) }), now)).toBe(true);
  });
});

describe('blockingStores', () => {
  it('una tienda está bloqueando solo si todas sus fichas acumulan bloqueos', () => {
    const blocked = { status: 'error' as const, fail_count: MAX_FAILS, last_error: 'bloqueada: la tienda respondió 403' };
    expect([...blockingStores([row(blocked), row({ id: 2, ...blocked })])]).toEqual(['paris']);
    // Una sola ficha que se lee bien basta para seguir.
    expect(blockingStores([row(blocked), row({ id: 2 })]).size).toBe(0);
    // Fallas que no son un bloqueo (la ficha cambió de forma) no detienen la tienda.
    expect(blockingStores([row({ ...blocked, last_error: 'sin_precio: no trae precio' })]).size).toBe(0);
    // Pocas fallas todavía no.
    expect(blockingStores([row({ ...blocked, fail_count: MAX_FAILS - 1 })]).size).toBe(0);
  });

  it('mira cada tienda por separado y no cuenta las fichas en pausa', () => {
    const blocked = { status: 'error' as const, fail_count: MAX_FAILS, last_error: 'robots: no deja' };
    const offers = [row(blocked), row({ id: 2, store: 'maconline' }), row({ id: 3, status: 'pausado', fail_count: 0 })];
    expect([...blockingStores(offers)]).toEqual(['paris']);
    expect(blockingStores([row({ status: 'pausado' })]).size).toBe(0);
  });
});

describe('publicStoreOffers', () => {
  const now = NOW.getTime();

  it('muestra las ofertas activas con su precio, su fecha y la dirección de la tienda', () => {
    expect(publicStoreOffers([row()], now)).toEqual([
      {
        store: 'paris',
        storeName: 'Paris',
        price: 699990,
        checkedAt: '2026-11-26T11:17:00Z',
        url: FICHA,
        seller: null,
        commission: true,
      },
    ]);
  });

  it('ordena de menor a mayor precio y, en las tiendas de una ficha por modelo, abre la versión exacta', () => {
    const mac = row({
      id: 2,
      store: 'maconline',
      url: 'https://www.maconline.com/products/iphone-17',
      external_id: 'MG6J4BE/A',
      seller: null,
      price: 599990,
    });
    const offers = publicStoreOffers([row(), mac], now);
    expect(offers.map((o) => o.store)).toEqual(['maconline', 'paris']);
    expect(offers[0]).toMatchObject({ url: 'https://www.maconline.com/products/iphone-17#default_sku=MG6J4BE/A', commission: false });
  });

  it('dice quién lo vende solo cuando no es la tienda misma', () => {
    expect(publicStoreOffers([row({ seller: 'PARIS' })], now)[0].seller).toBeNull();
    expect(publicStoreOffers([row({ seller: 'Tecno Store SpA' })], now)[0].seller).toBe('Tecno Store SpA');
  });

  it('no muestra lo que no está activo, no tiene precio o no tiene una fecha que sirva', () => {
    for (const hidden of [
      row({ status: 'sin_stock' }),
      row({ status: 'error' }),
      row({ status: 'pausado' }),
      row({ price: null }),
      row({ price: 0 }),
      row({ checked_at: null }),
      row({ checked_at: 'ayer' }),
      // Más de un mes: ya no sirve ni de referencia.
      row({ checked_at: '2026-10-20T12:00:00Z' }),
      // Del futuro.
      row({ checked_at: '2026-11-27T12:00:00Z' }),
    ]) {
      expect(publicStoreOffers([hidden], now)).toEqual([]);
    }
    // Hace 29 días todavía sirve, con su fecha.
    expect(publicStoreOffers([row({ checked_at: '2026-10-28T16:00:00Z' })], now)).toHaveLength(1);
  });

  it('una tienda que no está en la lista, o una dirección que no es de esa tienda, no se muestra', () => {
    expect(publicStoreOffers([row({ store: 'falabella' })], now)).toEqual([]);
    expect(publicStoreOffers([row({ url: 'https://www.otro-sitio.com/producto.html' })], now)).toEqual([]);
    expect(publicStoreOffers([row({ url: 'https://www.maconline.com/products/iphone-17' })], now)).toEqual([]);
    expect(publicStoreOffers([row({ url: 'javascript:alert(1)' })], now)).toEqual([]);
  });

  it('una sola oferta por tienda', () => {
    expect(publicStoreOffers([row(), row({ id: 2, price: 1 })], now)).toHaveLength(1);
  });
});

describe('readAllOffers', () => {
  function admin(pages: Array<{ data: unknown; error: { code?: string; message: string } | null }>) {
    const calls: Array<[number, number]> = [];
    const client = {
      from: () => ({
        select: () => ({
          order: () => ({
            range: async (from: number, to: number) => {
              calls.push([from, to]);
              return pages[calls.length - 1] ?? { data: [], error: null };
            },
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    return { client, calls };
  }

  it('lee de a páginas hasta que una viene incompleta', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => row({ id: i + 1 }));
    const { client, calls } = admin([
      { data: full, error: null },
      { data: [row({ id: 1001 })], error: null },
    ]);
    const read = await readAllOffers(client);
    expect(read.available && read.rows.length).toBe(1001);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('sin la migración aplicada dice que falta la tabla, y otro error lo informa', async () => {
    const missing = admin([{ data: null, error: { code: 'PGRST205', message: 'no existe store_offers' } }]);
    await expect(readAllOffers(missing.client)).resolves.toEqual({ available: false, missing: true, error: 'no existe store_offers' });
    const broken = admin([{ data: null, error: { code: '500', message: 'caída' } }]);
    await expect(readAllOffers(broken.client)).resolves.toEqual({ available: false, missing: false, error: 'caída' });
  });
});
