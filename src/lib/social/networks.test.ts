import { describe, expect, it, vi } from 'vitest';

// lib/settings usa cache() de React, que solo existe dentro de Next.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { DISCLOSURE } from '@/lib/content/captions';
import { checkPiecePath, pieceKey } from '@/lib/social/piece-url';
import type { InterestEvidence } from '@/lib/social/interest';
import { pickByRules, TELEGRAM_RULES, type PickRules, type SocialProduct } from '@/lib/social/telegram';
import {
  NETWORK_RULES,
  RECORDS_MAX,
  SCHEDULE_AHEAD_MS,
  STORY_MARK,
  VIDEO_MARK,
  buildPlanItem,
  isHandMark,
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

/**
 * Una oferta que cualquier canal publicaría: audífonos de marca conocida, de
 * tienda oficial y con 40% de lista. Queda muy por encima del piso de interés.
 */
function strong(over: Partial<SocialProduct> = {}): SocialProduct {
  return product({
    name: 'Audífonos Bluetooth JBL Tune 520BT Negro',
    brand: 'JBL',
    price: 60_000,
    original_price: 100_000,
    seller_sales_count: 50_000,
    ml_root_category: 'MLC1000',
    offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true } as SocialProduct['offer_info'],
    ...over,
  });
}

/** Un producto pedido por su id: sin piso de interés ni avisos, para probar solo cómo se arma el plan. */
const HAND_PICKED: PickRules = { ...NETWORK_RULES, anyScore: true };

// La selección misma (puerta de entrada, piso, variedad, orden) se prueba en pick.test.ts.
describe('NETWORK_RULES', () => {
  const opts = { now: NOW, recentlyPosted: new Set<string>() };
  const ids = (picks: { product: SocialProduct }[]) => picks.map((pick) => pick.product.id);

  it('las redes piden el descuento que el sitio llama oferta (20%), no el de Telegram', () => {
    const at17 = strong({ price: 83_000 });
    const at40 = strong({ category: 'gaming' });
    // Sin el piso de interés ni el filtro de avisos, para mirar solo la puerta de entrada.
    const gate = (rules: PickRules): PickRules => ({ ...rules, maxPosts: 6, anyScore: true });
    expect(ids(pickByRules([at17, at40], opts, gate(TELEGRAM_RULES))).sort()).toEqual([at17.id, at40.id].sort());
    expect(ids(pickByRules([at17, at40], opts, gate(NETWORK_RULES)))).toEqual([at40.id]);
  });

  it('por defecto propone pocos: Metricool gratis da 20 publicaciones al mes y cada red cuenta', () => {
    const rows = [strong(), strong({ category: 'gaming' }), strong({ category: 'hogar' })];
    expect(NETWORK_RULES.maxPosts).toBe(2);
    expect(pickByRules(rows, opts, NETWORK_RULES)).toHaveLength(2);
  });

  it('un precio revisado hace más de 6 horas no se publica', () => {
    const stale = strong({ price_checked_at: new Date(NOW.getTime() - 7 * 3600_000).toISOString() });
    expect(pickByRules([stale], opts, NETWORK_RULES)).toHaveLength(0);
    expect(pickByRules([strong()], opts, NETWORK_RULES)).toHaveLength(1);
  });

  it('lo programado sale solo y no se puede corregir: lo que trae un aviso no se propone', () => {
    // Una consola con una baja de verdad, pero de un vendedor casi sin ventas.
    const doubtful = strong({
      name: 'Consola PlayStation 5 Slim Digital 1TB Blanco',
      brand: 'Sony',
      category: 'gaming',
      price: 449_990,
      original_price: null,
      seller_sales_count: 4,
      offer_info: { free_shipping: true, is_full: true, official_store: false, is_lowest: true } as SocialProduct['offer_info'],
    });
    const fine = strong();
    const evidence = new Map<string, InterestEvidence>([
      [doubtful.id, { drop: { pct: 25, amount: 150_000 }, min30: 449_990, daysTracked: 12 }],
    ]);

    expect(NETWORK_RULES.cleanOnly).toBe(true);
    expect(ids(pickByRules([doubtful, fine], { ...opts, evidence }, NETWORK_RULES))).toEqual([fine.id]);
    // No es que le falten puntos: donde alguien mira antes de publicar, sale, con su aviso.
    const seen = pickByRules([doubtful, fine], { ...opts, evidence }, { ...NETWORK_RULES, cleanOnly: false });
    expect(seen.find((pick) => pick.product.id === doubtful.id)?.score.warning).toEqual(expect.any(String));
  });
});

