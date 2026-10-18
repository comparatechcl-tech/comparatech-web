const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g'); // U+0300–U+036F, marcas diacríticas combinadas

// Quita tildes/diéresis para comparar texto sin importar cómo lo haya
// escrito el usuario ("audifonos" vs "audífonos") — muy común que la gente
// no tipee tildes al buscar.
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS_RE, '');
}

// Google corta las meta descriptions alrededor de los 155-160 caracteres.
// Cortamos nosotros en el espacio anterior para no dejar una palabra partida
// al medio ni un "..." dentro de una cifra.
export function truncateAtWord(text: string, maxLength = 155): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxLength) return clean;

  const cut = clean.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, '')}…`;
}

/**
 * Nombre comparable: sin tildes, mayúsculas ni puntuación. Mercado Libre a
 * veces tiene el mismo artículo en fichas de catálogo distintas —había tres
 * "Audifonos Bluetooth Inalámbricos Blik Air500 Blanco", cada una con su
 * propia ficha y su propia familia—, y por familia no se detectan.
 */
export function normalizeName(name: string): string {
  return stripDiacritics(name.toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
}

// "… - Color Light Gold", "… Color Rosa", "… - Color plata - Distribuidor
// Autorizado": desde la palabra "Color" en adelante es la variante, no el
// producto.
const COLOR_SUFFIX_RE = /[\s\-–—,|•]*\bcolor\b.*$/i;
// Coletilla que ML agrega a las tiendas oficiales de Apple y no dice nada
// del producto.
const AUTHORIZED_SUFFIX_RE = /[\s\-–—,|•]*distribuidor autorizado\s*$/i;
const TRAILING_JUNK_RE = /[\s\-–—,;:|•/(+]+$/;
// Un corte que termina en "… con" o "… con 20" (de "con 20 horas") deja la
// frase colgando: esa cola se saca.
const TRAILING_CONNECTOR_RE = /\s+(?:con|de|del|y|e|o|para|en|a|al|la|el|los|las|por|sin|tipo)(?:\s+[\d.,]+)?$/i;

/** Si el recorte deja menos que esto, mejor el nombre original. */
const MIN_SHORT_NAME = 8;

// ---------------------------------------------------------------------------
// Códigos de fábrica.
//
// "Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3": el "Asm-r390nidalta" es
// el código de artículo del fabricante (Samsung, Midea, Kingston, HP, SanDisk
// los ponen en el título de ML) y no le dice nada a nadie. Se reconoce por la
// forma, sin una lista de marcas:
//  - lleva letras y números, y al menos CODE_MIN_CHARS de ellos sin contar
//    guiones ni barras. Los modelos que la gente recuerda son más cortos:
//    "S45AR", "WH-1000XM5", "VG249Q5A", "TL-WA850RE", "i5-13420H";
//  - y además mezcla letras y números más de una vez en un mismo tramo
//    ("r390nidalta": letra, número, letras), o en tres tramos o más
//    ("Al14-31p-31th-1");
//  - no es una medida ("100x60x74cm", "520/450mbps", "12GB+256GB"), ni una
//    lista ("Gt2/gt2e/gt2pro/gt3pro"), ni un nombre pegado a su número
//    ("Centrophorus2", "Buenas3D-Silk", "Eap225-outdoor", "OLED55C3PSA").
//
// Solo se quitan en el nombre que va escrito en el reel (reelProductName). En
// la ficha, el <title>, las redes y Telegram el código sí sirve: es lo que se
// busca en Google, y en un televisor ("Un55u8000h") o una memoria
// ("KVR32S22S8/8") es el modelo.

/** Letras y números (sin guiones ni barras) desde los que un modelo deja de ser algo que la gente recuerde. */
const CODE_MIN_CHARS = 10;
const CODE_SHAPE_RE = /^[a-z0-9]+(?:[-/._+][a-z0-9]+)*$/i;
const EDGE_PUNCTUATION_RE = /^[^a-z0-9]+|[^a-z0-9]+$/gi;
const CODE_SEPARATOR_RE = /[-/._+]/;
// Una cifra con su unidad, o varias unidas por x, guion, barra o +.
const UNIT =
  '(?:mah|mts?|mm|cm|km|m|tb|gb|mb|kb|kg|grs?|g|ghz|mhz|hz|kw|w|kva|va|v|ma|a|litros|lts?|ml|l|cc|mpx|mp|px|p|fps|ms|gbps|mbps|kbps|k|inch|in|pulgadas|hrs?|hs|h|db|lm|rpm)';
const MEASURE_RE = new RegExp(`^\\d+(?:[.,]\\d+)?${UNIT}?(?:[x*/+-]\\d+(?:[.,]\\d+)?${UNIT}?)*$`, 'i');

/** ¿Es una palabra? Cuatro letras o más, con dos vocales y sin tres consonantes seguidas ("Buenas", "OLED"; no "Boobgm" ni "SDSQUNR"). */
function looksLikeWord(run: string): boolean {
  return (
    run.length >= 4 && /^[a-z]+$/i.test(run) && (run.match(/[aeiou]/gi) ?? []).length >= 2 && !/[^aeiou]{3}/i.test(run)
  );
}

/** ¿Es un código de artículo del fabricante? Ver arriba. Pura. */
export function isFactoryCode(token: string): boolean {
  const core = token.replace(EDGE_PUNCTUATION_RE, '');
  const chars = core.replace(/[^a-z0-9]/gi, '');
  if (chars.length < CODE_MIN_CHARS || !/[a-z]/i.test(chars) || !/\d/.test(chars)) return false;
  if (!CODE_SHAPE_RE.test(core) || MEASURE_RE.test(core)) return false;
  if (core.split('/').length >= 3) return false;

  let mixed = 0;
  for (const segment of core.split(CODE_SEPARATOR_RE)) {
    const runs = segment.match(/[a-z]+|\d+/gi) ?? [];
    if (runs.length >= 2) mixed++;
    if (runs.length >= 3 && !looksLikeWord(runs[0] ?? '')) return true;
  }
  return mixed >= 3;
}

/** ¿Es una cifra con su unidad ("8GB", "1300W", "2.4GHz", "4G", "10/100/1000", "43\"")? Sin contar los signos de alrededor. Pura. */
export function isMeasure(token: string): boolean {
  return MEASURE_RE.test(token.replace(EDGE_PUNCTUATION_RE, ''));
}

// "Cargador para <código>", "compatible con <código>": el código dice con qué
// calza y sin él la frase queda colgando. Ahí se queda.
const LEADS_TO_CODE_RE = /^(?:con|de|del|y|e|o|u|para|en|a|al|por|sin|tipo|compatibles?|modelo|mod|for)$/i;

// En un repuesto o un consumible, el número de parte es lo que dice con qué
// equipo calza ("Cargador Para Notebook Lenovo Adlx65ndc3a") o cuál es
// exactamente ("Kingston ValueRAM KVR32S22S8/8 Memoria RAM"): no se quita
// ningún código. La lista sale del catálogo (sin tildes ni mayúsculas).
const SPARE_PART_RE =
  /\b(?:repuestos?|recambios?|cargador(?:es)?|baterias?|pilas?|memorias?|cartuchos?|toner|tintas?|filtros?|correas?|cables?|adaptador(?:es)?|fundas?|carcasas?|micas?|laminas?)\b/;
// "Batería portátil", "Batería externa", "Cargador portátil": eso es un
// power bank, un producto de por sí, no el repuesto de otro. Pero solo si
// dice su capacidad en mAh y no dice para qué equipo es: "Cargador Portátil
// Para Notebook Lenovo Adlx65ndc3a" es un repuesto y su código se queda.
const POWER_BANK_RE = /\b(?:cargador(?:es)?|baterias?)\s+(?:portatil(?:es)?|extern[ao]s?)\b/g;
const CAPACITY_MAH_RE = /\d[\d.,]*\s?mah\b/;
const FOR_DEVICE_RE = /\b(?:notebook|laptop|para|compatibles?)\b/;

/** ¿El nombre habla de un repuesto o de un consumible? */
function isSparePart(name: string): boolean {
  const plain = stripDiacritics(name.toLowerCase());
  const powerBank = CAPACITY_MAH_RE.test(plain) && !FOR_DEVICE_RE.test(plain);
  return SPARE_PART_RE.test(powerBank ? plain.replace(POWER_BANK_RE, ' ') : plain);
}

const WORD_EDGE_RE = /^[^a-z0-9áéíóúüñ]+|[^a-z0-9áéíóúüñ]+$/gi;
const LETTERS_ONLY_RE = /^[a-záéíóúüñ]{3,}$/i;

/** ¿Abre un paréntesis que cierra otra palabra (o al revés)? Quitarla dejaría el otro suelto: "(UN55U8000H 2026)". */
function hasOpenBracket(word: string): boolean {
  return (word.match(/\(/g) ?? []).length !== (word.match(/\)/g) ?? []).length;
}

/**
 * El nombre sin los códigos de fábrica, y sin el guion o la coma que queden
 * sueltos por eso. `whole` es el nombre completo, para saber si es un
 * repuesto. Con cualquier duda devuelve `name` tal cual:
 *  - la primera palabra no se quita nunca ("FA607NUQ-RL060W AMD Ryzen 7…":
 *    sin ella no queda nada que diga qué es);
 *  - un código después de "con", "para", "compatible", "modelo"… se queda;
 *  - en un repuesto o un consumible no se quita ninguno (isSparePart);
 *  - si quedan menos de 3 palabras, o ninguna de solo letras y de 3 o más,
 *    es que el código era casi todo el nombre.
 */
function withoutFactoryCodes(name: string, whole: string): string {
  if (isSparePart(whole)) return name;
  const words = name.split(' ');
  const kept = words.filter(
    (word, i) =>
      i === 0 ||
      !isFactoryCode(word) ||
      hasOpenBracket(word) ||
      LEADS_TO_CODE_RE.test((words[i - 1] ?? '').replace(/[.:,]+$/, ''))
  );
  if (kept.length === words.length) return name;

  const plain = kept
    .join(' ')
    .replace(/(\s[-–—|•])(?:\s[-–—|•])+(?=\s)/g, '$1')
    .replace(/^[\s\-–—,;:|•/]+/, '')
    .replace(TRAILING_JUNK_RE, '');
  const left = plain
    .split(' ')
    .map((word) => word.replace(WORD_EDGE_RE, ''))
    .filter(Boolean);
  if (left.length < 3 || !left.some((word) => LETTERS_ONLY_RE.test(word)) || plain.length < MIN_SHORT_NAME) return name;
  return plain;
}

/**
 * Nombre corto para títulos, migas y la barra de compra.
 *
 * Los nombres de ML miden 76-90 caracteres y repiten el color y coletillas
 * de la tienda. Se quita el sufijo de color y se corta en el espacio
 * anterior al máximo, sin dejar una palabra partida ni un paréntesis
 * abierto. El <title> de la ficha tiene su propia regla, que no pierde la
 * marca, el modelo ni la capacidad (lib/seo-title).
 */
export function shortProductName(name: string, max = 55): string {
  return shortName(name, max, false);
}

/**
 * El nombre corto que va escrito EN EL REEL (y en el título de YouTube del
 * video): el de shortProductName, pero sin los códigos de fábrica
 * (isFactoryCode), que en pantalla no le dicen nada a nadie y le quitan
 * espacio al resto: "Samsung Asm-r390nidalta Smartwatch Galaxy Fit 3" =>
 * "Samsung Smartwatch Galaxy Fit 3". Los resguardos, en withoutFactoryCodes.
 *
 * Solo para el video: los textos que se pegan en las redes, Telegram, las
 * historias, la portada y la ficha siguen con shortProductName.
 */
export function reelProductName(name: string, max = 55): string {
  return shortName(name, max, true);
}

function shortName(name: string, max: number, withoutCodes: boolean): string {
  const original = name.trim().replace(/\s+/g, ' ');

  let short = original.replace(AUTHORIZED_SUFFIX_RE, '');
  const withoutColor = short.replace(COLOR_SUFFIX_RE, '');
  if (withoutColor.length >= MIN_SHORT_NAME) short = withoutColor;
  short = short.replace(TRAILING_JUNK_RE, '');
  if (short.length < MIN_SHORT_NAME) short = original;
  // Antes de cortar: así el código tampoco le quita espacio al resto.
  if (withoutCodes) short = withoutFactoryCodes(short, original);

  if (short.length > max) {
    const cut = short.slice(0, max + 1);
    const lastSpace = cut.lastIndexOf(' ');
    short = lastSpace > 0 ? cut.slice(0, lastSpace) : short.slice(0, max);
    // "Apple iPhone 17 Pro Max (256" se lee como un error: el paréntesis
    // abierto se va con lo que trae.
    const open = short.lastIndexOf('(');
    if (open > short.lastIndexOf(')')) short = short.slice(0, open);
    short = short.replace(TRAILING_JUNK_RE, '');
    for (let i = 0; i < 3 && TRAILING_CONNECTOR_RE.test(short); i++) {
      short = short.replace(TRAILING_CONNECTOR_RE, '').replace(TRAILING_JUNK_RE, '');
    }
  }

  return short || original.slice(0, max);
}
