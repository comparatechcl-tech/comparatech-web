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

import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildVideoTexts } from '@/lib/content/captions';
import type { PriceStats } from '@/lib/deals';
import { getPriceStatsMany, getPriceStatsManyChecked } from '@/lib/queries/price-history';
import { MIN_INTEREST_POINTS } from '@/lib/social/interest';
import { NETWORK_RULES, STORY_MARK } from '@/lib/social/networks';
import { readFreshSocialProducts, type SocialProduct } from '@/lib/social/telegram';
import {
  VIDEO_BOARD_MAX,
  VIDEO_BUCKET,
  VIDEO_KEEP_DAYS,
  VIDEO_MARK,
  VIDEO_MAX_BYTES,
  VIDEO_NETWORKS,
  VIDEO_PLAN_MAX,
  VIDEO_RULES,
  VIDEO_TEMPLATES,
  VIDEO_WARNING_MARK,
  assignVideoTemplates,
  ensureVideoBucket,
  parseVideoObjectName,
  readVideoBoard,
  readVideoMarks,
  readVideoPicks,
  removeOldVideos,
  signVideoUploads,
  videoObjectName,
  videoPhoto,
  videoPublicUrl,
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

/**
 * El sitio de mentira: una base que filtra como la de verdad (eq, neq, in,
 * not … is null, gte, orden, tope y páginas) y un almacén con carpetas. Anota
 * qué tablas se leyeron y cada operación del almacén.
 */
function fakeSite(seed: Seed = {}) {
  const tables: Record<string, Row[]> = {
    products: (seed.products ?? []) as unknown as Row[],
    social_posts: (seed.posts ?? []).map((post, i) => ({ id: i + 1, status: 'publicado', ...post })),
    outbound_clicks: seed.clicks ?? [],
    product_candidates: seed.candidates ?? [],
  };
  const read: string[] = [];

  function from(table: string) {
    read.push(table);
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
        return builder;
      },
      then<T>(resolve: (value: { data: Row[] | null; error: DbError | null }) => T) {
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
  return { admin, read, ops, created, signed, objects, tables, hasBucket: () => bucket !== null };
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

/** El nombre del video de un producto en el almacén, sin extensión. */
const fileOf = (date: string, p: Pick<SocialProduct, 'id' | 'price'>, price: number = p.price, template = 'estudio') =>
  `${date}/${p.id}-${price}-${template}`;

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
  const video = { date: '2026-10-13', productId: ID, price: 27_990, template: 'estudio' };

  it('arma "AAAA-MM-DD/<id>-<precio>-<plantilla>" y lo lee de vuelta', () => {
    const name = videoObjectName(video);
    expect(name).toBe(`2026-10-13/${ID}-27990-estudio`);
    expect(parseVideoObjectName(name!)).toEqual(video);

    for (const other of [
      { ...video, price: 1 },
      { ...video, price: 2_147_483_647 },
      { ...video, template: 'ficha2' },
      { ...video, date: '2028-02-29' },
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
    ]) {
      expect(videoObjectName(bad)).toBeNull();
    }
  });

  it('al leer rechaza todo lo que no calce exacto', () => {
    const good = `2026-10-13/${ID}-27990-estudio`;
    expect(parseVideoObjectName(good)).not.toBeNull();
    for (const bad of [
      '',
      `${good}.mp4`,
      `${good} `,
      ` ${good}`,
      `${good}\n`,
      `reels/${good}`,
      `${good}/otro`,
      `2026-10-13/${ID}-27990`,
      `2026-10-13/${ID}-estudio`,
      `2026-10-13/${ID}-027990-estudio`,
      `2026-10-13/${ID}-0-estudio`,
      `2026-10-13/${ID}--27990-estudio`,
      `2026-10-13/${ID}-27.990-estudio`,
      `2026-10-13/${ID}-27990-Estudio`,
      `2026-10-13/${ID}-27990-estudio-v2`,
      `2026-10-13/${ID}-99999999999-estudio`,
      `2026-10-13/${ID}-3000000000-estudio`,
      `2026-10-13/${ID.toUpperCase()}-27990-estudio`,
      `2026-10-13/${ID.slice(1)}-27990-estudio`,
      `2026-02-31/${ID}-27990-estudio`,
      `2026-1-3/${ID}-27990-estudio`,
      `2026-10-13\\${ID}-27990-estudio`,
      `../2026-10-13/${ID}-27990-estudio`,
    ]) {
      expect(parseVideoObjectName(bad)).toBeNull();
    }
    expect(parseVideoObjectName(undefined as unknown as string)).toBeNull();
  });

  it('la dirección pública es la del bucket público del proyecto', () => {
    expect(VIDEO_BUCKET).toBe('reels');
    expect(videoPublicUrl(`2026-10-13/${ID}-27990-estudio.mp4`)).toBe(
      `${STORAGE_URL}/storage/v1/object/public/reels/2026-10-13/${ID}-27990-estudio.mp4`
    );
    expect(videoPublicUrl('a.jpg', 'https://otro.test/')).toBe('https://otro.test/storage/v1/object/public/reels/a.jpg');
  });
});

describe('plantillas', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('hoy hay una sola: todos los videos salen con ella', () => {
    expect(VIDEO_TEMPLATES).toEqual(['estudio']);
    expect(assignVideoTemplates(ids, TODAY)).toEqual(ids.map(() => 'estudio'));
    expect(assignVideoTemplates([], TODAY)).toEqual([]);
    for (const template of VIDEO_TEMPLATES) expect(template).toMatch(/^[a-z0-9]+$/);
  });

  it('con más de una se reparten parejo, y el mismo día con los mismos productos da siempre lo mismo', () => {
    const two = ['estudio', 'ficha'];
    for (const date of ['2026-10-13', '2026-10-14', '2026-10-15', '2026-11-01']) {
      const assigned = assignVideoTemplates(ids, date, new Map(), two);
      expect(assigned).toEqual(assignVideoTemplates(ids, date, new Map(), two));
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
      first.add(assignVideoTemplates(['a'], `2026-10-${String(day).padStart(2, '0')}`, new Map(), ['estudio', 'ficha'])[0]);
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
    const assigned = assignVideoTemplates(['a', 'b', 'c', 'd'], TODAY, already, two);
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
    for (const pick of plan.picks) {
      expect(pick.template).toBe('estudio');
      expect(pick.file).toBe(`${TODAY}/${pick.product.id}-60000-estudio`);
      expect(parseVideoObjectName(pick.file)).toMatchObject({ productId: pick.product.id, price: 60_000 });
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
    expect(plan.picks[0].file).toBe(`2026-10-13/${p.id}-60000-estudio`);
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
    const file = `${TODAY}/6f1d1a52-6f0e-4c4b-9a43-1d2f3c4b5a60-27990-estudio`;
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
    expect(await readVideoBoard(admin, NOW)).toEqual({ videos: [], stale: 0, lastRenderedAt: null, storageReady: false });
    expect(read).toEqual([]);
    expect(ops).toEqual(['getBucket reels']);
  });

  it('con el bucket vacío no hay videos, y no se lee la base', async () => {
    const { admin, read } = fakeSite({ products: [strong()] });
    expect(await readVideoBoard(admin, NOW)).toEqual({ videos: [], stale: 0, lastRenderedAt: null, storageReady: true });
    expect(read).toEqual([]);
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
    expect(board).toMatchObject({ stale: 0, lastRenderedAt: uploadedAt, storageReady: true });
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
      videoUrl: `${STORAGE_URL}/storage/v1/object/public/reels/${TODAY}/${p.id}-60000-estudio.mp4`,
      coverUrl: `${STORAGE_URL}/storage/v1/object/public/reels/${TODAY}/${p.id}-60000-estudio.jpg`,
      fileName: 'comparatech-audifonos-jbl-tune-520bt-reel.mp4',
      renderedAt: uploadedAt,
      // El mismo destino que el botón de compra del sitio.
      link: `https://www.mercadolibre.cl/p/${p.ml_product_id}?matt_word=comparatech&matt_tool=12345`,
      posted: {},
    });
    expect(video.points).toBeGreaterThanOrEqual(MIN_INTEREST_POINTS);
    expect(video.reason).toContain('40% por debajo del precio de lista');
    expect(video.reason).not.toContain('Ojo');
    expect(video.texts).toEqual(buildVideoTexts(p, NOW));
    expect(Object.keys(video.texts).sort()).toEqual(['facebook', 'instagram', 'tiktok', 'youtubeDescription', 'youtubeTitle']);
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
    expect(hidden).toMatchObject({ videos: [], stale: 0, storageReady: true });

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
    expect(byId.get(twice.id)?.videoUrl).toContain(`/${TODAY}/${twice.id}-60000-estudio.mp4`);
    expect(byId.get(twice.id)?.renderedAt).toBe(hoursAgo(3));
    expect(byId.get(cheaper.id)?.videoUrl).toContain(`/${TODAY}/${cheaper.id}-55000-estudio.mp4`);
    expect(byId.get(back.id)?.videoUrl).toContain(`/${YESTERDAY}/${back.id}-60000-estudio.mp4`);
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
    const board = await readVideoBoard(admin, NOW);
    expect(board.videos.map((video) => video.template)).toEqual(['nueva']);
    expect(board.stale).toBe(0);
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
        [`${TODAY}/${fine.id}-060000-estudio.mp4`]: hoursAgo(1),
        [`${TODAY}/${fine.id}-060000-estudio.jpg`]: hoursAgo(1),
        [`${TODAY}/sub/${fine.id}-60000-estudio.mp4`]: hoursAgo(1),
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
    expect(parts[0]).toContain('40% por debajo del precio de lista');
    expect(parts[1]).toMatch(/^otro vendedor lo ofrece a menos/);
    expect(byId.get(fine.id)?.reason).not.toContain('Ojo');
  });

  it('si no se pudo leer el historial de precios, el video se muestra con ese aviso', async () => {
    const p = strong();
    vi.mocked(getPriceStatsManyChecked).mockResolvedValueOnce({ stats: new Map(), unread: new Set([p.id]) });
    const { admin } = fakeSite({ products: [p], objects: stored([fileOf(TODAY, p)]) });
    const [video] = (await readVideoBoard(admin, NOW)).videos;
    expect(video.reason).toContain('Ojo: hoy no se pudo leer su historial de precios');
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
    expect(await readVideoBoard(admin, NOW)).toEqual({ videos: [], stale: 1, lastRenderedAt: hoursAgo(2), storageReady: true });
    expect(read).toEqual(['products']);
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
    const file = `${TODAY}/${p.id}-60000-estudio`;
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
      motivo: expect.stringContaining('40% por debajo del precio de lista'),
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
    const file = `${TODAY}/${done.id}-60000-estudio`;
    fake.objects.set(`${file}.mp4`, hoursAgo(0));
    fake.objects.set(`${file}.jpg`, hoursAgo(0));
    const second = await call('/api/social/videos/plan');
    const byId = new Map(second.rows.map((row) => [row.id, row]));
    expect(byId.get(done.id)).toMatchObject({ archivo: file, ya_existe: true, subir: null });
    expect(byId.get(pending.id)?.ya_existe).toBe(false);
    expect(byId.get(pending.id)?.subir).toEqual({
      video: expect.stringContaining(`/${TODAY}/${pending.id}-60000-estudio.mp4?token=`),
      portada: expect.stringContaining(`/${TODAY}/${pending.id}-60000-estudio.jpg?token=`),
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
});
