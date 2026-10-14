import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * /hoy es adonde lleva el link del perfil, que es lo que dicen los textos de
 * los reels: quien llega desde un video tiene que encontrar ese producto en
 * "Lo que mostramos en redes". La sección junta lo publicado en el feed
 * (products.rrss_published_at) con los videos marcados como subidos en
 * /admin/videos, y si las marcas no se pueden leer sale como antes.
 */

const site = vi.hoisted(() => ({
  /** Filas de products que ve el cliente público; null = sin Supabase. */
  feed: [] as Record<string, unknown>[] | null,
  feedError: null as { code?: string; message: string } | null,
  /** Lo que se le pidió a products. */
  feedQuery: null as { since: unknown; limit: unknown } | null,
  /** El cliente de servicio: un objeto, null (sin configurar) o una función que lanza. */
  admin: { servicio: true } as unknown,
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => {
    if (site.feed === null) return null;
    const rows = site.feed;
    return {
      from: (table: string) => {
        if (table !== 'products') throw new Error(`el cliente público no lee ${table}`);
        const query = { since: null as unknown, limit: null as unknown };
        site.feedQuery = query;
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.order = () => builder;
        builder.gte = (_column: string, value: unknown) => {
          query.since = value;
          return builder;
        };
        builder.limit = (n: number) => {
          query.limit = n;
          return builder;
        };
        builder.then = (resolve: (value: unknown) => unknown) => {
          if (site.feedError) return Promise.resolve({ data: null, error: site.feedError }).then(resolve);
          const hit = rows
            .filter((row) => String(row.rrss_published_at) >= String(query.since))
            .sort((a, b) => (String(a.rrss_published_at) < String(b.rrss_published_at) ? 1 : -1))
            .slice(0, Number(query.limit));
          return Promise.resolve({ data: hit, error: null }).then(resolve);
        };
        return builder;
      },
    };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => (typeof site.admin === 'function' ? (site.admin as () => unknown)() : site.admin),
}));
// Las marcas se entregan ya leídas: cómo se leen de la base está en videos.test.ts.
vi.mock('@/lib/social/videos', () => ({ readVideoMarks: vi.fn() }));
vi.mock('@/lib/queries/products', () => ({ getAllProducts: vi.fn(), getDeals: vi.fn() }));
// La grilla de verdad dibuja tarjetas de cliente: acá basta con saber qué productos recibe y en qué orden.
vi.mock('@/components/product/ProductGrid', async () => {
  const { createElement } = await import('react');
  return {
    ProductGrid: ({ products, placement }: { products: { id: string }[]; placement?: string }) =>
      createElement('ul', { 'data-grid': placement ?? '' }, products.map((p) => p.id).join(',')),
  };
});

import HoyPage, * as hoyModule from '@/app/hoy/page';
import { getAllProducts, getDeals } from '@/lib/queries/products';
import { readVideoMarks, type VideoPosted } from '@/lib/social/videos';
import type { Product } from '@/lib/types';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** El catálogo publicado: lo que /hoy puede mostrar. */
function catalog(...ids: string[]) {
  vi.mocked(getAllProducts).mockResolvedValue(ids.map((id) => ({ id }) as unknown as Product));
}
function deals(...ids: string[]) {
  vi.mocked(getDeals).mockResolvedValue(ids.map((id) => ({ id }) as unknown as Product));
}
/** Productos publicados en el feed: id → fecha de rrss_published_at. */
function feed(rows: Record<string, string>) {
  site.feed = Object.keys(rows).map((id) => ({ id, rrss_published_at: rows[id] }));
}
/** Videos marcados como subidos: id → red → fecha de la marca. */
function marks(rows: Record<string, Partial<Record<keyof VideoPosted, string>>>) {
  const map = new Map<string, VideoPosted>();
  let postId = 1;
  for (const id of Object.keys(rows)) {
    const posted: VideoPosted = {};
    for (const network of Object.keys(rows[id]) as (keyof VideoPosted)[]) {
      posted[network] = { postId: postId++, at: rows[id][network] as string };
    }
    map.set(id, posted);
  }
  vi.mocked(readVideoMarks).mockResolvedValue(map);
}

/** Lo que la página le entrega a cada grilla: la de redes (null si la sección no sale) y la de descuentos. */
async function shown(): Promise<{ social: string[] | null; deals: string[] }> {
  const html = renderToStaticMarkup(await HoyPage());
  const grids = (html.match(/<ul data-grid="social">[^<]*<\/ul>/g) ?? []).map((grid) =>
    grid
      .replace(/<[^>]+>/g, '')
      .split(',')
      .filter(Boolean)
  );
  const hasSocial = html.includes('Lo que mostramos en redes</h2>');
  expect(grids).toHaveLength(hasSocial ? 2 : 1);
  return { social: hasSocial ? grids[0] : null, deals: grids[grids.length - 1] };
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  site.feed = [];
  site.feedError = null;
  site.feedQuery = null;
  site.admin = { servicio: true };
  vi.mocked(readVideoMarks).mockReset();
  vi.mocked(readVideoMarks).mockResolvedValue(new Map());
  catalog('a', 'b', 'c', 'd', 'e');
  deals();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe('/hoy: lo que mostramos en redes', () => {
  it('suma los productos con un video marcado como subido a lo publicado en el feed', async () => {
    feed({ a: ago(2 * DAY) });
    marks({ b: { instagram: ago(HOUR) } });
    expect((await shown()).social).toEqual(['b', 'a']);
  });

  it('un producto que solo salió en un reel aparece aunque nunca se haya publicado en el feed', async () => {
    marks({ c: { tiktok: ago(3 * HOUR) } });
    expect((await shown()).social).toEqual(['c']);
  });

  it('ordena por la fecha más reciente de cualquiera de las dos fuentes', async () => {
    feed({ a: ago(1 * DAY), b: ago(3 * DAY), c: ago(5 * DAY) });
    marks({ d: { youtube: ago(2 * DAY) }, e: { facebook: ago(4 * DAY) } });
    expect((await shown()).social).toEqual(['a', 'd', 'b', 'e', 'c']);
  });

  it('no repite un producto que salió por los dos lados: vale su fecha más nueva', async () => {
    // "a" se publicó en el feed hace 6 días y su video se subió hace una hora: sube al primer lugar.
    // "b" tiene el video de hace 5 días y una publicación del feed programada para mañana: va primero de todos.
    feed({ a: ago(6 * DAY), b: ago(-1 * DAY), c: ago(2 * DAY) });
    marks({ a: { instagram: ago(HOUR) }, b: { instagram: ago(5 * DAY) } });
    const { social } = await shown();
    expect(social).toEqual(['b', 'a', 'c']);
    expect(new Set(social).size).toBe(social?.length);
  });

  it('de un video subido a varias redes cuenta la marca más reciente', async () => {
    feed({ a: ago(2 * DAY) });
    marks({ b: { instagram: ago(4 * DAY), tiktok: ago(DAY), youtube: ago(3 * DAY) }, c: { facebook: ago(3 * DAY) } });
    expect((await shown()).social).toEqual(['b', 'a', 'c']);
  });

  it('lee las marcas de los últimos 7 días con el cliente de servicio', async () => {
    const before = Date.now();
    await shown();
    expect(vi.mocked(readVideoMarks)).toHaveBeenCalledTimes(1);
    const [client, since] = vi.mocked(readVideoMarks).mock.calls[0];
    expect(client).toBe(site.admin);
    expect(since).toBeInstanceOf(Date);
    expect(since.getTime()).toBeGreaterThanOrEqual(before - 7 * DAY);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now() - 7 * DAY);
    // La misma ventana, y el mismo tope, que lo del feed.
    expect(site.feedQuery).toEqual({ since: since.toISOString(), limit: 24 });
  });

  it('el tope es el mismo de antes, contando las dos fuentes juntas', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p${String(i).padStart(2, '0')}`);
    catalog(...ids);
    // Los pares en el feed y los impares en video, cada uno una hora más viejo que el anterior.
    const inFeed: Record<string, string> = {};
    const inVideo: Record<string, { instagram: string }> = {};
    ids.forEach((id, i) => {
      if (i % 2 === 0) inFeed[id] = ago((i + 1) * HOUR);
      else inVideo[id] = { instagram: ago((i + 1) * HOUR) };
    });
    feed(inFeed);
    marks(inVideo);
    const { social } = await shown();
    expect(social).toHaveLength(24);
    expect(social).toEqual(ids.slice(0, 24));
  });

  it('lo que salió del catálogo no se muestra aunque tenga un video subido', async () => {
    catalog('a');
    feed({ a: ago(DAY) });
    marks({ oculto: { instagram: ago(HOUR) } });
    expect((await shown()).social).toEqual(['a']);
  });

  it('lo que ya está arriba no se repite entre los mayores descuentos', async () => {
    deals('a', 'b', 'c');
    marks({ b: { instagram: ago(HOUR) } });
    expect(await shown()).toEqual({ social: ['b'], deals: ['a', 'c'] });
  });

  it('sin nada en redes esta semana, la sección no sale', async () => {
    deals('a');
    expect(await shown()).toEqual({ social: null, deals: ['a'] });
  });
});

describe('/hoy: si las marcas de video no se pueden leer, sale como antes', () => {
  it('sin cliente de servicio muestra lo del feed y no intenta leer', async () => {
    site.admin = null;
    feed({ a: ago(DAY), b: ago(2 * DAY) });
    marks({ c: { instagram: ago(HOUR) } });
    expect((await shown()).social).toEqual(['a', 'b']);
    expect(vi.mocked(readVideoMarks)).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('si la lectura falla muestra lo del feed, no lanza y deja el aviso en el registro', async () => {
    feed({ a: ago(DAY) });
    vi.mocked(readVideoMarks).mockRejectedValue(new Error('No se pudo leer los videos ya subidos: se cayó'));
    expect((await shown()).social).toEqual(['a']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('[hoy] no se pudo leer los videos subidos: No se pudo leer los videos ya subidos: se cayó');
  });

  it('si ni siquiera se puede armar el cliente, tampoco lanza', async () => {
    site.admin = () => {
      throw new Error('Invalid URL');
    };
    feed({ a: ago(DAY) });
    expect((await shown()).social).toEqual(['a']);
    expect(vi.mocked(readVideoMarks)).not.toHaveBeenCalled();
  });

  it('una marca con una fecha que no se entiende se salta sin romper las demás', async () => {
    marks({ a: { instagram: 'no es una fecha' }, b: { instagram: 'no es una fecha', tiktok: ago(HOUR) } });
    expect((await shown()).social).toEqual(['b']);
  });

  it('si falla lo del feed, los videos subidos igual aparecen', async () => {
    site.feedError = { code: '500', message: 'se cayó' };
    marks({ b: { instagram: ago(HOUR) } });
    expect((await shown()).social).toEqual(['b']);

    // Y sin el cliente público (Supabase sin configurar del todo), lo mismo.
    site.feedError = null;
    site.feed = null;
    expect((await shown()).social).toEqual(['b']);
  });
});

describe('/hoy: cada cuánto se regenera', () => {
  it('cada minuto, sola: por eso marcar un video no necesita pedirlo', () => {
    expect(hoyModule.revalidate).toBe(60);
  });
});
