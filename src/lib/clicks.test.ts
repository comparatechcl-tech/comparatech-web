import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_CLICKS_PER_DAY,
  chileDateKey,
  chileDayStart,
  isBotUserAgent,
  linkModeFromHref,
  normalizeSrc,
  parseClickBody,
  parseWholeNumber,
  placementFromPath,
  shiftDateKey,
  startOfChileDay,
  weekStartOf,
} from '@/lib/clicks';

const ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

describe('placementFromPath', () => {
  it.each([
    ['/', 'home'],
    ['', 'home'],
    ['/categoria/celulares', 'categoria'],
    ['/ofertas', 'ofertas'],
    ['/ofertas/', 'ofertas'],
    ['/buscar', 'buscar'],
    ['/buscar?q=audifonos', 'buscar'],
    ['/producto/iphone-15-128gb', 'ficha'],
    ['/comparador', 'comparador'],
    ['/hoy', 'social'],
    ['/nosotros', 'otro'],
    ['/privacidad', 'otro'],
  ])('%s → %s', (path, expected) => {
    expect(placementFromPath(path)).toBe(expected);
  });
});

describe('linkModeFromHref', () => {
  it('distingue meli.la, la ficha directa y lo demás', () => {
    expect(linkModeFromHref('https://meli.la/2AbCdEf')).toBe('meli_la');
    expect(linkModeFromHref('https://www.mercadolibre.cl/p/MLC123?matt_word=x&matt_tool=1')).toBe('directo');
    expect(linkModeFromHref('https://articulo.mercadolibre.cl/MLC-123-algo')).toBe('otro');
    expect(linkModeFromHref('https://www.mercadolibre.cl/social/comparatech')).toBe('otro');
    expect(linkModeFromHref('no es una url')).toBe('otro');
  });
});

describe('isBotUserAgent', () => {
  it('deja pasar navegadores reales, incluidos los de apps sociales', () => {
    expect(isBotUserAgent(CHROME)).toBe(false);
    expect(isBotUserAgent(`${CHROME} Telegram-Android/11.2.0`)).toBe(false);
    expect(isBotUserAgent(`${CHROME} Instagram 300.0.0.0`)).toBe(false);
    expect(
      isBotUserAgent('Mozilla/5.0 (Linux; Android 9; CUBOT X20) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')
    ).toBe(false);
  });

  it('descarta robots, scripts y user-agent vacío', () => {
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent('   ')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; bingbot/2.0)')).toBe(true);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 HeadlessChrome/120.0')).toBe(true);
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('python-requests/2.31')).toBe(true);
    expect(isBotUserAgent('node-fetch/1.0')).toBe(true);
  });
});

describe('parseClickBody', () => {
  const valid = { p: ID, s: 'categoria', m: 'meli_la', src: 'Telegram', mob: true };

  it('acepta un clic bien formado', () => {
    expect(parseClickBody(JSON.stringify(valid))).toEqual({
      productId: ID,
      placement: 'categoria',
      linkMode: 'meli_la',
      src: 'telegram',
      mobile: true,
    });
  });

  it('completa lo opcional con valores seguros', () => {
    expect(parseClickBody(JSON.stringify({ p: ID.toUpperCase(), s: 'ficha' }))).toEqual({
      productId: ID,
      placement: 'ficha',
      linkMode: 'otro',
      src: null,
      mobile: false,
    });
    expect(parseClickBody(JSON.stringify({ ...valid, m: 'raro', mob: 'true', src: 42 }))).toMatchObject({
      linkMode: 'otro',
      mobile: false,
      src: null,
    });
  });

  it.each([
    ['vacío', ''],
    ['no es JSON', 'hola'],
    ['JSON que no es objeto', '[1,2]'],
    ['null', 'null'],
    ['sin producto', JSON.stringify({ s: 'ficha' })],
    ['producto que no es uuid', JSON.stringify({ ...valid, p: '123' })],
    ['uuid con inyección', JSON.stringify({ ...valid, p: `${ID}' or 1=1` })],
    ['sin placement', JSON.stringify({ p: ID })],
    ['placement fuera del enum', JSON.stringify({ ...valid, s: 'portada' })],
    ['más de 1 KB', JSON.stringify({ ...valid, src: 'x'.repeat(2000) })],
  ])('rechaza %s', (_, body) => {
    expect(parseClickBody(body)).toBeNull();
  });
});

describe('normalizeSrc', () => {
  it('deja una etiqueta corta y limpia', () => {
    expect(normalizeSrc(' Instagram ')).toBe('instagram');
    expect(normalizeSrc('<script>alert(1)</script>')).toBe('script-alert-1-script');
    expect(normalizeSrc('a'.repeat(100))).toHaveLength(40);
    expect(normalizeSrc('')).toBeNull();
    expect(normalizeSrc('!!!')).toBeNull();
    expect(normalizeSrc(undefined)).toBeNull();
  });
});

