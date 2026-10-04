/**
 * Textos para redes sociales, uno por canal.
 *
 * Antes cada post se escribía a mano y por eso no se publicaba nada: con un
 * texto listo en un clic, publicar cuesta un par de minutos. Todos los
 * textos llevan lo que la ley y Mercado Libre exigen a un afiliado: que es
 * publicidad, que el link paga comisión y que el precio es el de una hora
 * concreta (en Mercado Libre cambia varias veces al día).
 *
 * Puro y sin I/O a propósito: lo usan el admin (cliente), el cron de
 * Telegram y los tests, con la misma salida para la misma entrada.
 */

import { shortProductName } from '@/lib/text';

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
}

export interface CaptionOptions {
  now: Date;
  siteUrl: string;
  /** Link de compra (buyUrl / resolveOutboundUrl): el mismo que usa el sitio. */
  link: string;
}

/** Línea final de todos los textos. No se edita sin revisar la ley del consumidor. */
export const DISCLOSURE =
  '#publicidad · Link de afiliado: si compras, ComparaTech recibe una comisión sin costo extra para ti.';

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
 * "rebajado" se dice sobre el precio de lista que informa ML (no "bajó",
 * que exigiría historial), y "top" habla del vendedor, que es lo que el
 * dato seller_sales_count mide.
 */
const HOOKS: Record<HookKind, string[]> = {
  oferta: [
    // Sin "hoy": se lee como una oferta del día, y sin historial de precios
    // no se puede afirmar.
    '🔥 Con descuento en Mercado Libre',
    '⚡ Descuento sobre su precio de lista',
    '👀 Ojo con este descuento',
    '💸 Precio rebajado',
    '🛒 Para aprovechar mientras dure',
    '📉 Con descuento en este momento',
  ],
  top: [
    '⭐ De un vendedor con reputación verde y miles de ventas',
    '✅ Vendedor con reputación verde y miles de ventas',
    '🏆 Vendedor top en Mercado Libre',
    '🤝 Vendedor confiable, con miles de ventas',
    '👍 Lo vende alguien con reputación verde',
  ],
  precio: [
    '💡 Dato de precio',
    '🔎 Lo comparamos por ti',
    '📌 Precio revisado hoy',
    '🛒 Para tener en el radar',
    '✅ Precio actual en Mercado Libre',
    '👇 Mira cuánto cuesta hoy',
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

function priceLine(p: CaptionProduct): string {
  const discount = captionDiscount(p);
  const base = `💰 ${formatPrice(p.price)}`;
  // El "antes" va solo si el precio de lista es mayor: un "antes" igual o
  // menor sería una rebaja inventada.
  if (discount > 0 && p.original_price) return `${base} (antes ${formatPrice(p.original_price)} / -${discount}%)`;
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
  const tags = ['#ofertas', '#tecnologia', '#chile', '#mercadolibre', categoryTag(p.category)].filter(
    (t): t is string => Boolean(t)
  );
  return [...new Set(tags)].join(' ');
}

/** Link a la ficha propia, con el canal para medir de dónde llegan las visitas. */
export function productPageUrl(siteUrl: string, slug: string, channel: CaptionChannel): string {
  return `${siteUrl.replace(/\/+$/, '')}/producto/${slug}?src=${channel}`;
}

export function buildCaption(product: CaptionProduct, channel: CaptionChannel, opts: CaptionOptions): string {
  const lines: string[] = [pickHook(product, opts.now), shortProductName(product.name), priceLine(product)];
  if (product.offer_info?.free_shipping === true) lines.push('🚚 Envío gratis');
  lines.push(priceCheckedLine(product.price_checked_at));
  lines.push('');

  // Instagram y TikTok no dejan links clicables en el texto: se manda a la
  // bio, donde está /hoy.
  if (channel === 'instagram' || channel === 'tiktok') {
    lines.push('Link en la bio 👉 comparatech');
  } else {
    lines.push(`👉 Ver en Mercado Libre: ${opts.link}`);
    lines.push(`🔎 Compara en ComparaTech: ${productPageUrl(opts.siteUrl, product.slug, channel)}`);
  }

  const tags = hashtags(product, channel);
  if (tags) {
    lines.push('');
    lines.push(tags);
  }

  // Separada de los hashtags para que no se pierda entre ellos.
  lines.push('');
  lines.push(DISCLOSURE);
  return lines.join('\n');
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
