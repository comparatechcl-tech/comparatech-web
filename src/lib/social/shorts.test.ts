import { describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

import type { DailyState } from './meta-daily';
import { METRICOOL_MONTHLY_FREE, chileMonthStart, planShorts, shortsMetricoolInfo, type ShortsInput } from './shorts';
import type { SocialProduct } from './telegram';

/**
 * El reel de hoy para TikTok y YouTube (lib/social/shorts): solo el que ya
 * salió en Instagram o Facebook, con el mismo precio, 1 al día por red, sin
 * repetir producto en 14 días y sin pasar el cupo gratis de Metricool.
 */

/** Jueves 5 de noviembre de 2026, 13:00 en Chile. */
const NOW = new Date('2026-11-05T16:00:00Z');
const SITE = 'https://www.comparatech.cl';
const ID = '00000000-0000-4000-8000-000000000001';
const VIDEO = 'https://x.supabase.co/storage/v1/object/public/reels/2026-11-05/v.mp4';

function product(over: Partial<SocialProduct> = {}): SocialProduct {
  return {
    id: ID,
    slug: 'audifonos-x',
    name: 'Audífonos Bluetooth Soundcore Q20i',
    brand: 'Soundcore',
    category: 'audio',
    price: 39_990,
    original_price: 59_990,
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-O.webp',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: 'MLC123',
    ml_family_id: null,
    price_checked_at: '2026-11-05T15:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    seller_reputation: 'verde',
    seller_sales_count: 10_000,
    is_active: true,
    is_hidden: false,
    offer_info: { free_shipping: true, is_full: false },
    ml_root_category: null,
    deleted_at: null,
    ...over,
  } as SocialProduct;
}

function state(over: Partial<DailyState> = {}): DailyState {
  return {
    day: 20261105,
    productId: ID,
    name: 'Audífonos Soundcore Q20i',
    price: 39_990,
    videoUrl: VIDEO,
    instagram: { status: 'publicado', at: '2026-11-05T14:06:00Z' },
    facebook: { status: 'publicado', at: '2026-11-05T14:06:00Z' },
    ...over,
  };
}

const input = (over: Partial<ShortsInput> = {}): ShortsInput => ({
  now: NOW,
  siteUrl: SITE,
  state: state(),
  product: product(),
  marks: [],
  monthCount: 0,
  ...over,
});

describe('planShorts', () => {
  it('con el reel de hoy publicado, arma TikTok y YouTube con el video y sus textos', () => {
    const plan = planShorts(input());
    expect(plan.listo).toBe(true);
    expect(plan.video).toBe(VIDEO);
    expect(plan.publicaciones.map((p) => p.red)).toEqual(['tiktok', 'youtube']);
    const [tiktok, youtube] = plan.publicaciones;
    expect(tiktok.metricool.media).toEqual([VIDEO]);
    expect(tiktok.metricool.providers).toEqual([{ network: 'tiktok' }]);
    expect(tiktok.metricool.text).toBe(tiktok.texto);
    expect(tiktok.texto.includes(String.fromCharCode(10))).toBe(false);
    expect(youtube.texto.includes(String.fromCharCode(10))).toBe(true);
    expect(tiktok.metricool.tiktokData).toMatchObject({ commercialContentThirdParty: true, privacyOption: 'PUBLIC_TO_EVERYONE', autoAddMusic: false });
    expect(youtube.metricool.youtubeData).toMatchObject({ type: 'short', privacy: 'public', madeForKids: false });
    expect(String((youtube.metricool.youtubeData as { title: string }).title).length).toBeGreaterThan(0);
    expect(youtube.metricool.text).toBe(youtube.texto);
    for (const p of plan.publicaciones) {
      expect(p.metricool.shortener).toBe(false);
      expect(p.metricool).not.toHaveProperty('videoThumbnailUrl');
      expect(p.texto).not.toMatch(/mejor precio|el más barato|imperdible|solo hoy|precio de lista|publicidad/i);
    }
  });

  it('sin reel de hoy, o sin publicar todavía, no arma nada', () => {
    expect(planShorts(input({ state: null })).listo).toBe(false);
    expect(planShorts(input({ state: state({ day: 20261104 }) })).motivo).toMatch(/todavía no sale/);
    const pending = state({ instagram: { status: 'procesando', at: '' }, facebook: { status: 'error', at: '' } });
    expect(planShorts(input({ state: pending })).motivo).toMatch(/no está publicado/);
    // Con una sola red publicada basta.
    expect(planShorts(input({ state: state({ facebook: { status: 'error', at: '' } }) })).listo).toBe(true);
  });

  it('si el precio cambió, el producto no está a la venta o el precio es viejo, no sale', () => {
    expect(planShorts(input({ product: product({ price: 35_990 }) })).motivo).toMatch(/precio cambió/);
    expect(planShorts(input({ product: product({ is_active: false }) })).motivo).toMatch(/no está a la venta/);
    expect(planShorts(input({ product: null })).listo).toBe(false);
    expect(planShorts(input({ product: product({ price_checked_at: '2026-11-05T06:00:00Z' }) })).motivo).toMatch(/no se revisó/);
  });

  it('1 al día por red y sin repetir producto en 14 días', () => {
    const today = planShorts(input({ marks: [{ channel: 'youtube', productId: 'otro', postedAt: '2026-11-05T13:00:00Z' }] }));
    expect(today.publicaciones.map((p) => p.red)).toEqual(['tiktok']);
    expect(today.omitidas).toEqual([{ red: 'youtube', motivo: 'hoy ya salió un video en esta red' }]);

    const repeated = planShorts(input({ marks: [{ channel: 'tiktok', productId: ID, postedAt: '2026-10-28T16:00:00Z' }] }));
    expect(repeated.publicaciones.map((p) => p.red)).toEqual(['youtube']);
    expect(repeated.omitidas[0].motivo).toMatch(/14 días/);

    const old = planShorts(input({ marks: [{ channel: 'tiktok', productId: ID, postedAt: '2026-10-15T16:00:00Z' }] }));
    expect(old.publicaciones).toHaveLength(2);
  });

  it('no pasa el cupo gratis del mes y sin conteo no programa', () => {
    const one = planShorts(input({ monthCount: METRICOOL_MONTHLY_FREE - 1 }));
    expect(one.publicaciones.map((p) => p.red)).toEqual(['tiktok']);
    expect(one.omitidas[0].motivo).toMatch(/cupo/);
    expect(planShorts(input({ monthCount: METRICOOL_MONTHLY_FREE })).listo).toBe(false);
    expect(planShorts(input({ monthCount: null })).motivo).toMatch(/contar/);
  });
});

describe('shortsMetricoolInfo', () => {
  it('YouTube lleva título y descripción; TikTok, el texto de TikTok', () => {
    const texts = { tiktok: 'tt', youtubeTitle: 'Título', youtubeDescription: 'desc' };
    expect(shortsMetricoolInfo('tiktok', VIDEO, texts).text).toBe('tt');
    const yt = shortsMetricoolInfo('youtube', VIDEO, texts);
    expect(yt.text).toBe('desc');
    expect((yt.youtubeData as { title: string }).title).toBe('Título');
  });
});

describe('chileMonthStart', () => {
  it('la medianoche del día 1 en Chile, con o sin horario de verano', () => {
    expect(chileMonthStart(NOW).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(chileMonthStart(new Date('2026-07-15T12:00:00Z')).toISOString()).toBe('2026-07-01T04:00:00.000Z');
    // El 1 de diciembre a las 00:30 de Chile ya es diciembre.
    expect(chileMonthStart(new Date('2026-12-01T03:30:00Z')).toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });
});
