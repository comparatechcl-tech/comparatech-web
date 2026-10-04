/**
 * Medición de clics hacia Mercado Libre.
 *
 * Las comisiones aparecen en la Central de Afiliados hasta 60 días después
 * de la compra. Contar los clics propios es lo único que dice HOY qué
 * páginas, productos y canales mueven ventas, y permite comparar en 24 a 48
 * horas contra los clics que informa ML: si los nuestros siguen y los de ML
 * se caen, algo dejó de atribuirse.
 *
 * Sin imports a propósito: lo usan el botón (cliente) y /api/e (servidor).
 */

export const PLACEMENTS = [
  'home-ofertas',
  'home-nuevos',
  'home',
  'categoria',
  'ofertas',
  'buscar',
  'ficha',
  'ficha-sticky',
  'alternativas',
  'comparador',
  'social',
  'otro',
] as const;

/** Desde qué parte del sitio salió el clic. */
export type Placement = (typeof PLACEMENTS)[number];

export const LINK_MODES = ['meli_la', 'directo', 'otro'] as const;
export type LinkMode = (typeof LINK_MODES)[number];

export interface ClickBody {
  productId: string;
  placement: Placement;
  linkMode: LinkMode;
  src: string | null;
  mobile: boolean;
}

/** Tope del cuerpo que acepta /api/e: un clic real pesa ~150 bytes. */
export const MAX_CLICK_BODY_BYTES = 1024;

/**
 * Freno de gasto: sobre esta cantidad de filas en el día, /api/e deja de
 * insertar. Un sitio de este tamaño no llega ni cerca con tráfico real; si
 * se alcanza es un script inflando la tabla, y el plan gratis de Supabase
 * tiene 500 MB para todo.
 */
export const MAX_CLICKS_PER_DAY = 20_000;

/** sessionStorage: origen del primer aterrizaje (?src= o utm_source). */
export const SRC_STORAGE_KEY = 'ct_src';

