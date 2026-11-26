import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// cache() de React solo existe en el runtime de servidor de Next (lo usa
// lib/settings, que llega por lib/pricing).
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

import { CHANNEL_OFFER_INFO } from './channel-price';
import {
  CHANNEL_ACTOR,
  channelName,
  dealOutcomeText,
  postsToProcess,
  processNotices,
  readLastChannelPost,
  syncChannel,
  type ChannelSyncDeps,
} from './channel-sync';
import type { PricingOutcome } from './pricing';
import type { ShortLinkResult } from './short-links';
import type { ChannelPost } from './telegram-channel';

/*
 * Una pasada completa con todo falso: el canal, el acortador y la base. Nunca
 * hay red. Lo que se revisa es qué se guarda, qué no, y hasta dónde queda
 * visto el canal.
 */

const NOW = new Date('2026-11-25T21:30:00Z');

const DEALS_TEXT = [
  'Ojo con esta selección de tecnología y gaming 🎮📱 👇',
  '',
  '🎧 Auriculares inalámbricos Pulse Elite Sony',
  '💰 Precio: $109.990',
  '👉 https://tinyurl.com/3vvdnnpn',
  '',
  '🎮 Consola PlayStation 5 Digital Slim',
  '💰 Precio: $709.990',
  '👉 https://tinyurl.com/yc8hrkdp',
  '',
  '💡 TIP DE AFILIADO: destaca la seguridad de comprar en distribuidores autorizados.',
].join('\n');

const post = (id: number, postedAt: string, text: string): ChannelPost => ({ id, postedAt, text });
const TIP = post(120, '2026-11-25T15:30:00.000Z', 'Recuerda revisar tus ganancias en la Central.');
const DEALS = post(122, '2026-11-25T21:01:13.000Z', DEALS_TEXT);

const LINKS: Record<string, ShortLinkResult> = {
  'https://tinyurl.com/3vvdnnpn': { status: 'ficha', mlId: 'MLC50000001' },
  'https://tinyurl.com/yc8hrkdp': { status: 'ficha', mlId: 'MLC61403702' },
};

function ps5(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ml_product_id: 'MLC61403702',
    affiliate_url: 'https://www.mercadolibre.cl/p/MLC61403702',
    slug: 'consola-playstation-5-digital-slim',
    name: 'Consola Playstation 5 Digital Slim + Juego Astro Bot y Gran Turismo 7',
    price: 709_990,
    original_price: null,
    seller_id: 123,
    seller_sales_count: 500,
    is_active: true,
    is_hidden: false,
    inactive_reason: null,
    inactive_since: null,
    winner_item_id: 'MLC999',
    link_target_product_id: null,
    link_checked_at: null,
    price_checked_at: '2026-11-23T17:30:00Z',
    deleted_at: null,
    ...overrides,
  };
}

function fakeAdmin(products: Record<string, unknown>[], lastPost: number | null = null) {
  const audit: Record<string, unknown>[] = [];
  const runs = lastPost === null ? [] : [{ summary: { ultimo_aviso: lastPost } }];
  const runsQuery: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not', 'order']) runsQuery[m] = () => runsQuery;
  runsQuery.limit = async () => ({ data: runs, error: null });
  const admin = {
    from(table: string) {
      if (table === 'products') {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: products.filter((p) => ids.includes(p.ml_product_id as string)),
              error: null,
            }),
          }),
        };
      }
      if (table === 'admin_audit_log') {
        return {
          insert: async (row: Record<string, unknown>) => {
            audit.push(row);
            return { error: null };
          },
        };
      }
      return runsQuery;
    },
  } as unknown as SupabaseClient;
  return { admin, audit };
}

function deps(posts: ChannelPost[], overrides: Partial<ChannelSyncDeps> = {}) {
  const applied: PricingOutcome[] = [];
  const d: ChannelSyncDeps = {
    read: vi.fn(async () => ({ status: 'ok' as const, posts })),
    resolve: vi.fn(async (link: string) => LINKS[link] ?? { status: 'sin_resolver' as const, reason: 'no respondió' }),
    apply: vi.fn(async (_admin, outcomes) => {
      applied.push(...outcomes);
      return 0;
    }),
    ...overrides,
  };
  return { d, applied };
}

