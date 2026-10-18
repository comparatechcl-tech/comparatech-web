/**
 * El <title> de una ficha para Google.
 *
 * El nombre de Mercado Libre mide 70-170 caracteres y Google muestra unos
 * 60. El título viejo ("{nombre corto}: precio y ofertas en Chile |
 * ComparaTech") medía 91 de mediana y se cortaba, y el recorte desde la
 * palabra "color" a veces se llevaba el modelo o la capacidad ("Memoria RAM
 * ValueRAM color Verde 8GB Kingston KVR16LS11/8" quedaba en "Memoria RAM
 * ValueRAM"): había modelos distintos con el mismo título (auditoría SEO del
 * 17-10-2026).
 *
 * La regla:
 *  - se conserva el comienzo del nombre, que en Mercado Libre casi siempre
 *    dice qué es, la marca y el modelo, y se corta en una palabra entera;
 *  - el corte no separa una cifra de lo que cuenta ("Gas 4 | Quemadores",
 *    "128 | Gb", "8 | En 1"), ni deja un conector colgando ("… Con 2") o un
 *    paréntesis abierto;
 *  - si el corte deja fuera la marca, el código del modelo o la capacidad,
 *    se rescatan al final ("Home Theaters Soundbar Aiwa Aw-sbh16"): son lo
 *    que distingue un producto de otro y lo que la gente escribe en Google;
 *  - si así no cabe el nombre del modelo que sigue a la marca, se sacan los
 *    adjetivos de antes de la marca ("Pulsera [Inteligente] Xiaomi Mi Smart
 *    Band 9 Active") o el código de fábrica ("Samsung [Asm-r390nidalta]
 *    Smartwatch Galaxy Fit 3");
 *  - la marca va adelante si el nombre no la trae, salvo "Genérica", "OEM" y
 *    las marcas mal cargadas ("Calentador De Agua Instantáneo Sin");
 *  - el color solo se quita cuando viene marcado con la palabra "color" y es
 *    un color de verdad ("Color Negro" sí; "Tinta Continua Color Wi-Fi" no),
 *    y vuelve al final si cabe.
 *
 * Es solo para buscadores: las redes, Telegram y los videos siguen con
 * shortProductName y reelProductName (lib/text).
 */
import { isFactoryCode, isMeasure, normalizeName } from '@/lib/text';

/** Lo que Google muestra de un título, más o menos. */
export const SEO_TITLE_MAX = 60;
const PRICE_SUFFIX = ': precio en Chile';
const SOLD_OUT_SUFFIX = ': sin stock hoy';
const SITE_SUFFIX = ' | ComparaTech';

