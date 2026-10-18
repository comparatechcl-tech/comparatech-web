import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La ruta pública de las láminas del carrusel (/social/carrusel/{ids}/{archivo}):
 * sin firma no toca la base, solo acepta la dirección exacta, no dibuja lo
 * que ya no se vende y entrega un JPG que se puede guardar en caché.
 */

const SECRET = 'un-secreto-de-prueba-de-mas-de-32-caracteres';

const site = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  queries: 0,
  photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' as string | null,
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    from: () => {
      site.queries++;
      const builder: Record<string, unknown> = {};
      let ids: string[] = [];
      builder.select = () => builder;
      builder.in = (_column: string, values: string[]) => {
        ids = values;
        return builder;
      };
      builder.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: site.rows.filter((row) => ids.includes(row.id as string)), error: null }).then(resolve);
      return builder;
    },
  }),
}));
vi.mock('@/lib/content/og-template', async (original) => ({
  ...(await original<typeof import('@/lib/content/og-template')>()),
  loadPhoto: vi.fn(async () => site.photo),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/social/carrusel/[ids]/[file]/route';
import { carouselKey, carouselPath, type CarouselSet } from '@/lib/social/carousel-url';
import { isJpeg } from '@/lib/content/jpeg';

const IDS = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3'];
const NOW = Math.floor(Date.now() / 1000);

function row(id: string, over: Record<string, unknown> = {}) {
  return { id, name: `Parlante JBL ${id.slice(-2)}`, brand: 'JBL', image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-O.webp', is_active: true, ml_domain_id: null, specs: null, ...over };
}

let key: Buffer;
let set: CarouselSet;

function request(path: string) {
  const [, , , ids, file] = path.split('?')[0].split('/');
  return GET(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({ ids, file }) });
}

beforeAll(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  key = carouselKey()!;
  set = { kind: 'bajas', day: 20261018, ids: IDS, expiresAt: NOW + 3600 };
});
afterAll(() => {
  vi.unstubAllEnvs();
});
beforeEach(() => {
  site.rows = IDS.map((id) => row(id));
  site.queries = 0;
  site.photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
});

const item = { rank: 2, price: 59_990, dropAmount: 10_000, dropSince: NOW - 86_400, checkedAt: NOW - 600, freeShipping: true, full: false };

describe('/social/carrusel', () => {
  it('dibuja la portada, una lámina y el cierre en JPG, con caché corta', async () => {
    for (const path of [
      carouselPath({ type: 'portada', set }, key)!,
      carouselPath({ type: 'producto', set, item }, key)!,
      carouselPath({ type: 'cierre', set }, key)!,
    ]) {
      const res = await request(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=600');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(isJpeg(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    }
  }, 60_000);

  it('sin firma válida responde sin tocar la base', async () => {
    const path = carouselPath({ type: 'producto', set, item }, key)!;
    const forged = path.replace('-59990-', '-9990-');
    expect((await request(forged)).status).toBe(403);
    expect((await request('/social/carrusel/no-son-ids/portada.jpg')).status).toBe(404);
    expect(site.queries).toBe(0);
  });

  it('solo la dirección exacta: con parámetros no', async () => {
    const path = carouselPath({ type: 'cierre', set }, key)!;
    expect((await request(`${path}?x=1`)).status).toBe(404);
  });

  it('si un producto del carrusel ya no está a la venta, no dibuja su lámina ni la portada', async () => {
    site.rows = [row(IDS[0]), row(IDS[1], { is_active: false }), row(IDS[2])];
    // Otra dirección que la del primer test: esa ya quedó guardada 10 minutos, como en /social/pieza.
    const product = carouselPath({ type: 'producto', set: { ...set, expiresAt: NOW + 3604 }, item: { ...item, rank: 2 } }, key)!;
    const cover = carouselPath({ type: 'portada', set: { ...set, expiresAt: NOW + 3601 } }, key)!;
    expect((await request(product)).status).toBe(404);
    expect((await request(cover)).status).toBe(404);
    // El de otro puesto, que sigue a la venta, sí.
    const other = carouselPath({ type: 'producto', set: { ...set, expiresAt: NOW + 3602 }, item: { ...item, rank: 1 } }, key)!;
    expect((await request(other)).status).toBe(200);
  }, 30_000);

  it('sin la foto del producto no publica una lámina con el marco vacío', async () => {
    site.photo = null;
    const path = carouselPath({ type: 'producto', set: { ...set, expiresAt: NOW + 3603 }, item }, key)!;
    const res = await request(path);
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