describe('fechas en hora de Chile', () => {
  it('chileDateKey usa el día de Chile, no el UTC', () => {
    // 02:00 UTC del 5 de octubre = 23:00 del 4 en Chile (horario de verano, UTC-3).
    expect(chileDateKey(new Date('2026-10-05T02:00:00Z'))).toBe('2026-10-04');
    // Invierno (UTC-4): 03:30 UTC del 10 de julio = 23:30 del 9.
    expect(chileDateKey(new Date('2026-07-10T03:30:00Z'))).toBe('2026-07-09');
  });

  it('startOfChileDay devuelve la medianoche de Chile', () => {
    expect(startOfChileDay(new Date('2026-10-04T18:20:00Z')).toISOString()).toBe('2026-10-04T03:00:00.000Z');
    expect(startOfChileDay(new Date('2026-07-10T03:30:00Z')).toISOString()).toBe('2026-07-09T04:00:00.000Z');
    expect(chileDayStart('2026-10-04').toISOString()).toBe('2026-10-04T03:00:00.000Z');
  });

  it('shiftDateKey cruza meses y años', () => {
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('weekStartOf lleva cualquier día a su lunes', () => {
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28'); // domingo
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28'); // lunes
    expect(weekStartOf('2026-10-01')).toBe('2026-09-28'); // jueves
    expect(weekStartOf('2026-02-31')).toBeNull();
    expect(weekStartOf('ayer')).toBeNull();
  });
});

describe('parseWholeNumber', () => {
  it('entiende los formatos chilenos', () => {
    expect(parseWholeNumber('12.345')).toBe(12345);
    expect(parseWholeNumber('$ 8.000')).toBe(8000);
    expect(parseWholeNumber('230')).toBe(230);
    expect(parseWholeNumber('')).toBeNull();
    expect(parseWholeNumber('  ')).toBeNull();
  });

  it('rechaza lo que no es un entero no negativo', () => {
    expect(parseWholeNumber('12,5')).toBeUndefined();
    expect(parseWholeNumber('-3')).toBeUndefined();
    expect(parseWholeNumber('abc')).toBeUndefined();
    expect(parseWholeNumber('99999999999')).toBeUndefined();
  });
});

// ── /api/e ──────────────────────────────────────────────────────────────

const db = vi.hoisted(() => ({
  todayCount: 0 as number,
  countError: null as { code?: string; message: string } | null,
  inserts: [] as unknown[],
  available: true,
}));

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: () => {
    if (!db.available) return null;
    return {
      from: () => ({
        select: () => ({
          gte: async () => ({ count: db.todayCount, error: db.countError }),
        }),
        insert: async (row: unknown) => {
          db.inserts.push(row);
          return { error: null };
        },
      }),
    };
  },
}));

async function post(body: string, headers: Record<string, string> = {}) {
  const { POST } = await import('@/app/api/e/route');
  const { NextRequest } = await import('next/server');
  const req = new NextRequest('https://comparatech.cl/api/e', {
    method: 'POST',
    body,
    headers: { 'user-agent': CHROME, 'content-type': 'text/plain;charset=UTF-8', ...headers },
  });
  return POST(req);
}

describe('POST /api/e', () => {
  const body = JSON.stringify({ p: ID, s: 'home-ofertas', m: 'meli_la', src: 'telegram', mob: true });

  beforeEach(() => {
    db.todayCount = 0;
    db.countError = null;
    db.inserts = [];
    db.available = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('un clic real inserta una fila sin IP y responde 204', async () => {
    const res = await post(body, { 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '200.1.2.3' });
    expect(res.status).toBe(204);
    expect(db.inserts).toEqual([
      { product_id: ID, placement: 'home-ofertas', link_mode: 'meli_la', src: 'telegram', is_mobile: true },
    ]);
    expect(JSON.stringify(db.inserts)).not.toContain('200.1.2.3');
  });

  it('un body inválido no inserta', async () => {
    const res = await post('{"p":"no-uuid","s":"home"}');
    expect(res.status).toBe(204);
    expect(db.inserts).toHaveLength(0);
  });

  it('un body de más de 1 KB no inserta', async () => {
    const res = await post(body + ' '.repeat(2000));
    expect(res.status).toBe(204);
    expect(db.inserts).toHaveLength(0);
  });

  it('un user-agent de robot no inserta', async () => {
    const res = await post(body, { 'user-agent': 'Googlebot/2.1' });
    expect(res.status).toBe(204);
    expect(db.inserts).toHaveLength(0);
  });

  it('un pedido desde otro sitio no inserta', async () => {
    await post(body, { 'sec-fetch-site': 'cross-site' });
    expect(db.inserts).toHaveLength(0);
  });

  it('con el freno diario alcanzado no inserta', async () => {
    db.todayCount = MAX_CLICKS_PER_DAY;
    await post(body);
    expect(db.inserts).toHaveLength(0);
  });

  it('sin la tabla responde 204 en silencio', async () => {
    db.countError = { code: '42P01', message: 'relation "outbound_clicks" does not exist' };
    const res = await post(body);
    expect(res.status).toBe(204);
    expect(db.inserts).toHaveLength(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('sin Supabase configurado responde 204', async () => {
    db.available = false;
    const res = await post(body);
    expect(res.status).toBe(204);
  });
});
