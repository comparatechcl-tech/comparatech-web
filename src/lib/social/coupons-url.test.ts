import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/social/cupones/[data]/[file]/route';
import { isJpeg } from '@/lib/content/jpeg';
import { checkCouponPath, couponExpiry, couponKey, couponPath, type CouponSet } from './coupons-url';
import type { Coupon } from './coupons';

/**
 * Las direcciones firmadas de la imagen de cupones y la ruta que la dibuja:
 * sin la firma no se dibuja nada, cada imagen tiene una sola dirección y
 * nadie puede cambiar un monto sin que la firma deje de calzar.
 */

const SECRET = 'un-secreto-de-prueba-de-mas-de-32-caracteres';
const NOW = Math.floor(Date.now() / 1000);

const COUPONS: Coupon[] = [
  { code: 'ORBITA45', kind: 'monto', value: 45000, cap: 0, min: 500000, minWord: 'sobre', note: '' },
  { code: 'USA10', kind: 'porcentaje', value: 10, cap: 20000, min: 0, minWord: 'desde', note: 'compras internacionales' },
];
const SET: CouponSet = { day: 20261026, coupons: COUPONS, expiresAt: NOW + 86_400 };

let key: Buffer;

function split(path: string): { data: string; file: string } {
  const [, , , data, file] = path.split('/');
  return { data, file };
}

beforeAll(() => {
  vi.stubEnv('CRON_SECRET', SECRET);
  key = couponKey() as Buffer;
});
afterAll(() => {
  vi.unstubAllEnvs();
});

describe('couponKey', () => {
  it('sin CRON_SECRET, o uno corto, no hay clave', () => {
    expect(couponKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(couponKey({ CRON_SECRET: 'corto' } as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
});

describe('couponPath y checkCouponPath', () => {
  it('lo firmado se lee igual, en los dos formatos', () => {
    for (const format of ['feed', 'historia'] as const) {
      const path = couponPath(SET, format, key) as string;
      expect(path).toMatch(new RegExp(`^/social/cupones/[A-Za-z0-9_-]+/${format}-\\d+-[0-9a-f]{32}\\.jpg$`));
      const { data, file } = split(path);
      expect(checkCouponPath(data, file, key, NOW)).toEqual({ ok: true, set: SET, format });
    }
  });

  it('cupones no válidos no tienen dirección', () => {
    expect(couponPath({ ...SET, coupons: [] }, 'feed', key)).toBeNull();
    expect(couponPath({ ...SET, day: 20261332 }, 'feed', key)).toBeNull();
    expect(couponPath({ ...SET, coupons: [{ ...COUPONS[0], note: 'solo hoy' }] }, 'feed', key)).toBeNull();
  });

  it('cambiar un monto, el formato o la fecha de vencimiento rompe la firma', () => {
    const { data, file } = split(couponPath(SET, 'feed', key) as string);
    const forged = Buffer.from(Buffer.from(data, 'base64url').toString('utf8').replace('45000', '95000'), 'utf8').toString('base64url');
    expect(checkCouponPath(forged, file, key, NOW)).toEqual({ ok: false, reason: 'firma' });
    expect(checkCouponPath(data, file.replace('feed', 'historia'), key, NOW)).toEqual({ ok: false, reason: 'firma' });
    expect(checkCouponPath(data, file.replace(/-(\d+)-/, (_, n) => `-${Number(n) + 1}-`), key, NOW)).toEqual({ ok: false, reason: 'firma' });
    const other = Buffer.alloc(32, 7);
    expect(checkCouponPath(data, file, other, NOW)).toEqual({ ok: false, reason: 'firma' });
  });

  it('la misma imagen escrita de otra forma no vale', () => {
    const { data, file } = split(couponPath(SET, 'feed', key) as string);
    const json = Buffer.from(data, 'base64url').toString('utf8');
    const spaced = Buffer.from(json.replace(',', ', '), 'utf8').toString('base64url');
    expect(checkCouponPath(spaced, file, key, NOW)).toEqual({ ok: false, reason: 'formato' });
    expect(checkCouponPath('nada', file, key, NOW)).toEqual({ ok: false, reason: 'formato' });
    expect(checkCouponPath(data, 'feed.jpg', key, NOW)).toEqual({ ok: false, reason: 'formato' });
  });

  it('vencida no sirve', () => {
    const { data, file } = split(couponPath({ ...SET, expiresAt: NOW - 1 }, 'feed', key) as string);
    expect(checkCouponPath(data, file, key, NOW)).toEqual({ ok: false, reason: 'vencida' });
  });

  it('el vencimiento es el mismo todo el día: los mismos cupones dan la misma dirección', () => {
    expect(couponExpiry(new Date('2026-10-26T03:00:00Z'))).toBe(couponExpiry(new Date('2026-10-26T23:59:00Z')));
    expect(couponExpiry(new Date('2026-10-26T12:00:00Z'))).toBe(Date.UTC(2026, 9, 29) / 1000);
  });
});

describe('GET /social/cupones/{datos}/{archivo}', () => {
  function request(path: string) {
    const { data, file } = split(path.split('?')[0]);
    return GET(new NextRequest(`http://localhost${path}`), { params: Promise.resolve({ data, file }) });
  }

  it('dibuja la imagen firmada en JPG, con caché', async () => {
    for (const format of ['feed', 'historia'] as const) {
      const res = await request(couponPath(SET, format, key) as string);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(res.headers.get('cache-control')).toContain('max-age');
      expect(isJpeg(new Uint8Array(await res.arrayBuffer()))).toBe(true);
    }
  }, 30_000);

  it('sin firma válida, o con parámetros, no dibuja nada', async () => {
    const path = couponPath(SET, 'feed', key) as string;
    expect((await request(path.replace(/[0-9a-f]{32}\.jpg$/, '0'.repeat(32) + '.jpg'))).status).toBe(403);
    expect((await request(`${path}?x=1`)).status).toBe(404);
    expect((await request('/social/cupones/nada/feed.jpg')).status).toBe(404);
  });
});