const AUTHORIZED_RE = /[\s\-–—,|•]*distribuidor autorizado\b/gi;
const COLOR_WORD_RE = /^color:?$/i;
/** Colores que Mercado Libre pone después de "Color", en español e inglés (sin tildes ni mayúsculas). */
const COLOR_WORDS = new Set([
  'negro', 'negra', 'blanco', 'blanca', 'gris', 'plata', 'plateado', 'plateada', 'azul', 'rojo', 'roja', 'rosa',
  'rosado', 'rosada', 'verde', 'amarillo', 'amarilla', 'dorado', 'dorada', 'oro', 'morado', 'morada', 'violeta',
  'lila', 'celeste', 'beige', 'cafe', 'marron', 'naranjo', 'naranja', 'grafito', 'titanio', 'natural', 'champagne',
  'turquesa', 'crema', 'acero', 'oscuro', 'oscura', 'claro', 'clara', 'mate', 'brillante', 'menta', 'coral',
  'black', 'white', 'silver', 'gold', 'blue', 'red', 'pink', 'green', 'gray', 'grey', 'purple', 'violet', 'light',
  'dark', 'midnight', 'starlight', 'space', 'graphite', 'rose', 'glow', 'navy', 'sky', 'mint', 'cream', 'lavender',
  'titanium', 'obsidian', 'jet', 'lime', 'teal', 'orange', 'yellow', 'brown', 'y', 'and',
]);
/** Los colores que nunca son parte del nombre de un modelo (no como "Space" en "Soundcore Space Q45"). */
const PLAIN_COLORS = new Set([
  'negro', 'negra', 'blanco', 'blanca', 'gris', 'plata', 'plateado', 'plateada', 'azul', 'rojo', 'roja', 'rosado',
  'rosada', 'verde', 'amarillo', 'amarilla', 'dorado', 'dorada', 'morado', 'morada', 'celeste', 'beige', 'cafe',
  'marron', 'naranjo', 'naranja', 'grafito', 'black', 'white', 'silver', 'blue', 'red', 'pink', 'green', 'gray', 'grey',
]);
/** Palabras que unen: un corte que termina en una de ellas queda colgando. */
const CONNECTORS = new Set([
  'de', 'del', 'con', 'para', 'y', 'e', 'o', 'u', 'en', 'a', 'al', 'la', 'el', 'los', 'las', 'por', 'sin', 'tipo',
  'for', 'with', 'and', 'by', 'of', 'the',
]);
/** Una "marca" con estas palabras es un pedazo de nombre mal cargado ("Cocina Con Patas"); "Safe And Sound" sí es marca. */
const NOT_IN_BRANDS = new Set(['de', 'del', 'con', 'para', 'sin', 'por', 'en', 'la', 'el', 'los', 'las', 'al', 'a', 'tipo']);
/** Tampoco cierran un título: "… Batería 9v Incluye", "… Pequeño Hasta". */
const DANGLING = new Set([
  'incluye', 'incluido', 'incluida', 'incluidos', 'incluidas', 'hasta', 'desde', 'mas', 'x', 'vs', 'modelo', 'mod',
  'marca', 'compatible', 'compatibles', 'ideal', 'apto', 'apta', 'especial',
]);
/** La unidad que va separada de su cifra ("128 Gb", "20 Metros"). */
const UNIT_WORDS = new Set([
  'gb', 'tb', 'mb', 'kb', 'mah', 'w', 'kw', 'watts', 'hz', 'mhz', 'ghz', 'mp', 'mpx', 'mm', 'cm', 'm', 'mt', 'mts',
  'metro', 'metros', 'km', 'l', 'lt', 'lts', 'litro', 'litros', 'ml', 'cc', 'kg', 'g', 'gr', 'grs', 'v', 'va', 'kva',
  'h', 'hr', 'hrs', 'hs', 'horas', 'pulgadas', 'pulg', 'inch', 'fps', 'ms', 'db', 'rpm', 'lm', 'lumenes', 'mbps',
  'gbps', 'k', 'p',
]);
/** Lo que se cuenta, en singular ("Con 1 Puerta"). En plural lo dice la "s" del final ("4 Quemadores"). */
const COUNTED = new Set([
  'puerta', 'puerto', 'cajon', 'quemador', 'plato', 'nivel', 'microfono', 'unidad', 'pieza', 'salida', 'canal',
  'velocidad', 'tubo', 'foco', 'pila', 'bateria', 'toma', 'enchufe', 'boton', 'modo', 'cuerpo', 'persona', 'puesto',
  'asiento', 'rueda', 'bandeja', 'repisa', 'estante', 'hoja', 'juego', 'control', 'mando', 'camara', 'disco',
  'ventilador', 'aspa', 'filtro',
]);
/** Terminan en "s" pero son parte del nombre: "iPhone 16 Plus". */
const NOT_COUNTED = new Set(['plus', 'pros', 'series', 'buds', 'airpods', 'pods', 'gamers']);
/** Marcas que Mercado Libre acepta y que no son una marca. */
const GENERIC_BRANDS = new Set([
  'generica', 'generico', 'generic', 'oem', 'sin marca', 'otra marca', 'otras marcas', 'otra', 'otro', 'otros',
  'varios', 'varias', 'na', 'n a', 'no aplica', 'none', 'alternativo', 'alternativa', 'compatible', 'importado',
  'importada',
]);
/** Lo que corta el nombre del modelo que sigue a la marca: "Xiaomi Redmi Buds 6 Play | Bt 5.4". */
const MODEL_STOP = new Set([
  'bluetooth', 'bt', 'inalambrico', 'inalambrica', 'inalambricos', 'inalambricas', 'wireless', 'portatil',
  'portatiles', 'recargable', 'recargables', 'usb', 'wifi', 'wi fi', 'gamer', 'gaming', 'digital', 'electrico',
  'electrica', 'electricos', 'electricas', 'profesional', 'original', 'originales', 'nuevo', 'nueva', 'sellado',
  'sellada', 'estereo', 'tactil', 'plegable', 'ergonomico', 'ergonomica', 'ajustable', 'universal', 'pack', 'kit',
  'set', 'combo', 'edicion', 'version', 'hd', 'fhd', 'uhd', 'full', 'led', 'lcd', 'oled', 'qled', 'amoled', 'ips',
  'android', 'dual', 'doble', 'sim', 'lte', 'nfc', 'gps', 'rgb',
]);
/** El nombre del modelo, sin la marca, a lo más. */
const MODEL_WORDS_MAX = 5;
/** Las palabras de antes de la marca que se pueden sacar para que quepa el modelo ("Pulsera [Inteligente] Xiaomi"). */
const DROPPED_WORDS_MAX = 2;

