import { describe, expect, it, vi } from 'vitest';

// La lectura del historial va a Supabase: acá solo se prueba lo puro.
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(async () => new Map()) }));
// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { AD_LABEL, DISCLOSURE } from '@/lib/content/captions';
import { getPriceStatsMany } from '@/lib/queries/price-history';
import { readConfirmedDrops } from '@/lib/social/drops';
import { checkPiecePath, pieceKey } from '@/lib/social/piece-url';
import { pickByRules, pickForTelegram, TELEGRAM_RULES, type SocialProduct } from '@/lib/social/telegram';
import {
  NETWORK_RULES,
  RECORDS_MAX,
  SCHEDULE_AHEAD_MS,
  buildPlanItem,
  parsePostRecords,
  parseRetirements,
  pendingIssue,
  registerPosts,
  retirePosts,
  singleParagraph,
  type PostRecord,
} from '@/lib/social/networks';

const NOW = new Date('2026-10-10T15:00:00Z');
const KEY = pieceKey({ CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv)!;

let seq = 0;
function product(over: Partial<SocialProduct> = {}): SocialProduct {
  seq++;
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return {
    id,
    slug: `producto-${seq}`,
    name: `Audífonos Marca Modelo ${seq}`,
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

describe('pickByRules', () => {
  const opts = { now: NOW, recentlyPosted: new Set<string>() };
  const six = { ...NETWORK_RULES, maxPosts: 6 };

  it('Telegram sigue eligiendo con sus reglas: 15% o más, sin lo oculto', () => {
    const ok = product();
    const gaming = product({ category: 'gaming', original_price: 95_000 }); // 16%
    const low = product({ original_price: 81_000 }); // 1%
    const hidden = product({ is_hidden: true });
    const picks = pickForTelegram([ok, gaming, low, hidden], opts);
    expect(picks.map((p) => p.product.id).sort()).toEqual([ok.id, gaming.id].sort());
    expect(pickByRules([ok, gaming, low, hidden], opts, TELEGRAM_RULES)).toEqual(picks);
  });

  it('las redes piden el descuento que el sitio llama oferta (20%), no el de Telegram', () => {
    const at15 = product({ price: 85_000, original_price: 100_000 });
    const at20 = product({ price: 80_000, original_price: 100_000 });
    expect(pickForTelegram([at15], opts)).toHaveLength(1);
    expect(pickByRules([at15, at20], opts, six).map((p) => p.product.id)).toEqual([at20.id]);
  });

  it('por defecto propone pocos: Metricool gratis da 20 publicaciones al mes y cada red cuenta', () => {
    const rows = [product(), product({ category: 'gaming' }), product({ category: 'hogar' })];
    expect(pickByRules(rows, opts, NETWORK_RULES)).toHaveLength(2);
  });

  it('respeta la cantidad pedida, el máximo por categoría y lo ya publicado', () => {
    const rows = [product(), product(), product(), product({ category: 'gaming' }), product({ category: 'hogar' })];
    const picks = pickByRules(rows, opts, { ...NETWORK_RULES, maxPosts: 3 });
    expect(picks).toHaveLength(3);
    expect(picks.filter((p) => p.product.category === 'audio')).toHaveLength(2);

    const posted = new Set([rows[0].id, rows[1].id]);
    const rest = pickByRules(rows, { now: NOW, recentlyPosted: posted }, six);
    expect(rest).toHaveLength(3);
    expect(rest.some((p) => posted.has(p.product.id))).toBe(false);
  });

  it('un precio revisado hace más de 6 horas no se publica', () => {
    const stale = product({ price_checked_at: new Date(NOW.getTime() - 7 * 3600_000).toISOString() });
    expect(pickByRules([stale], opts, six)).toHaveLength(0);
  });

  it('una baja comprobada entra aunque no llegue al descuento', () => {
    const p = product({ original_price: null });
    expect(pickByRules([p], opts, six)).toHaveLength(0);
    const picks = pickByRules([p], { ...opts, drops: new Map([[p.id, 8]]) }, six);
    expect(picks[0]).toMatchObject({ drop: 8, discount: 0 });
  });
});

describe('buildPlanItem', () => {
  const settings = { word: 'comparatech', tool: '15629069', directLinks: true };
  const build = { now: NOW, siteUrl: 'https://sitio.test/', settings, key: KEY };
  const p = product();
  const [pick] = pickByRules([p], { now: NOW, recentlyPosted: new Set() }, NETWORK_RULES);
  const item = buildPlanItem(pick, build)!;

  it('la imagen es una dirección firmada del sitio, con el precio del texto', () => {
    expect(item.pieza.startsWith(`https://sitio.test/social/pieza/${p.id}/feed-80000-100000-`)).toBe(true);
    const file = item.pieza.split('/').pop()!;
    const check = checkPiecePath(p.id, file, KEY, Math.floor(NOW.getTime() / 1000));
    expect(check).toMatchObject({ ok: true, snapshot: { price: 80_000, listPrice: 100_000, freeShipping: true } });
  });

  it('cada red lleva su texto: empieza con el aviso de publicidad y trae la comisión y la hora del precio', () => {
    for (const text of Object.values(item.textos)) {
      expect(text.startsWith(AD_LABEL)).toBe(true);
      expect(text).toContain(DISCLOSURE);
      expect(text).toContain('$80.000');
      expect(text).toMatch(/Precio revisado el \d{2}\/\d{2} a las \d{2}:\d{2}/);
    }
    // Instagram y TikTok no dejan links en el texto; Facebook sí.
    expect(item.textos.instagram).not.toContain('https://');
    expect(item.textos.tiktok).not.toContain('https://');
    expect(item.textos.facebook).toContain(item.link_compra);
    expect(item.textos.facebook).toContain('https://sitio.test/producto/');
  });

  it('el link de compra es el mismo destino que el botón del sitio', () => {
    expect(item.link_compra).toBe('https://www.mercadolibre.cl/p/MLC123?matt_word=comparatech&matt_tool=15629069');
    expect(item.ficha).toBe(`https://sitio.test/producto/${p.slug}`);
  });

  it('trae lo que hace falta para un video: la foto de Mercado Libre en JPG y el nombre corto', () => {
    expect(item.foto).toBe('https://http2.mlstatic.com/D_NQ_NP_123-F.jpg');
    expect(item.nombre_corto.length).toBeLessThanOrEqual(55);
    expect(item.marca).toBe('Marca');
  });

  it('dice hasta cuándo se puede programar: 48 horas, no más', () => {
    expect(SCHEDULE_AHEAD_MS).toBe(48 * 3600_000);
    expect(item.programar_antes_de).toBe(new Date(NOW.getTime() + SCHEDULE_AHEAD_MS).toISOString());
  });

  it('TikTok va en un solo párrafo (no respeta saltos de línea), con los hashtags al final', () => {
    const text = item.textos.tiktok;
    expect(text).not.toContain('\n');
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.indexOf(DISCLOSURE)).toBeLessThan(text.indexOf('#'));
    expect(text.trimEnd().endsWith('#audio')).toBe(true);
    expect(singleParagraph('a\n\n b \nc')).toBe('a · b · c');
    expect(singleParagraph('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('el título de TikTok empieza con "Publicidad" y cabe en 90 caracteres aunque el nombre sea largo', () => {
    const long = product({ name: 'Televisor '.repeat(30) });
    const [longPick] = pickByRules([long], { now: NOW, recentlyPosted: new Set() }, NETWORK_RULES);
    const title = (buildPlanItem(longPick, build)!.metricool.tiktok.tiktokData as { title: string }).title;
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.startsWith('Publicidad: ')).toBe(true);
    expect(title).toContain('$80.000');
  });

  it('los ajustes de Metricool van listos: una red por publicación, con la imagen y su texto', () => {
    for (const network of ['instagram', 'facebook', 'tiktok'] as const) {
      const info = item.metricool[network];
      expect(info).toMatchObject({
        autoPublish: true,
        draft: false,
        shortener: false,
        providers: [{ network }],
        text: item.textos[network],
        media: [item.pieza],
      });
      expect(info.mediaAltText).toEqual([`${item.nombre_corto} a $80.000`]);
    }
    expect(item.metricool.instagram.instagramData).toMatchObject({ type: 'POST', isAiGenerated: false });
    expect(item.metricool.facebook.facebookData).toEqual({ type: 'POST' });
  });

  it('en TikTok va marcado como contenido comercial, público y sin música automática', () => {
    expect(item.metricool.tiktok.tiktokData).toMatchObject({
      commercialContentThirdParty: true,
      commercialContentOwnBrand: true,
      privacyOption: 'PUBLIC_TO_EVERYONE',
      autoAddMusic: false,
      isAigc: false,
    });
  });

  it('sin precio de lista mayor, no informa un precio de lista', () => {
    const flat = product({ original_price: null });
    const [flatPick] = pickByRules(
      [flat],
      { now: NOW, recentlyPosted: new Set(), drops: new Map([[flat.id, 10]]) },
      NETWORK_RULES
    );
    const built = buildPlanItem(flatPick, build)!;
    expect(built.precio_lista).toBeNull();
    expect(built.pieza).toContain('/feed-80000-0-');
    expect(built.baja_historial).toBe(10);
  });
});

describe('parsePostRecords', () => {
  const ID = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c';
  const UUID = '0b6f6d53-8a0e-4b6e-9f2e-3a1c5d7e9f10';
  const ok = { product_id: ID, canal: 'instagram', programado_para: '2026-10-11T10:00:00-03:00', metricool_id: UUID };

  it('acepta una publicación completa', () => {
    const parsed = parsePostRecords({ publicaciones: [{ ...ok, precio: 80000, texto: 'hola' }] }, NOW);
    expect(parsed).toEqual({
      ok: true,
      records: [
        {
          productId: ID,
          channel: 'instagram',
          at: new Date('2026-10-11T13:00:00Z'),
          price: 80000,
          caption: 'hola',
          externalId: UUID,
        },
      ],
    });
  });

  it('precio y texto pueden faltar; el id de Metricool también puede venir como número', () => {
    const parsed = parsePostRecords({ publicaciones: [{ ...ok, canal: 'youtube', metricool_id: 123456 }] }, NOW);
    expect(parsed).toMatchObject({ ok: true, records: [{ price: null, caption: null, externalId: '123456' }] });
  });

  it('rechaza lo que no se puede anotar', () => {
    const bad: unknown[] = [
      null,
      {},
      { publicaciones: [] },
      { publicaciones: 'x' },
      { publicaciones: [null] },
      { publicaciones: [{ ...ok, product_id: 'nada' }] },
      { publicaciones: [{ ...ok, canal: 'telegram' }] }, // sus filas las maneja el bot
      { publicaciones: [{ ...ok, canal: 'twitter' }] },
      { publicaciones: [{ ...ok, programado_para: 'mañana' }] },
      { publicaciones: [{ ...ok, programado_para: '2026-10-11T10:00:00' }] }, // sin zona: el servidor la leería como UTC
      { publicaciones: [{ ...ok, programado_para: '2026-10-01T00:00:00Z' }] }, // hace más de dos días
      { publicaciones: [{ ...ok, programado_para: '2026-10-13T00:00:00Z' }] }, // a más de 48 horas
      { publicaciones: [{ ...ok, precio: -5 }] },
      { publicaciones: [{ ...ok, precio: '80000' }] },
      { publicaciones: [{ ...ok, texto: 'x'.repeat(3001) }] },
      { publicaciones: [{ ...ok, metricool_id: undefined }] },
      { publicaciones: [{ ...ok, metricool_id: '' }] },
      { publicaciones: [{ ...ok, metricool_id: 'con espacios y <script>' }] },
      { publicaciones: Array.from({ length: RECORDS_MAX + 1 }, () => ok) },
    ];
    for (const body of bad) expect(parsePostRecords(body, NOW).ok).toBe(false);
  });

  it('dice por qué rechaza una fecha lejana', () => {
    const parsed = parsePostRecords({ publicaciones: [{ ...ok, programado_para: '2026-10-20T10:00:00-03:00' }] }, NOW);
    expect(parsed).toMatchObject({ ok: false, error: expect.stringContaining('48 horas') });
  });
});

describe('parseRetirements', () => {
  it('sin la lista no hay nada que retirar', () => {
    expect(parseRetirements({})).toEqual({ ok: true, items: [] });
    expect(parseRetirements(null)).toEqual({ ok: true, items: [] });
  });

  it('acepta canal y id de Metricool', () => {
    expect(parseRetirements({ retiradas: [{ canal: 'tiktok', metricool_id: 'u-1' }] })).toEqual({
      ok: true,
      items: [{ channel: 'tiktok', externalId: 'u-1' }],
    });
  });

  it('el precio no puede pasar del entero que guarda la base', () => {
    const ok = {
      product_id: '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c',
      canal: 'instagram',
      programado_para: '2026-10-11T10:00:00-03:00',
      metricool_id: 'u-1',
    };
    expect(parsePostRecords({ publicaciones: [{ ...ok, precio: 2_147_483_647 }] }, NOW).ok).toBe(true);
    expect(parsePostRecords({ publicaciones: [{ ...ok, precio: 3_000_000_000 }] }, NOW).ok).toBe(false);
  });

  it('no deja retirar publicaciones de Telegram ni entradas sin id', () => {
    expect(parseRetirements({ retiradas: [{ canal: 'telegram', metricool_id: '55' }] }).ok).toBe(false);
    expect(parseRetirements({ retiradas: [{ canal: 'tiktok' }] }).ok).toBe(false);
    expect(parseRetirements({ retiradas: 'todas' }).ok).toBe(false);
    expect(parseRetirements({ retiradas: [null] }).ok).toBe(false);
  });
});

type Row = Record<string, unknown>;

/**
 * Base de mentira con estado: guarda filas y entiende los filtros que usa el
 * código (eq, neq, in, order, limit). Sin estado no se puede probar lo que
 * importa acá: retirar y volver a anotar la misma publicación.
 */
function fakeDb(seed: { products: Row[]; posts?: Row[] }) {
  const tables: Record<string, Row[]> = {
    products: seed.products.map((p) => ({ ...p })),
    social_posts: (seed.posts ?? []).map((p, i) => ({ id: i + 1, status: 'publicado', ...p })),
  };
  const writes: string[] = [];

  function query(table: string, mode: 'select' | 'update', patch?: Row) {
    const filters: ((row: Row) => boolean)[] = [];
    let sort: { column: string; ascending: boolean } | null = null;
    let max = Infinity;
    const run = () => {
      let rows = tables[table].filter((row) => filters.every((f) => f(row)));
      if (mode === 'update') {
        for (const row of rows) Object.assign(row, patch);
        if (rows.length > 0) writes.push(`update ${table}`);
      }
      if (sort) {
        const { column, ascending } = sort;
        rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
      }
      return { data: rows.slice(0, max).map((row) => ({ ...row })), error: null };
    };
    const builder = {
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      order(column: string, opts: { ascending: boolean }) {
        sort = { column, ascending: opts.ascending };
        return builder;
      },
      limit(n: number) {
        max = n;
        return builder;
      },
      select() {
        return builder;
      },
      then<T>(resolve: (value: { data: Row[]; error: null }) => T) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return builder;
  }

  const admin = {
    from(table: string) {
      return {
        select: () => query(table, 'select'),
        update: (patch: Row) => query(table, 'update', patch),
        insert: async (rows: Row[]) => {
          for (const row of rows) tables[table].push({ id: tables[table].length + 1, ...row });
          writes.push(`insert ${table}`);
          return { error: null };
        },
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, tables, writes };
}

describe('registerPosts', () => {
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const onSale = (id: string, price = 80_000) => ({ id, price, is_active: true, is_hidden: false, deleted_at: null });
  const record = (over: Partial<PostRecord>): PostRecord => ({
    productId: A,
    channel: 'instagram',
    at: new Date('2026-10-11T16:00:00Z'),
    price: 80_000,
    caption: 'texto',
    externalId: 'u-1',
    ...over,
  });
  const stamp = (db: ReturnType<typeof fakeDb>, id: string) => {
    const p = db.tables.products.find((row) => row.id === id)!;
    return { status: p.rrss_status, at: p.rrss_published_at, channel: p.rrss_channel };
  };

  it('anota cada publicación y marca el producto con la primera fecha', async () => {
    const db = fakeDb({ products: [onSale(A), onSale(B)] });
    const result = await registerPosts(
      db.admin,
      [
        record({ channel: 'tiktok', at: new Date('2026-10-11T21:00:00Z'), externalId: 'u-2' }),
        record({ channel: 'instagram', at: new Date('2026-10-11T13:00:00Z'), externalId: 'u-1' }),
        record({ productId: B, channel: 'facebook', externalId: 'u-3' }),
      ],
      NOW
    );

    expect(result).toEqual({ registradas: 3, actualizadas: 0, repetidas: 0, productos: 2, rechazados: [] });
    expect(db.tables.social_posts).toHaveLength(3);
    expect(db.tables.social_posts[0]).toMatchObject({
      product_id: A,
      channel: 'tiktok',
      external_id: 'u-2',
      posted_price: 80_000,
      caption: 'texto',
      status: 'publicado',
      posted_at: '2026-10-11T21:00:00.000Z',
    });
    expect(stamp(db, A)).toEqual({ status: 'publicado', at: '2026-10-11T13:00:00.000Z', channel: 'instagram' });
    expect(stamp(db, B)).toMatchObject({ status: 'publicado', channel: 'facebook' });
  });

  it('repetir la llamada con lo mismo no escribe nada', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    const records = [record({ externalId: 'u-1' }), record({ channel: 'facebook', externalId: 'u-1' })];
    await registerPosts(db.admin, records, NOW);
    const before = db.writes.length;

    const again = await registerPosts(db.admin, [...records, record({ channel: 'facebook', externalId: 'u-1' })], NOW);
    expect(again).toMatchObject({ registradas: 0, actualizadas: 0, repetidas: 3, productos: 0 });
    expect(db.writes).toHaveLength(before);
    // El mismo id en dos redes son dos publicaciones.
    expect(db.tables.social_posts.map((r) => r.channel)).toEqual(['instagram', 'facebook']);
  });

  it('una publicación editada en Metricool (mismo uuid) actualiza su fila en vez de saltarse', async () => {
    const db = fakeDb({ products: [onSale(A, 95_000)] });
    await registerPosts(db.admin, [record({ externalId: 'u-1', price: 100_000 })], NOW);

    const later = new Date('2026-10-11T18:00:00Z');
    const result = await registerPosts(db.admin, [record({ externalId: 'u-1', price: 95_000, at: later, caption: null })], NOW);

    expect(result).toMatchObject({ registradas: 0, actualizadas: 1, repetidas: 0, productos: 1 });
    expect(db.tables.social_posts).toHaveLength(1);
    expect(db.tables.social_posts[0]).toMatchObject({
      posted_price: 95_000,
      posted_at: later.toISOString(),
      status: 'publicado',
      // No vino texto: se conserva el que había.
      caption: 'texto',
    });
    expect(stamp(db, A).at).toBe(later.toISOString());
  });

  it('retirar y volver a anotar la misma publicación la deja vigente', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    await registerPosts(db.admin, [record({ externalId: 'u-1' })], NOW);

    expect(await retirePosts(db.admin, [{ channel: 'instagram', externalId: 'u-1' }], NOW)).toBe(1);
    expect(db.tables.social_posts[0]).toMatchObject({ status: 'error' });
    // Sin ninguna otra publicación vigente, el producto deja de figurar como publicado.
    expect(stamp(db, A)).toEqual({ status: 'sin_usar', at: null, channel: null });

    const result = await registerPosts(db.admin, [record({ externalId: 'u-1' })], NOW);
    expect(result).toMatchObject({ registradas: 0, actualizadas: 1 });
    expect(db.tables.social_posts).toHaveLength(1);
    expect(db.tables.social_posts[0]).toMatchObject({ status: 'publicado', error: null });
    expect(stamp(db, A)).toMatchObject({ status: 'publicado', channel: 'instagram' });
  });

  it('al retirar una de dos publicaciones, el producto queda con la que sigue vigente', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    await registerPosts(
      db.admin,
      [
        record({ channel: 'instagram', externalId: 'u-1', at: new Date('2026-10-11T13:00:00Z') }),
        record({ channel: 'tiktok', externalId: 'u-2', at: new Date('2026-10-11T21:00:00Z') }),
      ],
      NOW
    );
    await retirePosts(db.admin, [{ channel: 'instagram', externalId: 'u-1' }], NOW);
    expect(stamp(db, A)).toEqual({ status: 'publicado', at: '2026-10-11T21:00:00.000Z', channel: 'tiktok' });
    // Retirar dos veces lo mismo no cuenta dos veces.
    expect(await retirePosts(db.admin, [{ channel: 'instagram', externalId: 'u-1' }], NOW)).toBe(0);
  });

  it('retirar no toca filas de otro canal aunque compartan el id', async () => {
    const db = fakeDb({
      products: [onSale(A)],
      posts: [{ product_id: A, channel: 'telegram', external_id: '55', posted_at: '2026-10-10T12:00:00Z' }],
    });
    expect(await retirePosts(db.admin, [{ channel: 'instagram', externalId: '55' }], NOW)).toBe(0);
    expect(db.tables.social_posts[0]).toMatchObject({ channel: 'telegram', status: 'publicado' });
  });

  it('sin precio en la llamada, anota el precio actual del producto para poder vigilarlo', async () => {
    const db = fakeDb({ products: [onSale(A, 123_456)] });
    await registerPosts(db.admin, [record({ price: null })], NOW);
    expect(db.tables.social_posts[0]).toMatchObject({ posted_price: 123_456 });
  });

  it('lo que no existe, está oculto, eliminado o sin stock no se anota, y se informa', async () => {
    const C = '00000000-0000-4000-8000-00000000000c';
    const D = '00000000-0000-4000-8000-00000000000d';
    const E = '00000000-0000-4000-8000-00000000000e';
    const db = fakeDb({
      products: [
        onSale(A),
        { ...onSale(C), is_hidden: true },
        { ...onSale(D), deleted_at: '2026-10-01T00:00:00Z' },
        { ...onSale(E), is_active: false },
      ],
    });
    const result = await registerPosts(
      db.admin,
      [
        record({}),
        record({ productId: B, externalId: 'u-b' }),
        record({ productId: C, externalId: 'u-c' }),
        record({ productId: D, externalId: 'u-d' }),
        record({ productId: E, externalId: 'u-e' }),
      ],
      NOW
    );
    expect(result).toEqual({ registradas: 1, actualizadas: 0, repetidas: 0, productos: 1, rechazados: [B, C, D, E] });
    expect(db.tables.social_posts).toHaveLength(1);
    expect(stamp(db, C).status).toBeUndefined();
  });

  it('marca los productos antes de anotar: si lo segundo falla, repetir la llamada lo completa', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    const order: string[] = [];
    const from = db.admin.from.bind(db.admin);
    let failInsert = true;
    (db.admin as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const real = from(table) as unknown as { insert: (rows: Row[]) => Promise<{ error: unknown }> };
      return {
        ...real,
        update: (patch: Row) => {
          order.push(`update ${table}`);
          return (real as unknown as { update: (p: Row) => unknown }).update(patch);
        },
        insert: async (rows: Row[]) => {
          order.push(`insert ${table}`);
          if (failInsert) return { error: { message: 'caída' } };
          return real.insert(rows);
        },
      };
    };

    await expect(registerPosts(db.admin, [record({})], NOW)).rejects.toThrow(/caída/);
    expect(order).toEqual(['update products', 'insert social_posts']);

    failInsert = false;
    const retry = await registerPosts(db.admin, [record({})], NOW);
    expect(retry).toMatchObject({ registradas: 1, productos: 1 });
    expect(stamp(db, A)).toMatchObject({ status: 'publicado' });
  });
});

describe('pendingIssue', () => {
  const live = { price: 100_000, is_active: true, is_hidden: false, deleted_at: null };

  it('una publicación programada sigue vigente si el precio casi no se movió', () => {
    expect(pendingIssue({ posted_price: 100_000 }, live)).toBeNull();
    expect(pendingIssue({ posted_price: 98_000 }, live)).toBeNull(); // 2%
    expect(pendingIssue({ posted_price: null }, live)).toBeNull();
  });

  it('avisa si el precio cambió 3% o más, hacia arriba o hacia abajo', () => {
    expect(pendingIssue({ posted_price: 90_000 }, live)).toMatch(/subió/);
    expect(pendingIssue({ posted_price: 110_000 }, live)).toMatch(/bajó/);
  });

  it('avisa si el producto ya no está a la venta o no se muestra', () => {
    expect(pendingIssue({ posted_price: 100_000 }, { ...live, is_active: false })).toMatch(/ya no está a la venta/);
    expect(pendingIssue({ posted_price: 100_000 }, { ...live, is_hidden: true })).toMatch(/ya no está a la venta/);
    expect(pendingIssue({ posted_price: 100_000 }, null)).toMatch(/ya no está a la venta/);
  });
});

describe('readConfirmedDrops', () => {
  it('solo consulta el historial de los que no llegan al descuento, y devuelve la baja en %', async () => {
    const deal = product({ price: 70_000, original_price: 100_000 });
    const flat = product({ price: 90_000, original_price: null });
    const lastChangeAt = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    vi.mocked(getPriceStatsMany).mockResolvedValueOnce(
      new Map([
        [
          flat.id,
          {
            min30: 90_000,
            median30: 95_000,
            max30: 100_000,
            minTracked: 90_000,
            maxTracked: 100_000,
            daysTracked: 20,
            lastPrice: 90_000,
            previousPrice: 100_000,
            lastChangeAt,
          },
        ],
      ])
    );

    const drops = await readConfirmedDrops([deal, flat], NOW, NETWORK_RULES.minDiscount);
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([flat.id]);
    expect(drops.get(flat.id)).toBeCloseTo(10);
    expect(drops.has(deal.id)).toBe(false);
  });
});
