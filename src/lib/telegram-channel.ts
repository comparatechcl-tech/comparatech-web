/**
 * Lector de la vista pública de un canal de Telegram (https://t.me/s/<canal>).
 *
 * Telegram publica ahí, sin sesión, los últimos avisos de cualquier canal
 * público: es la página que ve una persona que abre el link del canal sin
 * tener la aplicación. Sirve para leer el canal oficial de afiliados de
 * Mercado Libre, donde Mercado Libre publica productos con su precio
 * (lib/channel-sync).
 *
 * Es un pedido a t.me por pasada, que no es Mercado Libre. Si el canal no
 * tiene vista pública (es privado), Telegram redirige y no hay nada que leer.
 *
 * El análisis es puro; solo `readChannel` sale a la red.
 */

export interface ChannelPost {
  /** El número del aviso dentro del canal: crece con cada publicación. */
  id: number;
  /** Cuándo se publicó (ISO). */
  postedAt: string;
  /** El texto del aviso, con un salto de línea donde lo tiene y los links como dirección. */
  text: string;
}

/** Los nombres públicos de Telegram: letras, números y guion bajo, de 4 a 32. */
const CHANNEL_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

export function isChannelName(name: unknown): name is string {
  return typeof name === 'string' && CHANNEL_RE.test(name);
}

const POST_RE = /data-post="([A-Za-z0-9_]{4,32})\/(\d{1,12})"/g;
const TEXT_RE = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/;
const DATE_RE = /<a class="tgme_widget_message_date"[^>]*>\s*<time datetime="([^"]+)"/;
const ANCHOR_RE = /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** ¿Un link hacia afuera de Telegram? Los internos (otro aviso, una etiqueta) se quedan con su texto. */
function isOutbound(href: string): boolean {
  const m = /^https?:\/\/([^/?#]+)/i.exec(href);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host !== 't.me' && host !== 'telegram.me' && !host.endsWith('.t.me');
}

/** El texto de un aviso como lo copiaría una persona: saltos de línea, links escritos enteros, sin formato. */
export function messageText(html: string): string {
  const withLinks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(ANCHOR_RE, (_whole, href: string, label: string) => {
      const target = decodeEntities(href);
      return isOutbound(target) ? ` ${target} ` : label;
    });
  return decodeEntities(withLinks.replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Los avisos con texto de la página, del más antiguo al más nuevo. Solo los
 * del canal pedido: la página no debería traer otros, pero un aviso reenviado
 * lleva el nombre de su canal de origen.
 */
export function parseChannelPreview(html: string, channel: string): ChannelPost[] {
  const page = String(html ?? '');
  const wanted = channel.toLowerCase();
  const starts: { index: number; channel: string; id: number }[] = [];
  for (const m of page.matchAll(POST_RE)) {
    starts.push({ index: m.index ?? 0, channel: m[1].toLowerCase(), id: Number(m[2]) });
  }

  const posts = new Map<number, ChannelPost>();
  starts.forEach((start, i) => {
    if (start.channel !== wanted || !Number.isSafeInteger(start.id) || start.id <= 0) return;
    const block = page.slice(start.index, starts[i + 1]?.index ?? page.length);
    const body = TEXT_RE.exec(block)?.[1];
    const at = DATE_RE.exec(block)?.[1];
    const posted = at ? Date.parse(at) : NaN;
    if (!body || !Number.isFinite(posted)) return;
    const text = messageText(body);
    if (text) posts.set(start.id, { id: start.id, postedAt: new Date(posted).toISOString(), text });
  });
  return [...posts.values()].sort((a, b) => a.id - b.id);
}

export type ChannelRead =
  | { status: 'ok'; posts: ChannelPost[] }
  /** El canal no tiene vista pública (es privado o no existe): no hay nada que leer sin sesión. */
  | { status: 'sin_vista_publica' }
  | { status: 'error'; reason: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;
/** La página pesa cerca de 130 KB; con esto sobra y un cuerpo enorme no se procesa. */
const MAX_BYTES = 2_000_000;

/** Lee los últimos avisos del canal. Nunca lanza. */
export async function readChannel(channel: string, fetchImpl: Fetch = fetch): Promise<ChannelRead> {
  if (!isChannelName(channel)) return { status: 'error', reason: 'nombre de canal no válido' };
  try {
    const res = await fetchImpl(`https://t.me/s/${channel}`, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) return { status: 'sin_vista_publica' };
    if (res.status !== 200) return { status: 'error', reason: `Telegram respondió ${res.status}` };
    const html = await res.text();
    if (html.length > MAX_BYTES) return { status: 'error', reason: 'la página es más grande de lo esperado' };
    return { status: 'ok', posts: parseChannelPreview(html, channel) };
  } catch (err) {
    return { status: 'error', reason: err instanceof Error ? err.message : 'Telegram no respondió' };
  }
}
