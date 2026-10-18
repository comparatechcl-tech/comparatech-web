/**
 * Páginas por modelo (SEO etapa 2, punto 4): /modelo/iphone-17 junta todas
 * las versiones de un modelo (colores, capacidades, ediciones) con su precio
 * de hoy y el historial del precio más bajo entre ellas. Es la página que
 * responde "precio iphone 17": las fichas responden a una versión.
 *
 * La lista es a mano y la aprueba el dueño: son los modelos con varias
 * versiones en el catálogo que la gente más busca en Chile (Google, Knasta y
 * lo más buscado en Mercado Libre, medido el 18-10-2026). Una versión se
 * reconoce por su nombre y su tipo de producto, no por la familia de ML: los
 * colores y capacidades de un iPhone comparten familia, pero las ediciones de
 * la PS5 o los Kindle no, y un color nuevo que entre al catálogo tiene que
 * aparecer solo.
 *
 * Sin I/O: se prueba con datos fijos. Las lecturas están en lib/queries/models.
 */
import { normalizeName, shortProductName } from '@/lib/text';
import { formatCLP } from '@/lib/format';
import { SEO_TITLE_MAX } from '@/lib/seo-title';

export interface ModelDef {
  /** La dirección (/modelo/{slug}). No se cambia: la tienen Google y los links. */
  slug: string;
  /** Cómo se llama en el título, el H1 y las migas. */
  name: string;
  /** Otro nombre con que se busca ("PlayStation 5"): va en el texto y en el dato estructurado. */
  alias?: string;
  brand: string;
  /**
   * Los tipos de producto de Mercado Libre de sus versiones. Una funda o un
   * juego con el nombre del modelo no es una versión del modelo.
   */
  domains: string[];
  /** Todas tienen que estar en el nombre, comparado con modelText. Sin la marca g. */
  include: RegExp[];
  /** Ninguna puede estar. */
  exclude?: RegExp[];
  /** Qué distingue a una versión de otra en la tabla (ver versionLabel). */
  label: VersionLabelKind;
}

/**
 * - capacidad-color: "256 GB · Lavanda" (celulares y tablets).
 * - modelo-color: el Modelo de la ficha sin el nombre del modelo, y el color
 *   ("Paperwhite 12va Gen · Verde"), para una línea con varios modelos.
 * - color: solo el color (un parlante).
 * - nombre: el nombre de la ficha sin la marca ni el modelo ("Digital Slim +
 *   Juego Astro Bot…"), para las ediciones de una consola.
 */
export type VersionLabelKind = 'capacidad-color' | 'modelo-color' | 'color' | 'nombre';

const CELLPHONES = 'MLC-CELLPHONES';

/**
 * El orden es el de la lista que se le propuso al dueño. Las reglas se
 * excluyen entre sí ("iphone 17 pro" no toma los Pro Max): un test lo revisa.
 */
