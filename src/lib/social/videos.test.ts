import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Los videos de oferta de punta a punta, sin red: la base y el almacén son
 * de mentira. Se prueba el nombre de los archivos, la selección del día, el
 * almacén, lo que la página muestra para subir y la ruta que le entrega el
 * plan al generador.
 */

const SECRET = 'un-secreto-de-prueba-de-mas-de-32-caracteres';
const STORAGE_URL = 'https://proyecto.supabase.test';

/** El cliente admin que ve la ruta: cada test deja el suyo. */
const site = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: () => site.admin }));
// La lectura del historial va a Supabase: acá se entrega ya leída.
vi.mock('@/lib/queries/price-history', () => {
  const getPriceStatsMany = vi.fn(async (_ids: string[]) => new Map());
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

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildVideoTexts } from '@/lib/content/captions';
import type { PriceStats } from '@/lib/deals';
import { getPriceStatsMany, getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { MIN_INTEREST_POINTS, floorPoints, interestScore } from '@/lib/social/interest';
import { NETWORK_RULES, STORY_MARK } from '@/lib/social/networks';
import { readFreshSocialProducts, type SocialProduct } from '@/lib/social/telegram';
import { reelProductName, shortProductName } from '@/lib/text';
import {
  VIDEO_BOARD_MAX,
  VIDEO_BUCKET,
  VIDEO_KEEP_DAYS,
  VIDEO_LOOK_VERSION,
  VIDEO_MARK,
  VIDEO_MAX_BYTES,
  VIDEO_NETWORKS,
  VIDEO_PLAN_MAX,
  VIDEO_RULES,
  VIDEO_TEMPLATES,
  VIDEO_TEMPLATE_WEIGHTS,
  VIDEO_WARNING_MARK,
  assignVideoTemplates,
  ensureVideoBucket,
  parseVideoObjectName,
  readVideoBoard,
  readVideoMarks,
  readVideoPicks,
  removeOldVideos,
  signVideoUploads,
  videoClaims,
  videoFingerprint,
  videoObjectName,
  videoPhoto,
  videoPublicUrl,
  type VideoClaims,
} from '@/lib/social/videos';
import { GET as planRoute } from '@/app/api/social/videos/plan/route';

// Mediodía del 13 de octubre en Chile (UTC-3).
const NOW = new Date('2026-10-13T15:00:00Z');
const TODAY = '2026-10-13';
const YESTERDAY = '2026-10-12';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };
type StorageFault = { message: string; status?: number; statusCode?: string };

interface Seed {
  products?: SocialProduct[];
  posts?: Row[];
  clicks?: Row[];
  candidates?: Row[];
  /** Error con que responde una tabla entera. */
  tableErrors?: Record<string, DbError>;
  /** false: no existe. 'private': existe y no es público. Sin valor: existe y es público. */
  bucket?: boolean | 'private';
  /** Archivos del almacén: ruta completa y cuándo se subió. */
  objects?: Record<string, string>;
  storageErrors?: Partial<Record<'getBucket' | 'createBucket' | 'list' | 'sign' | 'remove', StorageFault>>;
}

/** Una consulta a la base de mentira: a qué tabla, con qué listas de .in() y qué página. */
interface Asked {
  table: string;
  in: Record<string, unknown[]>;
  range: [number, number] | null;
}

/**
 * El sitio de mentira: una base que filtra como la de verdad (eq, neq, in,
 * not … is null, gte, orden, tope y páginas) y un almacén con carpetas. Anota
 * qué tablas se leyeron, cada consulta que se ejecutó y cada operación del
 * almacén.
 */
function fakeSite(seed: Seed = {}) {
  const tables: Record<string, Row[]> = {
    products: (seed.products ?? []) as unknown as Row[],
    social_posts: (seed.posts ?? []).map((post, i) => ({ id: i + 1, status: 'publicado', ...post })),
    outbound_clicks: seed.clicks ?? [],
    product_candidates: seed.candidates ?? [],
  };
  const read: string[] = [];
  /** Cada consulta que llegó a ejecutarse, en orden. */
  const asked: Asked[] = [];

  function from(table: string) {
    read.push(table);
    const query: Asked = { table, in: {}, range: null };
    const filters: ((row: Row) => boolean)[] = [];
    let sort: { column: string; ascending: boolean } | null = null;
    let max = Infinity;
    let page: [number, number] | null = null;
    const builder = {
      select: () => builder,
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        query.in[column] = values;
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      not(column: string) {
        filters.push((row) => row[column] !== null && row[column] !== undefined);
        return builder;
      },
      gte(column: string, value: unknown) {
        filters.push((row) => String(row[column]) >= String(value));
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
      range(start: number, end: number) {
        page = [start, end];
        query.range = [start, end];
        return builder;
      },
      then<T>(resolve: (value: { data: Row[] | null; error: DbError | null }) => T) {
        asked.push(query);
        const error = seed.tableErrors?.[table];
        if (error) return Promise.resolve({ data: null, error }).then(resolve);
        let rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
        if (sort) {
          const { column, ascending } = sort;
          rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1));
        }
        if (page) rows = rows.slice(page[0], page[1] + 1);
        return Promise.resolve({ data: rows.slice(0, max), error: null }).then(resolve);
      },
    };
    return builder;
  }

  const objects = new Map(Object.entries(seed.objects ?? {}));
  let bucket: { public: boolean } | null = seed.bucket === false ? null : { public: seed.bucket !== 'private' };
  const faults = seed.storageErrors ?? {};
  /** Cada operación del almacén, en orden. */
  const ops: string[] = [];
  const created: { id: string; options: Row }[] = [];
  const signed: { path: string; upsert: boolean }[] = [];

  const storage = {
    async getBucket(id: string) {
      ops.push(`getBucket ${id}`);
      if (faults.getBucket) return { data: null, error: faults.getBucket };
      // Así responde Storage por un bucket que no existe: 400 con el 404 adentro.
      if (!bucket) return { data: null, error: { message: 'Bucket not found', status: 400, statusCode: '404' } };
      return { data: { id, name: id, public: bucket.public }, error: null };
    },
    async createBucket(id: string, options: Row) {
      ops.push(`createBucket ${id}`);
      if (faults.createBucket) return { data: null, error: faults.createBucket };
      bucket = { public: options.public === true };
      created.push({ id, options });
      return { data: { name: id }, error: null };
    },
    from(id: string) {
      return {
        async list(path: string = '', options?: { limit?: number }) {
          ops.push(`list ${id}/${path}`);
          if (faults.list) return { data: null, error: faults.list };
          const prefix = path ? `${path}/` : '';
          const entries = new Map<string, Row>();
          for (const [key, at] of objects) {
            if (!key.startsWith(prefix)) continue;
            const rest = key.slice(prefix.length);
            const slash = rest.indexOf('/');
            if (slash >= 0) {
              const name = rest.slice(0, slash);
              entries.set(name, { name, id: null, updated_at: null, created_at: null });
            } else {
              entries.set(rest, { name: rest, id: `obj-${key}`, updated_at: at, created_at: at });
            }
          }
          const sorted = [...entries.values()].sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
          return { data: sorted.slice(0, options?.limit ?? 100), error: null };
        },
        async createSignedUploadUrl(path: string, options?: { upsert: boolean }) {
          ops.push(`sign ${path}`);
          if (faults.sign) return { data: null, error: faults.sign };
          signed.push({ path, upsert: options?.upsert === true });
          const token = `firma-${signed.length}`;
          return {
            data: { signedUrl: `${STORAGE_URL}/storage/v1/object/upload/sign/${id}/${path}?token=${token}`, token, path },
            error: null,
          };
        },
        async remove(paths: string[]) {
          ops.push(`remove ${paths.length}`);
          if (faults.remove) return { data: null, error: faults.remove };
          const gone = paths.filter((path) => objects.delete(path));
          return { data: gone.map((name) => ({ name })), error: null };
        },
      };
    },
  };

  const admin = { from, storage } as unknown as SupabaseClient;
  return { admin, read, asked, ops, created, signed, objects, tables, hasBucket: () => bucket !== null };
}

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
    image_url: 'http://http2.mlstatic.com/D_NQ_NP_123-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: `MLC${50_000 + seq}`,
    ml_family_id: null,
    price_checked_at: hoursAgo(1),
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

/** Una oferta de verdad con algo que mirar: otro vendedor la tiene a menos. */
const notLowest = (over: Partial<SocialProduct> = {}) =>
  strong({
    offer_info: { free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: false } as SocialProduct['offer_info'],
    ...over,
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
    min30Held: over.min30Held ?? over.min30 ?? price,
    usualPriceBefore: 'usualPriceBefore' in over ? over.usualPriceBefore ?? null : over.previousPrice ?? null,
    firstSeenAt: over.firstSeenAt ?? daysAgo(20),
    trackedBeforeChangeMs:
      'trackedBeforeChangeMs' in over ? over.trackedBeforeChangeMs ?? null : (over.previousPrice ?? null) === null ? null : 18 * DAY,
  };
}

const droppedFrom = (price: number, previous: number) =>
  stats(price, { max30: previous, maxTracked: previous, previousPrice: previous, lastChangeAt: daysAgo(2) });

/** SHA-256 de un texto, en hexadecimal: la cuenta de la huella hecha acá, sin pasar por el código del sitio. */
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * La huella que le corresponde a un producto, sacada a mano: los primeros 8
 * caracteres del SHA-256 de lo que su video dice además del precio, con la
 * versión de cómo lo dice adelante (2: "de descuento" y "sin descuento").
 * `drop` es la baja del historial ya redondeada, y `price` el precio con que
 * se armó el video (el descuento sale de ahí).
 */
function printOf(p: SocialProduct, drop: number | null = null, price: number = p.price): string {
  const discount = p.original_price && p.original_price > price ? Math.round((1 - price / p.original_price) * 100) : 0;
  const said = [
    2,
    reelProductName(p.name),
    p.brand || null,
    discount > 0 ? p.original_price : null,
    discount,
    drop,
    p.offer_info?.free_shipping === true,
    p.offer_info?.is_full === true,
  ];
  return sha256(JSON.stringify(said)).slice(0, 8);
}

/** El nombre del video de un producto en el almacén, sin extensión. */
const fileOf = (date: string, p: SocialProduct, price: number = p.price, template = 'estudio', drop: number | null = null) =>
  `${date}/${p.id}-${price}-${template}-${printOf(p, drop, price)}`;

/**
 * Las plantillas son una lista fija en el código, y hoy hay una sola. Para
 * probar el día en que haya más, se agregan mientras dura el test.
 */
async function withTemplates<T>(extra: string[], run: () => Promise<T>): Promise<T> {
  const list = VIDEO_TEMPLATES as unknown as string[];
  list.push(...extra);
  try {
    return await run();
  } finally {
    list.splice(list.length - extra.length, extra.length);
  }
}

/** Los dos archivos (video y portada) de cada nombre, subidos a esa hora. */
function stored(files: string[], at: string = hoursAgo(3)): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of files) {
    out[`${file}.mp4`] = at;
    out[`${file}.jpg`] = at;
  }
  return out;
}

const videoMark = (productId: string, channel: string, postedAt: string, over: Row = {}): Row => ({
  product_id: productId,
  channel,
  caption: VIDEO_MARK,
  posted_price: 60_000,
  posted_at: postedAt,
  ...over,
});

const candidate = (mlProductId: string | null, position: number): Row => ({
  ml_product_id: mlProductId,
  highlight_position: position,
  prospected_at: daysAgo(2),
  checked_at: daysAgo(1),
});

const clicksOf = (productId: string, n: number): Row[] =>
  Array.from({ length: n }, () => ({ product_id: productId, client_key: null, created_at: daysAgo(1) }));

const catalog = (rows: SocialProduct[]) => vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows, error: null });