/** sessionStorage: marca de "este producto ya se contó en esta sesión". */
export function clickDedupKey(productId: string): string {
  return `ct_clic_${productId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La parte del sitio según la ruta, para los botones que no dicen de dónde
 * vienen. Las tarjetas de la portada lo dicen explícito (ofertas o nuevos):
 * la ruta sola no distingue una sección de la otra.
 */
export function placementFromPath(pathname: string): Placement {
  const path = (pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (path === '/') return 'home';

  const first = path.split('/')[1]?.toLowerCase() ?? '';
  switch (first) {
    case 'categoria':
      return 'categoria';
    case 'ofertas':
      return 'ofertas';
    case 'buscar':
      return 'buscar';
    case 'producto':
      return 'ficha';
    case 'comparador':
      return 'comparador';
    case 'hoy':
      // Landing a la que llevan los links de redes sociales.
      return 'social';
    default:
      return 'otro';
  }
}

/** Qué tipo de link abrió el comprador: el acortador o la ficha directa. */
export function linkModeFromHref(href: string): LinkMode {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return 'otro';
  }
  const host = url.hostname.toLowerCase();
  if (host === 'meli.la' || host.endsWith('.meli.la')) return 'meli_la';
  if (
    (host === 'mercadolibre.cl' || host.endsWith('.mercadolibre.cl')) &&
    url.pathname.startsWith('/p/')
  ) {
    return 'directo';
  }
  return 'otro';
}

/**
 * Robots, navegadores automatizados y scripts. Un clic de estos no es una
 * persona yendo a comprar, y si se cuenta infla la comparación con ML.
 * Sin user-agent también cuenta como robot: todo navegador manda uno.
 *
 * Ojo con lo que NO está: los navegadores dentro de Telegram, Instagram o
 * Facebook agregan su nombre al user-agent y son compradores reales que
 * llegan desde redes. Los previsualizadores de links de esas apps no
 * ejecutan JavaScript, así que nunca llegan a mandar un clic.
 * "(?<!cu)bot" deja pasar los celulares Cubot.
 */
const BOT_UA_RE =
  /(?<!cu)bot\b|bot\/|crawl|spider|slurp|mediapartners|facebookexternalhit|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|curl\/|wget\/|python|httpx|aiohttp|axios\/|node-fetch|undici|go-http-client|java\/|okhttp|libwww|scrapy|httpclient|postman/i;

export function isBotUserAgent(ua: string): boolean {
  const trimmed = (ua ?? '').trim();
  if (!trimmed) return true;
  return BOT_UA_RE.test(trimmed);
}

/**
 * Deja el origen como una etiqueta corta y sin caracteres raros: viene de la
 * URL, así que cualquiera puede escribir lo que quiera ahí.
 */
export function normalizeSrc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return clean || null;
}

/**
 * Valida el cuerpo que manda el botón. Cualquier cosa que no sea
 * exactamente un clic bien formado se descarta (null): mejor perder un clic
 * que guardar basura que después distorsione las métricas.
 */
export function parseClickBody(text: string): ClickBody | null {
  if (typeof text !== 'string' || !text || text.length > MAX_CLICK_BODY_BYTES) return null;

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const body = data as Record<string, unknown>;

  const productId = body.p;
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return null;

  const placement = body.s;
  if (typeof placement !== 'string' || !(PLACEMENTS as readonly string[]).includes(placement)) {
    return null;
  }

  const linkMode =
    typeof body.m === 'string' && (LINK_MODES as readonly string[]).includes(body.m)
      ? (body.m as LinkMode)
      : 'otro';

  return {
    productId: productId.toLowerCase(),
    placement: placement as Placement,
    linkMode,
    src: normalizeSrc(body.src),
    mobile: body.mob === true,
  };
}

const CHILE_TZ = 'America/Santiago';

// Crear un Intl.DateTimeFormat es caro y el admin agrupa miles de clics por
// día: se crea una sola vez.
let chileDayFormat: Intl.DateTimeFormat | null = null;

/** Fecha (AAAA-MM-DD) del instante dado en hora de Chile. */
export function chileDateKey(date: Date): string {
  chileDayFormat ??= new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = chileDayFormat.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Medianoche (hora de Chile) del día AAAA-MM-DD, como instante. */
export function chileDayStart(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Las 16:00 UTC son mediodía o la una de la tarde en Chile: siempre cae
  // dentro del mismo día, con o sin horario de verano.
  return startOfChileDay(new Date(Date.UTC(y, m - 1, d, 16)));
}

/**
 * Medianoche de hoy en Chile, como instante. "Hoy" es el día que ve la
 * dueña en el admin, no el día UTC (que en Chile cambia a las 20 o 21 h).
 */
export function startOfChileDay(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHILE_TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  // Diferencia entre la hora de pared en Chile y UTC en este instante.
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;

  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offsetMs);
}

/** Suma (o resta) días a una fecha AAAA-MM-DD, sin pasar por husos horarios. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Lunes de la semana de una fecha AAAA-MM-DD. Los reportes de la Central de
 * Afiliados se guardan por semana (lunes a domingo), da igual qué día de la
 * semana elija la dueña en el formulario.
 */
export function weekStartOf(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Fechas imposibles (2026-02-31) se descartan en vez de correrse de mes.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return shiftDateKey(dateKey, -daysSinceMonday);
}

/**
 * Número entero escrito a mano en el admin: acepta "12.345", "$12.345" o
 * "12345". Vacío es null (dato que no se cargó); cualquier otra cosa que no
 * sea un entero no negativo es un error (undefined).
 */
export function parseWholeNumber(raw: string): number | null | undefined {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const clean = trimmed.replace(/^\$\s*/, '').replace(/\./g, '').replace(/\s/g, '');
  if (!/^\d+$/.test(clean)) return undefined;
  const value = Number(clean);
  // Las columnas son integer de Postgres.
  return value <= 2_000_000_000 ? value : undefined;
}
