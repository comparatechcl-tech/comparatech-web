import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Las acciones de "Otras tiendas" (/admin/tiendas), con la tienda y la base
 * falsas. Lo que importa: que nada se guarde sin leer antes la ficha, que no
 * se le pida a la tienda más de lo necesario, que una copia de prueba no
 * escriba, y que nadie sin clave pueda usarlas.
 */

const env = vi.hoisted(() => ({ production: true }));
const db = vi.hoisted(() => ({
  product: null as Record<string, unknown> | null,
  offer: null as Record<string, unknown> | null,
  ops: [] as Array<{ table: string; method: string; payload?: unknown; filters: Array<[string, unknown]> }>,
  failWrite: null as { code?: string; message: string } | null,
}));
const store = vi.hoisted(() => ({
  robotsOk: true,
  read: null as unknown,
  hits: [] as unknown[],
}));

vi.mock('@/lib/supabase/server', () => {
  const from = (table: string) => {
    const op = { table, method: 'select', payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
    const run = () => {
      db.ops.push(op);
      if (op.method === 'select') {
        if (table === 'products') return { data: db.product, error: null };
        if (table === 'store_offers') return { data: db.offer, error: null };
        if (table === 'site_settings') return { data: null, error: null };
      }
      return { data: null, error: op.method === 'select' ? null : db.failWrite };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (column: string, value: unknown) => {
        op.filters.push([column, value]);
        return b;
      },
      maybeSingle: () => Promise.resolve(run()),
      update: (payload: unknown) => {
        op.method = 'update';
        op.payload = payload;
        return b;
      },
      delete: () => {
        op.method = 'delete';
        return b;
      },
      upsert: (payload: unknown) => {
        op.method = 'upsert';
        op.payload = payload;
        return Promise.resolve(run());
      },
      then: (ok: (r: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, fail),
    };
    return b;
  };
  return { getSupabaseAdmin: () => ({ from }) };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn(async () => 'cristopher') }));
vi.mock('@/lib/admin-audit', () => ({ logAdminEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/runtime-env', () => ({ isProductionRuntime: () => env.production }));
// lib/store-settings usa cache() de React, que solo existe en el servidor de Next.
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: <T,>(fn: T) => fn }));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: () => null }));
vi.mock('@/lib/store-reader', () => ({
  readRobots: vi.fn(async () => (store.robotsOk ? { ok: true, txt: '' } : { ok: false, detail: 'respondió 403' })),
  readStorePrice: vi.fn(async () => store.read),
  searchStore: vi.fn(async () => ({ ok: true, hits: store.hits })),
}));

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { readRobots, readStorePrice, searchStore } from '@/lib/store-reader';
import { clearStoreReadCache } from '@/lib/store-read-cache';
import { getStore } from '@/lib/stores';
import {
  linkStoreOffer,
  rereadOffer,
  reviewStoreLink,
  searchInStore,
  setOfferPaused,
  setStoresVisible,
  unlinkOffer,
} from '@/app/admin/tiendas/actions';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PARIS = getStore('paris')!;
let seq = 0;
/** Una ficha distinta en cada prueba. */
function ficha() {
  seq += 1;
  return `https://www.paris.cl/consola-nintendo-switch-2-negro-MK${seq}.html`;
}

function okRead(url: string, over: Record<string, unknown> = {}) {
  return {
    ok: true,
    store: PARIS,
    url,
    value: { title: 'Consola Nintendo Switch 2 Negro', price: 699_990, sku: 'MK3LFN4PP4', seller: 'Paris', available: true, ...over },
  };
}

const writes = () => db.ops.filter((op) => op.method !== 'select');

beforeEach(() => {
  // Lo leído queda guardado unos minutos en el proceso: cada prueba parte de cero.
  clearStoreReadCache();
  env.production = true;
  db.product = { id: PRODUCT_ID, slug: 'nintendo-switch-2', name: 'Nintendo Switch 2 256 GB Negro', price: 545_337, is_hidden: false };
  db.offer = null;
  db.ops = [];
  db.failWrite = null;
  store.robotsOk = true;
  store.read = null;
  store.hits = [];
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(logAdminEvent).mockClear();
  vi.mocked(readStorePrice).mockClear();
  vi.mocked(readRobots).mockClear();
  vi.mocked(searchStore).mockClear();
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(requireAdmin).mockResolvedValue('cristopher');
});