const options = (extra: Partial<Parameters<typeof syncChannel>[1]> = {}) => ({
  channel: 'canalafiliados',
  now: NOW,
  since: null,
  write: true,
  ...extra,
});

describe('syncChannel', () => {
  it('guarda el precio de lo que ya está en el sitio y anota lo que no está', async () => {
    const { admin, audit } = fakeAdmin([ps5({ original_price: 799_990 })]);
    const { d, applied } = deps([TIP, DEALS]);
    const { summary, written } = await syncChannel(admin, options(), d);

    expect(summary).toMatchObject({
      ok: true,
      canal: 'canalafiliados',
      avisos: 2,
      avisos_nuevos: 2,
      productos: 2,
      precios: 1,
      cambios: 1,
      saltados: { no_esta_en_el_sitio: 1 },
      no_estan: [{ ml_id: 'MLC50000001', nombre: 'Auriculares inalámbricos Pulse Elite Sony', precio: 109_990 }],
      ultimo_aviso: 122,
    });
    expect(summary.prueba).toBeUndefined();

    expect(applied).toHaveLength(1);
    expect(applied[0].patch).toEqual({
      price_checked_at: '2026-11-25T21:01:13.000Z',
      offer_info: CHANNEL_OFFER_INFO,
      // El aviso no trae precio sin descuento: el guardado ya no se afirma.
      original_price: null,
    });
    expect(written).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        slug: 'consola-playstation-5-digital-slim',
        name: 'Consola Playstation 5 Digital Slim + Juego Astro Bot y Gran Turismo 7',
        price: 709_990,
        changed: true,
      },
    ]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: CHANNEL_ACTOR,
      action: 'precio_canal',
      target: '11111111-1111-4111-8111-111111111111',
      after: { precio: 709_990, aviso: 122 },
    });
    // Solo se le preguntó al acortador por los dos links del aviso.
    expect(d.resolve).toHaveBeenCalledTimes(2);
  });

  it('mismo precio y sin tachado: solo queda la hora del aviso', async () => {
    const { admin } = fakeAdmin([ps5()]);
    const { d, applied } = deps([DEALS]);
    const { summary } = await syncChannel(admin, options(), d);
    expect(summary).toMatchObject({ precios: 1, cambios: 0 });
    expect(applied[0].patch).toEqual({ price_checked_at: '2026-11-25T21:01:13.000Z', offer_info: CHANNEL_OFFER_INFO });
  });

  it('no repite un aviso ya visto, ni uno que el sitio ya tiene anotado', async () => {
    const { admin } = fakeAdmin([ps5()], 122);
    const seen = deps([TIP, DEALS]);
    const first = await syncChannel(admin, options({ since: 122 }), seen.d);
    expect(first.summary).toMatchObject({ avisos_nuevos: 0, precios: 0, ultimo_aviso: 122 });
    expect(seen.d.resolve).not.toHaveBeenCalled();

    // Si igual se vuelve a mirar (se perdió el último visto), no escribe dos veces.
    const again = fakeAdmin([ps5({ price_checked_at: '2026-11-25T21:01:13.000Z' })]);
    const repeat = deps([DEALS]);
    const second = await syncChannel(again.admin, options(), repeat.d);
    expect(second.summary).toMatchObject({ precios: 0, saltados: { ya_revisado: 1, no_esta_en_el_sitio: 1 } });
    expect(repeat.applied).toHaveLength(0);
  });

  it('un cupón en el aviso deja todos sus precios fuera', async () => {
    const withCoupon = post(123, '2026-11-25T21:10:00.000Z', `${DEALS_TEXT}\n\n🎟️ CYBERTECH: $10.000 off en compras sobre $100.000`);
    const { admin } = fakeAdmin([ps5()]);
    const { d, applied } = deps([withCoupon]);
    const { summary } = await syncChannel(admin, options(), d);
    expect(summary).toMatchObject({ productos: 2, precios: 0, saltados: { con_condiciones: 2 }, ultimo_aviso: 123 });
    expect(applied).toHaveLength(0);
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it('si el acortador no responde, ese aviso se vuelve a mirar en la pasada siguiente', async () => {
    const { admin } = fakeAdmin([ps5()]);
    const { d } = deps([TIP, DEALS], {
      resolve: vi.fn(async () => ({ status: 'sin_resolver' as const, reason: 'timeout' })),
    });
    const { summary } = await syncChannel(admin, options({ since: 119 }), d);
    expect(summary).toMatchObject({ precios: 0, saltados: { link_sin_resolver: 2 }, ultimo_aviso: 121 });
  });

  it('un link que no lleva a una ficha no identifica un producto, y no queda pendiente', async () => {
    const { admin } = fakeAdmin([ps5()]);
    const { d } = deps([DEALS], { resolve: vi.fn(async () => ({ status: 'otro' as const })) });
    const { summary } = await syncChannel(admin, options(), d);
    expect(summary).toMatchObject({ precios: 0, saltados: { sin_ficha: 2 }, ultimo_aviso: 122 });
  });

  it('en modo prueba no escribe ni anota, y dice qué guardaría', async () => {
    const { admin, audit } = fakeAdmin([ps5({ price: 729_990 })]);
    const { d, applied } = deps([DEALS]);
    const { summary, written } = await syncChannel(admin, options({ write: false }), d);
    expect(summary).toMatchObject({ precios: 1, cambios: 1, prueba: true });
    expect(d.apply).not.toHaveBeenCalled();
    expect(applied).toHaveLength(0);
    expect(written).toEqual([]);
    expect(audit).toHaveLength(0);
  });

  it('si la base no guarda, lo dice y el aviso queda pendiente', async () => {
    const { admin, audit } = fakeAdmin([ps5()]);
    const { d } = deps([TIP, DEALS], { apply: vi.fn(async () => 1) });
    const { summary, written } = await syncChannel(admin, options({ since: 119 }), d);
    expect(summary).toMatchObject({ precios: 0, saltados: { no_se_guardo: 1 }, ultimo_aviso: 121 });
    expect(written).toEqual([]);
    expect(audit).toHaveLength(0);
  });

  it('no vuelve a publicar un producto en pausa', async () => {
    const { admin } = fakeAdmin([ps5({ is_active: false, inactive_reason: 'sin_ganador' })]);
    const { d, applied } = deps([DEALS]);
    const { summary } = await syncChannel(admin, options(), d);
    expect(summary).toMatchObject({ precios: 0, saltados: { en_pausa: 1 } });
    expect(applied).toHaveLength(0);
  });

  it('sin canal, sin vista pública o con Telegram caído no hace nada y lo explica', async () => {
    const { admin } = fakeAdmin([]);
    const none = deps([]);
    expect((await syncChannel(admin, options({ channel: null }), none.d)).summary).toMatchObject({ ok: true });
    expect(none.d.read).not.toHaveBeenCalled();

    const priv = deps([], { read: vi.fn(async () => ({ status: 'sin_vista_publica' as const })) });
    const closed = await syncChannel(admin, options(), priv.d);
    expect(closed.summary.ok).toBe(false);
    expect(closed.summary.omitida).toContain('vista pública');

    const down = deps([], { read: vi.fn(async () => ({ status: 'error' as const, reason: 'Telegram respondió 500' })) });
    expect((await syncChannel(admin, options(), down.d)).summary).toEqual({
      ok: false,
      omitida: 'Telegram no respondió bien: Telegram respondió 500',
    });
  });
});

