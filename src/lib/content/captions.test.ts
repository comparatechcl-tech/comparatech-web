import { describe, expect, it, vi } from 'vitest';
import {
  DISCLOSURE,
  buildCaption,
  captionDiscount,
  chileDateTime,
  formatPrice,
  mlPhotoJpg,
  pickHook,
  type CaptionChannel,
  type CaptionProduct,
} from './captions';

const CHANNELS: CaptionChannel[] = ['instagram', 'tiktok', 'whatsapp', 'telegram', 'facebook'];

const base: CaptionProduct = {
  id: '6f1d1a52-6f0e-4c4b-9a43-1d2f3c4b5a60',
  slug: 'audifonos-xyz',
  name: 'Audífonos Bluetooth Inalámbricos Xyz Pro Con Cancelación De Ruido - Color Negro',
  category: 'audio',
  price: 27990,
  original_price: 69990,
  // 17:30 UTC del 4 de octubre = 14:30 en Chile (UTC-3, horario de verano).
  price_checked_at: '2026-10-04T17:30:04.508+00:00',
  seller_reputation: 'verde',
  seller_sales_count: 120,
  offer_info: { free_shipping: true, is_full: false },
};

const opts = {
  now: new Date('2026-10-04T18:00:00Z'),
  siteUrl: 'https://comparatech.cl/',
  link: 'https://meli.la/abc123',
};

describe('buildCaption', () => {
  it('sin descuento no muestra porcentaje ni precio de lista', () => {
    const noDiscount = { ...base, original_price: null };
    for (const channel of CHANNELS) {
      const text = buildCaption(noDiscount, channel, opts);
      expect(text).not.toContain('%');
      expect(text).not.toContain('precio de lista');
    }
    // Un precio de lista menor o igual tampoco es una rebaja.
    const fake = buildCaption({ ...base, original_price: 20000 }, 'whatsapp', opts);
    expect(fake).not.toContain('%');
  });

  it('con descuento muestra el precio de lista y el porcentaje, sin llamarlo "antes"', () => {
    const text = buildCaption(base, 'whatsapp', opts);
    expect(text).toContain('$27.990 (precio de lista $69.990 / -60%)');
    expect(text).not.toContain('antes $');
  });

  it('#ofertas va solo si el producto tiene descuento', () => {
    for (const channel of ['instagram', 'tiktok', 'facebook'] as const) {
      expect(buildCaption(base, channel, opts)).toContain('#ofertas');
      const text = buildCaption({ ...base, original_price: null }, channel, opts);
      expect(text).not.toContain('#ofertas');
      expect(text).toContain('#tecnologia');
    }
  });

  it('la fecha y la hora del precio son las de Chile', () => {
    const text = buildCaption(base, 'instagram', opts);
    expect(text).toContain('Precio revisado el 04/10 a las 14:30 (hora de Chile); puede cambiar.');
    // Cerca de medianoche UTC el día en Chile todavía es el anterior.
    const late = buildCaption({ ...base, price_checked_at: '2026-10-05T01:15:00Z' }, 'instagram', opts);
    expect(late).toContain('el 04/10 a las 22:15');
  });

  it('el aviso de publicidad va siempre, como última línea y aparte de los hashtags', () => {
    for (const channel of CHANNELS) {
      const text = buildCaption(base, channel, opts);
      const lines = text.split('\n');
      expect(lines[lines.length - 1]).toBe(DISCLOSURE);
      expect(lines[lines.length - 2]).toBe('');
      expect(text).toContain('#publicidad');
    }
  });

  it('sin fecha de revisión no inventa una', () => {
    const text = buildCaption({ ...base, price_checked_at: null }, 'whatsapp', opts);
    expect(text).not.toContain('Precio revisado');
    expect(text).toContain('Precio sujeto a cambios');
  });

  it('links clicables solo donde el canal los permite', () => {
    for (const channel of ['whatsapp', 'telegram', 'facebook'] as const) {
      const text = buildCaption(base, channel, opts);
      expect(text).toContain('https://meli.la/abc123');
      expect(text).toContain(`https://comparatech.cl/producto/audifonos-xyz?src=${channel}`);
    }
    for (const channel of ['instagram', 'tiktok'] as const) {
      const text = buildCaption(base, channel, opts);
      expect(text).not.toContain('https://');
      expect(text).toContain('Link en la bio 👉 comparatech');
    }
  });

  it('usa el nombre corto y avisa el envío gratis solo si es real', () => {
    const text = buildCaption(base, 'telegram', opts);
    expect(text).not.toContain('Color Negro');
    expect(text).toContain('🚚 Envío gratis');
    expect(buildCaption({ ...base, offer_info: null }, 'telegram', opts)).not.toContain('Envío gratis');
  });

  it('el gancho es estable en el día y depende del producto', () => {
    const a = pickHook(base, opts.now);
    expect(pickHook(base, new Date('2026-10-04T23:00:00Z'))).toBe(a);
    const hooks = new Set(
      Array.from({ length: 30 }, (_, i) => pickHook({ ...base, id: `producto-${i}` }, opts.now))
    );
    expect(hooks.size).toBeGreaterThan(2);
  });
});

