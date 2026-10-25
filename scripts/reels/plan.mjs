// El plan de videos que entrega el sitio (GET /api/social/videos/plan) leído con desconfianza: aquí se
// revisa cada elemento antes de bajar nada, armar nada o subir nada, y se convierte en la entrada del reel.
// Solo datos: no toca la red ni los archivos, para poder probarlo entero.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** El nombre de una plantilla va en el nombre del archivo: solo letras minúsculas y números. */
const TEMPLATE_RE = /^[a-z0-9]+$/;
/**
 * El nombre del archivo, por partes: "AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>". La huella es opcional
 * aquí solo para poder reconocer la forma anterior (sin huella) y decir qué pasa, en vez de un "no calza".
 */
const FILE_RE = /^(\d{4}-\d{2}-\d{2})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+)-([a-z0-9]+)(?:-(.*))?$/;
/** La huella de la oferta: 8 signos, del 0 al 9 y de la a a la f. */
const FINGERPRINT_RE = /^[0-9a-f]{8}$/;
/** Lo que se dice cuando el nombre del archivo llega con la forma anterior, sin huella. */
const OLD_FILE_NAME =
  'el sitio y el generador no son de la misma versión: el nombre del archivo llegó sin la huella de la oferta. El sitio que respondió es más antiguo que este generador y hay que publicar su última versión';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.includes(hostname);
}

/**
 * Un texto en un solo renglón, sin signos de control y sin órdenes para el registro de GitHub Actions: lo que
 * se imprime no puede traer saltos de línea ajenos ni hacer que el registro anote o tape algo.
 */
export function oneLine(value, max = 90) {
  const text = noCommands(
    Array.from(String(value ?? ''), (ch) => (isControl(ch.codePointAt(0)) ? ' ' : ch))
      .join('')
      .replace(/ +/g, ' ')
      .trim()
  );
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * GitHub Actions lee lo que imprime cada paso y obedece dos formas de orden: "::orden::" cuando el renglón
 * empieza con ella, y la antigua "##[orden]" en cualquier parte del renglón. Con ellas un texto ajeno (el
 * nombre de un producto, el mensaje de error de otro servidor) podría anotar un error que no existe o tapar
 * texto en un registro que es público. Aquí se les mete un espacio al medio, que las deja como texto
 * corriente; lo demás queda igual. Sirve para un renglón o para varios.
 */
export function noCommands(value) {
  return String(value)
    .replace(/##(?=\[)/g, '# #')
    .replace(/^([\s\x00-\x20\x85]*):(?=:)/gm, '$1: ');
}

/**
 * Signos de control, saltos de línea y espacios raros (incluidos los separadores de línea de Unicode), y
 * también los signos que no se ven (guion opcional, espacios de ancho cero, marcas de dirección, selectores
 * de variante): quien lee el registro no los nota y un programa que busca texto puede saltárselos, así que
 * entre ellos se podría esconder una orden partida en dos.
 */
function isControl(code) {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0xa0) ||
    code === 0xad ||
    code === 0x34f ||
    code === 0x61c ||
    (code >= 0x180b && code <= 0x180f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff ||
    (code >= 0xfff0 && code <= 0xfff8) ||
    (code >= 0xe0000 && code <= 0xe0fff)
  );
}

/**
 * Revisa la respuesta del plan y devuelve { date, items, unreadHistory, deleted }. Lanza un error si no tiene
 * la forma acordada: en ese caso no se hace nada.
 */
export function readPlan(data) {
  if (!data || typeof data !== 'object' || data.ok !== true || !Array.isArray(data.seleccion)) {
    throw new Error('El sitio no respondió un plan de videos que se pueda leer.');
  }
  const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
  return {
    date: typeof data.fecha === 'string' && DATE_RE.test(data.fecha) ? data.fecha : null,
    items: data.seleccion,
    unreadHistory: count(data.historial_sin_leer),
    deleted: count(data.borrados),
  };
}

/**
 * ¿Sirve este elemento del plan? Devuelve null si está bien, o qué le falta.
 *
 * El nombre del archivo es "AAAA-MM-DD/<id>-<precio>-<plantilla>-<huella>" y se usa tal como llega. El id, el
 * precio y la plantilla del nombre tienen que ser los del elemento: si el sitio mandara otros, el video
 * quedaría guardado con un nombre que la página del admin no sabría leer. La huella resume la versión del
 * aspecto de los videos y lo demás que el video dice (nombre, marca, precio_lista, descuento, baja, envío
 * gratis, Full) y la calcula solo el sitio: aquí no se recalcula, se revisa que venga y que tenga su forma.
 * Un nombre sin huella es el de un sitio de la versión anterior, y un video guardado así no lo mostraría
 * nadie: se rechaza diciéndolo.
 */
export function planItemProblem(item) {
  if (!item || typeof item !== 'object') return 'el sitio mandó un elemento vacío';
  if (typeof item.id !== 'string' || !UUID_RE.test(item.id)) return 'no trae un id de producto válido';
  if (!Number.isInteger(item.precio) || item.precio <= 0) return 'no trae un precio en pesos';
  if (typeof item.plantilla !== 'string' || !TEMPLATE_RE.test(item.plantilla)) return 'no trae una plantilla válida';
  if (typeof item.archivo !== 'string') return 'no trae el nombre del archivo';
  const parts = FILE_RE.exec(item.archivo);
  if (parts && parts[5] === undefined) return OLD_FILE_NAME;
  if (!parts || parts[2] !== item.id || parts[3] !== String(item.precio) || parts[4] !== item.plantilla) {
    return 'el nombre del archivo no calza con el producto, el precio y la plantilla';
  }
  if (!FINGERPRINT_RE.test(parts[5])) return 'el nombre del archivo no trae una huella válida (8 signos, del 0 al 9 y de la a a la f)';
  if (typeof item.ya_existe !== 'boolean') return 'no dice si el video ya existe';
  return null;
}

/**
 * ¿Se puede bajar la foto de esta dirección? Solo por https y solo de los servidores de imágenes de Mercado
 * Libre (mlstatic.com y sus subdominios). Así, aunque el plan viniera alterado, este proceso no baja nada de
 * otra parte. Devuelve null si está bien, o el motivo.
 */
export function photoUrlProblem(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return 'no trae una dirección válida';
  }
  if (url.protocol !== 'https:') return 'no viene por https';
  if (url.username || url.password || url.port) return 'trae una dirección que no es la de una foto de Mercado Libre';
  const host = url.hostname.toLowerCase();
  if (host !== 'mlstatic.com' && !host.endsWith('.mlstatic.com')) return 'no es de Mercado Libre (mlstatic.com)';
  return null;
}