describe('processNotices: un aviso pegado a mano', () => {
  const pasted = (text: string) => [{ id: 0, postedAt: NOW.toISOString(), text }];
  const opts = { now: NOW.getTime(), write: true, actor: 'cristopher' };

  it('dice qué pasó con cada producto, en el orden del aviso, y firma quien lo pegó', async () => {
    const { admin, audit } = fakeAdmin([ps5({ price: 729_990 })]);
    const { d, applied } = deps([]);
    const result = await processNotices(admin, pasted(DEALS_TEXT), opts, d);

    expect(result.deals).toEqual([
      { name: 'Auriculares inalámbricos Pulse Elite Sony', price: 109_990, mlId: 'MLC50000001', status: 'no_esta_en_el_sitio' },
      { name: 'Consola PlayStation 5 Digital Slim', price: 709_990, mlId: 'MLC61403702', status: 'guardado', changed: true },
    ]);
    expect(result).toMatchObject({ products: 2, saved: 1, changed: 1 });
    // Queda con la hora en que se pegó, que es cuando la persona lo vio.
    expect(applied[0].patch).toMatchObject({ price: 709_990, price_checked_at: NOW.toISOString() });
    expect(audit[0]).toMatchObject({
      actor: 'cristopher',
      action: 'precio_canal',
      after: { precio: 709_990, aviso: 'pegado a mano' },
    });
  });

  it('si un producto viene dos veces, vale la última', async () => {
    const twice = `${DEALS_TEXT}\n\n🎮 Consola PlayStation 5 Digital Slim Edición Nueva\n💰 Precio: $699.990\n👉 https://tinyurl.com/yc8hrkdp`;
    const { admin } = fakeAdmin([ps5()]);
    const { d, applied } = deps([]);
    const result = await processNotices(admin, pasted(twice), opts, d);
    expect(result.deals.map((x) => [x.name, x.status])).toEqual([
      ['Auriculares inalámbricos Pulse Elite Sony', 'no_esta_en_el_sitio'],
      ['Consola PlayStation 5 Digital Slim', 'ya_revisado'],
      ['Consola PlayStation 5 Digital Slim Edición Nueva', 'guardado'],
    ]);
    expect(applied).toHaveLength(1);
    expect(applied[0].patch.price).toBe(699_990);
  });

  it('un aviso sin productos no hace nada', async () => {
    const { admin } = fakeAdmin([ps5()]);
    const { d } = deps([]);
    const result = await processNotices(admin, pasted('Hola, mañana hay ofertas'), opts, d);
    expect(result).toMatchObject({ products: 0, saved: 0, deals: [] });
    expect(d.resolve).not.toHaveBeenCalled();
  });

  it('dealOutcomeText explica cada caso en una frase', () => {
    expect(dealOutcomeText({ status: 'guardado', price: 709_990, changed: true })).toBe(
      'Guardado: $709.990. Cambió respecto de lo que tenía el sitio.'
    );
    expect(dealOutcomeText({ status: 'guardado', price: 709_990, changed: false })).toBe(
      'Guardado: $709.990, el mismo que tenía el sitio.'
    );
    expect(dealOutcomeText({ status: 'guardado', price: 709_990 }, true)).toBe('Modo prueba: se guardaría $709.990.');
    expect(dealOutcomeText({ status: 'con_condiciones', price: 1 })).toContain('cupón');
    expect(dealOutcomeText({ status: 'no_esta_en_el_sitio', price: 1 })).toContain('No está en el sitio');
    expect(dealOutcomeText({ status: 'cambio_grande', price: 1 })).toContain('pestaña Precios');
  });
});

