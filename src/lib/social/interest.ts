/**
 * Puntaje de interés: en qué orden van los candidatos a redes (historias,
 * reels, publicaciones y Telegram).
 *
 * Antes se ordenaban por comisión estimada, así que arriba quedaba siempre lo
 * más caro. Acá se ordenan por lo que haría que alguien deje de deslizar y
 * toque: algo que la gente ya quiere, de una marca que reconoce, con una
 * oferta que se pueda sostener y a un precio que mucha gente pueda pagar. La
 * comisión cuenta, pero al final.
 *
 * Los puntos se suman por bloques, para que el dueño pueda seguir la cuenta
 * (27 + 7 + 25 + 10 + 9,3 + 5 = 83,3):
 *
 *   type        0-30  qué es (tabla de tipos)
 *   brand      -4-12  de quién es
 *   deal        0-25  qué tan real es la oferta: baja vista por el sitio (hasta 20)
 *                     más descuento sobre el precio de lista (hasta 10)
 *   reach       0-15  precio que mucha gente puede pagar
 *   commission  0-10  lo que deja, en escala logarítmica
 *   delivery    0-8   envío gratis, Full, lo vende Mercado Libre, garantía
 *   signals     0-6   (opcional) más vendidos de Mercado Libre y clics en el sitio.
 *                     Ordenan, pero no habilitan: el piso se mide sin ellas.
 *   penalties         lo que haría pasar vergüenza: ya estuvo más barato, otro vendedor
 *                     lo tiene a menos, vendedor casi sin ventas, precio que se
 *                     mueve (varios cambios en dos días, o muchos vendedores en
 *                     la ficha), no es nuevo, oferta chica, nombre que parte con
 *                     un código. Cada uno sale también en `warning`, que es lo
 *                     que hay que mirar a mano antes de publicar algo solo.
 *
 * Cuatro reglas de honestidad mandan sobre el resto:
 *   - si el sitio vio el producto más barato en los últimos 30 días, pierde
 *     puntos (y se dice: "hace poco estuvo a $X"), sea cual sea la oferta;
 *   - si estuvo 10% o más abajo, no se publica (`excluded`);
 *   - si el vendedor casi no tiene ventas y además otro lo ofrece a menos,
 *     tampoco se publica;
 *   - bajo MIN_INTEREST_POINTS no se publica nada, aunque falten candidatos.
 *     El piso se mide sin el bloque de señales (floorPoints): un clic se
 *     puede fabricar desde afuera, y con eso no se entra.
 *
 * Puro: sin I/O, sin fecha y sin azar. La misma entrada da siempre la misma
 * salida, en el servidor, en el navegador y en los tests. Las tablas y los
 * pesos están en lib/social/interest-tables.
 */

import { estimateCommission } from '@/lib/commission';
import { captionDiscount, formatPrice } from '@/lib/content/captions';
import { MIN_DROP_PCT } from '@/lib/deal-rank';
import { normalizeName } from '@/lib/text';
import {
  BEFORE_TARGET_BRAND,
  CATEGORY_FALLBACK,
  COMPATIBLE_BRAND,
  CONSOLE_NAMES,
  DEFAULT_FALLBACK,
  FIELD_ONLY_BRANDS,
  FORBIDDEN_WORDS,
  GAMER_HEADSET,
  GAMER_WORDS,
  GENERIC_BRAND,
  HERO_TYPES,
  HIGH_DESIRE,
  INTEREST_WEIGHTS as W,
  KNOWN_BRANDS,
  MIN_CREDIBLE_PRICE,
  NOT_A_BRAND,
  NOT_NEW,
  PLATFORM_WORDS,
  RETRO_CONSOLE,
  STAR_BRANDS,
  TYPES_NAMING_OTHER_BRANDS,
  TYPES_WITH_INCHES,
  TYPE_GROUPS,
  TYPE_OVERRIDES,
  TYPE_RULES,
  TYPE_RULES_BY_CATEGORY,
  type TypeRule,
} from '@/lib/social/interest-tables';

/** Lo que el puntaje necesita del producto (una fila de `products`). */
export interface InterestProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  price: number;
  original_price: number | null;
  seller_sales_count?: number | null;
  ml_root_category?: string | null;
  ml_category_id?: string | null;
  ml_family_id?: string | null;
  offer_info?: {
    free_shipping?: boolean | null;
    is_full?: boolean | null;
    official_store?: boolean | null;
    sold_by_ml?: boolean | null;
    is_lowest?: boolean | null;
    warranty?: string | null;
    /** Cuántos vendedores compiten en la misma ficha. */
    offers_count?: number | null;
  } | null;
}

/**
 * Lo que el sitio comprobó por su cuenta. `drop`, `min30` y `daysTracked`
 * salen del historial de precios (confirmedDrop y priceStats) y hay que
 * calcularlos para TODOS los candidatos, no solo para los que no llegan al
 * descuento mínimo. Las dos señales son opcionales: si faltan no restan.
 */