export const MODELS: ModelDef[] = [
  {
    slug: 'iphone-17',
    name: 'iPhone 17',
    brand: 'Apple',
    domains: [CELLPHONES],
    include: [/\biphone 17\b/],
    exclude: [/\b(pro|max|plus|air)\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    brand: 'Apple',
    domains: [CELLPHONES],
    include: [/\biphone 17 pro\b/],
    exclude: [/\bmax\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'iphone-17-pro-max',
    name: 'iPhone 17 Pro Max',
    brand: 'Apple',
    domains: [CELLPHONES],
    include: [/\biphone 17 pro max\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'iphone-18-pro',
    name: 'iPhone 18 Pro',
    brand: 'Apple',
    domains: [CELLPHONES],
    include: [/\biphone 18 pro\b/],
    exclude: [/\bmax\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'iphone-18-pro-max',
    name: 'iPhone 18 Pro Max',
    brand: 'Apple',
    domains: [CELLPHONES],
    include: [/\biphone 18 pro max\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'iphone-15',
    name: 'iPhone 15',
    brand: 'Apple',
    domains: [CELLPHONES],
    include: [/\biphone 15\b/],
    exclude: [/\b(pro|max|plus)\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'galaxy-s26-ultra',
    name: 'Samsung Galaxy S26 Ultra',
    brand: 'Samsung',
    domains: [CELLPHONES],
    include: [/\bgalaxy\b/, /\bs26 ultra\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'galaxy-s26',
    name: 'Samsung Galaxy S26',
    brand: 'Samsung',
    domains: [CELLPHONES],
    include: [/\bgalaxy\b/, /\bs26\b/],
    exclude: [/\b(ultra|plus|edge|fe)\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'galaxy-a07',
    name: 'Samsung Galaxy A07',
    brand: 'Samsung',
    domains: [CELLPHONES],
    include: [/\bgalaxy\b/, /\ba07\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'galaxy-a57',
    name: 'Samsung Galaxy A57',
    brand: 'Samsung',
    domains: [CELLPHONES],
    include: [/\bgalaxy\b/, /\ba57\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'ps5',
    name: 'PS5',
    alias: 'PlayStation 5',
    brand: 'Sony',
    domains: ['MLC-GAME_CONSOLES'],
    include: [/\b(ps5|ps 5|playstation 5|play station 5)\b/],
    // El lector de discos que se vende aparte está en el mismo tipo de producto.
    exclude: [/\b(lector|unidad|disco|discos)\b/],
    label: 'nombre',
  },
  {
    slug: 'kindle',
    name: 'Kindle',
    brand: 'Amazon',
    domains: ['MLC-E_READERS'],
    include: [/\bkindle\b/],
    // Las fundas y micas están en el mismo tipo de producto que el Kindle.
    exclude: [/\b(funda|fundas|mica|micas|carcasa|protector|case|cover|lamina)\b/],
    label: 'modelo-color',
  },
  {
    slug: 'ipad-11',
    name: 'iPad 11 (A16)',
    brand: 'Apple',
    domains: ['MLC-TABLETS'],
    include: [/\bipad\b/, /\b(ipad 11|a16)\b/],
    exclude: [/\b(pro|air|mini)\b/],
    label: 'capacidad-color',
  },
  {
    slug: 'jbl-charge-6',
    name: 'JBL Charge 6',
    brand: 'JBL',
    domains: ['MLC-SPEAKERS'],
    include: [/\bjbl\b/, /\bcharge 6\b/],
    label: 'color',
  },
];

/** La dirección de la página de un modelo. */
export function modelPath(slug: string): string {
  return `/modelo/${slug}`;
}

export function getModel(slug: string): ModelDef | undefined {
  return MODELS.find((m) => m.slug === slug);
}

/**
 * El nombre como se compara: sin tildes, mayúsculas ni puntuación
 * (normalizeName), y con el "+" de un modelo dicho en palabras: "S26+" es el
 * "s26 plus", no el S26. Un "+" entre cifras ("50+12+10") no es un modelo.
 */
export function modelText(name: string): string {
  return normalizeName(name.replace(/([A-Za-z0-9])\+(?=\s|$)/g, '$1 plus'));
}

function textMatches(model: ModelDef, text: string): boolean {
  return model.include.every((re) => re.test(text)) && !(model.exclude ?? []).some((re) => re.test(text));
}

type Named = { name: string; ml_domain_id: string | null };

/** ¿Es una versión del modelo? Por su nombre y su tipo de producto. */
export function isVersionOf(model: ModelDef, product: Named): boolean {
  if (!product.ml_domain_id || !model.domains.includes(product.ml_domain_id)) return false;
  return textMatches(model, modelText(product.name));
}

/** El modelo del que el producto es una versión, si tiene página. */
export function modelOf(product: Named): ModelDef | undefined {
  return MODELS.find((m) => isVersionOf(m, product));
}

/** Las versiones de un modelo, de menor a mayor precio. */
export function versionsOf<T extends Named & { price: number }>(model: ModelDef, products: T[]): T[] {
  return products.filter((p) => isVersionOf(model, p)).sort((a, b) => a.price - b.price);
}

/**
 * Las páginas de modelo que pueden haber cambiado cuando cambian estas
 * fichas, para avisarle a Bing (IndexNow). Se reconocen por el slug, que es
 * el nombre escrito como dirección (lib/candidate-slugs): el refresco de
 * precios no lee el nombre ni el tipo de producto, así que una funda con el
 * nombre del modelo también cuenta. Un aviso de más solo hace que Bing vuelva
 * a leer la página.
 */
export function modelPathsForSlugs(slugs: Iterable<string>): string[] {
  const paths = new Set<string>();
  for (const slug of slugs) {
    const text = slug.replace(/-+/g, ' ').trim();
    for (const model of MODELS) if (textMatches(model, text)) paths.add(modelPath(model.slug));
  }
  return [...paths];
}

// ---------------------------------------------------------------------------
// Cómo se distingue cada versión.

type Spec = Record<string, string | number> | null | undefined;

function spec(specs: Spec, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = specs?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** La capacidad de una versión ("256 GB"), si la ficha la trae. */
export function versionCapacity(specs: Spec): string | null {
  return spec(specs, 'Memoria interna', 'Capacidad', 'Almacenamiento', 'Capacidad de almacenamiento');
}

/** El color de una versión, como lo escribe la ficha ("Naranja cósmico"). */
export function versionColor(specs: Spec): string | null {
  const color = spec(specs, 'Color');
  return color ? capitalize(color) : null;
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** El texto sin las palabras dadas (sin importar mayúsculas), sin espacios ni signos sobrantes. */
function without(text: string, words: string[]): string {
  let out = text;
  for (const word of words.filter(Boolean)) out = out.replace(new RegExp(`\\b${escapeRe(word)}\\b`, 'gi'), ' ');
  return out
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—,:;|•/+·]+|[\s\-–—,:;|•/+·]+$/g, '')
    .trim();
}

/**
 * Lo que distingue a una versión de las otras del mismo modelo, para la tabla
 * y para decir de cuál fue el precio más bajo. Si la ficha no trae el dato,
 * el nombre corto.
 */
export function versionLabel(model: ModelDef, product: { name: string; specs: Spec }): string {
  const color = versionColor(product.specs);
  let parts: (string | null)[];
  switch (model.label) {
    case 'capacidad-color':
      parts = [versionCapacity(product.specs), color];
      break;
    case 'modelo-color': {
      const sub = spec(product.specs, 'Modelo');
      parts = [sub ? without(sub, [model.name, model.brand]) || null : null, color];
      break;
    }
    case 'color':
      parts = [color];
      break;
    case 'nombre': {
      const rest = without(product.name.replace(/distribuidor autorizado/gi, ' '), [
        'Consola',
        model.brand,
        model.name,
        model.alias ?? '',
      ]);
      parts = [rest ? capitalize(shortProductName(rest, 60)) : null];
      break;
    }
  }
  const label = parts.filter((p): p is string => Boolean(p)).join(' · ');
  return label || shortProductName(product.name, 60);
}

// ---------------------------------------------------------------------------
// Textos (el formato del título lo aprueba el dueño).

/** Lo que sigue al nombre del modelo en el título. */
export const MODEL_TITLE_SUFFIX = ': precio en Chile e historial';
const SITE_SUFFIX = ' | ComparaTech';

/** El <title>: con "| ComparaTech" solo si cabe en lo que muestra Google. */
export function modelTitle(model: ModelDef): string {
  const base = `${model.name}${MODEL_TITLE_SUFFIX}`;
  return base.length + SITE_SUFFIX.length <= SEO_TITLE_MAX ? `${base}${SITE_SUFFIX}` : base;
}

/** El H1: corto, sin artículo (el iPhone, la PS5, el Kindle). */
export function modelHeading(model: ModelDef): string {
  return `${model.name}: precio en Chile`;
}

const versions = (n: number) => (n === 1 ? '1 versión' : `${n} versiones`);

/** Meta description: cuántas versiones, desde cuánto y que hay historial. */
export function modelMetaDescription(model: ModelDef, onSalePrices: number[]): string {
  if (onSalePrices.length === 0) {
    return `${model.name}: hoy sin versiones a la venta con vendedor de reputación verde en Mercado Libre Chile. Mira su historial de precios.`;
  }
  const min = Math.min(...onSalePrices);
  return `${model.name}: ${versions(onSalePrices.length)} a la venta en Mercado Libre Chile desde ${formatCLP(min)}. Mira el historial de precios y el más bajo que registramos.`;
}

/**
 * La primera frase de la página, con datos del día. Sin "el más barato" ni
 * recomendaciones: cuántas hay y entre qué precios. Sin artículo delante del
 * nombre ("versiones de PS5"): el iPhone, la PS5, el Kindle.
 */
export function modelIntro(model: ModelDef, onSalePrices: number[], pausedCount: number): string {
  const what = model.alias ? `${model.name} (${model.alias})` : model.name;
  if (onSalePrices.length === 0) {
    return `Hoy ninguna versión de ${what} tiene un vendedor con reputación verde en Mercado Libre. Abajo está el último precio que vimos de cada una.`;
  }
  const paused =
    pausedCount === 0
      ? ''
      : pausedCount === 1
        ? ' Otra no tiene vendedor con reputación verde hoy.'
        : ` Otras ${pausedCount} no tienen vendedor con reputación verde hoy.`;
  const min = Math.min(...onSalePrices);
  const max = Math.max(...onSalePrices);
  const range = min === max ? `a ${formatCLP(min)}` : `desde ${formatCLP(min)} hasta ${formatCLP(max)}`;
  return `Encontramos ${versions(onSalePrices.length)} de ${what} a la venta en Mercado Libre, ${range}.${paused} Revisamos los precios varias veces al día.`;
}