describe('buildPlanItem', () => {
  const settings = { word: 'comparatech', tool: '15629069', directLinks: true };
  const build = { now: NOW, siteUrl: 'https://sitio.test/', settings, key: KEY };
  const p = product();
  const [pick] = pickByRules([p], { now: NOW, recentlyPosted: new Set() }, HAND_PICKED);
  const item = buildPlanItem(pick, build)!;

  it('dice cuánto interesa, por qué y qué conviene mirar antes de programarlo', () => {
    expect(item.puntos).toBe(pick.score.points);
    expect(item.motivo).toBe(pick.score.reason);
    expect(item.motivo.length).toBeGreaterThan(10);
    expect(item.aviso).toBe(pick.score.warning);

    const score = { ...pick.score, points: 61.5, reason: 'Audífonos JBL, 30% por debajo del precio de lista' };
    const warned = buildPlanItem({ ...pick, score: { ...score, warning: 'otro vendedor lo ofrece a menos' } }, build)!;
    expect(warned).toMatchObject({
      puntos: 61.5,
      motivo: 'Audífonos JBL, 30% por debajo del precio de lista',
      aviso: 'otro vendedor lo ofrece a menos',
    });
    expect(buildPlanItem({ ...pick, score: { ...score, warning: null } }, build)!.aviso).toBeNull();
    // Lo que ya traía el plan sigue ahí.
    expect(warned).toMatchObject({ descuento: 20, baja_historial: null, comision_estimada: pick.commission });
  });

  it('una oferta limpia llega al plan sin aviso, y el motivo no usa las palabras que el sitio evita', () => {
    const [strongPick] = pickByRules([strong()], { now: NOW, recentlyPosted: new Set() }, NETWORK_RULES);
    const built = buildPlanItem(strongPick, build)!;
    expect(built.aviso).toBeNull();
    expect(built.puntos).toBeGreaterThan(0);
    expect(`${built.motivo} | ${item.motivo} | ${item.aviso ?? ''}`).not.toMatch(
      /recomendad|verificad|publicidad|mejor precio|m[aá]s barato|imperdible|ofert[oó]n|solo hoy|[uú]ltimas unidades|antes \$|rebajad|precio normal|ahorra/i
    );
  });

  it('la imagen es una dirección firmada del sitio, con el precio del texto', () => {
    expect(item.pieza.startsWith(`https://sitio.test/social/pieza/${p.id}/feed-80000-100000-`)).toBe(true);
    const file = item.pieza.split('/').pop()!;
    const check = checkPiecePath(p.id, file, KEY, Math.floor(NOW.getTime() / 1000));
    expect(check).toMatchObject({ ok: true, snapshot: { price: 80_000, listPrice: 100_000, freeShipping: true } });
  });

  it('cada red lleva su texto: sin la etiqueta "Publicidad", con la comisión y la hora del precio', () => {
    for (const text of Object.values(item.textos)) {
      expect(text).not.toMatch(/publicidad/i);
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

  it('el título de TikTok cabe en 90 caracteres aunque el nombre sea largo, y no lleva etiqueta', () => {
    const long = product({ name: 'Televisor '.repeat(30) });
    const [longPick] = pickByRules([long], { now: NOW, recentlyPosted: new Set() }, HAND_PICKED);
    const title = (buildPlanItem(longPick, build)!.metricool.tiktok.tiktokData as { title: string }).title;
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title).not.toMatch(/publicidad/i);
    expect(title.startsWith('Televisor')).toBe(true);
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

  it('trae la historia: otra imagen firmada, sin texto y marcada como historia', () => {
    expect(item.historia.startsWith(`https://sitio.test/social/pieza/${p.id}/story-80000-100000-`)).toBe(true);
    const file = item.historia.split('/').pop()!;
    expect(checkPiecePath(p.id, file, KEY, Math.floor(NOW.getTime() / 1000))).toMatchObject({
      ok: true,
      snapshot: { format: 'story', price: 80_000 },
    });
    for (const network of ['instagram', 'facebook'] as const) {
      const info = item.metricool_historia[network];
      expect(info).toMatchObject({ autoPublish: true, providers: [{ network }], media: [item.historia] });
      // Una historia que se publica sola no puede llevar texto.
      expect('text' in info).toBe(false);
    }
    expect(item.metricool_historia.instagram.instagramData).toEqual({ type: 'STORY', isAiGenerated: false });
    expect(item.metricool_historia.facebook.facebookData).toEqual({ type: 'STORY' });
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
    // Entra solo por la baja que vio el sitio.
    const evidence = new Map<string, InterestEvidence>([
      [flat.id, { drop: { pct: 10.2, amount: 9_000 }, min30: 80_000, daysTracked: 12 }],
    ]);
    expect(pickByRules([flat], { now: NOW, recentlyPosted: new Set() }, HAND_PICKED)).toHaveLength(0);
    const [flatPick] = pickByRules([flat], { now: NOW, recentlyPosted: new Set(), evidence }, HAND_PICKED);
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

  it('al retirar la única publicación, una historia subida a mano no deja el producto como publicado', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    await registerPosts(db.admin, [record({ externalId: 'u-1' })], NOW);
    db.tables.social_posts.push({
      id: 99,
      product_id: A,
      channel: 'instagram',
      external_id: null,
      caption: STORY_MARK,
      status: 'publicado',
      posted_at: '2026-10-11T23:00:00.000Z',
    });

    await retirePosts(db.admin, [{ channel: 'instagram', externalId: 'u-1' }], NOW);
    expect(stamp(db, A)).toEqual({ status: 'sin_usar', at: null, channel: null });
    expect(db.tables.social_posts.find((row) => row.id === 99)).toMatchObject({ status: 'publicado' });
  });

  it('al retirar la única publicación, un video subido a mano tampoco deja el producto como publicado', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    await registerPosts(db.admin, [record({ externalId: 'u-1' })], NOW);
    // El video se subió después de la publicación, a las cuatro redes.
    for (const [i, channel] of ['instagram', 'tiktok', 'youtube', 'facebook'].entries()) {
      db.tables.social_posts.push({
        id: 90 + i,
        product_id: A,
        channel,
        external_id: null,
        caption: VIDEO_MARK,
        status: 'publicado',
        posted_at: `2026-10-11T23:0${i}:00.000Z`,
      });
    }

    expect(await retirePosts(db.admin, [{ channel: 'instagram', externalId: 'u-1' }], NOW)).toBe(1);
    expect(stamp(db, A)).toEqual({ status: 'sin_usar', at: null, channel: null });
    // Las marcas de video siguen vigentes: retirar una publicación no las toca.
    expect(db.tables.social_posts.filter((row) => row.caption === VIDEO_MARK).map((row) => row.status)).toEqual([
      'publicado',
      'publicado',
      'publicado',
      'publicado',
    ]);
  });

  it('con marcas de video más nuevas, el producto queda con su última publicación del feed y no con el video', async () => {
    const db = fakeDb({ products: [onSale(A)] });
    await registerPosts(
      db.admin,
      [
        record({ channel: 'instagram', externalId: 'u-1', at: new Date('2026-10-11T13:00:00Z') }),
        record({ channel: 'facebook', externalId: 'u-2', at: new Date('2026-10-11T14:00:00Z') }),
      ],
      NOW
    );
    // Muchas marcas hechas a mano delante de la publicación que se busca.
    for (let i = 0; i < 30; i++) {
      db.tables.social_posts.push({
        id: 100 + i,
        product_id: A,
        channel: 'youtube',
        external_id: null,
        caption: i % 2 ? VIDEO_MARK : STORY_MARK,
        status: 'publicado',
        posted_at: `2026-10-12T10:${String(i).padStart(2, '0')}:00.000Z`,
      });
    }

    await retirePosts(db.admin, [{ channel: 'instagram', externalId: 'u-1' }], NOW);
    expect(stamp(db, A)).toEqual({ status: 'publicado', at: '2026-10-11T14:00:00.000Z', channel: 'facebook' });
  });

  it('una marca hecha a mano es una historia o un video, nunca un post con texto', () => {
    expect(isHandMark(STORY_MARK)).toBe(true);
    expect(isHandMark(VIDEO_MARK)).toBe(true);
    expect(VIDEO_MARK).toBe('video');
    expect(isHandMark(null)).toBe(false);
    expect(isHandMark(undefined)).toBe(false);
    expect(isHandMark('')).toBe(false);
    expect(isHandMark('Mira el video')).toBe(false);
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