describe('reviewStoreLink', () => {
  it('lee la ficha y muestra qué dice la tienda, sin guardar nada', async () => {
    const url = ficha();
    store.read = okRead(url);
    const result = await reviewStoreLink(PRODUCT_ID, `${url}?utm_source=x`);
    expect(result).toEqual({
      ok: true,
      preview: {
        store: 'paris',
        storeName: 'Paris',
        url,
        title: 'Consola Nintendo Switch 2 Negro',
        price: 699_990,
        sku: 'MK3LFN4PP4',
        seller: 'Paris',
        available: true,
        warnings: [],
      },
    });
    expect(writes()).toEqual([]);
  });

  it('avisa cuando el precio es muy distinto, cuando lo vende un tercero y cuando no hay stock', async () => {
    const url = ficha();
    store.read = okRead(url, { price: 19_990, seller: 'Fundas SpA', available: false });
    const result = await reviewStoreLink(PRODUCT_ID, url);
    expect(result.ok && result.preview.warnings).toHaveLength(3);
    expect(result.ok && result.preview.warnings.join(' ')).toMatch(/muy distinto[\s\S]*Fundas SpA[\s\S]*no tiene stock/);
  });

  it('un link que no es de una tienda legible no se pide, y dice por qué', async () => {
    for (const [link, expected] of [
      ['https://www.falabella.com/falabella-cl/product/1', 'Paris y MacOnline'],
      ['https://www.mercadolibre.cl/p/MLC61403702', 'Paris y MacOnline'],
      ['hola', 'Paris y MacOnline'],
      ['https://www.samsung.com/cl/smartphones/galaxy-s26/buy/', 'no permite en sus términos'],
      ['https://www.aliexpress.com/item/1005001234567890.html', 'conexión oficial'],
    ] as const) {
      const result = await reviewStoreLink(PRODUCT_ID, link);
      expect(result.ok).toBe(false);
      expect('error' in result ? result.error : '', link).toContain(expected);
    }
    expect(readStorePrice).not.toHaveBeenCalled();
    expect(readRobots).not.toHaveBeenCalled();
  });

  it('una ficha de varias versiones devuelve las versiones para elegir', async () => {
    store.read = {
      ok: false,
      reason: 'varias_versiones',
      detail: 'hay que elegir',
      variants: [{ title: 'iPhone 17 de 256 GB - Negro', sku: 'MG6J4BE/A', price: 1_099_990 }],
    };
    const result = await reviewStoreLink(PRODUCT_ID, `https://www.maconline.com/products/iphone-${++seq}`);
    expect(result).toMatchObject({ ok: false, store: 'maconline', variants: [{ sku: 'MG6J4BE/A' }] });
  });

  it('la versión sale del link pegado o de la que se eligió', async () => {
    const url = `https://www.maconline.com/products/iphone-${++seq}`;
    store.read = { ok: false, reason: 'error', detail: 'x' };
    await reviewStoreLink(PRODUCT_ID, `${url}#default_sku=MG6J4BE/A`);
    expect(vi.mocked(readStorePrice).mock.calls[0]).toEqual([url, '', { sku: 'MG6J4BE/A' }]);
    await reviewStoreLink(PRODUCT_ID, url, 'MG6P4BE/A');
    expect(vi.mocked(readStorePrice).mock.calls[1]).toEqual([url, '', { sku: 'MG6P4BE/A' }]);
    // Un código raro no viaja a la tienda.
    await reviewStoreLink(PRODUCT_ID, url, 'x" onload="');
    expect(vi.mocked(readStorePrice).mock.calls[2]).toEqual([url, '', { sku: null }]);
  });

  it('un bloqueo de la tienda se informa sin insistir', async () => {
    store.read = { ok: false, reason: 'bloqueada', detail: 'la tienda respondió 403' };
    const result = await reviewStoreLink(PRODUCT_ID, ficha());
    expect(result).toMatchObject({ ok: false });
    expect('error' in result ? result.error : '').toContain('No insisto');
    expect(readStorePrice).toHaveBeenCalledTimes(1);
  });

  it('si no se pudo leer el robots.txt de la tienda, no se le pide la ficha', async () => {
    store.robotsOk = false;
    const result = await reviewStoreLink(PRODUCT_ID, ficha());
    expect(result).toMatchObject({ ok: false });
    expect('error' in result ? result.error : '').toContain('robots.txt');
    expect(readRobots).toHaveBeenCalledTimes(1);
    expect(readStorePrice).not.toHaveBeenCalled();
  });

  it('el robots.txt de una tienda se pide una vez, no en cada ficha', async () => {
    store.read = okRead(ficha());
    await reviewStoreLink(PRODUCT_ID, ficha());
    await reviewStoreLink(PRODUCT_ID, ficha());
    await searchInStore('paris', 'switch 2');
    expect(readRobots).toHaveBeenCalledTimes(1);
    expect(readStorePrice).toHaveBeenCalledTimes(2);
  });

  it('un producto que no existe no se revisa', async () => {
    db.product = null;
    await expect(reviewStoreLink(PRODUCT_ID, ficha())).resolves.toMatchObject({ ok: false });
    await expect(reviewStoreLink('no-es-un-id', ficha())).resolves.toMatchObject({ ok: false });
    expect(readStorePrice).not.toHaveBeenCalled();
  });
});

