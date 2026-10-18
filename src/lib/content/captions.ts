/**
 * Textos para redes sociales, uno por canal.
 *
 * Antes cada post se escribía a mano y por eso no se publicaba nada: con un
 * texto listo en un clic, publicar cuesta un par de minutos. Todos los
 * textos dicen que el precio es el de una hora concreta (en Mercado Libre
 * cambia varias veces al día).
 *
 * Puro y sin I/O a propósito: lo usan el admin (cliente), el cron de
 * Telegram y los tests, con la misma salida para la misma entrada.
 */

import { normalizeName } from '@/lib/text';
import { socialProductName } from '@/lib/content/social-name';
import { FORBIDDEN_WORDS } from '@/lib/social/interest-tables';

export type CaptionChannel = 'instagram' | 'tiktok' | 'whatsapp' | 'telegram' | 'facebook';

/** Lo que el texto necesita del producto. */
export interface CaptionProduct {
  id: string;
  slug: string;
  name: string;
  category?: string | null;
  price: number;
  original_price: number | null;
  price_checked_at: string | null;
  seller_reputation?: string | null;
  seller_sales_count?: number | null;
  offer_info?: { free_shipping?: boolean | null; is_full?: boolean | null } | null;
  /** Para el nombre en redes (lib/content/social-name): tipo, marca y modelo cuando el nombre parte con un código. */
  brand?: string | null;
  ml_domain_id?: string | null;
  specs?: Record<string, unknown> | null;
}

export interface CaptionOptions {
  now: Date;
  siteUrl: string;
  /** Link de compra (buyUrl / resolveOutboundUrl): el mismo que usa el sitio. */
  link: string;
}

// Sin etiqueta "Publicidad" (el dueño la sacó el 11-10-2026) ni frase de la
// comisión (la sacó el 18-10-2026, sabiendo que el SERNAC recomienda
// identificar el contenido comercial): los textos no la llevan. En TikTok
// sigue el interruptor de contenido comercial de la propia plataforma, que no
// es texto. La comisión se menciona solo en /terminos.

/** Comienzo de las dos líneas con link. Telegram las busca para sacarlas si el texto no cabe. */
export const BUY_LINK_PREFIX = '👉 Ver en Mercado Libre:';
export const SITE_LINK_PREFIX = '🔎 Compara en ComparaTech:';
/**
 * Comienzo de la línea de compra donde el texto no admite links (Instagram,
 * TikTok y los reels): dice dónde está el link (el del perfil) y el nombre
 * del sitio. Los textos de un reel la cambian por la de su red.
 */
const BUY_LINE_PREFIX = '🛒 ';

/** Dónde está el link de compra en cada red donde no se puede tocar en el texto. */
type BuyLineWhere = 'instagram' | 'tiktok' | 'facebook-reel' | 'youtube';

/**
 * El sitio como se escribe ("comparatech.cl"), sin "https://" ni "www.", o
 * null si `siteUrl` no es la dirección de un sitio público: en el computador
 * y en las pruebas es localhost:3000, que no se le dice a nadie.
 */
