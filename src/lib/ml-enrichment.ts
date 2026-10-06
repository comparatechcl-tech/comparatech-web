/**
 * Enriquecimiento de productos desde la API de Mercado Libre.
 *
 * Vive acá y no dentro de un route handler porque varios lugares necesitan
 * exactamente las mismas reglas y no pueden divergir:
 *  - /api/cron/prospect, al guardar candidatos nuevos
 *  - /api/cron/refresh-prices, al reparar productos que quedaron incompletos
 *  - los scripts de backfill del catálogo ya publicado
 */

import { buildDescription } from '@/lib/product-description';

export interface MlAttribute {
  name: string;
  value_name: string | null;
}

export interface Enrichment {
  brand: string | null;
  specs: Record<string, string>;
  description: string;
  /** parent_id de ML: agrupa las variantes (colores) del mismo modelo. */
  familyId: string | null;
  /** domain_id de ML ("MLC-HEADPHONES"): el tipo exacto de producto. */
  domainId: string | null;
}

export const EMPTY_ENRICHMENT: Enrichment = {
  brand: null,
  specs: {},
  description: '',
  familyId: null,
  domainId: null,
};

/**
 * Atributos que no entran a la tabla de especificaciones. ML devuelve entre
 * 39 y 56 atributos por producto, así que descartar los que no le dicen nada
 * al comprador no deja huecos: simplemente entran los siguientes de la lista.
 */
const SKIP_SPEC_NAMES = new Set([
  'Marca', // ya tiene su propia columna
  'Modelo alfanumérico',
  'Línea',
  'Fabricante', // repite la marca ("Xiaomi Communication Corp")
  'Modelo detallado', // código interno del vendedor ("BLIK-SOUL250-GRE")
  'Color filtrable', // duplica "Color"
  'Color principal',
  'Formato de venta', // dice "Unidad" en prácticamente todo el catálogo
  'Unidades por pack',
]);

/** Registros regulatorios y códigos de barra: ruido puro en una ficha de comparación. */
const SKIP_SPEC_NAME_RE = /homologaci|anatel|c[oó]digo universal|\b(gtin|ean|upc)\b/i;

/** Valores sin contenido real: "0 MB", "0 cm", "No aplica". */
const EMPTY_SPEC_VALUE_RE = /^(0(\s*\S+)?|no aplica|n\/a|-{1,2})$/i;

/**
 * Magnitudes negativas: ML a veces devuelve basura como "Tamaño de la
 * memoria: -2000 MB". Las temperaturas son la excepción legítima — un
 * congelador que enfría a -18 °C es un dato real.
 */
const NEGATIVE_SPEC_VALUE_RE = /^-\s*\d/;
const TEMPERATURE_NAME_RE = /temperatur/i;

const MAX_SPECS = 8;

export function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}

/**
 * Token en memoria del proceso. Cada corrida del cron y cada acción del admin
 * pedían uno nuevo; con el cron cada 30 minutos más la prospección, eso es
 * pedirle a ML decenas de tokens al día que duran 6 horas. Una instancia
 * caliente de Vercel reusa el mismo hasta poco antes de que venza.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Margen antes del vencimiento: un token a punto de vencer puede morir a media corrida. */
const TOKEN_MARGIN_MS = 10 * 60 * 1000;
/** Tope de reuso aunque ML diga que dura más. */
const TOKEN_MAX_REUSE_MS = 5 * 60 * 60 * 1000;

/**
 * Esperas entre intentos de pedir el token. La bitácora de los crons mostró
 * que el refresco de las horas en punto fallaba casi siempre con "sin token"
 * mientras el de los minutos :30 funcionaba: ML rechaza pedidos de token en
 * los momentos de más carga. Sin reintento, esa corrida se perdía entera y
 * los precios pasaban una hora sin revisarse.
 */
const TOKEN_RETRY_WAITS_MS = [1000, 2500];
const TOKEN_TIMEOUT_MS = 4000;

/** Por qué falló el último pedido de token (para la bitácora). Null si salió bien. */
let lastTokenError: string | null = null;

export function mlTokenError(): string | null {
  return lastTokenError;
}

type TokenAttempt =
  | { ok: true; token: string; expiresIn: number | null }
  | { ok: false; error: string; retry: boolean };