describe('linkStoreOffer', () => {
  it('guarda el precio leído, lo anota en Actividad y rearma la ficha del producto', async () => {
    const url = ficha();
    store.read = okRead(url);
    const result = await linkStoreOffer(PRODUCT_ID, url);
    expect(result).toEqual({ ok: true, test: false, price: 699_990, storeName: 'Paris' });

    const [upsert] = writes();
    expect(upsert).toMatchObject({ table: 'store_offers', method: 'upsert' });
    expect(upsert.payload).toMatchObject({
      product_id: PRODUCT_ID,
      store: 'paris',
      url,
      external_id: 'MK3LFN4PP4',
      title: 'Consola Nintendo Switch 2 Negro',
      seller: 'Paris',
      price: 699_990,
      status: 'activo',
      fail_count: 0,
      last_error: null,
      created_by: 'cristopher',
    });
    expect(logAdminEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'tienda_enlazar', target: PRODUCT_ID }));
    expect(revalidatePath).toHaveBeenCalledWith('/producto/nintendo-switch-2');
  });

  it('entre revisar y guardar la ficha se le pide una sola vez a la tienda', async () => {
    const url = ficha();
    store.read = okRead(url);
    await reviewStoreLink(PRODUCT_ID, url);
    await linkStoreOffer(PRODUCT_ID, url);
    expect(readStorePrice).toHaveBeenCalledTimes(1);
  });

  it('sin stock se guarda, pero no como activo', async () => {
    const url = ficha();
    store.read = okRead(url, { available: false });
    await linkStoreOffer(PRODUCT_ID, url);
    expect(writes()[0].payload).toMatchObject({ status: 'sin_stock' });
  });

  it('en una copia de prueba lee, pero no guarda', async () => {
    env.production = false;
    const url = ficha();
    store.read = okRead(url);
    await expect(linkStoreOffer(PRODUCT_ID, url)).resolves.toEqual({ ok: true, test: true, price: 699_990, storeName: 'Paris' });
    expect(writes()).toEqual([]);
    expect(logAdminEvent).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('si la ficha no se pudo leer, no guarda nada', async () => {
    store.read = { ok: false, reason: 'sin_precio', detail: 'La ficha no trae un precio en pesos en sus datos.' };
    await expect(linkStoreOffer(PRODUCT_ID, ficha())).resolves.toMatchObject({ ok: false });
    store.read = { ok: false, reason: 'varias_versiones', detail: 'x', variants: [{ title: 'A', sku: 'A1', price: 1 }] };
    const result = await linkStoreOffer(PRODUCT_ID, `https://www.maconline.com/products/iphone-${++seq}`);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain('elige una');
    expect(writes()).toEqual([]);
  });

  it('sin la migración aplicada dice qué falta', async () => {
    const url = ficha();
    store.read = okRead(url);
    db.failWrite = { code: 'PGRST205', message: 'no existe store_offers' };
    const result = await linkStoreOffer(PRODUCT_ID, url);
    expect(result).toMatchObject({ ok: false });
    expect(!result.ok && result.error).toContain('migración 0022');
    expect(logAdminEvent).not.toHaveBeenCalled();
  });

  it('sin clave del admin no hace nada', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error('No autorizado'));
    await expect(linkStoreOffer(PRODUCT_ID, ficha())).rejects.toThrow('No autorizado');
    await expect(reviewStoreLink(PRODUCT_ID, ficha())).rejects.toThrow('No autorizado');
    await expect(searchInStore('paris', 'switch 2')).rejects.toThrow('No autorizado');
    await expect(rereadOffer(1)).rejects.toThrow('No autorizado');
    await expect(setOfferPaused(1, true)).rejects.toThrow('No autorizado');
    await expect(unlinkOffer(1)).rejects.toThrow('No autorizado');
    await expect(setStoresVisible(true)).rejects.toThrow('No autorizado');
    expect(db.ops).toEqual([]);
    expect(readStorePrice).not.toHaveBeenCalled();
  });
});

describe('searchInStore', () => {
  it('busca en Paris con un solo pedido y limpia lo escrito', async () => {
    store.hits = [{ title: 'Consola Nintendo Switch 2 Negro', url: ficha(), price: 699_990, sku: 'MK1' }];
    const result = await searchInStore('paris', '  Nintendo   <Switch> 2  ');
    expect(result).toMatchObject({ ok: true, storeName: 'Paris' });
    expect(searchStore).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchStore).mock.calls[0][1]).toBe('Nintendo Switch 2');
  });

  it('no busca con menos de 3 letras ni en tiendas sin buscador legible', async () => {
    await expect(searchInStore('paris', 'a')).resolves.toMatchObject({ ok: false });
    await expect(searchInStore('maconline', 'iphone 17')).resolves.toMatchObject({ ok: false });
    await expect(searchInStore('samsung', 'galaxy')).resolves.toMatchObject({ ok: false });
    await expect(searchInStore('falabella', 'galaxy')).resolves.toMatchObject({ ok: false });
    expect(searchStore).not.toHaveBeenCalled();
  });
});

