/**
 * Avisos de "recomendaciones" del canal de afiliados de Mercado Libre (los
 * que el dueño copia de WhatsApp): una lista de productos con su precio y un
 * link, a veces con un cupón. /admin/historias/aviso los lee para armar la
 * historia de cada producto de tecnología.
 *
 * Los links del aviso (tinyurl, meli.la) no se abren nunca: abrirlos cuenta
 * como clic de afiliado. A un link de tinyurl se le puede preguntar adónde
 * apunta sin seguirlo (lib/short-links), y con eso se sabe la ficha exacta;
 * si no, el producto se busca por su nombre en el catálogo de Mercado Libre
 * (lib/social/deal-notice-review). Un link limpio a una ficha
 * (mercadolibre.cl/…/p/MLC…) se usa tal cual.
 *
 * Puro y sin Node. Sin lookbehind ni grupos con nombre (Safari < 16.4).
 */

import { formatPrice } from '@/lib/content/captions';
import { formatDayMonth } from '@/lib/format';

/** Productos por aviso: cada uno son ~6 consultas a Mercado Libre. */
export const NOTICE_MAX_DEALS = 8;
/** Lo que puede pesar lo pegado: un aviso largo son ~2.000 letras. */
export const NOTICE_MAX_CHARS = 20_000;
/** Qué tanto se tiene que parecer el nombre de una ficha al del aviso (parte de sus palabras). */
export const NAME_MATCH_MIN = 0.6;

export interface NoticeDeal {
  /** El nombre del producto como lo trae el aviso, sin emojis ni asteriscos. */
  name: string;
  /** El precio final que dice el aviso (con el cupón, si trae uno), o null. */
  price: number | null;
  /** El código del cupón que el aviso da para este producto, o null. */
  coupon: string | null;
  /** La ficha, solo si el link del aviso es uno limpio a /p/MLC…. */
  mlId: string | null;
  /**
   * El link del producto tal como viene en el aviso (tinyurl, meli.la o la
   * ficha). No se abre nunca; lib/short-links puede preguntarle al acortador
   * adónde apunta, sin llegar a Mercado Libre.
   */
  link?: string | null;
  /**
   * Todos los montos que el aviso da para este producto, en orden y sin las
   * compras mínimas: "$629.990 a $369.474" son dos. Con ellos lib/channel-price
   * decide si el aviso da un precio sin condiciones.
   */
  amounts?: number[];
  /** El descuento que el aviso dice ("48% OFF"), o null. */
  discountPct?: number | null;
  /** El aviso condiciona el precio de este producto (cupón, tarjeta, cuotas, suscripción). */
  conditional?: boolean;
}

export interface ParsedNotice {
  deals: NoticeDeal[];
  /** Productos que no entraron por el tope de NOTICE_MAX_DEALS. */
  omitted: number;
  /** Cupones que vienen solos, sin producto ("FECHADOBLE: $5.000 off…"): van a /admin/historias/cupones. */
  coupons: string[];
}