beforeAll(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', STORAGE_URL);
  // Solo el reloj: la ruta toma la hora por su cuenta.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  site.admin = null;
  vi.mocked(readFreshSocialProducts).mockReset();
  vi.mocked(getPriceStatsMany).mockReset();
  vi.mocked(getPriceStatsMany).mockResolvedValue(new Map());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('nombre de los archivos', () => {
  const ID = '6f1d1a52-6f0e-4c4b-9a43-1d2f3c4b5a60';
  const video = { date: '2026-10-13', productId: ID, price: 27_990, template: 'estudio', fingerprint: '0a1b2c3d' };

  it('arma "AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>" y lo lee de vuelta', () => {
    const name = videoObjectName(video);
    expect(name).toBe(`2026-10-13/${ID}-27990-estudio-0a1b2c3d`);
    expect(parseVideoObjectName(name!)).toEqual(video);

    for (const other of [
      { ...video, price: 1 },
      { ...video, price: 2_147_483_647 },
      { ...video, template: 'ficha2' },
      { ...video, date: '2028-02-29' },
      { ...video, fingerprint: '00000000' },
      { ...video, fingerprint: 'ffffffff' },
      // Una plantilla que parece una huella no confunde: son dos tramos distintos.
      { ...video, template: 'deadbeef', fingerprint: 'cafe0123' },
    ]) {
      expect(parseVideoObjectName(videoObjectName(other)!)).toEqual(other);
    }
  });

  it('no arma un nombre con datos que no sirven', () => {
    for (const bad of [
      { ...video, date: '13-10-2026' },
      { ...video, date: '2026-02-31' },
      { ...video, date: '2026-13-01' },
      { ...video, productId: ID.toUpperCase() },
      { ...video, productId: 'no-es-un-id' },
      { ...video, productId: `${ID}/..` },
      { ...video, price: 0 },
      { ...video, price: -5 },
      { ...video, price: 27_990.5 },
      { ...video, price: Number.NaN },
      { ...video, price: 3_000_000_000 },
      { ...video, template: '' },
      { ...video, template: 'Estudio' },
      { ...video, template: 'estudio-2' },
      { ...video, template: 'a/b' },
      { ...video, template: 'x'.repeat(25) },
      // La huella son exactamente 8 caracteres en hexadecimal, en minúsculas.
      { ...video, fingerprint: '' },
      { ...video, fingerprint: '0a1b2c3' },
      { ...video, fingerprint: '0a1b2c3d4' },
      { ...video, fingerprint: '0A1B2C3D' },
      { ...video, fingerprint: '0a1b2c3g' },
      { ...video, fingerprint: '0a1b-c3d' },
      { ...video, fingerprint: '0a1b2c3d/..' },
      { ...video, fingerprint: undefined as unknown as string },
      { ...video, fingerprint: 12345678 as unknown as string },
    ]) {
      expect(videoObjectName(bad)).toBeNull();
    }
  });

  it('al leer rechaza todo lo que no calce exacto', () => {
    const good = `2026-10-13/${ID}-27990-estudio-0a1b2c3d`;
    expect(parseVideoObjectName(good)).not.toBeNull();
    for (const bad of [
      '',
      `${good}.mp4`,
      `${good} `,
      ` ${good}`,
      `${good}\n`,
      `reels/${good}`,
      `${good}/otro`,
      // Los nombres de antes de la huella: no se sabe qué dice ese video.
      `2026-10-13/${ID}-27990-estudio`,
      `2026-10-13/${ID}-27990`,
      `2026-10-13/${ID}-estudio`,
      `2026-10-13/${ID}-estudio-0a1b2c3d`,
      `2026-10-13/${ID}-27990-0a1b2c3d`,
      `2026-10-13/${ID}-027990-estudio-0a1b2c3d`,
      `2026-10-13/${ID}-0-estudio-0a1b2c3d`,
      `2026-10-13/${ID}--27990-estudio-0a1b2c3d`,
      `2026-10-13/${ID}-27.990-estudio-0a1b2c3d`,
      `2026-10-13/${ID}-27990-Estudio-0a1b2c3d`,
      `2026-10-13/${ID}-27990-estudio-v2-0a1b2c3d`,
      `2026-10-13/${ID}-27990-estudio-0a1b2c3`,
      `2026-10-13/${ID}-27990-estudio-0a1b2c3d4`,
      `2026-10-13/${ID}-27990-estudio-0A1B2C3D`,
      `2026-10-13/${ID}-27990-estudio-0a1b2c3g`,
      `2026-10-13/${ID}-27990-estudio-0a1b2c3d-0a1b2c3d`,
      `2026-10-13/${ID}-27990-estudio-`,
      `2026-10-13/${ID}-99999999999-estudio-0a1b2c3d`,
      `2026-10-13/${ID}-3000000000-estudio-0a1b2c3d`,
      `2026-10-13/${ID.toUpperCase()}-27990-estudio-0a1b2c3d`,
      `2026-10-13/${ID.slice(1)}-27990-estudio-0a1b2c3d`,
      `2026-02-31/${ID}-27990-estudio-0a1b2c3d`,
      `2026-1-3/${ID}-27990-estudio-0a1b2c3d`,
      `2026-10-13\\${ID}-27990-estudio-0a1b2c3d`,
      `../2026-10-13/${ID}-27990-estudio-0a1b2c3d`,
    ]) {
      expect(parseVideoObjectName(bad)).toBeNull();
    }
    expect(parseVideoObjectName(undefined as unknown as string)).toBeNull();
  });

  it('la dirección pública es la del bucket público del proyecto', () => {
    expect(VIDEO_BUCKET).toBe('reels');
    expect(videoPublicUrl(`2026-10-13/${ID}-27990-estudio-0a1b2c3d.mp4`)).toBe(
      `${STORAGE_URL}/storage/v1/object/public/reels/2026-10-13/${ID}-27990-estudio-0a1b2c3d.mp4`
    );
    expect(videoPublicUrl('a.jpg', 'https://otro.test/')).toBe('https://otro.test/storage/v1/object/public/reels/a.jpg');
  });
});

describe('lo que el video dice y su huella', () => {
  const claims: VideoClaims = {
    nombre_corto: 'Audífonos Bluetooth JBL Tune 520BT',
    marca: 'JBL',
    precio_lista: 100_000,
    descuento: 40,
    baja_historial: null,
    envio_gratis: true,
    full: false,
  };

  it('videoClaims arma lo que el video lleva escrito además del precio', () => {
    const p = strong({ name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro' });
    expect(videoClaims(p, null)).toEqual(claims);
    // La baja va en % entero, como la escribe el video.
    expect(videoClaims(p, 12.4).baja_historial).toBe(12);
    expect(videoClaims(p, 12.5).baja_historial).toBe(13);
    // Un número que no sirve es "sin baja", no un NaN que se cuele en la huella.
    expect(videoClaims(p, Number.NaN).baja_historial).toBeNull();

    // Sin descuento de lista no hay precio de lista que mostrar; sin marca, null; sin datos de entrega, dos "no".
    const bare = strong({ name: p.name, original_price: null, brand: '', offer_info: null });
    expect(videoClaims(bare, 25)).toEqual({
      nombre_corto: 'Audífonos Bluetooth JBL Tune 520BT',
      marca: null,
      precio_lista: null,
      descuento: 0,
      baja_historial: 25,
      envio_gratis: false,
      full: false,
    });
    // Un precio de lista que no es mayor que el precio tampoco se muestra.
    expect(videoClaims(strong({ original_price: 60_000 }), null)).toMatchObject({ precio_lista: null, descuento: 0 });
    expect(videoClaims(strong({ original_price: 50_000 }), null)).toMatchObject({ precio_lista: null, descuento: 0 });
    // "Envío gratis" y "Full" solo con un sí explícito.
    const unknown = strong({ offer_info: { free_shipping: null, is_full: undefined } as SocialProduct['offer_info'] });
    expect(videoClaims(unknown, null)).toMatchObject({ envio_gratis: false, full: false });
  });

  it('el nombre que el video lleva escrito va sin el código de fábrica, y así entra en la huella', () => {
    const watch = strong({ name: 'Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3', brand: 'Samsung' });
    const said = videoClaims(watch, null);
    expect(said.nombre_corto).toBe('Samsung Smartwatch Galaxy Fit 3');
    expect(videoFingerprint(said)).toBe(
      sha256(JSON.stringify([2, 'Samsung Smartwatch Galaxy Fit 3', 'Samsung', 100_000, 40, null, true, false])).slice(0, 8)
    );
    // Con el código (el nombre corto de la ficha y de las redes) sería otro video.
    expect(shortProductName(watch.name)).toBe('Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3');
    expect(videoFingerprint({ ...said, nombre_corto: shortProductName(watch.name) })).not.toBe(videoFingerprint(said));
    // Una memoria conserva su número de parte: es lo que dice cuál es.
    const ram = strong({ name: 'Kingston ValueRAM KVR32S22S8/8 Memoria RAM color verde 8GB 3200MHz', brand: 'Kingston' });
    expect(videoClaims(ram, null).nombre_corto).toBe('Kingston ValueRAM KVR32S22S8/8 Memoria RAM');
  });

  it('la huella son los primeros 8 caracteres del SHA-256 de esos datos, siempre en el mismo orden y con la versión adelante', () => {
    // El contrato, escrito con todas sus letras: si esta cuenta cambia, los
    // videos ya guardados dejan de reconocerse.
    expect(VIDEO_LOOK_VERSION).toBe(2);
    const written = '[2,"Audífonos Bluetooth JBL Tune 520BT","JBL",100000,40,null,true,false]';
    expect(videoFingerprint(claims)).toBe(sha256(written).slice(0, 8));
    expect(videoFingerprint(claims)).toBe('16a0bfd5');
    expect(
      videoFingerprint({ ...claims, marca: null, precio_lista: null, descuento: 0, baja_historial: 25, envio_gratis: false })
    ).toBe('900dbf84');
    expect(videoFingerprint(claims)).toMatch(/^[0-9a-f]{8}$/);
    // No depende del orden en que vengan los campos del objeto.
    const shuffled: VideoClaims = {
      full: false,
      envio_gratis: true,
      baja_historial: null,
      descuento: 40,
      precio_lista: 100_000,
      marca: 'JBL',
      nombre_corto: 'Audífonos Bluetooth JBL Tune 520BT',
    };
    expect(videoFingerprint(shuffled)).toBe('16a0bfd5');
  });

  it('con las mismas cifras, la versión 2 da otra huella que la fórmula de antes (sin versión)', () => {
    // Lo que el video decía con "por debajo del precio de lista" y "precio de lista"
    // tiene las mismas cifras que el de ahora: solo la versión los distingue.
    const before = sha256(JSON.stringify(['Audífonos Bluetooth JBL Tune 520BT', 'JBL', 100_000, 40, null, true, false])).slice(0, 8);
    expect(before).toBe('7b6ff293');
    expect(videoFingerprint(claims)).not.toBe(before);
    const dropOnly: VideoClaims = { ...claims, marca: null, precio_lista: null, descuento: 0, baja_historial: 25, envio_gratis: false };
    expect(videoFingerprint(dropOnly)).not.toBe('188b17c7');
  });

  it('cualquier cosa que el video diga distinto da otra huella', () => {
    const changes: Partial<VideoClaims>[] = [
      { nombre_corto: 'Audífonos Bluetooth JBL Tune 720BT' },
      { marca: 'Sony' },
      { marca: null },
      { precio_lista: 110_000 },
      { precio_lista: null },
      { descuento: 39 },
      { descuento: 0 },
      { baja_historial: 12 },
      { baja_historial: 0 },
      { envio_gratis: false },
      { full: true },
      // Los dos "sí" cambiados de lugar no dan lo mismo.
      { envio_gratis: false, full: true },
    ];
    const prints = changes.map((change) => videoFingerprint({ ...claims, ...change }));
    for (const print of prints) expect(print).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set([videoFingerprint(claims), ...prints]).size).toBe(changes.length + 1);
  });

  it('el nombre de un video lleva la huella de su producto, y con ella se lee de vuelta', () => {
    const p = strong({ name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro' });
    const fingerprint = videoFingerprint(videoClaims(p, null));
    expect(fingerprint).toBe('16a0bfd5');
    // La cuenta hecha a mano en este archivo da lo mismo que la del sitio.
    expect(printOf(p)).toBe(fingerprint);
    const name = videoObjectName({ date: TODAY, productId: p.id, price: p.price, template: 'estudio', fingerprint });
    expect(name).toBe(`${TODAY}/${p.id}-60000-estudio-16a0bfd5`);
    expect(name).toBe(fileOf(TODAY, p));
  });
});

describe('plantillas', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('hoy son dos, "estudio" y "bloques", y de cada cuatro videos tres salen con "estudio"', () => {
    expect(VIDEO_TEMPLATES).toEqual(['estudio', 'bloques']);
    expect(VIDEO_TEMPLATE_WEIGHTS).toEqual({ estudio: 3, bloques: 1 });
    for (const template of VIDEO_TEMPLATES) expect(template).toMatch(/^[a-z0-9]+$/);
    expect(assignVideoTemplates([], TODAY)).toEqual([]);
    for (let day = 1; day <= 28; day++) {
      const date = `2026-10-${String(day).padStart(2, '0')}`;
      const four = assignVideoTemplates(['a', 'b', 'c', 'd'], date);
      expect(four.filter((t) => t === 'estudio')).toHaveLength(3);
      expect(four.filter((t) => t === 'bloques')).toHaveLength(1);
      // Con uno o dos videos en el día, todos son de "estudio": "bloques" no le gana el turno.
      expect(assignVideoTemplates(['a'], date)).toEqual(['estudio']);
      expect(assignVideoTemplates(['a', 'b'], date)).toEqual(['estudio', 'estudio']);
    }
    // Ocho videos: seis y dos.
    const eight = assignVideoTemplates(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], TODAY);
    expect(eight.filter((t) => t === 'bloques')).toHaveLength(2);
  });

  it('un peso que no sirve (cero, negativo, no número) cuenta como 1', () => {
    const assigned = assignVideoTemplates(ids, TODAY, new Map(), ['x', 'y'], { x: 0, y: Number.NaN });
    expect(assigned.filter((t) => t === 'x')).toHaveLength(3);
    expect(assigned.filter((t) => t === 'y')).toHaveLength(3);
  });

  it('con pesos iguales se reparten parejo, y el mismo día con los mismos productos da siempre lo mismo', () => {
    const two = ['estudio', 'ficha'];
    const even = {};
    for (const date of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-11-01']) {
      const assigned = assignVideoTemplates(ids, date, new Map(), two, even);
      expect(assigned).toEqual(assignVideoTemplates(ids, date, new Map(), two, even));
      expect(assigned.filter((t) => t === 'estudio')).toHaveLength(3);
      expect(assigned.filter((t) => t === 'ficha')).toHaveLength(3);
    }
    // Con una cantidad que no calza, ninguna se usa dos veces más que otra.
    const three = assignVideoTemplates(['a', 'b', 'c', 'd'], TODAY, new Map(), ['x', 'y', 'z']);
    const counts = ['x', 'y', 'z'].map((t) => three.filter((used) => used === t).length).sort();
    expect(counts).toEqual([1, 1, 2]);
  });

  it('por cuál se empieza cambia con el día: el primero de la lista no sale siempre igual', () => {
    const first = new Set<string>();
    for (let day = 1; day <= 28; day++) {
      first.add(assignVideoTemplates(['a'], `2026-10-${String(day).padStart(2, '0')}`, new Map(), ['estudio', 'ficha'], {})[0]);
    }
    expect(first.size).toBe(2);
  });

  it('un producto que ya tiene su video de hoy conserva la plantilla', () => {
    const two = ['estudio', 'ficha'];
    const already = new Map([
      ['a', 'ficha'],
      ['b', 'ficha'],
      // Una plantilla que ya no existe no se respeta.
      ['c', 'retirada'],
    ]);
    const assigned = assignVideoTemplates(['a', 'b', 'c', 'd'], TODAY, already, two, {});
    expect(assigned.slice(0, 2)).toEqual(['ficha', 'ficha']);
    // Los que faltan compensan: quedan dos y dos.
    expect(assigned.slice(2)).toEqual(['estudio', 'estudio']);
  });
});

describe('VIDEO_RULES', () => {
  it('son las del plan de publicaciones, con cuatro videos al día', () => {
    expect(VIDEO_RULES).toMatchObject({
      maxPosts: 4,
      perCategory: 2,
      minDiscount: 20,
      minDrop: 5,
      maxPriceAgeMs: 6 * HOUR,
      cleanOnly: true,
      repeatAfterDays: 14,
    });
    expect(VIDEO_RULES.minDiscount).toBe(NETWORK_RULES.minDiscount);
    expect(VIDEO_NETWORKS).toEqual(['instagram', 'tiktok', 'youtube', 'facebook']);
    expect(VIDEO_MARK).toBe('video');
    expect(VIDEO_PLAN_MAX).toBe(6);
  });
});

// ---------------------------------------------------------------------------

describe('readVideoMarks', () => {
  const since = new Date(NOW.getTime() - 14 * DAY);

  it('entrega la marca vigente más nueva de cada red, por producto', async () => {
    const { admin } = fakeSite({
      posts: [
        videoMark('a', 'instagram', hoursAgo(30)), // id 1
        videoMark('a', 'instagram', hoursAgo(2)), // id 2: la más nueva
        videoMark('a', 'tiktok', hoursAgo(3)), // id 3
        videoMark('b', 'youtube', daysAgo(13)), // id 4
        videoMark('b', 'facebook', daysAgo(15)), // id 5: fuera de los 14 días
        videoMark('c', 'facebook', hoursAgo(1), { status: 'error' }), // id 6: se deshizo
        videoMark(null as unknown as string, 'tiktok', hoursAgo(1)), // id 7: el producto se borró
      ],
    });

    const marks = await readVideoMarks(admin, since);
    expect(marks.get('a')).toEqual({
      instagram: { postId: 2, at: hoursAgo(2) },
      tiktok: { postId: 3, at: hoursAgo(3) },
    });
    expect(marks.get('b')).toEqual({ youtube: { postId: 4, at: daysAgo(13) } });
    expect([...marks.keys()].sort()).toEqual(['a', 'b']);
  });

  it('solo cuenta las marcas de video: ni historias, ni publicaciones del feed, ni Telegram', async () => {
    const { admin } = fakeSite({
      posts: [
        { product_id: 'historia', channel: 'instagram', caption: STORY_MARK, posted_at: hoursAgo(1) },
        { product_id: 'feed', channel: 'instagram', caption: 'Texto del post', posted_at: hoursAgo(1), external_id: 'u-1' },
        { product_id: 'a-mano', channel: 'tiktok', caption: null, posted_at: hoursAgo(1) },
        { product_id: 'telegram', channel: 'telegram', caption: VIDEO_MARK, posted_at: hoursAgo(1) },
        videoMark('video', 'youtube', hoursAgo(1)),
      ],
    });
    expect([...(await readVideoMarks(admin, since)).keys()]).toEqual(['video']);
  });

  it('sin la tabla no hay marcas; con otro error, falla', async () => {
    const missing = fakeSite({ tableErrors: { social_posts: { code: '42P01', message: 'no existe' } } });
    expect((await readVideoMarks(missing.admin, since)).size).toBe(0);
    const broken = fakeSite({ tableErrors: { social_posts: { code: '500', message: 'se cayó' } } });
    await expect(readVideoMarks(broken.admin, since)).rejects.toThrow('se cayó');
  });
});

// ---------------------------------------------------------------------------

describe('readVideoPicks', () => {
  const CATEGORIES = ['audio', 'gaming', 'hogar', 'celulares', 'computacion'];
  const many = () => CATEGORIES.reduce<SocialProduct[]>((all, category) => all.concat([strong({ category }), strong({ category })]), []);

  it('propone cuatro por defecto, cada uno con su archivo de hoy', async () => {
    const rows = many();
    catalog(rows);
    const { admin } = fakeSite();

    const plan = await readVideoPicks(admin, NOW);
    expect(plan.date).toBe(TODAY);
    expect(plan.unreadHistory).toBe(0);
    expect(plan.picks).toHaveLength(4);
    // De cada cuatro, tres con "estudio" y uno con "bloques".
    expect(plan.picks.map((pick) => pick.template).sort()).toEqual(['bloques', 'estudio', 'estudio', 'estudio']);
    for (const pick of plan.picks) {
      // Las cuatro ofertas dicen lo mismo, así que llevan la misma huella.
      expect(pick.file).toBe(`${TODAY}/${pick.product.id}-60000-${pick.template}-dfd6e270`);
      expect(pick.file).toBe(fileOf(TODAY, pick.product, pick.product.price, pick.template));
      expect(parseVideoObjectName(pick.file)).toEqual({
        date: TODAY,
        productId: pick.product.id,
        price: 60_000,
        template: pick.template,
        fingerprint: 'dfd6e270',
      });
      // Lo que el video dice va con el elegido: de ahí sale la huella y es lo que entrega la ruta.
      expect(pick.claims).toEqual({
        nombre_corto: 'Audífonos Bluetooth JBL Tune 520BT Negro',
        marca: 'JBL',
        precio_lista: 100_000,
        descuento: 40,
        baja_historial: null,
        envio_gratis: true,
        full: false,
      });
      expect(videoFingerprint(pick.claims)).toBe('dfd6e270');
      expect(pick.exists).toBe(false);
      expect(pick.score.points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
      expect(pick.score.warning).toBeNull();
      expect(pick.reason.length).toBeGreaterThan(10);
    }
    // Nunca más de dos por categoría.
    const perCategory = new Map<string, number>();
    for (const pick of plan.picks) perCategory.set(pick.product.category, (perCategory.get(pick.product.category) ?? 0) + 1);
    expect(Math.max(...perCategory.values())).toBeLessThanOrEqual(2);
  });

  it('acepta pedir entre uno y seis', async () => {
    catalog(many());
    const { admin } = fakeSite();
    expect((await readVideoPicks(admin, NOW, 1)).picks).toHaveLength(1);
    expect((await readVideoPicks(admin, NOW, 6)).picks).toHaveLength(6);
    expect((await readVideoPicks(admin, NOW, 50)).picks).toHaveLength(6);
    for (const odd of [0, -2, 2.5, Number.NaN]) expect((await readVideoPicks(admin, NOW, odd)).picks).toHaveLength(4);
  });

  it('el día del archivo es el de Chile, no el de UTC', async () => {
    // 23:30 del 13 de octubre en Chile; en UTC ya es 14.
    const late = new Date('2026-10-14T02:30:00Z');
    const p = strong({ price_checked_at: new Date(late.getTime() - HOUR).toISOString() });
    catalog([p]);
    const plan = await readVideoPicks(fakeSite().admin, late);
    expect(plan.date).toBe('2026-10-13');
    expect(plan.picks[0].file).toBe(fileOf('2026-10-13', p));
  });

  it('no vuelve lo que ya se subió como video a cualquier red en los últimos 14 días', async () => {
    const uploaded = strong({ category: 'audio' });
    const longAgo = strong({ category: 'gaming' });
    const undone = strong({ category: 'hogar' });
    const onlyStory = strong({ category: 'celulares' });
    const onlyFeed = strong({ category: 'computacion' });
    const fresh = strong({ category: 'audio' });
    catalog([uploaded, longAgo, undone, onlyStory, onlyFeed, fresh]);
    const { admin } = fakeSite({
      posts: [
        // Basta una red.
        videoMark(uploaded.id, 'youtube', daysAgo(13)),
        videoMark(longAgo.id, 'instagram', daysAgo(15)),
        videoMark(undone.id, 'tiktok', daysAgo(1), { status: 'error', error: 'Marcada por error' }),
        // Las historias y el feed llevan otra cuenta: no le quitan productos a los videos.
        { product_id: onlyStory.id, channel: 'instagram', caption: STORY_MARK, posted_at: daysAgo(1) },
        { product_id: onlyFeed.id, channel: 'facebook', caption: 'Texto del post', external_id: 'u-9', posted_at: daysAgo(1) },
      ],
    });

    const plan = await readVideoPicks(admin, NOW, 6);
    const ids = plan.picks.map((pick) => pick.product.id);
    expect(ids).not.toContain(uploaded.id);
    expect(ids.sort()).toEqual([longAgo.id, undone.id, onlyStory.id, onlyFeed.id, fresh.id].sort());
    // Ni se lee el historial de lo que no puede salir.
    expect(vi.mocked(getPriceStatsMany)).toHaveBeenLastCalledWith([longAgo.id, undone.id, onlyStory.id, onlyFeed.id, fresh.id]);
  });

  it('respeta la puerta de entrada: descuento de 20% o baja confirmada, y precio recién revisado', async () => {
    const deal = strong({ category: 'audio' });
    const small = strong({ category: 'gaming', price: 90_000 }); // 10% de lista y sin baja
    const dropped = strong({ category: 'hogar', price: 90_000 }); // 10% de lista, pero bajó de verdad
    const old = strong({ category: 'celulares', price_checked_at: hoursAgo(7) });
    const hidden = strong({ category: 'computacion', is_hidden: true });
    catalog([deal, small, dropped, old, hidden]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[dropped.id, droppedFrom(90_000, 100_000)]]));

    const plan = await readVideoPicks(fakeSite().admin, NOW, 6);
    expect(plan.picks.map((pick) => pick.product.id).sort()).toEqual([deal.id, dropped.id].sort());
    expect(plan.picks.find((pick) => pick.product.id === dropped.id)?.drop).toBeCloseTo(10);
  });

  it('respeta cleanOnly y el piso de interés: el video se arma sin que nadie mire el producto', async () => {
    const fine = strong({ category: 'audio' });
    const doubtful = notLowest({ category: 'gaming' });
    const filler = cable();
    // Hoy a $60.000; hace unos días estuvo a $40.000.
    const inflated = strong({ category: 'hogar' });
    catalog([doubtful, filler, inflated, fine]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [fine.id, stats(60_000)],
        [inflated.id, stats(60_000, { min30: 40_000, minTracked: 40_000 })],
      ])
    );

    const plan = await readVideoPicks(fakeSite().admin, NOW, 6);
    expect(plan.picks.map((pick) => pick.product.id)).toEqual([fine.id]);
    expect(VIDEO_RULES.cleanOnly).toBe(true);
  });

  it('si el historial de un producto no se pudo leer, no se propone y se dice cuántos fueron', async () => {
    const lost = strong({ category: 'audio' });
    const fine = strong({ category: 'gaming' });
    catalog([lost, fine]);
    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({ stats: new Map([[fine.id, stats(60_000)]]), unread: new Set([lost.id]) });

    const plan = await readVideoPicks(fakeSite().admin, NOW);
    expect(plan.picks.map((pick) => pick.product.id)).toEqual([fine.id]);
    expect(plan.unreadHistory).toBe(1);
  });

  it('sin una foto de Mercado Libre que el generador pueda bajar, no se propone', async () => {
    const fine = strong({ category: 'audio' });
    const elsewhere = strong({ category: 'gaming', image_url: 'https://otro-cdn.test/foto.jpg' });
    const broken = strong({ category: 'hogar', image_url: 'no es una dirección' });
    const empty = strong({ category: 'celulares', image_url: '' });
    catalog([elsewhere, broken, empty, fine]);

    const plan = await readVideoPicks(fakeSite().admin, NOW, 6);
    expect(plan.picks.map((pick) => pick.product.id)).toEqual([fine.id]);

    // La foto que se entrega: grande, en JPG y por https.
    expect(videoPhoto(fine.image_url)).toBe('https://http2.mlstatic.com/D_NQ_NP_123-F.jpg');
    expect(videoPhoto('https://mlstatic.com.malo.test/D_NQ_NP_123-O.webp')).toBeNull();
    expect(videoPhoto('ftp://http2.mlstatic.com/D_NQ_NP_123-O.webp')).toBe('https://http2.mlstatic.com/D_NQ_NP_123-F.jpg');
    expect(videoPhoto(null)).toBeNull();
  });

  it('dice de cada elegido si su video de hoy ya está en el almacén', async () => {
    const done = strong({ category: 'audio' });
    const half = strong({ category: 'gaming' });
    const repriced = strong({ category: 'hogar' });
    const yesterdayOnly = strong({ category: 'celulares' });
    const missing = strong({ category: 'computacion' });
    catalog([done, half, repriced, yesterdayOnly, missing]);
    const { admin, ops } = fakeSite({
      objects: {
        ...stored([fileOf(TODAY, done), fileOf(TODAY, repriced, 65_000), fileOf(YESTERDAY, yesterdayOnly)]),
        // Se cortó la subida: está el video y falta la portada.
        [`${fileOf(TODAY, half)}.mp4`]: hoursAgo(2),
      },
    });

    const plan = await readVideoPicks(admin, NOW, 6);
    const exists = new Map(plan.picks.map((pick) => [pick.product.id, pick.exists]));
    expect(exists.get(done.id)).toBe(true);
    expect(exists.get(half.id)).toBe(false);
    // Con otro precio es otro video: el de hoy a $60.000 no existe.
    expect(exists.get(repriced.id)).toBe(false);
    // El de ayer no cuenta: hoy se arma de nuevo, con la hora de revisión de hoy.
    expect(exists.get(yesterdayOnly.id)).toBe(false);
    expect(exists.get(missing.id)).toBe(false);
    expect(plan.picks.find((pick) => pick.product.id === repriced.id)?.file).toBe(fileOf(TODAY, repriced));
    // Una sola lectura del almacén: la carpeta de hoy.
    expect(ops).toEqual([`list reels/${TODAY}`]);
  });

  it('un video de hoy con el mismo precio que dice otra cosa no cuenta: se propone de nuevo, con otro nombre', async () => {
    const same = strong({ category: 'audio' });
    // Se armó cuando llegaba con Full; ya no.
    const lostFull = strong({ category: 'gaming' });
    const withFull = { ...lostFull, offer_info: { ...lostFull.offer_info, is_full: true } as SocialProduct['offer_info'] };
    // Se armó con el precio de lista de antes ($120.000, "-50%").
    const relisted = strong({ category: 'hogar' });
    // Se armó cuando el historial no mostraba ninguna baja; ahora confirma una de 25%.
    const dropped = strong({ category: 'celulares' });
    // Un archivo de antes de que el nombre llevara huella: no se sabe qué dice.
    const legacy = strong({ category: 'computacion' });
    catalog([same, lostFull, relisted, dropped, legacy]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[dropped.id, droppedFrom(60_000, 80_000)]]));
    const made = [
      fileOf(TODAY, same),
      fileOf(TODAY, withFull),
      fileOf(TODAY, { ...relisted, original_price: 120_000 }),
      fileOf(TODAY, dropped),
      `${TODAY}/${legacy.id}-60000-estudio`,
    ];
    const { admin } = fakeSite({ objects: stored(made) });

    const plan = await readVideoPicks(admin, NOW, 6);
    const byId = new Map(plan.picks.map((pick) => [pick.product.id, pick]));
    expect(byId.size).toBe(5);
    expect(byId.get(same.id)).toMatchObject({ exists: true, file: made[0] });
    for (const [p, old, drop] of [
      [lostFull, made[1], null],
      [relisted, made[2], null],
      [dropped, made[3], 25],
      [legacy, made[4], null],
    ] as const) {
      const pick = byId.get(p.id)!;
      expect(pick.exists).toBe(false);
      expect(pick.file).not.toBe(old);
      // El nombre nuevo es el de siempre con la huella de lo que diría ahora (y la plantilla que le toque).
      expect(pick.file).toBe(fileOf(TODAY, p, p.price, pick.template, drop));
    }
    expect(byId.get(dropped.id)?.claims.baja_historial).toBe(25);
  });

  it('un video de hoy con la misma huella pero otro precio no cuenta, aunque el descuento redondeado no cambie', async () => {
    // Se armó a $60.000 ("-40%"). Ahora está a $60.200: sigue siendo -40% y
    // el resto de lo que dice el video es igual, así que la huella no cambia.
    // Lo único que lo delata es el precio del nombre.
    const p = strong({ price: 60_200 });
    const old = fileOf(TODAY, p, 60_000);
    expect(printOf(p, null, 60_000)).toBe(printOf(p));
    catalog([p]);
    const fake = fakeSite({ products: [p], objects: stored([old]) });

    const plan = await readVideoPicks(fake.admin, NOW);
    expect(plan.picks).toHaveLength(1);
    expect(plan.picks[0].claims.descuento).toBe(40);
    expect(plan.picks[0]).toMatchObject({ exists: false, file: `${TODAY}/${p.id}-60200-estudio-${printOf(p)}` });
    expect(plan.picks[0].file).not.toBe(old);

    // Lo mismo por la ruta que lee el generador: no lo da por hecho y trae dónde subir el nuevo.
    site.admin = fake.admin;
    const response = await planRoute(
      new NextRequest('https://sitio.test/api/social/videos/plan', { headers: { authorization: `Bearer ${SECRET}` } })
    );
    const [row] = ((await response.json()) as { seleccion: { archivo: string; ya_existe: boolean; precio: number; subir: unknown }[] })
      .seleccion;
    expect(row).toMatchObject({ archivo: plan.picks[0].file, ya_existe: false, precio: 60_200 });
    expect(row.subir).not.toBeNull();

    // Y el tablero no ofrece el de $60.000: dice un precio que ya no rige.
    const board = await readVideoBoard(fake.admin, NOW);
    expect(board.videos).toEqual([]);
    expect(board.stale).toBe(1);
  });

  it('la plantilla de un video de hoy se conserva solo si ese video dice lo mismo que diría ahora', async () => {
    const two = ['estudio', 'ficha'];
    const p = strong();
    // La que le tocaría hoy a este producto si no tuviera video, y la otra.
    const fresh = assignVideoTemplates([p.id], TODAY, new Map(), two)[0];
    const other = two.find((template) => template !== fresh)!;
    catalog([p]);

    await withTemplates(['ficha'], async () => {
      // Ya tiene su video de hoy con la otra plantilla y diciendo lo mismo: se queda con ella, y no se arma de nuevo.
      const same = fakeSite({ objects: stored([fileOf(TODAY, p, p.price, other)]) });
      expect((await readVideoPicks(same.admin, NOW)).picks[0]).toMatchObject({
        template: other,
        file: fileOf(TODAY, p, p.price, other),
        exists: true,
      });

      // El de hoy se armó cuando llegaba con Full: hay que armarlo de nuevo, y ese video no ata la plantilla.
      const withFull = { ...p, offer_info: { ...p.offer_info, is_full: true } as SocialProduct['offer_info'] };
      const reworded = fakeSite({ objects: stored([fileOf(TODAY, withFull, p.price, other)]) });
      expect((await readVideoPicks(reworded.admin, NOW)).picks[0]).toMatchObject({
        template: fresh,
        file: fileOf(TODAY, p, p.price, fresh),
        exists: false,
      });
    });
  });

  it('las señales de ganadores y de tendencia llegan a la selección y al motivo', async () => {
    const plain = strong({ category: 'audio' });
    const winner = strong({ category: 'gaming' });
    const trending = strong({ category: 'hogar' });
    catalog([plain, trending, winner]);
    const { admin } = fakeSite({ candidates: [candidate(winner.ml_product_id, 3)], clicks: clicksOf(trending.id, 14) });

    const plan = await readVideoPicks(admin, NOW);
    // Las tres ofertas son iguales: el orden lo deciden las señales.
    expect(plan.picks.map((pick) => pick.product.id)).toEqual([winner.id, trending.id, plain.id]);
    expect(plan.picks[0].reason).toContain('figuró 3.º entre los más vendidos de su categoría');
    expect(plan.picks[1].reason).toContain('lleva 14 clics recientes en el sitio');
    expect(plan.picks[2].reason).not.toMatch(/figuró|clics/);
  });

  it('sin nada que proponer no lee el almacén', async () => {
    catalog([cable()]);
    const { admin, ops } = fakeSite();
    expect((await readVideoPicks(admin, NOW)).picks).toEqual([]);
    expect(ops).toEqual([]);
  });

  it('si el catálogo no se pudo leer, falla en vez de entregar un plan vacío', async () => {
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [], error: 'sin conexión' });
    await expect(readVideoPicks(fakeSite().admin, NOW)).rejects.toThrow('sin conexión');
  });
});

