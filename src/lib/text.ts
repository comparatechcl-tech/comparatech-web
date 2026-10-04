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

/**
 * Nombre corto para títulos, migas y la barra de compra.
 *
 * Los nombres de ML miden 76-90 caracteres y repiten el color y coletillas
 * de la tienda; en un <title> Google corta a los ~60 y se pierde justo lo
 * que importa ("precio y ofertas en Chile"). Se quita el sufijo de color y
 * se corta en el espacio anterior al máximo, sin dejar una palabra partida
 * ni un paréntesis abierto.
 */
export function shortProductName(name: string, max = 55): string {
  const original = name.trim().replace(/\s+/g, ' ');

  let short = original.replace(AUTHORIZED_SUFFIX_RE, '');
  const withoutColor = short.replace(COLOR_SUFFIX_RE, '');
  if (withoutColor.length >= MIN_SHORT_NAME) short = withoutColor;
  short = short.replace(TRAILING_JUNK_RE, '');
  if (short.length < MIN_SHORT_NAME) short = original;

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
