import { describe, expect, it, vi } from 'vitest';
import { hasForbiddenWord } from '@/lib/social/interest';
import {
  YOUTUBE_TITLE_MAX,
  buildCaption,
  buildVideoTexts,
  captionDiscount,
  chileDateTime,
  formatPrice,
  mlPhotoJpg,
  pickHook,
  youtubeTitle,
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
  it('sin descuento no muestra porcentaje ni cifra tachada', () => {
    const noDiscount = { ...base, original_price: null };
    for (const channel of CHANNELS) {
      const text = buildCaption(noDiscount, channel, opts);
      expect(text).not.toContain('%');
      expect(text).not.toContain('sin descuento $');
      expect(text).not.toContain('precio de lista');
    }
    // Un precio de lista menor o igual tampoco es una rebaja.
    const fake = buildCaption({ ...base, original_price: 20000 }, 'whatsapp', opts);
    expect(fake).not.toContain('%');
    expect(fake).not.toContain('sin descuento');
  });

  it('con descuento muestra el porcentaje y la cifra tachada como "sin descuento", nunca "antes" ni "precio de lista"', () => {
    for (const channel of CHANNELS) {
      const text = buildCaption(base, channel, opts);
      expect(text).toContain('💰 $27.990 (-60%, sin descuento $69.990)');
      expect(text).not.toContain('antes $');
      expect(text).not.toMatch(/precio de lista|precio normal|rebajado/i);
      // "descuento" no va dos veces en la misma línea.
      for (const line of text.split('\n')) expect(line.match(/descuento/gi)?.length ?? 0).toBeLessThanOrEqual(1);
    }
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

  it('no lleva la etiqueta "Publicidad" (decisión del dueño) y parte con el gancho', () => {
    for (const channel of CHANNELS) {
      const text = buildCaption(base, channel, opts);
      expect(text).not.toMatch(/publicidad/i);
      expect(text.split('\n')[0]).toBe(pickHook(base, opts.now));
    }
  });

  it('ningún texto menciona la comisión (decisión del dueño, 18-10-2026)', () => {
    for (const channel of CHANNELS) {
      expect(buildCaption(base, channel, opts)).not.toMatch(/comisi[oó]n/i);
    }
  });

  it('los hashtags van al final, en su propia línea y separados del resto', () => {
    for (const channel of CHANNELS) {
      const lines = buildCaption(base, channel, opts).split('\n');
      const tagLine = lines.findIndex((l) => l.startsWith('#'));
      if (tagLine < 0) continue;
      expect(tagLine).toBe(lines.length - 1);
      expect(lines[tagLine - 1]).toBe('');
    }
  });

  it('Instagram no pasa de cinco hashtags', () => {
    const tags = buildCaption(base, 'instagram', opts).match(/#[a-z0-9]+/g) ?? [];
    expect(tags.length).toBeLessThanOrEqual(5);
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
      expect(text).toMatch(/^🛒 /m);
    }
  });

  it('donde el link no se puede tocar, el perfil y el nombre del sitio, sin el link corto (dueño, 18-10-2026)', () => {
    // Los productos del sitio traen su código de Mercado Libre: igual no sale el link corto.
    const withId = { ...base, ml_product_id: 'MLC78729874' } as CaptionProduct;
    const instagram = buildCaption(withId, 'instagram', opts);
    const tiktok = buildCaption(withId, 'tiktok', opts);
    expect(instagram).toContain('🛒 Link de compra en nuestra bio, o búscalo en comparatech.cl');
    expect(tiktok).toContain('🛒 Para comprarlo, búscalo en comparatech.cl');
    for (const text of [instagram, tiktok]) expect(text).not.toMatch(/\/p\/|78729874/);
    // En el computador el sitio es localhost: esa dirección no se escribe.
    const local = { ...opts, siteUrl: 'http://localhost:3000' };
    expect(buildCaption(base, 'instagram', local)).toContain('🛒 Link de compra en nuestra bio\n');
    expect(buildCaption(base, 'tiktok', local)).toContain('🛒 Para comprarlo, búscalo en comparatech.cl');
    expect(buildCaption(base, 'instagram', local)).not.toContain('localhost');
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

describe('buildVideoTexts', () => {
  const texts = buildVideoTexts(base, opts.now);
  const all = [texts.instagram, texts.tiktok, texts.facebook, texts.youtubeTitle, texts.youtubeDescription];
  const WEB_ADDRESS = /https?:|www\.|\.(cl|com|la|app|net|org)\b/i;

  it('Instagram y TikTok llevan el texto de siempre', () => {
    const withSite = buildVideoTexts(base, opts.now, opts.siteUrl);
    expect(withSite.instagram).toBe(buildCaption(base, 'instagram', opts));
    expect(withSite.tiktok).toBe(buildCaption(base, 'tiktok', opts));
  });

  it('Facebook dice lo mismo que Instagram, mandando al perfil, sin link para tocar', () => {
    expect(texts.facebook).not.toMatch(WEB_ADDRESS);
    expect(texts.facebook).toContain('🛒 Link de compra en nuestro perfil');
    expect(texts.facebook).not.toContain('bio');
    // Ni el link de compra ni el de la ficha, que es lo que lleva el texto de Facebook del feed.
    const feed = buildCaption(base, 'facebook', opts);
    expect(feed).toMatch(WEB_ADDRESS);
    expect(texts.facebook).not.toContain('Ver en Mercado Libre');
    expect(texts.facebook).not.toContain('Compara en ComparaTech');

    const ig = texts.instagram.split('\n');
    const fb = texts.facebook.split('\n');
    expect(fb).toHaveLength(ig.length);
    const different = fb.filter((line, i) => line !== ig[i]);
    expect(different).toEqual(['🛒 Link de compra en nuestro perfil']);
  });

  it('ningún texto de un reel lleva un link para tocar ni el link corto; con el sitio, dicen su nombre', () => {
    for (const text of all) expect(text).not.toMatch(/https?:|www\./i);
    const withSite = buildVideoTexts({ ...base, ml_product_id: 'MLC78729874' } as CaptionProduct, opts.now, 'https://www.comparatech.cl');
    for (const text of [withSite.instagram, withSite.tiktok, withSite.facebook, withSite.youtubeDescription]) {
      expect(text).toContain('búscalo en comparatech.cl');
      expect(text).not.toMatch(/https?:|www\.|\/p\/|78729874/i);
    }
    expect(withSite.facebook).toContain('🛒 Link de compra en nuestro perfil, o búscalo en comparatech.cl');
    expect(withSite.youtubeTitle).not.toContain('comparatech.cl');
  });

  it('la descripción de YouTube es la de TikTok, diciendo dónde está el link de compra', () => {
    expect(texts.youtubeDescription).toContain('🛒 Link de compra en el perfil del canal');
    expect(texts.youtubeDescription).not.toContain('bio');
    const tk = texts.tiktok.split('\n');
    const yt = texts.youtubeDescription.split('\n');
    expect(yt.filter((line, i) => line !== tk[i])).toEqual(['🛒 Link de compra en el perfil del canal']);
    const withSite = buildVideoTexts(base, opts.now, 'https://www.comparatech.cl');
    expect(withSite.youtubeDescription).toContain('🛒 Link de compra en el perfil del canal, o búscalo en comparatech.cl');
  });

  it('todos los textos largos conservan la hora del precio, sin "Publicidad" ni la comisión', () => {
    for (const text of [texts.instagram, texts.tiktok, texts.facebook, texts.youtubeDescription]) {
      expect(text).toContain('Precio revisado el 04/10 a las 14:30 (hora de Chile); puede cambiar.');
      expect(text).not.toMatch(/publicidad/i);
      expect(text).not.toMatch(/comisi[oó]n/i);
      expect(text.indexOf('Precio revisado')).toBeLessThan(text.indexOf('#ofertas'));
    }
  });

  it('el título de YouTube dice qué es, el precio y el descuento ("con 60% de descuento")', () => {
    // El nombre se corta en una palabra entera (y sin dejar un "De" colgando); el color no va.
    expect(texts.youtubeTitle).toBe(
      'Audífonos Bluetooth Inalámbricos Xyz Pro Con Cancelación a $27.990 con 60% de descuento'
    );
    expect(texts.youtubeTitle).not.toContain('precio de lista');

    // Sin descuento real no hay porcentaje.
    expect(youtubeTitle({ ...base, original_price: null })).toMatch(/ a \$27\.990$/);
    expect(youtubeTitle({ ...base, original_price: 20_000 })).not.toContain('%');
  });

  it('el título nunca pasa de 90 caracteres, y lo que se acorta es el nombre', () => {
    expect(YOUTUBE_TITLE_MAX).toBe(90);
    const names = [
      base.name,
      'Smart TV Samsung Crystal UHD 4K 65 Pulgadas Con Control De Voz Y Sistema Operativo Tizen Modelo 2026 Negro',
      'Notebook',
      `Palabra${'larguísima'.repeat(20)}`,
      'Refrigerador Side By Side (No Frost, 578 Litros, Dispensador De Agua, Inverter) Acero Inoxidable',
    ];
    const prices: [number, number | null][] = [
      [990, null],
      [27_990, 69_990],
      [1_299_990, 2_599_990],
      [2_147_483_647, null],
      [12_999_990, 99_999_990],
    ];
    for (const name of names) {
      for (const [price, original_price] of prices) {
        const title = youtubeTitle({ name, price, original_price });
        expect(title.length).toBeLessThanOrEqual(YOUTUBE_TITLE_MAX);
        // El precio y el descuento van siempre enteros.
        expect(title).toContain(` a ${formatPrice(price)}`);
        const discount = captionDiscount({ price, original_price });
        if (discount > 0) expect(title.endsWith(` con ${discount}% de descuento`)).toBe(true);
        expect(title.trim()).toBe(title);
      }
    }
  });

  it('el título no lleva las palabras que el sitio no usa, aunque vengan en el nombre', () => {
    expect(hasForbiddenWord(texts.youtubeTitle)).toBe(false);
    for (const text of all) expect(hasForbiddenWord(text)).toBe(false);

    const loud = [
      'Audífonos Sony WH-CH520 ¡Imperdible! Oferton Solo Hoy',
      'Parlante JBL Go 4 Mejor Precio - El Más Barato',
      'Smartwatch Xiaomi Rebajado Antes Ahorra',
      'Tablet Lenovo Recomendado Últimas Unidades Precio Normal',
      // Al sacar la del medio no pueden quedar juntas otras dos.
      'Mouse Logitech Solo Imperdible Hoy M170',
      'IMPERDIBLE',
    ];
    for (const name of loud) {
      const title = youtubeTitle({ name, price: 19_990, original_price: 39_990 });
      expect(hasForbiddenWord(title)).toBe(false);
      expect(title).toContain(' a $19.990 con 50% de descuento');
    }
    expect(youtubeTitle({ name: loud[0], price: 19_990, original_price: null })).toBe('Audífonos Sony WH-CH520 a $19.990');
    expect(youtubeTitle({ name: 'IMPERDIBLE', price: 19_990, original_price: null })).toBe('Producto a $19.990');
    // Un nombre limpio no se toca.
    expect(youtubeTitle({ name: 'Parlante JBL Go 4', price: 19_990, original_price: null })).toBe('Parlante JBL Go 4 a $19.990');
  });

  it('el título y los textos llevan el nombre de redes, sin el código de fábrica (pedido del dueño, 18-10-2026)', () => {
    const watch = { ...base, name: 'Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3 - Color Negro' };
    const watchTexts = buildVideoTexts(watch, opts.now);
    expect(watchTexts.youtubeTitle).toBe('Samsung Smartwatch Galaxy Fit 3 a $27.990 con 60% de descuento');
    for (const text of [watchTexts.instagram, watchTexts.tiktok, watchTexts.facebook, watchTexts.youtubeDescription]) {
      expect(text.split('\n')).toContain('Samsung Smartwatch Galaxy Fit 3');
      expect(text).not.toContain('Asm-r390nidalta');
    }
    // El código que dice con qué calza un repuesto se queda también en el título.
    expect(youtubeTitle({ name: 'Cargador Para Notebook Lenovo Adlx65ndc3a 20v 3.25a', price: 19_990, original_price: null })).toBe(
      'Cargador Para Notebook Lenovo Adlx65ndc3a 20v 3.25a a $19.990'
    );
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

// El pie de foto de Telegram se arma con buildCaption: se prueba acá para no
// sumar otro archivo de tests. La selección (pickForTelegram) se prueba en
// lib/social/pick.test.ts.
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

  it('el pie de foto escapa HTML, cabe en 1024 y no menciona la comisión', () => {
    const caption = telegramCaption(row({ name: 'Parlante <b>Pro</b> & Más' }), 'https://meli.la/abc', now);
    expect(caption).toContain('&lt;b&gt;Pro&lt;/b&gt; &amp; Más');
    expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX);
    expect(caption).not.toMatch(/comisi[oó]n/i);
  });

  it('si el pie no cabe, saca los links enteros y conserva el precio y su hora', () => {
    // Un link pegado a mano con parámetros de seguimiento puede medir más que el pie entero.
    const longLink = `https://articulo.mercadolibre.cl/MLC-1?${'x'.repeat(1300)}`;
    const caption = telegramCaption(row({}), longLink, now);
    expect(caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX);
    expect(caption).toContain('Precio revisado el');
    // Ni un link a medias (perdería los parámetros de afiliado) ni el de la ficha.
    expect(caption).not.toContain('https://');

    // Si basta con sacar el link a la ficha, el de compra se queda completo.
    // Tan largo que con los dos links no cabe, y sin el de la ficha sí.
    const mediumLink = `https://articulo.mercadolibre.cl/MLC-1?${'x'.repeat(710)}`;
    const medium = telegramCaption(row({}), mediumLink, now);
    expect(medium.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX);
    expect(medium).toContain(mediumLink);
    expect(medium).not.toContain('Compara en ComparaTech');
    expect(medium).toContain('Precio revisado el');
  });

  it('sacar el link a la ficha no se lleva el gancho que empieza con el mismo emoji', () => {
    const longLink = `https://articulo.mercadolibre.cl/MLC-1?${'x'.repeat(1300)}`;
    // Un producto sin descuento ni vendedor destacado usa los ganchos de "precio", entre ellos "🔎 Míralo antes de comprar".
    const plain = row({ original_price: null, seller_sales_count: 10 });
    const hooks = new Set<string>();
    for (let day = 1; day <= 20; day++) {
      const at = new Date(Date.UTC(2026, 9, day, 15));
      const full = buildCaption(plain, 'telegram', { now: at, siteUrl: 'https://sitio.test', link: longLink });
      const cut = telegramCaption(plain, longLink, at).split('\n');
      // La primera línea es el mismo gancho del texto completo.
      expect(cut[0]).toBe(full.split('\n')[0]);
      hooks.add(cut[0]);
    }
    expect([...hooks]).toContain('🔎 Míralo antes de comprar');
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