/**
 * ¿Sirve esta dirección firmada para subir `objectPath` (por ejemplo
 * "2026-10-13/<id>-<precio>-estudio-<huella>.mp4")?
 * Tiene que ir por https (o a un servidor local, cuando el plan también se pidió a uno), traer su token y
 * terminar en ese mismo archivo del almacén "reels". Devuelve null si está bien, o el motivo.
 */
export function uploadUrlProblem(value, objectPath, { allowLocal = false } = {}) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return 'no trae una dirección de subida válida';
  }
  const local = allowLocal && url.protocol === 'http:' && isLocalHost(url.hostname);
  if (url.protocol !== 'https:' && !local) return 'la dirección de subida no va por https';
  if (url.username || url.password) return 'la dirección de subida no es válida';
  if (!url.searchParams.get('token')) return 'la dirección de subida no trae su firma';
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return 'la dirección de subida no es válida';
  }
  if (!pathname.endsWith(`/reels/${objectPath}`)) return 'la dirección de subida no es la de este archivo';
  return null;
}

/**
 * ¿Se puede bajar la canción de fondo de esta dirección? Tiene que ser una dirección firmada del bucket
 * privado "musica" del almacén (ver src/lib/social/music.ts), por https, de un archivo de audio. Devuelve null
 * si está bien, o el motivo (sin la dirección, que es secreta).
 */
export function musicUrlProblem(value, { allowLocal = false } = {}) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return 'no trae una dirección válida';
  }
  const local = allowLocal && url.protocol === 'http:' && isLocalHost(url.hostname);
  if (url.protocol !== 'https:' && !local) return 'la dirección no va por https';
  if (url.username || url.password) return 'la dirección no es válida';
  if (!url.searchParams.get('token')) return 'la dirección no trae su firma';
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return 'la dirección no es válida';
  }
  if (!/\/storage\/v1\/object\/sign\/musica\/[a-z0-9][a-z0-9._-]{0,80}\.(mp3|m4a|aac|wav|ogg)$/i.test(pathname)) {
    return 'la dirección no es la de una canción del almacén';
  }
  return null;
}

/**
 * La entrada del reel a partir de un elemento del plan: los mismos campos que una entrada de productos.json
 * (ver resolverProducto en datos.mjs). "Envío gratis" y "Full" salen solo de sus campos de sí o no; el motivo
 * y los demás textos no se pasan, para que nada de lo que va en pantalla se deduzca de una frase.
 */
export function reelInput(item) {
  return {
    id: item.id,
    nombre: item.nombre,
    nombre_corto: item.nombre_corto,
    marca: item.marca ?? null,
    precio: item.precio,
    precio_lista: item.precio_lista ?? null,
    descuento: item.descuento ?? null,
    baja_historial: item.baja_historial ?? null,
    precio_revisado: item.precio_revisado ?? null,
    envio_gratis: item.envio_gratis === true,
    full: item.full === true,
  };
}