const NUMBER_RE = /^\d+(?:[.,]\d+)?$/;
const YEAR_RE = /^(?:19|20)\d{2}$/;
/** La capacidad: lo que separa "Galaxy A27 128GB" de "256GB" y una batería de 5.000 de una de 10.000 mAh. */
const CAPACITY_RE = /^\d+(?:[.,]\d+)?(?:gb|tb|mah)$/i;
const CAPACITY_UNITS = ['gb', 'tb', 'mah'];
/** El tamaño, cuando no hay capacidad: lo que separa "Rack Tv 118cm" de "Rack Tv 140cm". */
const SIZE_RE = /^\d{2,3}(?:cm|"|”|inch|pulgadas|pulg)$/i;

const fold = (word: string) => normalizeName(word);
/** La palabra sin signos alrededor: "(256" → "256", "Ca-605bl," → "Ca-605bl"; las pulgadas y los grados quedan: 43", 360°. */
const bare = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}"”°º]+$/gu, '');
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/** ¿`word` dice qué es la cifra que va antes? "128 Gb", "4 Quemadores", "1 Puerta", "32 A 55", "8 En 1", "2 x 1.5W". */
function completesNumber(word: string | undefined, after: string | undefined): boolean {
  if (!word) return false;
  const w = fold(bare(word));
  if (UNIT_WORDS.has(w) || COUNTED.has(w)) return true;
  if (/^[a-z]{4,}s$/.test(w) && !NOT_COUNTED.has(w)) return true;
  const joiner = /^[-–—]$/.test(word) || ['a', 'al', 'en', 'x', 'y', 'o'].includes(w);
  return joiner && (NUMBER_RE.test(bare(after ?? '')) || isMeasure(after ?? ''));
}

/**
 * Un código de modelo: letras y cifras juntas que no son una medida ni una
 * norma ("A27", "Aw-sbh16", "KVR16LS11/8"; no "1300W", "4G" ni "IP67"), o un
 * número de modelo suelto que no es un año ni una cantidad ("Mlab 9204",
 * "Smart Tank 720"; no "2024" ni "300 Mbps"). `next` y `after` son las dos
 * palabras que siguen.
 */
export function isModelToken(word: string, next?: string, after?: string): boolean {
  const w = bare(word);
  if (/^\d{3,6}$/.test(w)) return !YEAR_RE.test(w) && !completesNumber(next, after);
  if (w.length < 2 || !/\d/.test(w) || !/\p{L}/u.test(w)) return false;
  return !isMeasure(w) && !/^(?:ip[x\d]\d|rj\d{2}|\d+lum)$/i.test(w);
}