describe('postsToProcess', () => {
  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

  it('la primera vez toma solo los avisos de las últimas 24 horas', () => {
    const posts = [post(1, at(50), 'a'), post(2, at(23), 'b'), post(3, at(1), 'c')];
    expect(postsToProcess(posts, null, NOW.getTime()).map((p) => p.id)).toEqual([2, 3]);
  });

  it('después toma los no vistos de hasta 3 días, y como máximo los 12 más nuevos', () => {
    const posts = [post(5, at(80), 'viejo'), post(6, at(60), 'b'), post(7, at(2), 'c')];
    expect(postsToProcess(posts, 4, NOW.getTime()).map((p) => p.id)).toEqual([6, 7]);
    expect(postsToProcess(posts, 6, NOW.getTime()).map((p) => p.id)).toEqual([7]);
    const many = Array.from({ length: 20 }, (_, i) => post(100 + i, at(1), 'x'));
    expect(postsToProcess(many, 50, NOW.getTime()).map((p) => p.id)).toEqual(many.slice(-12).map((p) => p.id));
  });
});

describe('estado y configuración', () => {
  it('readLastChannelPost lee el último aviso visto de la bitácora, o null', async () => {
    expect(await readLastChannelPost(fakeAdmin([], 122).admin)).toBe(122);
    expect(await readLastChannelPost(fakeAdmin([]).admin)).toBeNull();
    const broken = { from: () => { throw new Error('caída'); } } as unknown as SupabaseClient;
    expect(await readLastChannelPost(broken)).toBeNull();
  });

  it('channelName acepta solo un nombre público de Telegram', () => {
    expect(channelName({ CANAL_AFILIADOS_TELEGRAM: ' afiliados_ml ' })).toBe('afiliados_ml');
    expect(channelName({ CANAL_AFILIADOS_TELEGRAM: 'https://t.me/afiliados_ml' })).toBeNull();
    expect(channelName({})).toBeNull();
  });
});