async function requestMlToken(): Promise<TokenAttempt> {
  try {
    const res = await fetchWithTimeout(
      'https://api.mercadolibre.com/oauth/token',
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.ML_CLIENT_ID ?? '',
          client_secret: process.env.ML_CLIENT_SECRET ?? '',
        }),
      },
      TOKEN_TIMEOUT_MS
    );
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;

    if (typeof body?.access_token === 'string') {
      return {
        ok: true,
        token: body.access_token,
        expiresIn: typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : null,
      };
    }
    // Solo el estado y el código de error de ML: el cuerpo no se guarda.
    const raw = typeof body?.error === 'string' ? body.error : typeof body?.code === 'string' ? body.code : '';
    const code = raw ? ` ${raw.slice(0, 60)}` : '';
    return {
      ok: false,
      error: `HTTP ${res.status}${code}`,
      // Con credenciales rechazadas (400/401) insistir no cambia nada; un
      // 429, un 403 del filtro de ML o un 5xx sí pueden pasar al rato.
      retry: res.status !== 400 && res.status !== 401,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: timedOut ? `sin respuesta en ${TOKEN_TIMEOUT_MS / 1000} s` : 'error de red', retry: true };
  }
}

export async function getMlToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  for (let attempt = 0; ; attempt++) {
    const result = await requestMlToken();

    if (result.ok) {
      const lifetimeMs = result.expiresIn ? result.expiresIn * 1000 - TOKEN_MARGIN_MS : TOKEN_MAX_REUSE_MS;
      const reuseMs = Math.min(lifetimeMs, TOKEN_MAX_REUSE_MS);
      cachedToken = reuseMs > 0 ? { value: result.token, expiresAt: Date.now() + reuseMs } : null;
      lastTokenError = null;
      return result.token;
    }

    lastTokenError = attempt > 0 ? `${result.error} (${attempt + 1} intentos)` : result.error;
    const wait = TOKEN_RETRY_WAITS_MS[attempt];
    if (!result.retry || wait === undefined) {
      console.warn(`[ml] no se pudo obtener el token: ${lastTokenError}`);
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

export function extractBrand(attributes: MlAttribute[]): string | null {
  return attributes.find((a) => a.name === 'Marca')?.value_name ?? null;
}

export function extractSpecs(attributes: MlAttribute[]): Record<string, string> {
  const specs: Record<string, string> = {};
  const seenValues = new Set<string>();

  for (const attr of attributes) {
    if (Object.keys(specs).length >= MAX_SPECS) break;
    if (!attr.name || !attr.value_name) continue;

    const value = attr.value_name.trim();
    if (!value) continue;
    if (SKIP_SPEC_NAMES.has(attr.name) || SKIP_SPEC_NAME_RE.test(attr.name)) continue;
    if (EMPTY_SPEC_VALUE_RE.test(value)) continue;
    if (NEGATIVE_SPEC_VALUE_RE.test(value) && !TEMPERATURE_NAME_RE.test(attr.name)) continue;
    if (seenValues.has(value)) continue; // evita "Color"/"Color principal" repetidos

    specs[attr.name] = value;
    seenValues.add(value);
  }

  return specs;
}

export function extractFeatures(mlProduct: unknown): string[] {
  const features = (mlProduct as { main_features?: { text?: string }[] })?.main_features ?? [];
  return features.map((f) => f?.text).filter((t): t is string => typeof t === 'string');
}

/** Arma el enriquecimiento desde una respuesta ya obtenida de /products/{id}. */
export function enrichFromMlProduct(mlProduct: unknown, name: string): Enrichment {
  const attributes: MlAttribute[] = (mlProduct as { attributes?: MlAttribute[] })?.attributes ?? [];
  const brand = extractBrand(attributes);
  const specs = extractSpecs(attributes);

  return {
    brand,
    specs,
    description: buildDescription({ name, brand, features: extractFeatures(mlProduct), specs }),
    familyId: (mlProduct as { parent_id?: string })?.parent_id ?? null,
    domainId: (mlProduct as { domain_id?: string })?.domain_id ?? null,
  };
}

/**
 * Consulta /products/{id} y devuelve marca, specs y descripción.
 *
 * Nunca lanza: si ML está lento o caído para este producto puntual, devuelve
 * el enriquecimiento vacío para no tirar abajo el lote completo — quien
 * llama decide si guarda igual o si deja el dato como estaba.
 */
export async function enrichFromMl(
  mlProductId: string,
  token: string,
  name: string
): Promise<Enrichment> {
  try {
    const res = await fetchWithTimeout(`https://api.mercadolibre.com/products/${mlProductId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return EMPTY_ENRICHMENT;

    return enrichFromMlProduct(await res.json(), name);
  } catch {
    return EMPTY_ENRICHMENT;
  }
}