// ---------------------------------------------------------------------------

describe('el almacén', () => {
  it('crea el bucket público la primera vez, con tope de tamaño y solo MP4 y JPG', async () => {
    const { admin, created, ops, hasBucket } = fakeSite({ bucket: false });
    expect(await ensureVideoBucket(admin)).toBe(true);
    expect(hasBucket()).toBe(true);
    expect(created).toEqual([
      { id: 'reels', options: { public: true, fileSizeLimit: VIDEO_MAX_BYTES, allowedMimeTypes: ['video/mp4', 'image/jpeg'] } },
    ]);
    expect(VIDEO_MAX_BYTES).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    expect(VIDEO_MAX_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);

    // La segunda vez ya existe: no se crea de nuevo.
    expect(await ensureVideoBucket(admin)).toBe(false);
    expect(ops).toEqual(['getBucket reels', 'createBucket reels', 'getBucket reels']);
  });

  it('reconoce "no existe" como lo diga Storage, y no confunde una caída con eso', async () => {
    for (const notFound of [
      { message: 'Bucket not found', status: 400, statusCode: '404' },
      { message: 'Not Found', status: 404, statusCode: '404' },
      { message: 'The resource was not found' },
    ]) {
      const { admin, created } = fakeSite({ bucket: false, storageErrors: { getBucket: notFound } });
      expect(await ensureVideoBucket(admin)).toBe(true);
      expect(created).toHaveLength(1);
    }

    const down = fakeSite({ storageErrors: { getBucket: { message: 'Gateway Timeout', status: 504, statusCode: '504' } } });
    await expect(ensureVideoBucket(down.admin)).rejects.toThrow('Gateway Timeout');
    expect(down.created).toEqual([]);
  });

  it('si otra corrida lo creó primero, no es un error; si no se pudo crear, sí', async () => {
    const race = fakeSite({
      bucket: false,
      storageErrors: { createBucket: { message: 'The resource already exists', status: 400, statusCode: '409' } },
    });
    expect(await ensureVideoBucket(race.admin)).toBe(false);

    const denied = fakeSite({ bucket: false, storageErrors: { createBucket: { message: 'new row violates policy', status: 403, statusCode: '403' } } });
    await expect(ensureVideoBucket(denied.admin)).rejects.toThrow('No se pudo crear el almacén de videos');
  });

  it('un bucket que existe pero no es público se dice con todas sus letras, y no se cambia solo', async () => {
    const { admin, created } = fakeSite({ bucket: 'private' });
    await expect(ensureVideoBucket(admin)).rejects.toThrow(/no es público/);
    await expect(readVideoBoard(admin, NOW)).rejects.toThrow(/no es público/);
    expect(created).toEqual([]);
  });

  it('firma la subida del video y de su portada, con reemplazo', async () => {
    const { admin, signed } = fakeSite();
    const file = `${TODAY}/6f1d1a52-6f0e-4c4b-9a43-1d2f3c4b5a60-27990-estudio-0a1b2c3d`;
    const uploads = await signVideoUploads(admin, file);
    expect(uploads.video).toBe(`${STORAGE_URL}/storage/v1/object/upload/sign/reels/${file}.mp4?token=firma-1`);
    expect(uploads.cover).toBe(`${STORAGE_URL}/storage/v1/object/upload/sign/reels/${file}.jpg?token=firma-2`);
    expect(signed).toEqual([
      { path: `${file}.mp4`, upsert: true },
      { path: `${file}.jpg`, upsert: true },
    ]);

    const broken = fakeSite({ storageErrors: { sign: { message: 'se cayó' } } });
    await expect(signVideoUploads(broken.admin, file)).rejects.toThrow('No se pudo preparar la subida de un video: se cayó');
  });

  it('borra las carpetas con más de tres días y nada más', async () => {
    const id = '6f1d1a52-6f0e-4c4b-9a43-1d2f3c4b5a60';
    const { admin, objects } = fakeSite({
      objects: {
        ...stored([`2026-10-13/${id}-1000-estudio`, `2026-10-12/${id}-1000-estudio`, `2026-10-11/${id}-1000-estudio`]),
        // Justo tres días: se queda.
        ...stored([`2026-10-10/${id}-1000-estudio`]),
        // Cuatro días o más: se van, con todo lo que tengan adentro.
        ...stored([`2026-10-09/${id}-1000-estudio`, `2026-10-09/${id}-2000-estudio`, `2026-09-30/${id}-1000-estudio`]),
        '2026-10-09/suelto.txt': hoursAgo(100),
        // Lo que no es una carpeta con fecha no es de acá.
        'logo.png': hoursAgo(900),
        'otros/2020-01-01.mp4': hoursAgo(900),
        '2026-13-45/raro.mp4': hoursAgo(900),
        'respaldo-2026-10-01/video.mp4': hoursAgo(900),
      },
    });

    expect(VIDEO_KEEP_DAYS).toBe(3);
    expect(await removeOldVideos(admin, NOW)).toBe(7);
    expect([...objects.keys()].sort()).toEqual(
      [
        ...Object.keys(stored([`2026-10-13/${id}-1000-estudio`, `2026-10-12/${id}-1000-estudio`, `2026-10-11/${id}-1000-estudio`])),
        ...Object.keys(stored([`2026-10-10/${id}-1000-estudio`])),
        'logo.png',
        'otros/2020-01-01.mp4',
        '2026-13-45/raro.mp4',
        'respaldo-2026-10-01/video.mp4',
      ].sort()
    );
    // Ya no queda nada viejo: la siguiente corrida no borra.
    expect(await removeOldVideos(admin, NOW)).toBe(0);
  });

  it('si no se puede limpiar no lanza: el plan sale igual', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = '6f1d1a52-6f0e-4c4b-9a43-1d2f3c4b5a60';
    const objects = stored([`2026-10-01/${id}-1000-estudio`]);

    const noList = fakeSite({ objects, storageErrors: { list: { message: 'se cayó' } } });
    expect(await removeOldVideos(noList.admin, NOW)).toBe(0);
    const noRemove = fakeSite({ objects, storageErrors: { remove: { message: 'se cayó' } } });
    expect(await removeOldVideos(noRemove.admin, NOW)).toBe(0);
    expect(noRemove.objects.size).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------

describe('readVideoBoard', () => {
  it('sin el bucket avisa que el almacén no está listo y no lee nada más', async () => {
    const { admin, read, ops } = fakeSite({ bucket: false, products: [strong()] });
    expect(await readVideoBoard(admin, NOW)).toEqual({
      videos: [],
      stale: 0,
      hiddenUnread: 0,
      lastRenderedAt: null,
      storageReady: false,
      changedAfterPosting: [],
    });
    expect(read).toEqual([]);
    expect(ops).toEqual(['getBucket reels']);
  });

  it('con el bucket vacío y sin marcas recientes no hay videos, y de la base solo se leen las marcas', async () => {
    const { admin, read } = fakeSite({ products: [strong()] });
    expect(await readVideoBoard(admin, NOW)).toEqual({
      videos: [],
      stale: 0,
      hiddenUnread: 0,
      lastRenderedAt: null,
      storageReady: true,
      changedAfterPosting: [],
    });
    // Las marcas se leen siempre (dicen qué video subido cambió de precio); sin videos ni marcas no hay productos que leer.
    expect(read).toEqual(['social_posts']);
  });

  it('si el almacén no responde, falla en vez de decir que no hay videos', async () => {
    const { admin } = fakeSite({ storageErrors: { getBucket: { message: 'Gateway Timeout', status: 504 } } });
    await expect(readVideoBoard(admin, NOW)).rejects.toThrow('No se pudo consultar el almacén de videos');
  });

  it('entrega cada video listo con todo lo necesario para subirlo', async () => {
    const p = strong({ slug: 'audifonos-jbl-tune-520bt', name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro' });
    const uploadedAt = hoursAgo(3);
    const { admin } = fakeSite({ products: [p], objects: stored([fileOf(TODAY, p)], uploadedAt) });

    const board = await readVideoBoard(admin, NOW);
    expect(board).toMatchObject({ stale: 0, hiddenUnread: 0, lastRenderedAt: uploadedAt, storageReady: true });
    expect(board.videos).toHaveLength(1);
    const video = board.videos[0];
    expect(video).toMatchObject({
      id: p.id,
      slug: 'audifonos-jbl-tune-520bt',
      name: 'Audífonos Bluetooth JBL Tune 520BT',
      brand: 'JBL',
      price: 60_000,
      listPrice: 100_000,
      discount: 40,
      checkedAt: p.price_checked_at,
      template: 'estudio',
      videoUrl: `${STORAGE_URL}/storage/v1/object/public/reels/${TODAY}/${p.id}-60000-estudio-16a0bfd5.mp4`,
      coverUrl: `${STORAGE_URL}/storage/v1/object/public/reels/${TODAY}/${p.id}-60000-estudio-16a0bfd5.jpg`,
      fileName: 'comparatech-audifonos-jbl-tune-520bt-reel.mp4',
      renderedAt: uploadedAt,
      // El mismo destino que el botón de compra del sitio.
      link: `https://www.mercadolibre.cl/p/${p.ml_product_id}?matt_word=comparatech&matt_tool=12345`,
      posted: {},
    });
    expect(video.points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
    expect(video.reason).toContain('40% de descuento');
    expect(video.reason).not.toContain('precio de lista');
    expect(video.reason).not.toContain('Ojo');
    expect(video.texts).toEqual(buildVideoTexts(p, NOW));
    expect(Object.keys(video.texts).sort()).toEqual(['facebook', 'instagram', 'tiktok', 'youtubeDescription', 'youtubeTitle']);
  });

  it('la tarjeta y el título de YouTube llevan el nombre del reel; los textos para pegar, el nombre corto de siempre', async () => {
    const p = strong({ name: 'Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3', brand: 'Samsung' });
    catalog([p]);
    const plan = await readVideoPicks(fakeSite({ products: [p] }).admin, NOW);
    expect(plan.picks.map((pick) => pick.claims.nombre_corto)).toEqual(['Samsung Smartwatch Galaxy Fit 3']);
    expect(plan.picks[0].file).toBe(fileOf(TODAY, p));

    const { admin } = fakeSite({ products: [p], objects: stored([fileOf(TODAY, p)]) });
    const [video] = (await readVideoBoard(admin, NOW)).videos;
    expect(video.name).toBe('Samsung Smartwatch Galaxy Fit 3');
    expect(video.texts.youtubeTitle).toBe('Samsung Smartwatch Galaxy Fit 3 a $60.000 con 40% de descuento');
    for (const text of [video.texts.instagram, video.texts.tiktok, video.texts.facebook, video.texts.youtubeDescription]) {
      expect(text.split('\n')).toContain('Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3');
    }
  });

  it('un video armado con el nombre de antes, con el código de fábrica, ya no es el de hoy', async () => {
    const p = strong({ name: 'Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3', brand: 'Samsung' });
    const before = sha256(JSON.stringify([2, shortProductName(p.name), 'Samsung', 100_000, 40, null, true, false])).slice(0, 8);
    const { admin } = fakeSite({ products: [p], objects: stored([`${TODAY}/${p.id}-60000-estudio-${before}`]) });
    const board = await readVideoBoard(admin, NOW);
    expect(board.videos).toEqual([]);
    expect(board.stale).toBe(1);
  });

  it('un video armado con la huella de antes de la versión (decía "precio de lista") cuenta como viejo y el plan lo pide de nuevo', async () => {
    const p = strong({ name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro' });
    // Las mismas cifras, con la cuenta de antes: sin la versión adelante.
    const said = [reelProductName(p.name), 'JBL', 100_000, 40, null, true, false];
    const old = `${TODAY}/${p.id}-60000-estudio-${sha256(JSON.stringify(said)).slice(0, 8)}`;
    expect(old).toBe(`${TODAY}/${p.id}-60000-estudio-7b6ff293`);
    expect(fileOf(TODAY, p)).not.toBe(old);
    catalog([p]);
    const fake = fakeSite({ products: [p], objects: stored([old]) });

    const board = await readVideoBoard(fake.admin, NOW);
    expect(board.videos).toEqual([]);
    expect(board.stale).toBe(1);

    // El plan no lo da por armado: pide el de ahora, con otro nombre.
    const plan = await readVideoPicks(fake.admin, NOW);
    expect(plan.picks).toHaveLength(1);
    expect(plan.picks[0]).toMatchObject({ exists: false, file: fileOf(TODAY, p) });
  });

  it('sin descuento de lista no muestra un precio de lista, y el nombre del archivo no lleva caracteres raros', async () => {
    const p = strong({ original_price: null, slug: 'Audífonos_Sony/WH 1000' });
    const { admin } = fakeSite({ products: [p], objects: stored([fileOf(TODAY, p)]) });
    const [video] = (await readVideoBoard(admin, NOW)).videos;
    expect(video).toMatchObject({ discount: 0, listPrice: null });
    expect(video.fileName).toMatch(/^comparatech-[a-z0-9-]+-reel\.mp4$/);
  });

  it('un video cuyo precio ya no es el del sitio queda fuera, igual que el de un producto que salió', async () => {
    const fine = strong({ category: 'audio' });
    const repriced = strong({ category: 'gaming', price: 64_990 });
    const hidden = strong({ category: 'hogar', is_hidden: true });
    const paused = strong({ category: 'celulares', is_active: false });
    const deleted = strong({ category: 'computacion', deleted_at: daysAgo(1) });
    const unchecked = strong({ category: 'audio', price_checked_at: hoursAgo(7) });
    const gone = strong({ category: 'gaming' });
    const { admin } = fakeSite({
      // `gone` ya no está en la base.
      products: [fine, repriced, hidden, paused, deleted, unchecked],
      objects: stored([
        fileOf(TODAY, fine),
        // El video dice $60.000 y el sitio ya dice $64.990.
        fileOf(TODAY, repriced, 60_000),
        fileOf(TODAY, hidden),
        fileOf(YESTERDAY, paused),
        fileOf(TODAY, deleted),
        fileOf(TODAY, unchecked),
        fileOf(YESTERDAY, gone),
      ]),
    });

    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => video.id)).toEqual([fine.id]);
    // Quedaron viejos los cinco cuyo precio cambió o cuyo producto salió. El
    // de precio sin revisar no se muestra, pero no es "viejo": vuelve solo.
    expect(board.stale).toBe(5);
    expect(board.storageReady).toBe(true);
  });

  it('con el precio sin revisar hace más de 6 horas el video se esconde, y vuelve apenas se revisa', async () => {
    const p = strong({ price_checked_at: hoursAgo(6.5) });
    const future = strong({ category: 'gaming', price_checked_at: new Date(NOW.getTime() + 2 * HOUR).toISOString() });
    const never = strong({ category: 'hogar', price_checked_at: null });
    const objects = stored([fileOf(TODAY, p), fileOf(TODAY, future), fileOf(TODAY, never)]);

    const hidden = await readVideoBoard(fakeSite({ products: [p, future, never], objects }).admin, NOW);
    // El historial sí se leyó: tampoco cuentan como escondidos por eso.
    expect(hidden).toMatchObject({ videos: [], stale: 0, hiddenUnread: 0, storageReady: true });

    const again = await readVideoBoard(fakeSite({ products: [{ ...p, price_checked_at: hoursAgo(0.2) }], objects }).admin, NOW);
    expect(again.videos.map((video) => video.id)).toEqual([p.id]);
  });

  it('un video por producto: el más nuevo que siga vigente', async () => {
    const twice = strong({ category: 'audio' });
    // Bajó hoy: el video de ayer quedó con el precio viejo.
    const cheaper = strong({ category: 'gaming', price: 55_000 });
    // Volvió al precio de ayer: el video de hoy quedó con un precio que ya no rige.
    const back = strong({ category: 'hogar' });
    const { admin } = fakeSite({
      products: [twice, cheaper, back],
      objects: {
        ...stored([fileOf(YESTERDAY, twice)], hoursAgo(27)),
        ...stored([fileOf(TODAY, twice)], hoursAgo(3)),
        ...stored([fileOf(YESTERDAY, cheaper, 60_000)], hoursAgo(27)),
        ...stored([fileOf(TODAY, cheaper)], hoursAgo(2)),
        ...stored([fileOf(YESTERDAY, back)], hoursAgo(26)),
        ...stored([fileOf(TODAY, back, 52_000)], hoursAgo(4)),
      },
    });

    const board = await readVideoBoard(admin, NOW);
    const byId = new Map(board.videos.map((video) => [video.id, video]));
    expect(board.videos).toHaveLength(3);
    expect(byId.get(twice.id)?.videoUrl).toContain(`/${TODAY}/${twice.id}-60000-estudio-`);
    expect(byId.get(twice.id)?.videoUrl).toContain(`/${fileOf(TODAY, twice)}.mp4`);
    expect(byId.get(twice.id)?.renderedAt).toBe(hoursAgo(3));
    expect(byId.get(cheaper.id)?.videoUrl).toContain(`/${TODAY}/${cheaper.id}-55000-estudio-`);
    expect(byId.get(cheaper.id)?.videoUrl).toContain(`/${fileOf(TODAY, cheaper)}.mp4`);
    expect(byId.get(back.id)?.videoUrl).toContain(`/${YESTERDAY}/${back.id}-60000-estudio-`);
    expect(byId.get(back.id)?.videoUrl).toContain(`/${fileOf(YESTERDAY, back)}.mp4`);
    // Ninguno quedó fuera: cada producto tiene un video que sirve.
    expect(board.stale).toBe(0);
    // El último que se subió, sirva o no.
    expect(board.lastRenderedAt).toBe(hoursAgo(2));
  });

  it('dentro del mismo día gana el video que se subió último', async () => {
    const p = strong();
    const { admin } = fakeSite({
      products: [p],
      objects: {
        ...stored([fileOf(TODAY, p, 60_000, 'antigua')], hoursAgo(5)),
        ...stored([fileOf(TODAY, p, 60_000, 'nueva')], hoursAgo(1)),
        ...stored([fileOf(TODAY, p, 60_000, 'media')], hoursAgo(3)),
      },
    });
    // El día en que el generador arme esas tres plantillas.
    const board = await withTemplates(['antigua', 'nueva', 'media'], () => readVideoBoard(admin, NOW));
    expect(board.videos.map((video) => video.template)).toEqual(['nueva']);
    expect(board.stale).toBe(0);
  });

  it('un video de una plantilla que ya no se arma no es el que saldría hoy: queda fuera y cuenta como viejo', async () => {
    const retired = strong({ category: 'audio' });
    const both = strong({ category: 'gaming' });
    const { admin } = fakeSite({
      products: [retired, both],
      objects: {
        ...stored([fileOf(TODAY, retired, 60_000, 'retirada')], hoursAgo(2)),
        // Este tiene además uno de la plantilla de hoy, más antiguo: ese es el que vale.
        ...stored([fileOf(TODAY, both, 60_000, 'retirada')], hoursAgo(1)),
        ...stored([fileOf(TODAY, both)], hoursAgo(4)),
      },
    });

    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => [video.id, video.template, video.renderedAt])).toEqual([[both.id, 'estudio', hoursAgo(4)]]);
    expect(board.stale).toBe(1);
    // Mientras esa plantilla se armaba, el mismo archivo sí se mostraba.
    const before = await withTemplates(['retirada'], () => readVideoBoard(admin, NOW));
    expect(before.videos.map((video) => video.id).sort()).toEqual([retired.id, both.id].sort());
    expect(before.stale).toBe(0);
  });

  it('solo mira hoy y ayer, solo videos completos, y nada que no tenga un nombre de video', async () => {
    const old = strong({ category: 'audio' });
    const half = strong({ category: 'gaming' });
    const coverOnly = strong({ category: 'hogar' });
    const fine = strong({ category: 'celulares' });
    const { admin, ops } = fakeSite({
      products: [old, half, coverOnly, fine],
      objects: {
        ...stored([fileOf('2026-10-11', old), fileOf(TODAY, fine)]),
        [`${fileOf(TODAY, half)}.mp4`]: hoursAgo(1),
        [`${fileOf(TODAY, coverOnly)}.jpg`]: hoursAgo(1),
        [`${TODAY}/notas.txt`]: hoursAgo(1),
        [`${TODAY}/video.mp4`]: hoursAgo(1),
        [`${TODAY}/video.jpg`]: hoursAgo(1),
        [`${TODAY}/${fine.id}-060000-estudio-${printOf(fine)}.mp4`]: hoursAgo(1),
        [`${TODAY}/${fine.id}-060000-estudio-${printOf(fine)}.jpg`]: hoursAgo(1),
        [`${TODAY}/sub/${fileOf(TODAY, fine).split('/')[1]}.mp4`]: hoursAgo(1),
        // Un video completo con un nombre de antes de la huella: no se sabe qué dice, así que no es de acá.
        ...stored([`${TODAY}/${coverOnly.id}-60000-estudio`], hoursAgo(1)),
        // Y uno con la huella mal escrita.
        ...stored([`${TODAY}/${half.id}-60000-estudio-${printOf(half).toUpperCase()}x`], hoursAgo(1)),
      },
    });

    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => video.id)).toEqual([fine.id]);
    expect(board.stale).toBe(0);
    expect(ops).toEqual(['getBucket reels', `list reels/${TODAY}`, `list reels/${YESTERDAY}`]);
  });

  it('primero los que faltan por subir a alguna red, por puntos; al final los que ya están en las cuatro', async () => {
    const plain = strong({ category: 'audio' });
    const winner = strong({ category: 'gaming' });
    const trending = strong({ category: 'hogar' });
    const done = strong({ category: 'celulares' });
    const almost = strong({ category: 'computacion' });
    const { admin } = fakeSite({
      products: [plain, winner, trending, done, almost],
      objects: stored([plain, winner, trending, done, almost].map((p) => fileOf(TODAY, p))),
      // `done` tiene además el mejor puesto: por puntos iría primero.
      candidates: [candidate(winner.ml_product_id, 3), candidate(done.ml_product_id, 1), candidate(almost.ml_product_id, 15)],
      clicks: clicksOf(trending.id, 6),
      posts: [
        ...VIDEO_NETWORKS.map((network) => videoMark(done.id, network, hoursAgo(2))),
        // Le falta una sola red: sigue arriba.
        videoMark(almost.id, 'instagram', hoursAgo(2)),
        videoMark(almost.id, 'tiktok', hoursAgo(2)),
        videoMark(almost.id, 'youtube', hoursAgo(2)),
      ],
    });

    const board = await readVideoBoard(admin, NOW);
    // Puesto 3 suma 4 puntos; 6 clics y puesto 15 suman 2 cada uno (ahí decide el id).
    expect(board.videos.map((video) => video.id)).toEqual([winner.id, trending.id, almost.id, plain.id, done.id]);
    const points = board.videos.map((video) => video.points);
    expect(points[0]).toBeGreaterThan(points[1]);
    expect(points[1]).toBe(points[2]);
    expect(points[2]).toBeGreaterThan(points[3]);
    expect(points[4]).toBeGreaterThanOrEqual(points[0]);
    // Los puntos y el motivo son los de ahora, con las mismas señales que la selección.
    expect(board.videos[0].reason).toContain('figuró 3.º entre los más vendidos de su categoría');
    expect(board.videos[1].reason).toContain('lleva 6 clics recientes en el sitio');
  });

  it('muestra a qué redes ya se subió cada video, con la marca para deshacer', async () => {
    const p = strong({ category: 'audio' });
    const other = strong({ category: 'gaming' });
    const { admin } = fakeSite({
      products: [p, other],
      objects: stored([fileOf(TODAY, p), fileOf(TODAY, other)]),
      posts: [
        videoMark(p.id, 'instagram', hoursAgo(5)), // id 1
        videoMark(p.id, 'youtube', hoursAgo(4)), // id 2
        videoMark(p.id, 'tiktok', hoursAgo(3), { status: 'error', error: 'Marcada por error' }), // id 3: deshecha
        videoMark(p.id, 'facebook', daysAgo(20)), // id 4: de otra vez, hace más de 14 días
        videoMark(p.id, 'youtube', hoursAgo(1)), // id 5: marcada de nuevo
        { product_id: p.id, channel: 'instagram', caption: STORY_MARK, posted_at: hoursAgo(1) }, // id 6: una historia
        { product_id: other.id, channel: 'tiktok', caption: 'Texto del post', external_id: 'u-1', posted_at: hoursAgo(1) }, // id 7: el feed
      ],
    });

    const byId = new Map((await readVideoBoard(admin, NOW)).videos.map((video) => [video.id, video]));
    expect(byId.get(p.id)?.posted).toEqual({
      instagram: { postId: 1, at: hoursAgo(5) },
      youtube: { postId: 5, at: hoursAgo(1) },
    });
    expect(byId.get(other.id)?.posted).toEqual({});
  });

  it('muestra ocho como máximo, y lo que no cabe no cuenta como caído', async () => {
    const rows = Array.from({ length: 11 }, () => strong());
    const { admin } = fakeSite({ products: rows, objects: stored(rows.map((p) => fileOf(TODAY, p))) });
    const board = await readVideoBoard(admin, NOW);
    expect(VIDEO_BOARD_MAX).toBe(8);
    expect(board.videos).toHaveLength(8);
    expect(board.stale).toBe(0);
  });

  it('lo que el puntaje ya no publicaría queda fuera; lo que trae un aviso se muestra diciéndolo', async () => {
    const fine = strong({ category: 'audio' });
    // Después de armar el video, el sitio lo vio (y se sostuvo) bastante más barato.
    const inflated = strong({ category: 'gaming' });
    const doubtful = notLowest({ category: 'hogar' });
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [fine.id, stats(60_000)],
        [inflated.id, stats(60_000, { min30: 40_000, minTracked: 40_000 })],
        [doubtful.id, stats(60_000)],
      ])
    );
    const { admin } = fakeSite({
      products: [fine, inflated, doubtful],
      objects: stored([fine, inflated, doubtful].map((p) => fileOf(TODAY, p))),
    });

    const board = await readVideoBoard(admin, NOW);
    const byId = new Map(board.videos.map((video) => [video.id, video]));
    expect([...byId.keys()].sort()).toEqual([fine.id, doubtful.id].sort());
    // No es un video viejo (el precio es el mismo): simplemente ya no se ofrece.
    expect(board.stale).toBe(0);
    // La página separa el motivo del aviso por este texto exacto.
    expect(VIDEO_WARNING_MARK).toBe('. Ojo: ');
    const parts = byId.get(doubtful.id)!.reason.split(VIDEO_WARNING_MARK);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('40% de descuento');
    expect(parts[1]).toMatch(/^otro vendedor lo ofrece a menos/);
    expect(byId.get(fine.id)?.reason).not.toContain('Ojo');
  });

  it('si no se pudo leer el historial de un producto, su video no se muestra, no cuenta como viejo y se dice cuántos fueron', async () => {
    // Sin el historial no se sabe qué baja diría hoy el video: no se puede saber si sigue vigente.
    const lost = strong({ category: 'audio' });
    const fine = strong({ category: 'gaming' });
    const { admin } = fakeSite({ products: [lost, fine], objects: stored([fileOf(TODAY, lost), fileOf(TODAY, fine)]) });

    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({ stats: new Map(), unread: new Set([lost.id]) });
    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => video.id)).toEqual([fine.id]);
    expect(board.stale).toBe(0);
    expect(board.hiddenUnread).toBe(1);
    expect(board.lastRenderedAt).toBe(hoursAgo(3));

    // A la próxima carga, con el historial leído, vuelve sin que nadie lo arme de nuevo.
    const again = await readVideoBoard(admin, NOW);
    expect(again.videos.map((video) => video.id).sort()).toEqual([lost.id, fine.id].sort());
    expect(again.stale).toBe(0);
    expect(again.hiddenUnread).toBe(0);
  });

  it('hiddenUnread cuenta un producto por video escondido, y solo si el historial es lo único que lo esconde', async () => {
    // Video de hoy y de ayer, los dos vigentes: es un solo producto escondido.
    const twice = strong({ category: 'audio' });
    // Su precio no se revisa hace rato: no se mostraría aunque el historial se leyera.
    const unchecked = strong({ category: 'gaming', price_checked_at: hoursAgo(7) });
    // El video lleva un precio que ya no rige: es viejo, se lea o no el historial.
    const repriced = strong({ category: 'hogar', price: 55_000 });
    // Ya no está a la venta.
    const paused = strong({ category: 'celulares', is_active: false });
    const fine = strong({ category: 'computacion' });
    const lost = [twice, unchecked, repriced, paused];
    const { admin } = fakeSite({
      products: [...lost, fine],
      objects: {
        ...stored([fileOf(YESTERDAY, twice)], hoursAgo(26)),
        ...stored([fileOf(TODAY, twice), fileOf(TODAY, unchecked), fileOf(TODAY, repriced, 60_000), fileOf(TODAY, paused), fileOf(TODAY, fine)]),
      },
    });

    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({ stats: new Map(), unread: new Set(lost.map((p) => p.id)) });
    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => video.id)).toEqual([fine.id]);
    expect(board.hiddenUnread).toBe(1);
    expect(board.stale).toBe(2);
  });

  it('si el historial no se pudo leer de ninguno, no muestra nada, no da nada por viejo y no sigue preguntando', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = [strong({ category: 'audio' }), strong({ category: 'gaming' })];
    const { admin, read } = fakeSite({ products: rows, objects: stored(rows.map((p) => fileOf(TODAY, p)), hoursAgo(2)) });

    vi.mocked(getPriceStatsManyChecked).mockRejectedValueOnce(new Error('sin conexión'));
    // Pero dice cuántos quedaron escondidos por eso.
    expect(await readVideoBoard(admin, NOW)).toEqual({
      videos: [],
      stale: 0,
      hiddenUnread: 2,
      lastRenderedAt: hoursAgo(2),
      storageReady: true,
      changedAfterPosting: [],
    });
    // Las marcas y los productos, una vez cada uno; ni señales: no hay nada que mostrar.
    expect(read).toEqual(['social_posts', 'products']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('un video que el historial ya no respalda (decía una baja que hoy no consta) queda fuera y cuenta como viejo', async () => {
    const p = strong();
    // Se armó cuando el historial confirmaba una baja de 25%.
    const { admin } = fakeSite({ products: [p], objects: stored([fileOf(TODAY, p, p.price, 'estudio', 25)]) });

    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[p.id, droppedFrom(60_000, 80_000)]]));
    expect((await readVideoBoard(admin, NOW)).videos.map((video) => video.id)).toEqual([p.id]);

    // Con el mismo precio, el historial de ahora ya no muestra esa baja.
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[p.id, stats(60_000)]]));
    expect(await readVideoBoard(admin, NOW)).toMatchObject({ videos: [], stale: 1 });
  });

  it('el día es el de Chile: a las 21:10 del 13 mira las carpetas del 13 y del 12, no las del día de UTC', async () => {
    // 21:10 del 13 de octubre en Chile (UTC-3); en UTC ya es 14.
    const late = new Date('2026-10-14T00:10:00Z');
    const at = (hours: number) => new Date(late.getTime() - hours * HOUR).toISOString();
    const today = strong({ category: 'audio', price_checked_at: at(1) });
    const yesterday = strong({ category: 'gaming', price_checked_at: at(1) });
    const utcDay = strong({ category: 'hogar', price_checked_at: at(1) });
    const before = strong({ category: 'celulares', price_checked_at: at(1) });
    const { admin, ops } = fakeSite({
      products: [today, yesterday, utcDay, before],
      objects: {
        ...stored([fileOf('2026-10-13', today)], at(2)),
        ...stored([fileOf('2026-10-12', yesterday)], at(26)),
        // La carpeta que miraría quien tomara el día de UTC, y la de anteayer.
        ...stored([fileOf('2026-10-14', utcDay)], at(0.1)),
        ...stored([fileOf('2026-10-11', before)], at(50)),
      },
    });

    const board = await readVideoBoard(admin, late);
    expect(ops).toEqual(['getBucket reels', 'list reels/2026-10-13', 'list reels/2026-10-12']);
    expect(board.videos.map((video) => video.id).sort()).toEqual([today.id, yesterday.id].sort());
    expect(board.stale).toBe(0);
    expect(board.lastRenderedAt).toBe(at(2));
    for (const video of board.videos) expect(video.videoUrl).toMatch(/\/reels\/2026-10-1[23]\//);
  });

  it('pide los clics solo de los productos que puede mostrar, no la semana entera de todo el sitio', async () => {
    const shown = [strong({ category: 'audio' }), strong({ category: 'gaming' }), strong({ category: 'hogar' })];
    // Estos tres tienen video, pero no se muestran: de ellos no se pregunta.
    const repriced = strong({ category: 'celulares', price: 70_000 });
    const unchecked = strong({ category: 'computacion', price_checked_at: hoursAgo(7) });
    const reworded = strong({ category: 'celulares', original_price: 110_000 });
    // Una semana de clics de otros cincuenta productos: tres páginas de mil.
    const elsewhere: Row[] = Array.from({ length: 2_500 }, (_, i) => ({
      product_id: `00000000-0000-4000-9000-${String(i % 50).padStart(12, '0')}`,
      client_key: null,
      created_at: daysAgo(1),
    }));
    const fake = fakeSite({
      products: [...shown, repriced, unchecked, reworded],
      objects: stored([
        ...shown.map((p) => fileOf(TODAY, p)),
        fileOf(TODAY, repriced, 60_000),
        fileOf(TODAY, unchecked),
        fileOf(TODAY, { ...reworded, original_price: 100_000 }),
      ]),
      clicks: [...elsewhere, ...clicksOf(shown[0].id, 6), ...clicksOf(repriced.id, 9), ...clicksOf(unchecked.id, 9), ...clicksOf(reworded.id, 9)],
    });

    const board = await readVideoBoard(fake.admin, NOW);
    expect(board.videos.map((video) => video.id).sort()).toEqual(shown.map((p) => p.id).sort());
    expect(board.stale).toBe(2);
    // El dato es el de siempre.
    expect(board.videos[0].id).toBe(shown[0].id);
    expect(board.videos[0].reason).toContain('lleva 6 clics recientes en el sitio');

    // Una sola consulta de clics, por los tres productos y nada más.
    const clicks = fake.asked.filter((query) => query.table === 'outbound_clicks');
    expect(clicks).toHaveLength(1);
    expect([...(clicks[0].in.product_id as string[])].sort()).toEqual(shown.map((p) => p.id).sort());
    expect(clicks[0].range).toEqual([0, 999]);
    // Toda la carga: los productos, las dos señales y las marcas. Una consulta cada una.
    expect(fake.asked.map((query) => query.table).sort()).toEqual(['outbound_clicks', 'product_candidates', 'products', 'social_posts']);

    // La selección completa sigue leyendo la semana entera, de a mil: necesita casi todo el catálogo.
    catalog(shown);
    const from = fake.asked.length;
    const plan = await readVideoPicks(fake.admin, NOW);
    expect(plan.picks[0].reason).toContain('lleva 6 clics recientes en el sitio');
    const full = fake.asked.slice(from).filter((query) => query.table === 'outbound_clicks');
    expect(full.map((query) => query.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(full.every((query) => query.in.product_id === undefined)).toBe(true);
  });

  it('sin la tabla de publicaciones muestra los videos sin marcas; si no puede leer los productos, falla', async () => {
    const p = strong();
    const objects = stored([fileOf(TODAY, p)]);
    const noPosts = fakeSite({ products: [p], objects, tableErrors: { social_posts: { code: 'PGRST205', message: 'no existe' } } });
    expect((await readVideoBoard(noPosts.admin, NOW)).videos.map((video) => video.posted)).toEqual([{}]);

    const noProducts = fakeSite({ objects, tableErrors: { products: { code: '500', message: 'se cayó' } } });
    await expect(readVideoBoard(noProducts.admin, NOW)).rejects.toThrow('No se pudo leer los productos: se cayó');
  });

  it('con todos los videos caídos lo dice, y no calcula nada más', async () => {
    const repriced = strong({ price: 70_000 });
    const { admin, read } = fakeSite({ products: [repriced], objects: stored([fileOf(TODAY, repriced, 60_000)], hoursAgo(2)) });
    expect(await readVideoBoard(admin, NOW)).toEqual({
      videos: [],
      stale: 1,
      hiddenUnread: 0,
      lastRenderedAt: hoursAgo(2),
      storageReady: true,
      changedAfterPosting: [],
    });
    expect(read).toEqual(['social_posts', 'products']);
  });
});

// ---------------------------------------------------------------------------

describe('/api/social/videos/plan', () => {
  const request = (path: string, secret: string | null = SECRET) =>
    new NextRequest(`https://sitio.test${path}`, secret ? { headers: { authorization: `Bearer ${secret}` } } : undefined);

  interface PlanRow {
    id: string;
    archivo: string;
    ya_existe: boolean;
    subir: { video: string; portada: string } | null;
    [key: string]: unknown;
  }
  async function call(path: string, secret: string | null = SECRET) {
    const response = await planRoute(request(path, secret));
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, rows: (body.seleccion ?? []) as PlanRow[] };
  }

  it('sin el secreto no entrega nada ni toca el almacén', async () => {
    const fake = fakeSite({ bucket: false });
    site.admin = fake.admin;
    catalog([strong()]);

    for (const secret of [null, 'otro-secreto-cualquiera-de-mas-de-32-caracteres', 'undefined']) {
      const { status, body } = await call('/api/social/videos/plan', secret);
      expect(status).toBe(401);
      expect(body).toEqual({ error: 'Unauthorized' });
    }
    expect(fake.ops).toEqual([]);
    expect(fake.read).toEqual([]);
    expect(vi.mocked(readFreshSocialProducts)).not.toHaveBeenCalled();
  });

  it('responde con la forma exacta que espera el generador', async () => {
    const p = strong({
      name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro',
      offer_info: { free_shipping: true, is_full: true, official_store: true, is_lowest: true } as SocialProduct['offer_info'],
    });
    catalog([p]);
    const fake = fakeSite();
    site.admin = fake.admin;

    const { status, body, rows } = await call('/api/social/videos/plan');
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['borrados', 'fecha', 'generado', 'historial_sin_leer', 'ok', 'seleccion', 'sitio']);
    expect(body).toMatchObject({
      ok: true,
      generado: NOW.toISOString(),
      fecha: TODAY,
      sitio: expect.stringMatching(/^https?:\/\//),
      historial_sin_leer: 0,
      borrados: 0,
    });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        'id',
        'slug',
        'nombre',
        'nombre_corto',
        'marca',
        'categoria',
        'precio',
        'precio_lista',
        'descuento',
        'baja_historial',
        'envio_gratis',
        'full',
        'precio_revisado',
        'puntos',
        'motivo',
        'foto',
        'plantilla',
        'archivo',
        'ya_existe',
        'subir',
      ].sort()
    );
    // Con Full: no es la huella de las demás ofertas de este archivo.
    const file = fileOf(TODAY, p);
    expect(file).not.toBe(`${TODAY}/${p.id}-60000-estudio-16a0bfd5`);
    expect(row).toEqual({
      id: p.id,
      slug: p.slug,
      nombre: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro',
      nombre_corto: 'Audífonos Bluetooth JBL Tune 520BT',
      marca: 'JBL',
      categoria: 'audio',
      precio: 60_000,
      precio_lista: 100_000,
      descuento: 40,
      baja_historial: null,
      envio_gratis: true,
      full: true,
      precio_revisado: p.price_checked_at,
      puntos: expect.any(Number),
      motivo: expect.stringContaining('40% de descuento'),
      foto: 'https://http2.mlstatic.com/D_NQ_NP_123-F.jpg',
      plantilla: 'estudio',
      archivo: file,
      ya_existe: false,
      subir: {
        video: `${STORAGE_URL}/storage/v1/object/upload/sign/reels/${file}.mp4?token=firma-1`,
        portada: `${STORAGE_URL}/storage/v1/object/upload/sign/reels/${file}.jpg?token=firma-2`,
      },
    });
    expect(row.puntos as number).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
    expect(fake.signed.every((upload) => upload.upsert)).toBe(true);
  });

  it('los campos que pueden faltar van como null o false, nunca ausentes', async () => {
    // Sin precio de lista entra por la baja que confirma el historial.
    const p = strong({ original_price: null, brand: '', offer_info: null });
    catalog([p]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[p.id, droppedFrom(60_000, 80_000)]]));
    site.admin = fakeSite().admin;

    const { rows } = await call('/api/social/videos/plan');
    expect(rows[0]).toMatchObject({
      id: p.id,
      marca: null,
      precio_lista: null,
      descuento: 0,
      baja_historial: 25,
      envio_gratis: false,
      full: false,
    });
  });

  it('la primera vez crea el bucket; un video que ya existe no trae dónde subirlo', async () => {
    const done = strong({ category: 'audio' });
    const pending = strong({ category: 'gaming' });
    catalog([done, pending]);
    const fake = fakeSite({ bucket: false });
    site.admin = fake.admin;

    const first = await call('/api/social/videos/plan');
    expect(first.status).toBe(200);
    expect(fake.created).toHaveLength(1);
    expect(fake.created[0]).toMatchObject({ id: 'reels', options: { public: true } });
    expect(first.rows.map((row) => row.ya_existe)).toEqual([false, false]);
    expect(fake.signed).toHaveLength(4);

    // El generador sube el primero (video y portada) y vuelve a preguntar.
    const file = fileOf(TODAY, done);
    fake.objects.set(`${file}.mp4`, hoursAgo(0));
    fake.objects.set(`${file}.jpg`, hoursAgo(0));
    const second = await call('/api/social/videos/plan');
    const byId = new Map(second.rows.map((row) => [row.id, row]));
    expect(byId.get(done.id)).toMatchObject({ archivo: file, ya_existe: true, subir: null });
    expect(byId.get(pending.id)?.ya_existe).toBe(false);
    expect(byId.get(pending.id)?.subir).toEqual({
      video: expect.stringContaining(`/${fileOf(TODAY, pending)}.mp4?token=`),
      portada: expect.stringContaining(`/${fileOf(TODAY, pending)}.jpg?token=`),
    });
    // Solo se firmó lo que faltaba, y el bucket no se creó de nuevo.
    expect(fake.signed).toHaveLength(6);
    expect(fake.created).toHaveLength(1);
  });

  it('?n= pide otra cantidad, entre uno y seis', async () => {
    const categories = ['audio', 'gaming', 'hogar', 'celulares'];
    catalog(categories.reduce<SocialProduct[]>((all, category) => all.concat([strong({ category }), strong({ category })]), []));
    site.admin = fakeSite().admin;

    expect((await call('/api/social/videos/plan')).rows).toHaveLength(4);
    expect((await call('/api/social/videos/plan?n=1')).rows).toHaveLength(1);
    expect((await call('/api/social/videos/plan?n=6')).rows).toHaveLength(6);
    expect((await call('/api/social/videos/plan?n=40')).rows).toHaveLength(6);
    for (const odd of ['0', '-3', 'muchos', '2.5', '']) {
      expect((await call(`/api/social/videos/plan?n=${odd}`)).rows).toHaveLength(4);
    }
  });

  it('borra los videos de hace más de tres días y dice cuántos', async () => {
    const p = strong();
    catalog([p]);
    const fake = fakeSite({
      objects: {
        ...stored([`2026-10-08/${p.id}-60000-estudio`, `2026-10-09/${p.id}-60000-estudio`]),
        ...stored([`2026-10-10/${p.id}-60000-estudio`, `${YESTERDAY}/${p.id}-60000-estudio`]),
      },
    });
    site.admin = fake.admin;

    const { body } = await call('/api/social/videos/plan');
    expect(body.borrados).toBe(4);
    expect([...fake.objects.keys()].every((key) => key >= '2026-10-10')).toBe(true);
    expect(fake.objects.size).toBe(4);
  });

  it('lo ya subido como video no se propone, y lo que el historial no dejó leer se informa', async () => {
    const uploaded = strong({ category: 'audio' });
    const lost = strong({ category: 'gaming' });
    const fine = strong({ category: 'hogar' });
    catalog([uploaded, lost, fine]);
    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({ stats: new Map(), unread: new Set([lost.id]) });
    site.admin = fakeSite({ posts: [videoMark(uploaded.id, 'tiktok', daysAgo(2))] }).admin;

    const { body, rows } = await call('/api/social/videos/plan');
    expect(rows.map((row) => row.id)).toEqual([fine.id]);
    expect(body.historial_sin_leer).toBe(1);
  });

  it('si algo falla responde 500 con el motivo, sin plan a medias', async () => {
    site.admin = null;
    expect(await call('/api/social/videos/plan')).toMatchObject({ status: 500, body: { error: 'Supabase admin no configurado' } });

    site.admin = fakeSite().admin;
    vi.mocked(readFreshSocialProducts).mockResolvedValue({ rows: [], error: 'sin conexión' });
    expect(await call('/api/social/videos/plan')).toMatchObject({
      status: 500,
      body: { error: 'No se pudo leer el catálogo: sin conexión' },
    });

    catalog([strong()]);
    site.admin = fakeSite({ storageErrors: { sign: { message: 'se cayó' } } }).admin;
    const failed = await call('/api/social/videos/plan');
    expect(failed.status).toBe(500);
    expect(Object.keys(failed.body)).toEqual(['error']);

    site.admin = fakeSite({ storageErrors: { getBucket: { message: 'Gateway Timeout', status: 504 } } }).admin;
    expect((await call('/api/social/videos/plan')).status).toBe(500);
  });

  it('las direcciones firmadas no se imprimen: son un permiso de escritura', async () => {
    const printed: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '));
      });
    }
    catalog([strong()]);
    site.admin = fakeSite({ bucket: false }).admin;

    const { rows } = await call('/api/social/videos/plan');
    expect(rows[0].subir?.video).toContain('token=');
    expect(printed.join('\n')).not.toContain('token=');
    expect(printed.join('\n')).not.toContain(SECRET);
  });

  it('el nombre del archivo lleva la huella de lo que la misma respuesta dice que va en el video', async () => {
    const plain = strong({ category: 'audio', name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro' });
    const full = strong({
      category: 'gaming',
      offer_info: { free_shipping: true, is_full: true, official_store: true, is_lowest: true } as SocialProduct['offer_info'],
    });
    // Sin precio de lista, sin marca y sin datos de entrega: entra por la baja que confirma el historial.
    const dropped = strong({
      category: 'hogar',
      name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro',
      original_price: null,
      brand: '',
      offer_info: null,
    });
    // Con las dos cosas: descuento de lista y baja confirmada.
    const both = strong({ category: 'celulares' });
    catalog([plain, full, dropped, both]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(
      new Map([
        [dropped.id, droppedFrom(60_000, 80_000)],
        [both.id, droppedFrom(60_000, 70_000)],
      ])
    );
    site.admin = fakeSite().admin;

    const { rows } = await call('/api/social/videos/plan?n=6');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      // La cuenta que haría quien revisa desde afuera: la versión y siete campos de la respuesta, en este orden.
      const said = [2, row.nombre_corto, row.marca, row.precio_lista, row.descuento, row.baja_historial, row.envio_gratis, row.full];
      const print = sha256(JSON.stringify(said)).slice(0, 8);
      expect(row.archivo).toBe(`${TODAY}/${row.id}-${row.precio}-${row.plantilla}-${print}`);
      expect(row.archivo).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}-[1-9]\d*-[a-z0-9]+-[0-9a-f]{8}$/);
      expect(row.subir?.video).toContain(`/reels/${row.archivo}.mp4?token=`);
      expect(row.subir?.portada).toContain(`/reels/${row.archivo}.jpg?token=`);
    }
    // Cuatro ofertas que dicen cosas distintas: cuatro huellas.
    expect(new Set(rows.map((row) => row.archivo.slice(-8))).size).toBe(4);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(plain.id)?.archivo).toBe(`${TODAY}/${plain.id}-60000-estudio-16a0bfd5`);
    expect(byId.get(full.id)).toMatchObject({ envio_gratis: true, full: true });
    expect(byId.get(dropped.id)).toMatchObject({
      marca: null,
      precio_lista: null,
      descuento: 0,
      baja_historial: 25,
      envio_gratis: false,
      full: false,
    });
    expect(byId.get(dropped.id)?.archivo).toBe(`${TODAY}/${dropped.id}-60000-estudio-900dbf84`);
    expect(byId.get(both.id)).toMatchObject({ precio_lista: 100_000, descuento: 40, baja_historial: 14 });
  });

  const delivery = (over: Record<string, unknown>) =>
    ({ free_shipping: true, is_full: false, official_store: true, sold_by_ml: false, is_lowest: true, ...over }) as SocialProduct['offer_info'];
  /** Lo que le cambia al producto con el mismo precio. Sin `historyAfter`, el historial sigue como estaba. */
  const CHANGES: [string, { after: Partial<SocialProduct>; historyBefore?: PriceStats; historyAfter?: PriceStats }][] = [
    ['le cambian el precio de lista', { after: { original_price: 110_000 } }],
    // Sigue entrando al plan por la baja que confirma el historial.
    ['le quitan el precio de lista', { after: { original_price: null }, historyBefore: droppedFrom(60_000, 80_000) }],
    ['pierde el envío gratis', { after: { offer_info: delivery({ free_shipping: false }) } }],
    ['pasa a llegar con Full', { after: { offer_info: delivery({ is_full: true }) } }],
    ['el historial pasa a confirmarle una baja', { after: {}, historyBefore: stats(60_000), historyAfter: droppedFrom(60_000, 80_000) }],
    ['el historial deja de confirmarle la baja', { after: {}, historyBefore: droppedFrom(60_000, 80_000), historyAfter: stats(60_000) }],
    ['le cambian el modelo en el nombre', { after: { name: 'Audífonos Bluetooth JBL Tune 720BT Negro' } }],
  ];

  it.each(CHANGES)(
    'si al producto %s sin cambiarle el precio, su video deja de mostrarse, cuenta como viejo y el plan lo pide de nuevo con otro nombre',
    async (_label, change) => {
      const before = strong();
      const history = (seen?: PriceStats) =>
        vi.mocked(getPriceStatsMany).mockResolvedValue(new Map(seen ? [[before.id, seen]] : []));
      history(change.historyBefore);
      catalog([before]);
      const fake = fakeSite({ products: [before] });
      site.admin = fake.admin;
      const upload = (file: string, at: string) => {
        fake.objects.set(`${file}.jpg`, at);
        fake.objects.set(`${file}.mp4`, at);
      };

      // El generador pide el plan, arma el video y lo sube con el nombre que le llegó.
      const first = (await call('/api/social/videos/plan')).rows[0];
      expect(first).toMatchObject({ id: before.id, ya_existe: false });
      upload(first.archivo, hoursAgo(2));
      expect(await readVideoBoard(fake.admin, NOW)).toMatchObject({ stale: 0, videos: [{ id: before.id }] });
      expect((await call('/api/social/videos/plan')).rows[0]).toMatchObject({ archivo: first.archivo, ya_existe: true, subir: null });

      // Cambia lo que el video dice. El precio, no.
      const after: SocialProduct = { ...before, ...change.after };
      expect(after.price).toBe(before.price);
      fake.tables.products[0] = after as unknown as Row;
      catalog([after]);
      history('historyAfter' in change ? change.historyAfter : change.historyBefore);

      const board = await readVideoBoard(fake.admin, NOW);
      expect(board.videos).toEqual([]);
      expect(board.stale).toBe(1);

      const next = (await call('/api/social/videos/plan')).rows[0];
      expect(next).toMatchObject({ id: before.id, precio: 60_000, ya_existe: false });
      expect(next.archivo).not.toBe(first.archivo);
      // Mismo día, producto, precio y plantilla: lo único distinto es la huella.
      expect(next.archivo.slice(0, -8)).toBe(first.archivo.slice(0, -8));
      expect(next.subir?.video).toContain(`/reels/${next.archivo}.mp4?token=`);

      // El generador sube el nuevo: vuelve a mostrarse, con ese archivo, y ya no hay nada viejo.
      upload(next.archivo, hoursAgo(0.5));
      const again = await readVideoBoard(fake.admin, NOW);
      expect(again.stale).toBe(0);
      expect(again.videos.map((video) => video.videoUrl)).toEqual([
        `${STORAGE_URL}/storage/v1/object/public/reels/${next.archivo}.mp4`,
      ]);
      expect((await call('/api/social/videos/plan')).rows[0]).toMatchObject({ archivo: next.archivo, ya_existe: true, subir: null });
    }
  );

  it('lo que el video no lleva escrito no lo deja viejo: otro color, otra hora de revisión, más ventas del vendedor', async () => {
    const before = strong({ name: 'Audífonos Bluetooth JBL Tune 520BT - Color Negro' });
    catalog([before]);
    const fake = fakeSite({ products: [before] });
    site.admin = fake.admin;
    const first = (await call('/api/social/videos/plan')).rows[0];
    fake.objects.set(`${first.archivo}.jpg`, hoursAgo(2));
    fake.objects.set(`${first.archivo}.mp4`, hoursAgo(2));

    const after: SocialProduct = {
      ...before,
      // El nombre corto no lleva el color: el video dice lo mismo.
      name: 'Audífonos Bluetooth JBL Tune 520BT - Color Azul',
      price_checked_at: hoursAgo(0.1),
      seller_sales_count: 60_000,
      slug: 'otro-slug',
    };
    fake.tables.products[0] = after as unknown as Row;
    catalog([after]);

    expect(await readVideoBoard(fake.admin, NOW)).toMatchObject({ stale: 0, videos: [{ id: before.id }] });
    expect((await call('/api/social/videos/plan')).rows[0]).toMatchObject({ archivo: first.archivo, ya_existe: true, subir: null });
  });
});

