/**
 * Genera la descripción de un producto a partir de datos factuales del
 * catálogo de Mercado Libre.
 *
 * A propósito NO usamos `short_description` de la API de ML, aunque venga
 * lista y sea más larga: es copy de marketing del vendedor ("Redefine tu
 * experiencia auditiva...") y llega idéntico a la ficha de ML y a todo sitio
 * que lo copie. Reproducirlo nos dejaría con contenido duplicado —justo lo
 * que hunde el SEO de las fichas, que son el driver de tráfico orgánico del
 * proyecto— y con afirmaciones sobre el producto que no podemos verificar,
 * algo que las reglas del Programa de Afiliados prohíben.
 *
 * `main_features` en cambio son hechos concretos del catálogo oficial
 * ("Batería de 400 mAh que ofrece 45 horas de reproducción continua"), así
 * que se pueden reordenar y combinar en un texto propio sin inventar nada.
 */

import type { Product } from '@/lib/types';

/**
 * Largo mínimo para que un main_feature aporte algo. Descarta ruido como
 * "Con ruedas.", "Giratoria." o "Incluye cable.", y de paso filtra los
 * booleanos que ML renderiza mal: hay audífonos True Wireless que traen
 * "Es monoaural." como feature mientras sus specs dicen "Es monoaural: No".
 */
const MIN_FEATURE_LENGTH = 28;

/** Pasan el largo mínimo pero no dicen nada: "Compatible con: Todos los disponibles en el Mercado." */
const USELESS_FEATURE_RE = /compatible con:?\s*todos/i;

const MAX_FEATURES = 3;
const MAX_SPECS_FALLBACK = 3;

/** Specs que no aportan a una descripción — son códigos internos o redundan con la marca. */
const SKIP_SPEC_KEYS = new Set(['Modelo', 'Modelo detallado', 'Fabricante', 'Color filtrable']);

export function cleanFeatures(features: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const raw of features) {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (text.length < MIN_FEATURE_LENGTH) continue;
    if (USELESS_FEATURE_RE.test(text)) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    kept.push(text.endsWith('.') ? text : `${text}.`);
    if (kept.length >= MAX_FEATURES) break;
  }

  return kept;
}

/**
 * Cuando ML no trae main_features utilizables, armamos la segunda frase con
 * las specs que ya guardamos. Es menos natural de leer, pero sigue siendo
 * información real del producto y evita dejar la ficha sin descripción.
 */
function describeFromSpecs(specs: Record<string, string | number>): string {
  const parts = Object.entries(specs)
    .filter(([key, value]) => !SKIP_SPEC_KEYS.has(key) && String(value).trim().length > 0)
    .slice(0, MAX_SPECS_FALLBACK)
    .map(([key, value]) => `${key.toLowerCase()} ${value}`);

  return parts.length > 0 ? `Características: ${parts.join(', ')}.` : '';
}

/**
 * Bajo este largo, el texto que sacamos del catálogo no alcanza para una
 * meta description decente y conviene completarlo.
 */
const MIN_USEFUL_LENGTH = 90;

export function buildDescription({
  name,
  brand,
  features = [],
  specs = {},
}: {
  name: string;
  brand?: string | null;
  features?: string[];
  specs?: Record<string, string | number>;
}): string {
  const cleanName = name.trim();
  if (!cleanName) return '';

  let text = cleanFeatures(features).join(' ');

  // ML dio poco para este producto — completamos con las specs guardadas.
  if (text.length < MIN_USEFUL_LENGTH) {
    const fromSpecs = describeFromSpecs(specs);
    if (fromSpecs) text = text ? `${text} ${fromSpecs}` : fromSpecs;
  }

  if (!text) return '';

  // El nombre NO se antepone salvo que el texto haya quedado muy corto: los
  // nombres de ML miden 76-90 caracteres, así que repetirlos acá se come el
  // espacio que Google muestra (~155) y duplica lo que ya dice el <title>.
  if (text.length >= MIN_USEFUL_LENGTH) return text;

  // No repetimos la marca si el nombre ya la incluye (pasa seguido:
  // "Xiaomi Redmi Buds 6 Play Rosa" con brand "Xiaomi").
  const brandName = brand?.trim();
  const nameHasBrand = !!brandName && cleanName.toLowerCase().includes(brandName.toLowerCase());
  const lead = brandName && !nameHasBrand ? `${cleanName}, de ${brandName}.` : `${cleanName}.`;

  return `${lead} ${text}`;
}

/**
 * Último recurso para que ninguna ficha quede sin meta description, incluso
 * si el producto se cargó a mano y nadie escribió una. No inventa nada sobre
 * el producto: solo dice qué encuentra el usuario en la página.
 */
export function fallbackDescription(product: Pick<Product, 'name' | 'brand'>): string {
  const brand = product.brand?.trim();
  const subject = brand ? `${product.name} de ${brand}` : product.name;
  return `${subject}: precio actualizado, especificaciones y reputación del vendedor. Compara antes de comprar en Mercado Libre Chile.`;
}

/** Descripción efectiva de un producto — nunca vacía. */
export function resolveDescription(
  product: Pick<Product, 'name' | 'brand' | 'description'>
): string {
  return product.description?.trim() || fallbackDescription(product);
}