/** "[11/11, 11:58] Nombre: " al comienzo de cada mensaje copiado de WhatsApp. */
const HEADER_RE = /^\s*\[[^\]\n]{3,40}\]\s*[^:\n]{0,60}:\s*/;
const URL_RE = /https?:\/\/[^\s<>"'()]+/i;
const CATALOG_RE = /mercadolibre\.cl\/(?:[^\s?#]*\/)?p\/(MLC\d{5,15})(?:[/?#]|$)/i;
const TICKET_RE = /\u{1F39F}️?/gu;
/** Emojis, banderas y sus uniones. */
const PICTO_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu;
const MONEY_RE = /\$\s?(\d{1,3}(?:\.\d{3})+|\d+)/g;
/** Una línea de precio, descuento, cupón o encabezado no es el nombre del producto. */
const NOT_NAME_RE = /\$|%|\b(?:off|precio|cup[oó]n|descuentos?|dcto)\b|:$/i;
const COUPON_RE = /[cC][uU][pP][oOóÓ][nN]:?\s+([A-Z0-9]{4,20})\b/g;
/** Palabras en mayúsculas que siguen a "cupón" y no son un código. */
const NOT_CODE = new Set(['PARA', 'TODOS', 'TODO', 'SOBRE', 'DESDE', 'FECHA', 'DOBLE', 'HASTA', 'MERCADO', 'LIBRE', 'EXCLUSIVO']);

/** Sin emojis ni marcas de formato de WhatsApp (*negrita*, ~tachado~, _cursiva_). */
function clean(line: string): string {
  return line
    .replace(PICTO_RE, ' ')
    .replace(/[*~_]/g, ' ')
    .replace(/^[\s\-•·>]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toPesos(digits: string): number | null {
  const n = Number(digits.replace(/\./g, ''));
  return Number.isSafeInteger(n) && n > 0 && n <= 99_999_999 ? n : null;
}

function couponsIn(text: string): string[] {
  // El emoji del boleto marca el código ("🎟️ PICK11", "🎟️FECHADOBLE:"): se lee como la palabra "cupón".
  const plain = text.replace(TICKET_RE, ' cupón ').replace(PICTO_RE, ' ').replace(/[*~_]/g, ' ');
  const codes: string[] = [];
  for (const m of plain.matchAll(COUPON_RE)) {
    const code = m[1];
    if (code.length >= 5 && !NOT_CODE.has(code) && /[A-Z]/.test(code) && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Una línea que habla de una compra mínima ("sobre $34.990"): su monto no es un precio. */
const MINIMUM_RE = /\b(?:sobre|desde|compras?|m[ií]nim[oa])\b/i;
/** "48% OFF", "8% de descuento", "50% dcto". */
const PERCENT_RE = /(\d{1,2})\s?%\s*(?:off|de\s+descuento|dcto|descuento)/i;
/**
 * Lo que condiciona un precio: no es el que paga cualquiera. Se busca en todo
 * el bloque, así que las frases son las de una condición y no las de un
 * producto ("con tarjeta", no "Tarjeta de video").
 */
const CONDITION_RE =
  /\b(?:cup[oó]n(?:es)?|c[oó]digo|con\s+tarjeta|tarjeta\s+de\s+cr[eé]dito|cuotas?|pagando\s+con|mercado\s*pago|suscripci[oó]n|meli\s*\+)/i;

/** Los montos del bloque, en orden, sin las compras mínimas. */
function amountsIn(lines: string[]): number[] {
  const amounts: number[] = [];
  for (const line of lines) {
    if (MINIMUM_RE.test(line)) continue;
    for (const m of line.matchAll(MONEY_RE)) {
      const value = toPesos(m[1]);
      if (value !== null) amounts.push(value);
    }
  }
  return amounts;
}

/** El último monto del bloque que no es una compra mínima ("sobre $34.990"): el precio final del producto. */
function priceIn(lines: string[]): number | null {
  const amounts = amountsIn(lines);
  return amounts.length > 0 ? amounts[amounts.length - 1] : null;
}

function percentIn(lines: string[]): number | null {
  for (const line of lines) {
    const m = PERCENT_RE.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

/** El nombre: la última línea del bloque que no es precio, descuento, cupón ni encabezado. */
function nameIn(lines: string[]): string | null {
  let name: string | null = null;
  for (const raw of lines) {
    const line = clean(raw);
    if (line.length < 10 || line.length > 200) continue;
    if (NOT_NAME_RE.test(line)) continue;
    if ((line.match(/\p{L}{2,}/gu) ?? []).length < 2) continue;
    name = line;
  }
  return name;
}

/**
 * Los productos del aviso, en orden. Cada producto termina en su link; lo
 * que viene después del último link, o en un mensaje sin link, solo se mira
 * por cupones sueltos. Lo que no tiene nombre reconocible se salta.
 */
export function parseDealNotice(text: string): ParsedNotice {
  const deals: NoticeDeal[] = [];
  const coupons: string[] = [];
  let block: string[] = [];

  const close = (link: string | null) => {
    const lines = block;
    block = [];
    if (!link) {
      for (const code of couponsIn(lines.join('\n'))) if (!coupons.includes(code)) coupons.push(code);
      return;
    }
    const name = nameIn(lines);
    if (!name) return;
    if (deals.some((d) => d.name.toLowerCase() === name.toLowerCase())) return;
    const coupon = couponsIn(lines.join('\n'))[0] ?? null;
    deals.push({
      name,
      price: priceIn(lines),
      coupon,
      mlId: CATALOG_RE.exec(link)?.[1]?.toUpperCase() ?? null,
      link,
      amounts: amountsIn(lines),
      discountPct: percentIn(lines),
      conditional: coupon !== null || lines.some((raw) => CONDITION_RE.test(raw)),
    });
  };

  for (const raw of String(text ?? '').slice(0, NOTICE_MAX_CHARS).split(/\r?\n/)) {
    let line = raw;
    // Un mensaje nuevo cierra lo que venía del anterior.
    if (HEADER_RE.test(line)) {
      close(null);
      line = line.replace(HEADER_RE, '');
    }
    const url = URL_RE.exec(line);
    if (url) {
      block.push(line.replace(URL_RE, ' '));
      close(url[0]);
    } else {
      block.push(line);
    }
  }
  close(null);

  return { deals: deals.slice(0, NOTICE_MAX_DEALS), omitted: Math.max(0, deals.length - NOTICE_MAX_DEALS), coupons };
}

const STOP_WORDS = new Set(['de', 'del', 'con', 'y', 'para', 'el', 'la', 'los', 'las', 'en', 'por', 'color', 'a', 'un', 'una']);

/** Las palabras de un nombre, comparables: sin tildes, en minúsculas y "128 GB" como "128gb". Puro. */
export function nameTokens(name: string): string[] {
  const text = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d)\s+(gb|tb|mb|hz|w|mah|l|lt|litros|mm|cm|kg|pulgadas)\b/g, '$1$2');
  const tokens = text
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));
  return [...new Set(tokens)];
}

/** Qué parte de las palabras del aviso trae el nombre de la ficha: de 0 a 1. Puro. */
export function nameMatch(noticeName: string, candidate: string): number {
  const wanted = nameTokens(noticeName);
  if (wanted.length === 0) return 0;
  const have = new Set(nameTokens(candidate));
  return wanted.filter((t) => have.has(t)).length / wanted.length;
}

/**
 * Lo que la tarjeta de la historia dice del aviso, en frases cortas (la
 * tarjeta agrega el punto final). Puro.
 *
 * `fromNotice`: el sitio no tenía un precio revisado hace poco y la historia
 * lleva el del aviso (lib/social/deal-notice-review). Nadie lo comparó con
 * Mercado Libre: la tarjeta lo dice, y si es con cupón, que hay que escribirlo.
 */
export function noticeNote(
  deal: Pick<NoticeDeal, 'price' | 'coupon'>,
  price: number,
  lastStory: { price: number | null; at: string } | null,
  fromNotice = false
): string {
  const parts: string[] = [];
  if (fromNotice) {
    parts.push(
      deal.coupon
        ? `La historia lleva el precio del aviso, que es con el cupón ${deal.coupon}: escríbelo en la historia. Mira el precio en Mercado Libre antes de subirla`
        : 'La historia lleva el precio del aviso: el sitio no tiene el de hoy. Míralo en Mercado Libre antes de subirla'
    );
  } else if (deal.coupon) {
    parts.push(
      deal.price
        ? `El aviso trae el cupón ${deal.coupon}: con él queda en ${formatPrice(deal.price)}. Si quieres, escríbelo en la historia`
        : `El aviso trae el cupón ${deal.coupon}. Si quieres, escríbelo en la historia`
    );
  } else if (deal.price && deal.price !== price) {
    parts.push(`El aviso dice ${formatPrice(deal.price)}; hoy está a ${formatPrice(price)}`);
  } else if (deal.price) {
    parts.push('Mismo precio que el aviso');
  }
  if (lastStory) {
    const at = formatDayMonth(lastStory.at);
    parts.push(
      lastStory.price
        ? `Ya la subiste como historia el ${at} a ${formatPrice(lastStory.price)}`
        : `Ya la subiste como historia el ${at}`
    );
  }
  return parts.join('. ');
}