// ---------------------------------------------------------------------------

describe('las señales ordenan, pero no habilitan', () => {
  const info = (over: Record<string, unknown> = {}) =>
    ({ free_shipping: true, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true, ...over }) as SocialProduct['offer_info'];
  /**
   * Una campana de cocina de marca conocida, de tienda oficial y con 45% de
   * lista: una oferta sin ningún aviso que queda justo bajo el piso (39 puntos
   * y fracción). Es el caso que encontró la revisión: con doce clics mandados
   * desde afuera pasaba a publicarse sola.
   */
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
  /** La señal más alta que existe: primero entre los más vendidos y cientos de clics. */
  const MAX_SIGNAL = { mlPosition: 1, recentClicks: 500 };
  /** El puntaje de un producto con 20 días de historial quieto, como el que entrega `stats`. */
  const scoreOf = (p: SocialProduct, signals: { mlPosition?: number; recentClicks?: number } = {}) =>
    interestScore(p, { drop: null, min30: p.price, daysTracked: 20, ...signals });
  const ids = (plan: { picks: { product: SocialProduct }[] }) => plan.picks.map((pick) => pick.product.id);

  it('un producto bajo el piso no entra a los videos por más clics y puesto que tenga; uno sobre el piso sí, y la señal lo sube', async () => {
    const below = hood();
    const above = fridge();
    // La misma campana vendida por Mercado Libre, en otra categoría: unos puntos sobre el frigobar.
    const rival = hood({ category: 'hogar', offer_info: info({ sold_by_ml: true }) });
    catalog([below, above, rival]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([below, above, rival].map((p) => [p.id, stats(p.price)])));

    // Lo que vale cada uno por sí solo y con la señal al máximo. Si los pesos
    // del puntaje se afinan y esto deja de cumplirse, hay que elegir otros
    // productos: el test necesita uno bajo el piso que con señales lo pase.
    expect(scoreOf(below)).toMatchObject({ warning: null, excluded: null });
    expect(scoreOf(below).points).toBeLessThan(MIN_INTEREST_POINTS);
    expect(scoreOf(below).points).toBeGreaterThan(MIN_INTEREST_POINTS - 2);
    expect(scoreOf(below, MAX_SIGNAL).points).toBeGreaterThan(MIN_INTEREST_POINTS + 4);
    expect(scoreOf(below, MAX_SIGNAL).breakdown.signals).toBe(6);
    // El piso se mide sin las señales: son los mismos puntos de antes.
    expect(floorPoints(scoreOf(below, MAX_SIGNAL))).toBe(scoreOf(below).points);
    expect(scoreOf(above)).toMatchObject({ warning: null, excluded: null });
    expect(scoreOf(above).points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
    expect(scoreOf(above).points).toBeLessThan(MIN_INTEREST_POINTS + 2);
    expect(scoreOf(above).points).toBeLessThan(scoreOf(rival).points);
    expect(scoreOf(above, MAX_SIGNAL).points).toBeGreaterThan(scoreOf(rival).points);

    // Sin señales: el de 39 no entra, y el de 41 va después del rival.
    expect(ids(await readVideoPicks(fakeSite().admin, NOW, 6))).toEqual([rival.id, above.id]);

    // Con la señal máxima para los dos (clics y puesto, las dos cosas que se pueden fabricar desde afuera).
    const forged = fakeSite({
      clicks: [...clicksOf(below.id, 500), ...clicksOf(above.id, 500)],
      candidates: [candidate(below.ml_product_id, 1), candidate(above.ml_product_id, 1)],
    });
    const plan = await readVideoPicks(forged.admin, NOW, 6);
    // El de 39 sigue fuera, aunque con las señales sume más que todos; el de 41 pasa adelante.
    expect(ids(plan)).toEqual([above.id, rival.id]);
    expect(plan.picks[0].score.breakdown.signals).toBe(6);
    expect(plan.picks[0].score.points).toBeGreaterThan(plan.picks[1].score.points);
    expect(plan.picks[0].reason).toContain('figuró 1.º entre los más vendidos de su categoría');
  });

  it('doce clics mandados con doce navegadores distintos no meten al plan un producto que no llega al piso', async () => {
    const below = hood();
    catalog([below]);
    vi.mocked(getPriceStatsMany).mockResolvedValue(new Map([[below.id, stats(below.price)]]));
    // Lo que hizo la revisión: una sola persona, doce llaves de cliente distintas.
    const clicks: Row[] = Array.from({ length: 12 }, (_, i) => ({
      product_id: below.id,
      client_key: `llave-${i}`,
      created_at: daysAgo(1),
    }));
    expect(scoreOf(below, { recentClicks: 12 }).points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);

    const plan = await readVideoPicks(fakeSite({ clicks }).admin, NOW, 6);
    expect(plan.picks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Al final del archivo a propósito: los ids de strong() salen de un contador, y
// un test de la ruta del plan espera la plantilla que le toca a su id.

describe('readVideoBoard: lo ya subido cuyo precio cambió (changedAfterPosting)', () => {
  /** El tablero con solo las marcas: sin videos en el almacén, que para esto no hacen falta. */
  async function changed(products: SocialProduct[], posts: Row[]) {
    const fake = fakeSite({ products, posts });
    const board = await readVideoBoard(fake.admin, NOW);
    return { board, fake, list: board.changedAfterPosting };
  }

  it('avisa lo marcado en las últimas 24 horas que ahora está más caro: una marca de hace 23 horas sí, una de hace 25 no', async () => {
    const recent = strong({ category: 'audio', price: 64_990 });
    const old = strong({ category: 'gaming', price: 64_990 });
    const { board, list } = await changed(
      [recent, old],
      [videoMark(recent.id, 'instagram', hoursAgo(23)), videoMark(old.id, 'instagram', hoursAgo(25))]
    );
    expect(list).toEqual([
      { productId: recent.id, name: reelProductName(recent.name), networks: ['instagram'], postedPrice: 60_000, price: 64_990, at: hoursAgo(23) },
    ]);
    // Sin videos en el almacén igual se avisa: lo que está en las redes sigue diciendo el precio viejo.
    expect(board).toMatchObject({ videos: [], stale: 0, storageReady: true });
  });

  it('a las 24 horas justas todavía avisa', async () => {
    const p = strong({ price: 64_990 });
    const { list } = await changed([p], [videoMark(p.id, 'tiktok', hoursAgo(24))]);
    expect(list.map((item) => item.productId)).toEqual([p.id]);
  });

  it('una marca deshecha no cuenta', async () => {
    const p = strong({ price: 64_990 });
    const { list } = await changed([p], [videoMark(p.id, 'instagram', hoursAgo(2), { status: 'error', error: 'Marcada por error' })]);
    expect(list).toEqual([]);
  });

  it('con el mismo precio no avisa', async () => {
    const p = strong();
    const { list } = await changed([p], [videoMark(p.id, 'instagram', hoursAgo(2))]);
    expect(list).toEqual([]);
  });

  it('una subida de menos de 1% no avisa (el vaivén de dos vendedores); desde 1% sí', async () => {
    const small = strong({ category: 'audio', price: 60_590 });
    const exact = strong({ category: 'gaming', price: 60_600 });
    const big = strong({ category: 'hogar', price: 72_000 });
    const { list } = await changed(
      [small, exact, big],
      [videoMark(small.id, 'instagram', hoursAgo(1)), videoMark(exact.id, 'instagram', hoursAgo(2)), videoMark(big.id, 'instagram', hoursAgo(3))]
    );
    expect(list.map((item) => [item.productId, item.price])).toEqual([
      [exact.id, 60_600],
      [big.id, 72_000],
    ]);
  });

  it('una baja no se avisa: lo subido no promete nada que no exista', async () => {
    const p = strong({ price: 45_000 });
    const { list } = await changed([p], [videoMark(p.id, 'youtube', hoursAgo(2))]);
    expect(list).toEqual([]);
  });

  it('un producto que salió del sitio (ocultado, en pausa o borrado a mano) se avisa sin precio', async () => {
    const hidden = strong({ category: 'audio', is_hidden: true });
    const paused = strong({ category: 'gaming', is_active: false });
    const deleted = strong({ category: 'hogar', deleted_at: daysAgo(1) });
    const { list } = await changed(
      [hidden, paused, deleted],
      [videoMark(hidden.id, 'instagram', hoursAgo(1)), videoMark(paused.id, 'tiktok', hoursAgo(2)), videoMark(deleted.id, 'facebook', hoursAgo(3))]
    );
    expect(list.map((item) => [item.productId, item.price, item.name])).toEqual([
      [hidden.id, null, reelProductName(hidden.name)],
      [paused.id, null, reelProductName(paused.name)],
      [deleted.id, null, reelProductName(deleted.name)],
    ]);
  });

  it('un producto que ya no está en la base se avisa sin nombre y sin precio', async () => {
    const erased = '00000000-0000-4000-8000-0000000fffff';
    const { list, fake } = await changed([], [videoMark(erased, 'instagram', hoursAgo(5), { posted_price: 39_990 })]);
    expect(list).toEqual([{ productId: erased, name: null, networks: ['instagram'], postedPrice: 39_990, price: null, at: hoursAgo(5) }]);
    // Se preguntó por él: los productos de las marcas recientes se leen junto con los de los videos.
    const products = fake.asked.filter((query) => query.table === 'products');
    expect(products).toHaveLength(1);
    expect(products[0].in.id).toEqual([erased]);
  });

  it('junta las redes del mismo producto y precio, en el orden de la tarjeta, con la marca más nueva', async () => {
    const p = strong({ price: 64_990 });
    const { list } = await changed(
      [p],
      [
        videoMark(p.id, 'facebook', hoursAgo(1)),
        videoMark(p.id, 'tiktok', hoursAgo(3)),
        videoMark(p.id, 'instagram', hoursAgo(5)),
        // La misma red marcada dos veces al mismo precio cuenta una.
        videoMark(p.id, 'tiktok', hoursAgo(6)),
      ]
    );
    expect(list).toEqual([
      {
        productId: p.id,
        name: reelProductName(p.name),
        networks: ['instagram', 'tiktok', 'facebook'],
        postedPrice: 60_000,
        price: 64_990,
        at: hoursAgo(1),
      },
    ]);
  });

  it('el mismo producto marcado a dos precios va dos veces, de la marca más nueva a la más antigua; uno más caro y otro más barato que hoy, solo el que engaña', async () => {
    const p = strong({ price: 64_990 });
    const q = strong({ category: 'gaming', price: 64_990 });
    const { list } = await changed(
      [p, q],
      [
        videoMark(p.id, 'instagram', hoursAgo(2), { posted_price: 62_000 }),
        videoMark(q.id, 'youtube', hoursAgo(3)),
        videoMark(p.id, 'tiktok', hoursAgo(4), { posted_price: 60_000 }),
        // Marcado más caro que hoy: no se avisa.
        videoMark(p.id, 'facebook', hoursAgo(5), { posted_price: 70_000 }),
      ]
    );
    expect(list.map((item) => [item.productId, item.postedPrice, item.networks, item.at])).toEqual([
      [p.id, 62_000, ['instagram'], hoursAgo(2)],
      [q.id, 60_000, ['youtube'], hoursAgo(3)],
      [p.id, 60_000, ['tiktok'], hoursAgo(4)],
    ]);
  });

  it('una marca sin precio anotado, de una historia, del feed o de Telegram no cuenta', async () => {
    const p = strong({ price: 64_990 });
    const { list } = await changed(
      [p],
      [
        videoMark(p.id, 'instagram', hoursAgo(1), { posted_price: null }),
        videoMark(p.id, 'tiktok', hoursAgo(1), { posted_price: 0 }),
        { product_id: p.id, channel: 'instagram', caption: STORY_MARK, posted_price: 60_000, posted_at: hoursAgo(1) },
        { product_id: p.id, channel: 'facebook', caption: 'Texto del post', posted_price: 60_000, posted_at: hoursAgo(1) },
        { product_id: p.id, channel: 'telegram', caption: VIDEO_MARK, posted_price: 60_000, posted_at: hoursAgo(1) },
      ]
    );
    expect(list).toEqual([]);
  });

  it('con videos en pantalla, la tarjeta del producto que cambió ya no se ofrece y el aviso igual sale', async () => {
    const fine = strong({ category: 'audio' });
    const repriced = strong({ category: 'gaming', price: 64_990 });
    const { admin } = fakeSite({
      products: [fine, repriced],
      objects: stored([fileOf(TODAY, fine), fileOf(TODAY, repriced, 60_000)]),
      posts: [videoMark(repriced.id, 'instagram', hoursAgo(2)), videoMark(fine.id, 'tiktok', hoursAgo(2))],
    });
    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => video.id)).toEqual([fine.id]);
    expect(board.stale).toBe(1);
    expect(board.changedAfterPosting.map((item) => item.productId)).toEqual([repriced.id]);
    // Las marcas de los que sí se muestran siguen llegando a su tarjeta, de la misma lectura.
    expect(board.videos[0].posted).toEqual({ tiktok: { postId: 2, at: hoursAgo(2) } });
  });

  it('sin la tabla de publicaciones no hay nada que avisar', async () => {
    const p = strong({ price: 64_990 });
    const fake = fakeSite({ products: [p], tableErrors: { social_posts: { code: 'PGRST205', message: 'no existe' } } });
    expect((await readVideoBoard(fake.admin, NOW)).changedAfterPosting).toEqual([]);
  });

  it('cada video lleva la ficha limpia de Mercado Libre y lo que dice del envío', async () => {
    const p = strong({ offer_info: { free_shipping: false, is_full: true, official_store: true, sold_by_ml: false, is_lowest: true } as SocialProduct['offer_info'] });
    const { admin } = fakeSite({ products: [p], objects: stored([fileOf(TODAY, p)]) });
    const [video] = (await readVideoBoard(admin, NOW)).videos;
    expect(video.mlUrl).toBe(`https://www.mercadolibre.cl/p/${p.ml_product_id}`);
    expect(video.mlUrl).not.toMatch(/matt_|meli\.la|\?/);
    expect(video.link).toContain('matt_word');
    expect(video).toMatchObject({ freeShipping: false, full: true });

    const none = strong({ category: 'gaming', ml_product_id: null });
    const other = fakeSite({ products: [none], objects: stored([fileOf(TODAY, none)]) });
    const boardNone = await readVideoBoard(other.admin, NOW);
    for (const v of boardNone.videos) expect(v.mlUrl).toBeNull();
  });
});