function tokenize(name: string): string[] {
  return (
    name
      .replace(AUTHORIZED_RE, ' ')
      // "Portavasos,VIDITA": una coma pegada entre letras separa dos palabras ("1,6in" es un decimal y queda).
      .replace(/(?<=\p{L}),(?=\p{L})/gu, ', ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** Sin la palabra "color" y su color; el color aparte, para volver a ponerlo si cabe. */
export function splitColor(name: string): { core: string[]; color: string | null } {
  const tokens = tokenize(name);
  for (let i = 0; i < tokens.length; i++) {
    if (!COLOR_WORD_RE.test(tokens[i].replace(/[,;.]$/, ''))) continue;
    let end = i + 1;
    while (end < tokens.length && end - i <= 3) {
      const word = fold(tokens[end].replace(/[,;.]$/, ''));
      // "negro/gris": cada parte tiene que ser un color.
      if (!word || !word.split(' ').every((part) => COLOR_WORDS.has(part))) break;
      end++;
    }
    // Un "y" suelto al final no es parte del color ("Color Negro y 8GB").
    while (end > i + 1 && ['y', 'and'].includes(fold(tokens[end - 1]))) end--;
    // Sin un color de verdad después ("Tinta Continua Color Wi-Fi"), "color" es parte del nombre.
    if (end === i + 1) continue;
    const color = tokens
      .slice(i + 1, end)
      .map((t) => t.replace(/[,;.]$/, ''))
      .join(' ');
    return { core: tokens.slice(0, i).concat(tokens.slice(end)), color };
  }
  return { core: tokens, color: null };
}

/**
 * La marca como se compara (sin tildes ni signos), si sirve para el título:
 * ni "Genérica" ni "OEM", ni un pedazo de nombre cargado como marca
 * ("Calentador De Agua Instantáneo Sin", "Cocina Con Patas"). Si no, ''.
 */
function brandKey(brand: string | null | undefined): string {
  const key = fold(brand ?? '');
  if (!key || GENERIC_BRANDS.has(key)) return '';
  const words = key.split(' ');
  if (words.length > 3 || key.length > 20 || words.some((w) => NOT_IN_BRANDS.has(w))) return '';
  return key;
}

/** Dónde está la marca en el nombre, en palabras seguidas ("Tp-link", "Tp Link,", "Tplink", "BLACK+DECKER"), o null. */
function findBrand(tokens: string[], key: string): [number, number] | null {
  const target = key.replace(/ /g, '');
  for (let i = 0; i < tokens.length; i++) {
    let acc = '';
    for (let j = i; j < tokens.length; j++) {
      const word = fold(tokens[j]).replace(/ /g, '');
      if (!word) break;
      acc += word;
      if (acc === target) return [i, j + 1];
      if (!target.startsWith(acc)) break;
    }
  }
  return null;
}

/**
 * ¿La marca va adelante? Solo si el nombre no la trae, si es de una o dos
 * palabras y si ninguna de ellas aparece suelta en el nombre: ahí la "marca"
 * suele ser el modelo mal cargado ("ZEUS X WIRELESS" en unos "Audífonos
 * Inalámbricos Redragon Zeus Pro"). Tampoco si el nombre empieza con la misma
 * palabra: es un pedazo del nombre ("Switch 5 Puertos Rj45 10/100 Mbps").
 */
function prependsBrand(tokens: string[], key: string): boolean {
  const words = key.split(' ');
  if (words.length > 2) return false;
  const name = ` ${fold(tokens.join(' '))} `;
  if (words.some((w) => w.length >= 3 && name.includes(` ${w} `))) return false;
  return fold(tokens[0] ?? '').split(' ')[0] !== words[0];
}

/** Hasta dónde llega el nombre del modelo que empieza en `from`, justo después de la marca. */
function modelEnd(tokens: string[], from: number): number {
  let end = from;
  while (end < tokens.length && end - from < MODEL_WORDS_MAX) {
    const raw = tokens[end];
    const word = bare(raw);
    const key = fold(word);
    if (!word || CONNECTORS.has(key) || DANGLING.has(key) || MODEL_STOP.has(key) || PLAIN_COLORS.has(key)) break;
    if (YEAR_RE.test(word)) break;
    // Una cifra sola es parte del nombre ("Buds 6", "Mlab 9204"), salvo que cuente algo ("4 Quemadores").
    if (NUMBER_RE.test(word) ? /[.,]/.test(word) || completesNumber(tokens[end + 1], tokens[end + 2]) : isMeasure(word)) break;
    end++;
    // La puntuación cierra el nombre: "Asus Tuf Vg279q5a, 27 Fhd".
    if (/[,;:)]$/.test(raw) || /^[-–—|•(]/.test(tokens[end] ?? '')) break;
  }
  return end;
}

/** Sin conectores ni signos sueltos al final, ni una cifra que cuelgue de un conector ("… Con 2"; no "8 En 1"). */
function trimTail(tokens: string[], pick: number[]): number[] {
  const out = pick.slice();
  while (out.length > 1) {
    const word = bare(tokens[out[out.length - 1]]);
    const key = fold(word);
    if (!word || CONNECTORS.has(key) || DANGLING.has(key)) {
      out.pop();
      continue;
    }
    if (NUMBER_RE.test(word) && out.length > 2) {
      const before = fold(bare(tokens[out[out.length - 2]]));
      if (CONNECTORS.has(before) && !NUMBER_RE.test(bare(tokens[out[out.length - 3]]))) {
        out.length -= 2;
        continue;
      }
    }
    break;
  }
  return out;
}

/** ¿Se puede cortar `order` justo después de `head` (un comienzo de `order`)? */
function canCut(tokens: string[], order: number[], head: number[]): boolean {
  if (head.length >= order.length) return true;
  const text = head.map((i) => tokens[i]).join(' ');
  if ((text.match(/\(/g) ?? []).length > (text.match(/\)/g) ?? []).length) return false;
  const last = tokens[head[head.length - 1]];
  if (/[,;:]$/.test(last) || !NUMBER_RE.test(bare(last))) return true;
  return !completesNumber(tokens[order[head.length]], tokens[order[head.length + 1]]);
}

function render(tokens: string[], pick: number[]): string {
  return pick
    .map((i) => tokens[i].replace(/[,;:]+$/, '').replace(/^[-–—|•]+(?=\p{L})/u, ''))
    .filter((t) => bare(t))
    .join(' ');
}

/**
 * El comienzo más largo de `order` que cabe en `max` junto con lo rescatado
 * que quedó afuera (en su orden), o null si ni con una palabra cabe.
 */
function cut(tokens: string[], order: number[], rescue: Set<number>, max: number): number[] | null {
  for (let n = order.length; n >= 1; n--) {
    const head = trimTail(tokens, order.slice(0, n));
    if (!canCut(tokens, order, head)) continue;
    const pick = head.concat(order.slice(head.length).filter((i) => rescue.has(i)));
    if (render(tokens, pick).length <= max) return pick;
  }
  return null;
}

/**
 * Lo que se rescata si el corte lo deja afuera: el primer código de modelo,
 * la primera capacidad (con su unidad, si va aparte) o el tamaño, y la marca
 * si está a la vista: en la primera mitad del nombre o justo antes del
 * código ("… Ethernet Lan Gigabit Tp-link Ue300"). Una marca al final, sola
 * ("Correa Pulsera Para Apple Watch … Marca Cellbox", "The Legend Of Zelda
 * Breath Of The Wild Nintendo Switch 2"), no le gana a lo que dice qué es.
 */
function rescued(tokens: string[], brand: [number, number] | null): { rescue: Set<number>; withBrand: boolean } {
  const rescue = new Set<number>();
  const model = tokens.findIndex((t, i) => isModelToken(t, tokens[i + 1], tokens[i + 2]));
  if (model >= 0) rescue.add(model);
  const withBrand = brand !== null;
  if (withBrand && brand) range(brand[0], brand[1]).forEach((i) => rescue.add(i));
  let capacity = tokens.findIndex((t) => CAPACITY_RE.test(bare(t)));
  if (capacity < 0) {
    capacity = tokens.findIndex((t, i) => NUMBER_RE.test(bare(t)) && CAPACITY_UNITS.includes(fold(tokens[i + 1] ?? '')));
    if (capacity >= 0) rescue.add(capacity + 1);
  }
  if (capacity < 0) capacity = tokens.findIndex((t) => SIZE_RE.test(bare(t)));
  if (capacity >= 0) rescue.add(capacity);
  return { rescue, withBrand };
}

/**
 * El nombre del producto acortado para buscadores, en `max` caracteres o
 * menos, con la marca adelante si el nombre no la trae.
 */
export function seoProductName(
  name: string,
  brand: string | null | undefined,
  max = SEO_TITLE_MAX - PRICE_SUFFIX.length,
): string {
  const { core, color } = splitColor(name.trim());
  let tokens = core;
  const key = brandKey(brand);
  let brandAt = key ? findBrand(tokens, key) : null;
  let prepended = false;
  if (key && !brandAt && prependsBrand(tokens, key)) {
    const words = (brand as string).trim().split(/\s+/);
    tokens = words.concat(tokens);
    brandAt = [0, words.length];
    prepended = true;
  }

  const all = range(0, tokens.length);
  let result = render(tokens, all);
  if (result.length > max) {
    const { rescue, withBrand } = rescued(tokens, brandAt);
    // El nombre del modelo que sigue a la marca, que tiene que caber entero si se puede. Solo si
    // lleva una cifra ("Redmi Buds 6 Play"): "Linkon Base Escritorio" no es un modelo, es una descripción.
    const start = withBrand && !prepended && brandAt ? brandAt[0] : -1;
    const run = start >= 0 && brandAt ? range(brandAt[1], modelEnd(tokens, brandAt[1])) : [];
    const model = run.some((i) => /\d/.test(tokens[i])) ? run : [];
    const codes = model.filter((i) => isFactoryCode(tokens[i]));
    const bases = codes.length > 0 && codes.length < model.length ? [all, all.filter((i) => !codes.includes(i))] : [all];

    let first: number[] | null = null;
    let best: number[] | null = null;
    for (const base of bases) {
      const need = model.filter((i) => base.includes(i));
      const orders = [base];
      // Sin una o dos de las palabras de antes de la marca (las más cercanas a ella); la primera queda siempre.
      for (let keep = start - 1; keep >= Math.max(1, start - DROPPED_WORDS_MAX); keep--) {
        const zone = trimTail(tokens, range(0, keep));
        if (canCut(tokens, all, zone)) orders.push(zone.concat(base.filter((i) => i >= start)));
      }
      for (const order of orders) {
        const pick = cut(tokens, order, rescue, max);
        if (!pick) continue;
        first ??= pick;
        if (need.every((i) => pick.includes(i))) {
          best = pick;
          break;
        }
      }
      if (best) break;
    }
    const pick = best ?? first;
    if (pick) {
      result = render(tokens, pick);
    } else {
      // Ni con una palabra cabe (casi nunca pasa): se corta en el último espacio.
      const space = result.lastIndexOf(' ', max);
      result = result.slice(0, space > 0 ? space : max);
    }
  }
  // El color vuelve si cabe: distingue dos colores del mismo modelo.
  if (color && `${result} ${color}`.length <= max) result = `${result} ${color}`;
  return result;
}

/**
 * El <title> de la ficha (absoluto, sin la plantilla del sitio): nombre +
 * "precio en Chile" (lo que la gente busca), y la marca del sitio solo si
 * cabe. Fuera de venta lo dice, en vez de prometer un precio.
 */
export function seoProductTitle(product: { name: string; brand: string | null; is_active: boolean }): string {
  const suffix = product.is_active ? PRICE_SUFFIX : SOLD_OUT_SUFFIX;
  const name = seoProductName(product.name, product.brand, SEO_TITLE_MAX - suffix.length);
  const title = `${name}${suffix}`;
  return title.length + SITE_SUFFIX.length <= SEO_TITLE_MAX ? `${title}${SITE_SUFFIX}` : title;
}