describe('las fichas ya enlazadas', () => {
  function offer(over: Record<string, unknown> = {}) {
    return {
      id: 7,
      product_id: PRODUCT_ID,
      store: 'paris',
      url: ficha(),
      external_id: 'MK3LFN4PP4',
      title: 'Consola',
      seller: 'Paris',
      price: 699_990,
      checked_at: '2026-11-26T11:00:00Z',
      tried_at: '2026-11-26T11:00:00Z',
      status: 'activo',
      fail_count: 0,
      last_error: null,
      created_at: '2026-11-26T11:00:00Z',
      ...over,
    };
  }

  it('leer de nuevo guarda el precio de ahora', async () => {
    db.offer = offer();
    store.read = okRead(db.offer.url as string, { price: 649_990 });
    const result = await rereadOffer(7);
    expect(result).toMatchObject({ ok: true, test: false, price: 649_990 });
    const update = writes().find((op) => op.method === 'update');
    expect(update?.payload).toMatchObject({ price: 649_990, status: 'activo', fail_count: 0 });
    expect(update?.filters).toEqual([['id', 7]]);
    expect(revalidatePath).toHaveBeenCalledWith('/producto/nintendo-switch-2');
  });

  it('leer de nuevo una ficha que falla anota la falla y conserva el precio', async () => {
    db.offer = offer();
    store.read = { ok: false, reason: 'bloqueada', detail: 'la tienda respondió 403' };
    const result = await rereadOffer(7);
    expect(result).toMatchObject({ ok: true, price: 699_990 });
    expect(result.ok && result.message).toContain('No insisto');
    const update = writes().find((op) => op.method === 'update');
    expect(update?.payload).toMatchObject({ fail_count: 1, status: 'activo' });
    expect(update?.payload).not.toHaveProperty('price');
  });

  it('pausar, reanudar y quitar escriben lo justo y quedan en Actividad', async () => {
    db.offer = offer();
    await expect(setOfferPaused(7, true)).resolves.toEqual({ ok: true, test: false });
    expect(writes()[0]).toMatchObject({ method: 'update', payload: { status: 'pausado' } });

    db.ops = [];
    db.offer = offer({ status: 'pausado', fail_count: 4 });
    await setOfferPaused(7, false);
    expect(writes()[0].payload).toEqual({ status: 'activo', fail_count: 0, last_error: null, tried_at: null });

    db.ops = [];
    await expect(unlinkOffer(7)).resolves.toEqual({ ok: true, test: false });
    expect(writes()[0]).toMatchObject({ table: 'store_offers', method: 'delete', filters: [['id', 7]] });
    expect(vi.mocked(logAdminEvent).mock.calls.map((c) => c[1].action)).toEqual(['tienda_pausar', 'tienda_pausar', 'tienda_quitar']);
  });

  it('en una copia de prueba nada de eso escribe', async () => {
    env.production = false;
    db.offer = offer();
    store.read = okRead(db.offer.url as string);
    await expect(rereadOffer(7)).resolves.toMatchObject({ ok: true, test: true });
    await expect(setOfferPaused(7, true)).resolves.toEqual({ ok: true, test: true });
    await expect(unlinkOffer(7)).resolves.toEqual({ ok: true, test: true });
    await expect(setStoresVisible(true)).resolves.toEqual({ ok: true, test: true });
    expect(writes()).toEqual([]);
  });

  it('una ficha que ya no está enlazada, o un número que no es un id, no hace nada', async () => {
    db.offer = null;
    await expect(rereadOffer(7)).resolves.toMatchObject({ ok: false });
    await expect(unlinkOffer(-1)).resolves.toMatchObject({ ok: false });
    await expect(setOfferPaused(1.5, true)).resolves.toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });
});

describe('setStoresVisible', () => {
  it('guarda la decisión, la anota y rearma todas las fichas', async () => {
    await expect(setStoresVisible(true)).resolves.toEqual({ ok: true, test: false });
    const upsert = writes().find((op) => op.method === 'upsert');
    expect(upsert).toMatchObject({ table: 'site_settings', payload: { key: 'stores', value: { show: true } } });
    expect(logAdminEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'tiendas_mostrar', before: { mostrar: false }, after: { mostrar: true } })
    );
    expect(revalidatePath).toHaveBeenCalledWith('/producto/[slug]', 'page');
  });
});