describe('ayudantes', () => {
  it('formatPrice usa punto de miles', () => {
    expect(formatPrice(1234567)).toBe('$1.234.567');
    expect(formatPrice(990)).toBe('$990');
  });

  it('captionDiscount es 0 sin rebaja real', () => {
    expect(captionDiscount({ price: 100, original_price: null })).toBe(0);
    expect(captionDiscount({ price: 100, original_price: 100 })).toBe(0);
    expect(captionDiscount({ price: 80, original_price: 100 })).toBe(20);
  });

  it('chileDateTime respeta el horario de invierno', () => {
    // 15 de junio: Chile en UTC-4.
    expect(chileDateTime('2026-06-15T16:05:00Z')).toEqual({ date: '15/06', time: '12:05' });
    expect(chileDateTime('no es fecha')).toBeNull();
  });

  it('mlPhotoJpg pide la foto grande en https y jpg', () => {
    expect(mlPhotoJpg('http://http2.mlstatic.com/D_NQ_NP_1-MLA2_112025-O.webp')).toBe(
      'https://http2.mlstatic.com/D_NQ_NP_1-MLA2_112025-F.jpg'
    );
    expect(mlPhotoJpg('https://otro.com/foto-O.jpg')).toBe('https://otro.com/foto-O.jpg');
  });
});

// lib/settings usa cache() de React, que fuera de Next no existe.
vi.mock('@/lib/settings', () => ({
  readAffiliateSettings: async () => ({ word: null, tool: null, directLinks: false }),
}));

// La selección y el pie de foto de Telegram se arman con buildCaption: se
// prueban acá para no sumar otro archivo de tests.
describe('Telegram', async () => {
  const { pickForTelegram, telegramCaption, syncTelegramPosts, TELEGRAM_CAPTION_MAX } = await import(
    '@/lib/social/telegram'
  );
  type Row = Parameters<typeof pickForTelegram>[0][number];

  const now = new Date('2026-10-04T18:00:00Z');
  const fresh = '2026-10-04T16:00:00Z';
  const row = (over: Partial<Row>): Row => ({
    ...base,
    brand: 'Marca',
    category: 'audio',
    image_url: 'https://http2.mlstatic.com/D_NQ_NP_1-MLA2_112025-F.jpg',
    affiliate_url: 'https://meli.la/abc',
    ml_product_id: 'MLC123',
    is_active: true,
    is_hidden: false,
    deleted_at: null,
    price_checked_at: fresh,
    ...over,
  });

  it('elige con descuento real y precio fresco, máximo 2 por categoría y 5 en total', () => {
    const rows = [
      ...Array.from({ length: 4 }, (_, i) => row({ id: `a${i}`, category: 'audio', price: 10000 + i })),
      ...Array.from({ length: 3 }, (_, i) => row({ id: `c${i}`, category: 'computacion', price: 50000 + i })),
      row({ id: 'g1', category: 'gaming', price: 90000, original_price: 120000 }),
      row({ id: 'viejo', category: 'hogar', price_checked_at: '2026-10-04T08:00:00Z' }),
      row({ id: 'sin-dcto', category: 'hogar', original_price: null }),
      row({ id: 'oculto', category: 'hogar', is_hidden: true }),
      row({ id: 'repetido', category: 'electronica' }),
    ];
    const picks = pickForTelegram(rows, { now, recentlyPosted: new Set(['repetido']) });
    const ids = picks.map((p) => p.product.id);
    expect(ids).toHaveLength(5);
    expect(ids.filter((id) => id.startsWith('a'))).toHaveLength(2);
    expect(ids.filter((id) => id.startsWith('c'))).toHaveLength(2);
    expect(ids).toContain('g1');
    for (const excluded of ['viejo', 'sin-dcto', 'oculto', 'repetido']) expect(ids).not.toContain(excluded);
    // Primero lo que más comisión deja (a igual tasa, el más caro).
    expect(ids[0]).toBe('g1');
  });

  it('acepta una baja confirmada por el historial aunque no haya descuento de lista', () => {
    const rows = [row({ id: 'baja', original_price: null })];
    expect(pickForTelegram(rows, { now, recentlyPosted: new Set() })).toHaveLength(0);
    const picks = pickForTelegram(rows, { now, recentlyPosted: new Set(), drops: new Map([['baja', 12]]) });
    expect(picks.map((p) => p.product.id)).toEqual(['baja']);
  });

  it('no publica dos colores del mismo modelo', () => {
    const rows = [row({ id: 'negro', ml_family_id: 'F1' }), row({ id: 'blanco', ml_family_id: 'F1' })];
    expect(pickForTelegram(rows, { now, recentlyPosted: new Set() })).toHaveLength(1);
  });

  it('el pie de foto escapa HTML, cabe en 1024 y conserva el aviso', () => {
    const caption = telegramCaption(row({ name: 'Parlante <b>Pro</b> & Más' }), 'https://meli.la/abc', now);
    expect(caption).toContain('&lt;b&gt;Pro&lt;/b&gt; &amp; Más');
    expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX);
    expect(caption).toContain('#publicidad');
  });

  it('sin token no hace nada', async () => {
    const prev = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    const admin = { from: () => { throw new Error('no debería leer la base'); } };
    const result = await syncTelegramPosts(admin as never);
    expect(result).toEqual({ edited: 0, skipped: 'Falta TELEGRAM_BOT_TOKEN' });
    if (prev !== undefined) process.env.TELEGRAM_BOT_TOKEN = prev;
  });
});