export interface InterestEvidence {
  drop: { pct: number; amount: number } | null;
  min30: number | null;
  daysTracked: number;
  /** Cambios de precio en las últimas 48 horas. */
  recentChanges?: number | null;
  /** El precio de hoy ya había regido hace poco: va y vuelve entre los mismos valores. */
  seesaw?: boolean | null;
  /**
   * El único precio que conocemos empezó con un cambio (en los últimos 30
   * días) y no quedó anotado cuánto costaba antes: no se sabe si subió o bajó.
   */
  changedFromUnknown?: boolean | null;
  /**
   * true si el historial NO se pudo leer. No es lo mismo que no tenerlo: de
   * este producto no se sabe si estuvo más barato, y se avisa.
   */
  historyUnread?: boolean | null;
  /** Puesto en los más vendidos de su categoría en Mercado Libre. */
  mlPosition?: number | null;
  /**
   * Clics recientes en el sitio. Un dato que viene de afuera: puede traer los
   * del propio dueño y se puede inflar a propósito, así que solo ordena (el
   * piso se mide sin él, ver floorPoints).
   */
  recentClicks?: number | null;
}

export interface InterestScore {
  points: number;
  /** Una frase para el dueño: qué es y por qué queda donde queda. Solo cosas que constan. */
  reason: string;
  /** Lo que le quitó puntos, en palabras simples. null si no hay nada que mirar a mano. */
  warning: string | null;
  /** Por qué no se publica, o null. Los puntos se calculan igual. */
  excluded: string | null;
  /** Tipo de producto para la regla de variedad. */
  typeKey: string;
  /** Marca para la regla de variedad; '' si no tiene. */
  brandKey: string;
  /** Los puntos bloque por bloque: sumados dan `points`. */
  breakdown: Record<string, number>;
}

/** El aviso de un producto cuyo historial no se pudo leer. Quien lo muestra puede reconocerlo por este texto. */
export const HISTORY_UNREAD_WARNING = 'hoy no se pudo leer su historial de precios';

/**
 * Piso bajo el que no se publica nada. Bajo estos puntos quedan los productos
 * sin marca, de tipos que nadie busca o con una oferta que no se sostiene:
 * mejor una historia menos que rellenar con el fondo de la lista.
 */
export const MIN_INTEREST_POINTS: number = 40;

/**
 * Los puntos con que se mide el piso: los del puntaje SIN el bloque de
 * señales.
 *
 * Los clics del sitio los puede mandar cualquiera (cambiando el navegador que
 * dice ser, una misma persona cuenta como doce), y el puesto entre los más
 * vendidos lo mueve quien vende. Si alcanzaran para pasar el piso, alguien de
 * afuera podría hacer que el sitio publique solo un producto que por lo suyo
 * no publicaría. Por eso las señales ordenan a los que ya pasan, y a ninguno
 * lo hacen pasar.
 *
 * Va con un decimal, como los puntos: es el número que se le muestra al dueño.
 */
export function floorPoints(score: Pick<InterestScore, 'points' | 'breakdown'>): number {
  const signals = score.breakdown ? score.breakdown.signals : undefined;
  const extra = typeof signals === 'number' && Number.isFinite(signals) && signals > 0 ? signals : 0;
  return round1(score.points - extra);
}

/**
 * ¿Llega al piso de interés? Es la única forma de preguntarlo: quien compare
 * `points` a mano estaría contando las señales. Un puntaje que no es un
 * número no llega.
 */
export function meetsInterestFloor(score: Pick<InterestScore, 'points' | 'breakdown'>, floor: number = MIN_INTEREST_POINTS): boolean {
  return floorPoints(score) >= floor;
}

/** Los bloques del desglose, con el nombre que se le muestra al dueño. */
export const BREAKDOWN_LABELS: Record<string, string> = {
  type: 'Tipo de producto',
  brand: 'Marca',
  deal: 'Oferta',
  reach: 'Alcance',
  commission: 'Comisión',
  delivery: 'Entrega y confianza',
  signals: 'Señales',
  penalties: 'Castigos',
};

// ---------------------------------------------------------------------------
// Utilidades

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  // Sin castigos la cuenta da -0: se deja en 0 para que el desglose no muestre un signo de más.
  return rounded === 0 ? 0 : rounded;
}