function siteName(siteUrl: string): string | null {
  try {
    const { hostname, port } = new URL(siteUrl);
    if (port || !hostname.includes('.') || /^[\d.]+$/.test(hostname)) return null;
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * La línea de compra: el link del perfil, que lleva a /hoy, y el nombre del
 * sitio, fácil de recordar. Sin el link corto de cada producto
 * (comparatech.cl/p/…): el dueño lo sacó el 18-10-2026, porque un link que no
 * se puede tocar nadie lo escribe a mano.
 */
function buyLine(siteUrl: string, where: BuyLineWhere): string {
  const site = siteUrl ? siteName(siteUrl) : null;
  const orSite = site ? `, o búscalo en ${site}` : '';
  switch (where) {
    case 'instagram':
      return `🛒 Link de compra en nuestra bio${orSite}`;
    case 'tiktok':
      // TikTok todavía no deja link en el perfil (pide 1.000 seguidores o cuenta de empresa verificada).
      return `🛒 Para comprarlo, búscalo en ${site ?? 'comparatech.cl'}`;
    case 'facebook-reel':
      return `🛒 Link de compra en nuestro perfil${orSite}`;
    case 'youtube':
      return `🛒 Link de compra en el perfil del canal${orSite}`;
  }
}

const CHILE_TZ = 'America/Santiago';

/** Descuento sobre el precio de lista. 0 si no hay rebaja real. */
export function captionDiscount(p: Pick<CaptionProduct, 'price' | 'original_price'>): number {
  if (!p.original_price || p.original_price <= p.price || p.price <= 0) return 0;
  return Math.round((1 - p.price / p.original_price) * 100);
}

/** "$12.990". Sin depender de los datos de idioma del entorno (Telegram corre en Node). */
export function formatPrice(value: number): string {
  const digits = String(Math.round(Math.abs(value)));
  return `$${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/**
 * Fecha y hora de un instante en Chile: {date: '04/10', time: '14:30'}.
 * Se arma por partes porque es-CL escribe la fecha con guiones.
 */
export function chileDateTime(iso: string | Date | null | undefined): { date: string; time: string } | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TZ,
    hourCycle: 'h23',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('day')}/${get('month')}`, time: `${get('hour')}:${get('minute')}` };
}

/** Fecha AAAA-MM-DD en Chile: el gancho cambia una vez al día, no cada hora. */
function chileDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** FNV-1a de 32 bits: estable entre navegador y servidor, sin crypto. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type HookKind = 'oferta' | 'top' | 'precio';

/**
 * Ganchos por tipo de post. Ninguno afirma algo que no se pueda sostener:
 * se habla de "descuento", lo mismo que muestra Mercado Libre con la cifra
 * tachada que pone el vendedor (no "bajó" ni "rebajado", que exigirían
 * historial, ni "antes" o "precio normal", que afirmarían que se vendía a
 * esa cifra), y "top" habla del vendedor, que es lo que el dato
 * seller_sales_count mide.
 */
const HOOKS: Record<HookKind, string[]> = {
  oferta: [
    // Sin "hoy": se lee como una oferta del día, y sin historial de precios
    // no se puede afirmar.
    '🔥 Con descuento en Mercado Libre',
    '⚡ Viene con descuento',
    '👀 Ojo con este descuento',
    // Sin la palabra "descuento": el renglón del precio ya dice "sin
    // descuento $X", y en TikTok todo va en un párrafo.
    '💸 Vale la pena mirarlo',
    '🛒 Para aprovechar mientras dure',
    '🏷️ Con descuento en este momento',
  ],
  top: [
    '⭐ De un vendedor con reputación verde y miles de ventas',
    '✅ Vendedor con reputación verde y miles de ventas',
    // Sin "top" ni "confiable": son un aval que el sitio no puede dar. Lo
    // que consta es la reputación verde y las ventas que informa ML.
    '🏆 Vendedor con miles de ventas en Mercado Libre',
    '🤝 Miles de ventas y reputación verde en Mercado Libre',
    '👍 Lo vende alguien con reputación verde',
  ],
  precio: [
    '💡 Dato de precio',
    // Antes "Lo comparamos por ti": nadie compara producto por producto.
    '🔎 Míralo antes de comprar',
    '📌 Ojo con este precio',
    '🛒 Para tener en el radar',
    '✅ Precio actual en Mercado Libre',
    '👇 Mira cuánto cuesta',
  ],
};

/** Desde este descuento el post se presenta como oferta. */
const OFFER_HOOK_MIN_DISCOUNT = 10;
/** Ventas del vendedor desde las que se habla de "miles de ventas". */
const TOP_SELLER_MIN_SALES = 5000;

export function hookKind(p: CaptionProduct): HookKind {
  if (captionDiscount(p) >= OFFER_HOOK_MIN_DISCOUNT) return 'oferta';
  if (p.seller_reputation === 'verde' && (p.seller_sales_count ?? 0) >= TOP_SELLER_MIN_SALES) return 'top';
  return 'precio';
}

/**
 * Mismo gancho para el mismo producto durante el día (si se copia dos veces
 * sale igual), distinto entre productos y entre días: así diez posts
 * seguidos no empiezan todos con la misma frase.
 */
export function pickHook(p: CaptionProduct, now: Date): string {
  const options = HOOKS[hookKind(p)];
  return options[hash(`${p.id}|${chileDayKey(now)}`) % options.length];
}

/** Línea con la hora del precio. Sin fecha conocida no se inventa una. */
export function priceCheckedLine(priceCheckedAt: string | null): string {
  const at = chileDateTime(priceCheckedAt);
  if (!at) return 'Precio sujeto a cambios en Mercado Libre.';
  return `Precio revisado el ${at.date} a las ${at.time} (hora de Chile); puede cambiar.`;
}

/**
 * "45% de descuento": como se dice un descuento en todo lo que se publica
 * (dueño, 14/10/2026). Es el que muestra Mercado Libre sobre la cifra tachada
 * que pone el vendedor. Una baja medida con el historial propio NO es un
 * descuento y nunca se dice así ("bajó 12% según nuestro historial").
 */
export function discountPhrase(discount: number): string {
  return `${discount}% de descuento`;
}

function priceLine(p: CaptionProduct): string {
  const discount = captionDiscount(p);
  const base = `💰 ${formatPrice(p.price)}`;
  // La cifra tachada va solo si es mayor: una igual o menor sería una rebaja
  // inventada. Es la que pone el vendedor en Mercado Libre y el sitio no sabe
  // si de verdad lo vendía a ese precio: por eso "sin descuento" y no "antes"
  // ni "precio normal". El porcentaje va como "-60%" y no "60% de descuento",
  // para no decir "descuento" dos veces en la misma línea.
  if (discount > 0 && p.original_price) {
    return `${base} (-${discount}%, sin descuento ${formatPrice(p.original_price)})`;
  }
  return base;
}

function categoryTag(category: string | null | undefined): string | null {
  const clean = (category ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return clean ? `#${clean}` : null;
}

function hashtags(p: CaptionProduct, channel: CaptionChannel): string | null {
  if (channel === 'whatsapp' || channel === 'telegram') return null;
  // #ofertas solo si hay descuento: en un producto sin descuento sería falso.
  const tags = [
    captionDiscount(p) > 0 ? '#ofertas' : null,
    '#tecnologia',
    '#chile',
    '#mercadolibre',
    categoryTag(p.category),
  ].filter((t): t is string => Boolean(t));
  return [...new Set(tags)].join(' ');
}

/** Link a la ficha propia, con el canal para medir de dónde llegan las visitas. */
export function productPageUrl(siteUrl: string, slug: string, channel: CaptionChannel): string {
  return `${siteUrl.replace(/\/+$/, '')}/producto/${slug}?src=${channel}`;
}

export function buildCaption(product: CaptionProduct, channel: CaptionChannel, opts: CaptionOptions): string {
  const lines: string[] = [pickHook(product, opts.now), socialProductName(product), priceLine(product)];
  if (product.offer_info?.free_shipping === true) lines.push('🚚 Envío gratis');
  lines.push(priceCheckedLine(product.price_checked_at));
  lines.push('');

  // Instagram y TikTok no dejan links clicables en el texto: en Instagram, la
  // bio (lleva a /hoy); en los dos, el nombre del sitio.
  if (channel === 'instagram' || channel === 'tiktok') {
    lines.push(buyLine(opts.siteUrl, channel));
  } else {
    lines.push(`${BUY_LINK_PREFIX} ${opts.link}`);
    lines.push(`${SITE_LINK_PREFIX} ${productPageUrl(opts.siteUrl, product.slug, channel)}`);
  }

  const tags = hashtags(product, channel);
  if (tags) {
    lines.push('');
    lines.push(tags);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Textos de un reel: el video corto que se sube a mano desde /admin/videos.

/** Lo que se pega al subir el video en cada red. */
export interface VideoTexts {
  instagram: string;
  tiktok: string;
  facebook: string;
  youtubeTitle: string;
  youtubeDescription: string;
}

/** YouTube admite 100 caracteres de título; con 90 no lo corta en la lista de Shorts. */
export const YOUTUBE_TITLE_MAX = 90;


/**
 * El nombre sin las palabras que el sitio no usa. Los nombres vienen de
 * Mercado Libre y a veces traen "Imperdible" u "Oferton": en un título que
 * firma ComparaTech no van.
 */
function withoutForbiddenWords(name: string): string {
  let tokens = name.split(/\s+/).filter(Boolean);
  // Sacar una palabra puede juntar otras dos ("solo … hoy"): se repite hasta
  // que no quede ninguna. Termina porque cada vuelta saca al menos una.
  for (;;) {
    const words: { text: string; token: number }[] = [];
    tokens.forEach((token, i) => {
      for (const text of normalizeName(token).split(' ')) if (text) words.push({ text, token: i });
    });
    const drop = new Set<number>();
    for (const phrase of FORBIDDEN_WORDS) {
      const target = phrase.split(' ');
      for (let at = 0; at + target.length <= words.length; at++) {
        if (target.every((word, k) => words[at + k].text === word)) {
          for (let k = 0; k < target.length; k++) drop.add(words[at + k].token);
        }
      }
    }
    if (drop.size === 0) return tokens.join(' ');
    tokens = tokens.filter((_, i) => !drop.has(i));
  }
}

/**
 * Título para YouTube: qué es, cuánto cuesta y, si hay descuento, cuánto
 * ("… a $27.990 con 60% de descuento"). El nombre es lo único que se acorta:
 * el precio y el descuento van siempre enteros.
 */
export function youtubeTitle(
  product: Pick<CaptionProduct, 'name' | 'price' | 'original_price' | 'brand' | 'ml_domain_id' | 'specs'>,
): string {
  const discount = captionDiscount(product);
  const tail = ` a ${formatPrice(product.price)}${discount > 0 ? ` con ${discountPhrase(discount)}` : ''}`;
  // El título es el del video: el nombre va como en el reel (sin códigos de fábrica, con tipo y marca si parte con uno).
  const name = socialProductName(
    { ...product, name: withoutForbiddenWords(product.name) || 'Producto' },
    { max: YOUTUBE_TITLE_MAX - tail.length },
  );
  return `${name}${tail}`.slice(0, YOUTUBE_TITLE_MAX);
}

function withLinkLine(text: string, line: string): string {
  return text
    .split('\n')
    .map((current) => (current.startsWith(BUY_LINE_PREFIX) ? line : current))
    .join('\n');
}

/**
 * Los textos de un reel para cada red.
 *
 * Ninguno lleva un link para tocar: en la descripción de un reel no se puede,
 * y en Facebook además la página puede tener un tope de publicaciones con
 * link. Todos dicen dónde está el link en el perfil y, con `siteUrl`, el
 * nombre del sitio, y conservan la hora en que se revisó el precio.
 */
export function buildVideoTexts(product: CaptionProduct, now: Date, siteUrl = ''): VideoTexts {
  // Con estos dos canales buildCaption no escribe ni el link de compra ni el de la ficha.
  const opts: CaptionOptions = { now, siteUrl, link: '' };
  const instagram = buildCaption(product, 'instagram', opts);
  const tiktok = buildCaption(product, 'tiktok', opts);
  return {
    instagram,
    tiktok,
    facebook: withLinkLine(instagram, buyLine(siteUrl, 'facebook-reel')),
    youtubeTitle: youtubeTitle(product),
    youtubeDescription: withLinkLine(tiktok, buyLine(siteUrl, 'youtube')),
  };
}

/**
 * La foto de ML en su tamaño grande y en JPG. Las fichas guardan a veces la
 * versión chica (-O, -V) o en http; para un post hace falta la grande, y
 * JPG porque ni Telegram ni next/og aceptan WebP en todos los casos.
 */
export function mlPhotoJpg(imageUrl: string, size: 'F' | 'O' = 'F'): string {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return imageUrl;
  }
  if (!(url.hostname === 'mlstatic.com' || url.hostname.endsWith('.mlstatic.com'))) return imageUrl;
  url.protocol = 'https:';
  url.pathname = url.pathname.replace(/-[IEVOWF]\.(?:jpe?g|webp|png)$/i, `-${size}.jpg`);
  return url.toString();
}