function normalize(text: unknown): string {
  return typeof text === 'string' ? normalizeName(text) : '';
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Busca en una tabla por una clave que viene de los datos: "constructor" no es una categoría. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/**
 * La parte del nombre que dice qué es el producto. Lo que viene después de
 * "para" o "compatible" dice con qué se usa: un "Smart Finder compatible con
 * iPhone" no es un iPhone.
 */
function headOf(name: string): string {
  if (/^(para|compatibles?) /.test(name)) return '';
  return name.split(/ (?:para|compatibles?) /)[0];
}

// ---------------------------------------------------------------------------
// Qué es: el tipo de producto

export interface InterestType {
  /** Cómo se nombra en la frase: "Smart TV", "Audífonos gamer". */
  label: string;
  /** Deseo 0-30. */
  desire: number;
  /** false si ninguna palabra del nombre dijo qué es y se usó la categoría. */
  recognised: boolean;
  /** Clave para la variedad: el grupo del tipo, o la categoría hoja de Mercado Libre. */
  key: string;
}

/**
 * La primera regla que aparece en el texto, entre las de la tabla y las
 * propias de la categoría. `maxDesire`: deseo máximo que se acepta.
 */
function firstRule(text: string, maxDesire: number, category: string): TypeRule | null {
  let best: TypeRule | null = null;
  let bestAt = Infinity;
  const ofCategory = own(TYPE_RULES_BY_CATEGORY, category);
  for (const rule of ofCategory ? TYPE_RULES.concat(ofCategory) : TYPE_RULES) {
    if (rule[2] > maxDesire) continue;
    const at = text.search(rule[0]);
    if (at >= 0 && at < bestAt) {
      best = rule;
      bestAt = at;
    }
  }
  return best;
}

function recognisedType(label: string, desire: number): InterestType {
  return { label, desire, recognised: true, key: TYPE_GROUPS[label] ?? label };
}

/**
 * El tipo que dicen las palabras del nombre, o null. Primero se mira el
 * nombre hasta "para" o "compatible"; si así no se reconoce, se mira entero,
 * pero entonces ya no puede salir uno de los tipos más deseados (un hub "para
 * Macbook" no es un notebook).
 */
function namedType(name: string, category: string): InterestType | null {
  const head = headOf(name);

  for (const rule of TYPE_OVERRIDES) {
    if (rule[0].test(head)) return recognisedType(rule[1], rule[2]);
  }

  const rule = firstRule(head, 30, category) ?? firstRule(name, HIGH_DESIRE - 1, category);
  if (rule) {
    if (rule[1] === 'Consola' && !PLATFORM_WORDS.test(name)) return recognisedType(RETRO_CONSOLE[0], RETRO_CONSOLE[1]);
    if (rule[1] === 'Audífonos' && GAMER_WORDS.test(name)) return recognisedType(GAMER_HEADSET[0], GAMER_HEADSET[1]);
    return recognisedType(rule[1], rule[2]);
  }

  // Sin ninguna palabra conocida, la categoría del sitio ayuda en dos casos:
  // un juego ("Star Fox Nintendo Switch 2") y un celular ("Honor X5c 4gb 128gb").
  if (category === 'gaming' && PLATFORM_WORDS.test(head)) return recognisedType('Videojuego', 19);
  if (category === 'celulares' && /\b\d+ ?gb\b/.test(head)) return recognisedType('Celular', 28);
  return null;
}

/**
 * Qué es el producto: lo que dice su nombre y, si no lo dice, su categoría.
 *
 * Con el precio a la vista hay un resguardo más: una consola, un celular, un
 * notebook, un televisor o una tablet que cuestan menos de lo creíble
 * (MIN_CREDIBLE_PRICE) son un accesorio con el nombre del aparato, y se
 * tratan como no reconocidos. Sin precio no se puede saber y vale el nombre.
 */
export function interestType(
  product: Pick<InterestProduct, 'name' | 'category' | 'ml_category_id'> & { price?: number | null }
): InterestType {
  const category = typeof product.category === 'string' ? product.category : '';
  const named = namedType(normalize(product.name), category);
  if (named) {
    const floor = own(MIN_CREDIBLE_PRICE, named.label);
    const price = positiveNumber(product.price);
    if (floor === undefined || price === null || price >= floor) return named;
  }

  const fallback = own(CATEGORY_FALLBACK, category) ?? DEFAULT_FALLBACK;
  const leaf = typeof product.ml_category_id === 'string' ? product.ml_category_id.trim() : '';
  return { label: fallback[0], desire: fallback[1], recognised: false, key: leaf || category || fallback[0] };
}

// ---------------------------------------------------------------------------
// De quién es: la marca

export interface InterestBrand {
  /** 2: se desea. 1: se conoce. 0: no la conocemos. -1: genérica o sin marca. */
  level: 2 | 1 | 0 | -1;
  /** Cómo se escribe en la frase, o null si no hay marca que decir. */
  label: string | null;
  /** Clave para la variedad: "Kobo" y "Rakuten Kobo" dan 'kobo'. '' si no tiene. */
  key: string;
}

const NO_BRAND: InterestBrand = { level: -1, label: null, key: '' };

/** Una marca desconocida más larga que esto no se escribe en la frase. */
const BRAND_LABEL_MAX = 24;

/**
 * La marca de las tablas que aparece primero en el texto, como palabra
 * completa. Si dos parten en el mismo lugar gana la más larga ("Logitech G"
 * antes que "Logitech").
 */
function lookupBrand(text: string, fromName: boolean): InterestBrand | null {
  const padded = ` ${text} `;
  let best: InterestBrand | null = null;
  let bestAt = Infinity;
  let bestLength = 0;
  const tables: [Record<string, string>, 2 | 1][] = [
    [STAR_BRANDS, 2],
    [KNOWN_BRANDS, 1],
  ];
  for (const [table, level] of tables) {
    for (const key of Object.keys(table)) {
      if (fromName && FIELD_ONLY_BRANDS[key]) continue;
      const at = padded.indexOf(` ${key} `);
      if (at < 0) continue;
      if (at < bestAt || (at === bestAt && key.length > bestLength)) {
        best = { level, label: table[key], key: normalizeName(table[key]) };
        bestAt = at;
        bestLength = key.length;
      }
    }
  }
  return best;
}

/** El campo trae una marca de las tablas, pero no consta que sea la del producto: ni suma ni se nombra. */
const UNCONFIRMED_BRAND: InterestBrand = { level: 0, label: null, key: '' };

/** Las marcas de las tablas que parten en `tokens[at]`: [cómo se escribe, cuántas palabras ocupa], la más larga primero. */
function brandsAt(tokens: string[], at: number): [string, number][] {
  const found: [string, number][] = [];
  for (let words = Math.min(3, tokens.length - at); words >= 1; words--) {
    const key = tokens.slice(at, at + words).join(' ');
    const label = own(STAR_BRANDS, key) ?? own(KNOWN_BRANDS, key);
    if (label) found.push([label, words]);
  }
  return found;
}

/**
 * ¿El nombre trae la marca solo como aquello con lo que el producto se usa
 * ("Cargador Original 45w Para Samsung", "compatible con iPhone y Samsung")?
 * Tiene que venir pegada a "para" o "compatible", sola o en una lista de
 * marcas: en "Impresora Para Niños Mlab" la marca sigue siendo Mlab.
 */
function namedOnlyAsTarget(name: string, label: string): boolean {
  const head = headOf(name);
  const isIt = (brands: [string, number][]) => brands.some((brand) => brand[0] === label);

  const tail = name.slice(head.length).trim().split(' ');
  let asTarget = false;
  for (let i = 0; i < tail.length && !asTarget; i++) {
    if (!/^(para|compatibles?)$/.test(tail[i])) continue;
    let j = i + 1;
    while (j < tail.length && !asTarget) {
      const brands = brandsAt(tail, j);
      if (isIt(brands)) asTarget = true;
      else if (brands.length > 0) j += brands[0][1];
      else if (BEFORE_TARGET_BRAND.test(tail[j])) j++;
      else break;
    }
  }
  if (!asTarget) return false;

  // Si también está en la parte que dice qué es el producto, es su marca.
  const headTokens = head.split(' ');
  return !headTokens.some((_, at) => isIt(brandsAt(headTokens, at)));
}

/**
 * La marca y qué tan conocida es.
 *
 * Manda el campo `brand`. Si dice "Genérica" o "Compatible con…", el producto
 * no tiene marca y no se le busca una en el nombre (una funda para Kindle no
 * es Amazon). Si el campo trae una marca conocida pero el nombre la nombra
 * solo como "para Samsung", no consta que sea suya: queda como desconocida y
 * no se escribe (un cargador "Para Samsung" de un vendedor cualquiera no es
 * un cargador Samsung). Una marca real que no está en las tablas se queda
 * como desconocida: no se cambia por otra que aparezca en el nombre (un
 * televisor iFFALCON con Roku TV no es Roku). Solo cuando el campo viene
 * vacío o trae algo que no es una marca se miran las primeras palabras del
 * nombre, y ni así en un soporte, un cable o un cargador, que nombran las
 * marcas con las que sirven.
 */
export function interestBrand(product: Pick<InterestProduct, 'name' | 'brand'>): InterestBrand {
  const field = normalize(product.brand);
  if (field && (GENERIC_BRAND.test(field) || COMPATIBLE_BRAND.test(field))) return NO_BRAND;

  const name = normalize(product.name);
  if (field) {
    const byField = lookupBrand(field, false);
    if (byField) return byField.label !== null && namedOnlyAsTarget(name, byField.label) ? UNCONFIRMED_BRAND : byField;
  }

  const notABrand = !field || NOT_A_BRAND.test(field) || field.split(' ').length > 3;
  if (!notABrand) {
    const typed = String(product.brand).replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim();
    return { level: 0, label: typed && typed.length <= BRAND_LABEL_MAX ? typed : null, key: field };
  }

  const head = headOf(name);
  const rule = firstRule(head, 30, '');
  if (rule && TYPES_NAMING_OTHER_BRANDS[rule[1]]) return NO_BRAND;
  return lookupBrand(head.split(' ').slice(0, 4).join(' '), true) ?? NO_BRAND;
}

// ---------------------------------------------------------------------------
// Detalles del nombre

/**
 * Pulgadas de un televisor o monitor, si el nombre las dice.
 *
 * El número se lee entero, con sus decimales ('21.45"' son 21 pulgadas, no
 * 45; '23,8"' se dice 24). Un número suelto después de "TV" o "LED", o al
 * inicio del nombre, vale solo si no trae otra unidad: "Led 60 Hz" y "24
 * Meses Garantía" no son pulgadas.
 */
function inchesOf(rawName: string): number | null {
  const raw = rawName.toLowerCase();
  const match =
    raw.match(/(?:^|[^\d.,])(\d{2,3})(?:[.,](\d{1,2}))?\s*(?:"|''|\u201d|\u2033|pulgadas|pulg\b|in\b)/) ||
    raw.match(
      /\b(?:tv|led|qled|smart tv)\s+(?:led\s+)?(\d{2,3})(?:[.,](\d{1,2}))?\b(?!\s*(?:hz|w|v|ms|cm|mm|fps|nits|meses|a(?:n|\u00f1)os|d(?:i|\u00ed)as)\b)/
    ) ||
    raw.match(/^(\d{2,3})(?:[.,](\d{1,2}))?(?=\s)(?!\s*(?:hz|w|v|ms|cm|mm|fps|nits|meses|a(?:n|\u00f1)os|d(?:i|\u00ed)as)\b)/);
  if (!match) return null;
  const inches = Math.round(Number(match[2] ? `${match[1]}.${match[2]}` : match[1]));
  return inches >= 19 && inches <= 100 ? inches : null;
}

/**
 * ¿El nombre parte con un código de modelo ("FA607NUQ-RL060W AMD Ryzen…")?
 * En una historia ese nombre no le dice nada a nadie.
 */
function startsWithCode(rawName: string): boolean {
  const first = rawName.trim().split(/\s+/)[0] || '';
  return first.length >= 6 && /[a-z]/i.test(first) && /\d{2,}/.test(first);
}

/** Garantía de fábrica, o de 12 meses o más. */
function hasGoodWarranty(warranty: unknown): boolean {
  const text = normalize(warranty);
  if (!text) return false;
  if (/\bfabrica\b/.test(text)) return true;
  const match = text.match(/(\d+) ?(mes|meses|ano|anos)\b/);
  if (!match) return false;
  const months = Number(match[1]) * (match[2].charAt(0) === 'a' ? 12 : 1);
  return months >= 12;
}

// ---------------------------------------------------------------------------
// La frase

const REASON_MAX = 120;

/** ¿El texto trae alguna de las palabras que el sitio no usa? Se compara palabra por palabra. */
export function hasForbiddenWord(text: string): boolean {
  const padded = ` ${normalizeName(text)} `;
  for (const word of FORBIDDEN_WORDS) {
    if (padded.indexOf(` ${word} `) >= 0) return true;
  }
  return false;
}

interface ReasonFacts {
  typeLabel: string;
  brandLabel: string | null;
  inches: number | null;
  /** La baja, si se usa como prueba. */
  drop: { pct: number; amount: number } | null;
  shortHistory: boolean;
  /** Descuento sobre el precio de lista, en % entero. */
  discount: number;
  /** true si la baja dio más puntos que el descuento de lista. */
  dropFirst: boolean;
  /** Desde qué descuento la cifra se le atribuye al vendedor. */
  sellerFigureFrom: number;
  extras: string[];
}

function dropPhrase(facts: ReasonFacts, withAmount: boolean): string {
  const drop = facts.drop;
  if (!drop) return '';
  let phrase = `bajó ${Math.round(drop.pct)}% según nuestro historial`;
  if (withAmount && drop.amount >= 5000) phrase += ` (${formatPrice(drop.amount)} menos)`;
  // Una baja vista con tan poco historial puede ser un vaivén: se dice.
  if (facts.shortHistory) phrase += ', pero lo seguimos hace menos de dos días';
  return phrase;
}

function listPhrase(facts: ReasonFacts): string {
  if (facts.discount <= 0) return '';
  // "Por debajo del", nunca "bajo el": sin el acento se lee "bajó".
  let phrase = `${facts.discount}% por debajo del precio de lista`;
  // De 50% para arriba casi siempre es una lista inflada: la cifra es del vendedor, no nuestra.
  // Si no es tienda oficial ni Mercado Libre, se le atribuye desde antes.
  if (facts.discount >= facts.sellerFigureFrom) phrase += ' (cifra del vendedor)';
  return phrase;
}

function assembleReason(facts: ReasonFacts, withBrand: boolean): string {
  const subject = (inches: boolean, brand: boolean) =>
    facts.typeLabel +
    (brand && facts.brandLabel ? ` ${facts.brandLabel}` : '') +
    (inches && facts.inches ? ` de ${facts.inches} pulgadas` : '');

  const proofs = (withAmount: boolean): [string, string] => {
    const byDrop = dropPhrase(facts, withAmount);
    const byList = listPhrase(facts);
    if (byDrop && (facts.dropFirst || !byList)) return [byDrop, byList ? `y está ${byList}` : ''];
    if (byList) return [byList, byDrop ? `y ${byDrop}` : ''];
    return ['sin descuento ni baja registrada', ''];
  };

  // De la versión más completa a la más corta: lo primero que se sacrifica
  // es el monto, después las pulgadas y al final la marca.
  const attempts: [boolean, boolean, boolean][] = [
    [true, true, withBrand],
    [false, true, withBrand],
    [false, false, withBrand],
    [false, false, false],
  ];
  let text = '';
  let secondary = '';
  for (const [withAmount, inches, brand] of attempts) {
    const [main, second] = proofs(withAmount);
    text = `${subject(inches, brand)}, ${main}`;
    secondary = second;
    if (text.length <= REASON_MAX) break;
  }

  if (secondary && text.length + 1 + secondary.length <= REASON_MAX) text += ` ${secondary}`;
  let added = 0;
  for (const extra of facts.extras) {
    if (added >= 2) break;
    if (text.length + 2 + extra.length > REASON_MAX) continue;
    text += `, ${extra}`;
    added++;
  }
  return text;
}

/** Largo máximo del aviso. Si no caben todos, se dicen los más graves y cuántos quedan. */
const WARNING_MAX = 120;

function joinWarnings(warnings: string[]): string | null {
  if (warnings.length === 0) return null;
  let text = warnings[0];
  let used = 1;
  while (used < warnings.length) {
    const left = warnings.length - used - 1;
    const tail = left > 0 ? ` (y ${left} más)` : '';
    if (text.length + 2 + warnings[used].length + tail.length > WARNING_MAX) break;
    text += `; ${warnings[used]}`;
    used++;
  }
  const left = warnings.length - used;
  return left > 0 ? `${text} (y ${left} más)` : text;
}

function buildReason(facts: ReasonFacts): string {
  const full = assembleReason(facts, true);
  // La marca viene de Mercado Libre: si trajera una palabra que el sitio no usa, se omite.
  return hasForbiddenWord(full) ? assembleReason(facts, false) : full;
}

// ---------------------------------------------------------------------------
// El puntaje

/**
 * Cuánto interesa publicar este producto. Ver el encabezado del archivo para
 * los bloques. Para ordenar: puntos, después comisión, después id
 * (compareByInterest).
 */
export function interestScore(product: InterestProduct, evidence: InterestEvidence): InterestScore {
  const info = product.offer_info ?? {};
  const rawName = typeof product.name === 'string' ? product.name : '';
  const price = positiveNumber(product.price) ?? 0;
  const original = positiveNumber(product.original_price);
  const discount = price > 0 ? captionDiscount({ price, original_price: original }) : 0;
  const commissionPesos = estimateCommission(price, product.ml_root_category ?? null);

  const type = interestType(product);
  const brand = interestBrand(product);
  const official = info.official_store === true;
  const soldByMl = info.sold_by_ml === true;
  // Las ventas del vendedor, solo cuando el número se conoce: un dato que falta no se castiga ni se afirma.
  const rawSales = product.seller_sales_count;
  const sales = typeof rawSales === 'number' && Number.isFinite(rawSales) && rawSales >= 0 ? rawSales : null;
  // A una tienda oficial o a Mercado Libre no se les mira el contador: null también para ellos.
  const ownSales = official || soldByMl ? null : sales;

  // Lo que el sitio comprobó. Cualquier número que no sea válido se trata como "no hay dato".
  const ev = evidence ?? { drop: null, min30: null, daysTracked: 0 };
  const days = positiveNumber(ev.daysTracked) !== null ? Math.floor(ev.daysTracked) : 0;
  const min30 = positiveNumber(ev.min30);
  const dropPct = ev.drop ? positiveNumber(ev.drop.pct) : null;
  const dropAmount = ev.drop ? positiveNumber(ev.drop.amount) : null;
  const drop =
    price > 0 && dropPct !== null && dropAmount !== null && dropPct >= MIN_DROP_PCT
      ? { pct: Math.min(dropPct, 100), amount: dropAmount }
      : null;
  const shortHistory = days < 2;

  // 1. Tipo y 2. marca.
  const typePoints = type.desire;
  const brandPoints =
    brand.level === 2 ? W.brandStar : brand.level === 1 ? W.brandKnown : brand.level === 0 ? W.brandUnknown : W.brandGeneric;

  // 3. Qué tan real es la oferta.
  //    La baja que vimos nosotros vale hasta 20: pesa por su porcentaje, por
  //    su monto en pesos y por los días que llevamos siguiendo el producto.
  let dropPoints = 0;
  if (drop) {
    const byAmount = clamp(W.dropAmountBase + W.dropAmountPerDecade * Math.log10(drop.amount / 1000), W.dropAmountBase, 1);
    const byDays = W.dropByDays[Math.min(days, W.dropByDays.length - 1)];
    dropPoints = W.drop * (Math.min(drop.pct, W.dropFullAtPct) / W.dropFullAtPct) * byAmount * byDays;
  }
  //    El descuento sobre el precio de lista lo informa el vendedor: vale
  //    hasta 10, según cuánto se le cree a quien lo dice. Se cuenta desde
  //    10%, no suma pasar de 40% y sobre 50% va restando de a poco (a 80% ya
  //    no vale nada), sin saltos.
  let trust = Math.min(
    1,
    (brand.level === 2
      ? W.listTrustStar
      : brand.level === 1
        ? W.listTrustKnown
        : brand.level === 0
          ? W.listTrustUnknown
          : W.listTrustGeneric) +
      (official ? W.listTrustOfficialStore : 0) +
      (soldByMl ? W.listTrustSoldByMl : 0)
  );
  //    Un vendedor chico que no es tienda oficial puede poner la marca y la
  //    lista que quiera (un parlante JBL "44% más barato" que cuesta lo mismo
  //    en la tienda de JBL): la marca no le presta su confianza.
  if (ownSales !== null && ownSales < W.listTrustSmallSellerBelow) trust = Math.min(trust, W.listTrustUnknown);
  const listSpan = W.listFullAtPct - W.listFromPct;
  const faded = Math.max(0, discount - W.listFadesFromPct);
  const counted = clamp(Math.min(discount, W.listFullAtPct) - W.listFromPct - faded, 0, listSpan);
  //    Con menos de dos días de historial no se pudo comprobar si estuvo más barato: vale un poco menos.
  const listPoints = W.list * (counted / listSpan) * trust * (shortHistory ? W.listShortHistory : 1);
  const dealPoints = Math.min(W.deal, dropPoints + listPoints);

  // 8 y 9 (se calculan acá porque el alcance los necesita). ¿El sitio lo vio
  //    más barato en los últimos 30 días? Vale para toda oferta, también las
  //    de precio de lista.
  //    Con dos decimales: que un 3% justo no cuente como "más de 3%" por un redondeo.
  const abovePct = min30 !== null && price > min30 ? Math.round((price / min30 - 1) * 10000) / 100 : 0;
  const seenCheaper = abovePct > W.seenCheaperFromPct;
  const notLowest = info.is_lowest === false;
  const fewSales = ownSales !== null && ownSales < W.fewSalesBelow;
  //    ¿El precio se mueve? Lo que se publica lleva el precio escrito.
  const rawChanges = ev.recentChanges;
  const changes =
    typeof rawChanges === 'number' && Number.isFinite(rawChanges) && rawChanges >= 0 ? Math.min(99, Math.floor(rawChanges)) : 0;
  const movingPrice = changes >= W.movingPriceFromChanges || ev.seesaw === true;
  const rawSellers = info.offers_count;
  // Más de mil vendedores en una ficha no es un dato, es un error: se trata como si no viniera.
  const sellers =
    typeof rawSellers === 'number' && Number.isFinite(rawSellers) && rawSellers >= 0 && rawSellers <= 1000
      ? Math.floor(rawSellers)
      : null;
  const manySellers = sellers !== null && sellers >= W.manySellersFrom;

  // 4. Alcance: hasta $30.000 lo puede pagar casi cualquiera; de ahí baja de
  //    a poco ($100.000 vale dos tercios, $300.000 un tercio).
  let reachPoints = 0;
  if (price > 0) {
    reachPoints =
      price <= W.reachFullUntil
        ? W.reach
        : clamp(W.reach * (1 - Math.log10(price / W.reachFullUntil) / W.reachDecades), W.reachMin, W.reach);
  }
  //    Lo caro que igual hace mirar: una consola, un celular, un televisor o
  //    un notebook con una baja de verdad, de un vendedor de confianza y que
  //    no estuvo más barato hace poco. La noticia llega aunque pocos lo compren.
  const trustedSeller = official || soldByMl || (sales !== null && sales >= W.heroMinSales);
  const hero =
    HERO_TYPES[type.label] === true &&
    drop !== null &&
    drop.pct >= W.heroMinDropPct &&
    drop.amount >= W.heroMinDropAmount &&
    days >= W.heroMinDays &&
    trustedSeller &&
    !notLowest &&
    !seenCheaper &&
    !movingPrice &&
    ev.changedFromUnknown !== true;
  if (hero) reachPoints = Math.max(reachPoints, W.heroReach);

  // 5. Comisión: cuenta, pero en escala logarítmica. $500 o menos no suma;
  //    $4.000 suma la mitad; de $30.000 para arriba, el tope.
  const commissionPoints =
    commissionPesos <= W.commissionFrom
      ? 0
      : W.commission *
        clamp(Math.log10(commissionPesos / W.commissionFrom) / Math.log10(W.commissionFullAt / W.commissionFrom), 0, 1);

  // 6. Entrega y confianza.
  let deliveryPoints = 0;
  if (info.free_shipping === true) deliveryPoints += W.freeShipping;
  if (info.is_full === true) deliveryPoints += W.full;
  if (soldByMl) deliveryPoints += W.soldByMl;
  if (hasGoodWarranty(info.warranty)) deliveryPoints += W.warranty;

  // 7. Señales opcionales. Chicas y con tope: con pocos datos, que el orden
  //    no lo decida el ruido. Lo que no sea un número válido se ignora.
  const position =
    typeof ev.mlPosition === 'number' && Number.isInteger(ev.mlPosition) && ev.mlPosition >= 1 ? ev.mlPosition : null;
  const clicks =
    typeof ev.recentClicks === 'number' &&
    Number.isFinite(ev.recentClicks) &&
    ev.recentClicks >= W.clicksMin &&
    ev.recentClicks <= W.clicksSaneMax
      ? Math.floor(ev.recentClicks)
      : 0;
  let signalPoints = 0;
  if (position !== null) {
    for (const [until, stepPoints] of W.positionSteps) {
      if (position <= until) {
        signalPoints += stepPoints;
        break;
      }
    }
  }
  //    Clics: 1 punto con 3, 2 con 6, 3 con 12 o más.
  if (clicks > 0) signalPoints += Math.min(W.clicksMax, 1 + Math.log2(clicks / W.clicksMin));
  signalPoints = Math.min(W.signals, signalPoints);

  // 8. Castigos, cada uno con su aviso, del más grave al menos grave.
  let penalty = 0;
  const warnings: string[] = [];
  const weakDeal = dealPoints < W.weakDealBelow;
  if (seenCheaper && min30 !== null) {
    penalty += Math.min(W.seenCheaperMax, W.seenCheaperPerPct * (abovePct - W.seenCheaperFromPct));
    warnings.push(`hace poco estuvo a ${formatPrice(min30)}`);
  }
  if (notLowest) {
    penalty += W.penaltyNotLowest;
    warnings.push('otro vendedor lo ofrece a menos');
  }
  if (fewSales) {
    penalty += W.penaltyFewSales;
    warnings.push(`vendedor con pocas ventas (${Math.floor(ownSales as number)})`);
  }
  // Sin castigo en puntos: no es un defecto del producto, es que hoy no se pudo comprobar.
  if (ev.historyUnread === true) warnings.push(HISTORY_UNREAD_WARNING);
  if (ev.changedFromUnknown === true) warnings.push('cambió de precio y no sabemos cuánto costaba antes');
  if (movingPrice) {
    penalty += W.penaltyMovingPrice;
    warnings.push(
      changes >= W.movingPriceFromChanges
        ? `el precio cambió ${changes} veces en dos días`
        : 'el precio va y vuelve entre los mismos valores'
    );
  }
  if (manySellers) {
    penalty += W.penaltyManySellers;
    warnings.push(`${sellers} vendedores en la ficha: el precio puede cambiar`);
  }
  if (NOT_NEW.test(normalize(rawName))) {
    penalty += W.penaltyRefurbished;
    warnings.push('no es nuevo');
  }
  if (weakDeal) {
    penalty += W.penaltyWeakDealPerPoint * (W.weakDealBelow - dealPoints);
    // Un 40% de lista que casi no suma puntos no es "chico": es que no hay quién lo respalde.
    warnings.push(
      dealPoints <= 0 ? 'sin oferta que mostrar' : discount >= 30 ? 'descuento de lista con poco respaldo' : 'la oferta es chica'
    );
  }
  if (startsWithCode(rawName)) {
    penalty += W.penaltyCodeName;
    warnings.push('el nombre parte con un código');
  }

  // 9. Lo que no se publica.
  let excluded: string | null = null;
  if (price <= 0) {
    excluded = 'sin precio válido';
  } else if (min30 !== null && price * 100 >= min30 * (100 + W.excludeAbovePct)) {
    // Se compara sin redondear: 9,999% arriba todavía no es "10% o más".
    excluded = `hoy cuesta ${Math.round(abovePct)}% más de lo que llegó a costar en 30 días (${formatPrice(min30)})`;
  } else if (fewSales && notLowest) {
    // Cada alerta sola es un castigo; juntas son justo lo que la cuenta no debe publicar.
    excluded = 'vendedor con pocas ventas y otro vendedor lo ofrece a menos';
  }

  const breakdown: Record<string, number> = {
    type: round1(typePoints),
    brand: round1(brandPoints),
    deal: round1(dealPoints),
    reach: round1(reachPoints),
    commission: round1(commissionPoints),
    delivery: round1(deliveryPoints),
    signals: round1(signalPoints),
    penalties: round1(-penalty),
  };
  // Se suman los bloques ya redondeados: la cuenta que ve el dueño cuadra.
  let points = 0;
  for (const key of Object.keys(breakdown)) points += breakdown[key];
  points = round1(points);

  // La frase. Una consola se conoce por su nombre, no por el fabricante.
  let brandLabel = brand.label;
  let brandKey = brand.key;
  if (type.label === 'Consola') {
    const name = normalize(rawName);
    for (const [pattern, label] of CONSOLE_NAMES) {
      if (pattern.test(name)) {
        brandLabel = label;
        brandKey = normalizeName(label);
        break;
      }
    }
  }

  const extras: string[] = [];
  // "Figuró", no "va": la posición viene de una revisión que puede tener días.
  if (position !== null && position <= 20) extras.push(`figuró ${position}.º entre los más vendidos de su categoría`);
  if (clicks > 0) extras.push(`lleva ${clicks} clics recientes en el sitio`);
  if (info.is_full === true && info.free_shipping === true) extras.push('llega con Full y envío gratis');
  else if (info.is_full === true) extras.push('llega con Full');
  else if (info.free_shipping === true) extras.push('con envío gratis');
  if (soldByMl) extras.push('lo vende Mercado Libre');
  else if (official) extras.push('de tienda oficial');

  const reason = buildReason({
    typeLabel: type.label,
    brandLabel,
    inches: TYPES_WITH_INCHES[type.label] ? inchesOf(rawName) : null,
    drop,
    shortHistory,
    discount,
    dropFirst: dropPoints > 0 && dropPoints >= listPoints,
    sellerFigureFrom: official || soldByMl ? W.listFadesFromPct : W.sellerFigureFromPct,
    extras,
  });

  return {
    points,
    reason,
    warning: joinWarnings(warnings),
    excluded,
    typeKey: type.key,
    brandKey,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Orden y variedad

/** El orden de los candidatos: puntos, después comisión, después id. */
export function compareByInterest(
  a: { id: string; commission: number; score: InterestScore },
  b: { id: string; commission: number; score: InterestScore }
): number {
  return b.score.points - a.score.points || b.commission - a.commission || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Qué se publica de la lista: los de más puntos, sin repetir.
 *
 * Quedan fuera los excluidos y los que no llegan al piso (medido sin las
 * señales, ver floorPoints: las señales solo cambian el orden entre los que
 * ya entraron). Después se toman hasta `max`, con a lo más `perCategory` por
 * categoría del sitio, `perType` por tipo de producto, `perBrand` por marca y
 * uno por familia (dos colores del mismo modelo son el mismo post).
 *
 * Si así no se junta la cantidad pedida (un día con pocas ofertas), una
 * segunda vuelta deja repetir tipo y marca. La categoría, la familia, los
 * excluidos y el piso no se sueltan nunca. El resultado va en orden de
 * puntos y no depende del orden de entrada.
 */
export function pickVaried<
  T extends { id: string; category: string; familyId: string | null; commission: number; score: InterestScore },
>(
  candidates: T[],
  limits: { max: number; perCategory: number; perType: number; perBrand: number; minPoints?: number }
): T[] {
  const floor = limits.minPoints ?? MIN_INTEREST_POINTS;
  const seen = new Set<string>();
  const sorted = candidates
    .filter((c) => c.score.excluded === null && Number.isFinite(c.score.points) && meetsInterestFloor(c.score, floor))
    .sort(compareByInterest)
    // El mismo producto dos veces en la entrada cuenta una sola.
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));

  const perCategory = new Map<string, number>();
  const perType = new Map<string, number>();
  const perBrand = new Map<string, number>();
  const families = new Set<string>();
  const picked = new Set<string>();

  for (let pass = 0; pass < 2 && picked.size < limits.max; pass++) {
    const strict = pass === 0;
    for (const item of sorted) {
      if (picked.size >= limits.max) break;
      if (picked.has(item.id)) continue;
      if (item.familyId && families.has(item.familyId)) continue;
      if ((perCategory.get(item.category) ?? 0) >= limits.perCategory) continue;
      const typeKey = item.score.typeKey;
      const brandKey = item.score.brandKey;
      if (strict && typeKey && (perType.get(typeKey) ?? 0) >= limits.perType) continue;
      // Los productos sin marca no se limitan entre sí: no son "la misma marca".
      if (strict && brandKey && (perBrand.get(brandKey) ?? 0) >= limits.perBrand) continue;

      if (item.familyId) families.add(item.familyId);
      perCategory.set(item.category, (perCategory.get(item.category) ?? 0) + 1);
      if (typeKey) perType.set(typeKey, (perType.get(typeKey) ?? 0) + 1);
      if (brandKey) perBrand.set(brandKey, (perBrand.get(brandKey) ?? 0) + 1);
      picked.add(item.id);
    }
  }
  return sorted.filter((item) => picked.has(item.id));
}
