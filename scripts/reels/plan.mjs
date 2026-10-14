// El plan de videos que entrega el sitio (GET /api/social/videos/plan) leído con desconfianza: aquí se
// revisa cada elemento antes de bajar nada, armar nada o subir nada, y se convierte en la entrada del reel.
// Solo datos: no toca la red ni los archivos, para poder probarlo entero.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** El nombre de una plantilla va en el nombre del archivo: solo letras minúsculas y números. */
const TEMPLATE_RE = /^[a-z0-9]+$/;

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function isLocalHost(hostname) {
  return LOCAL_HOSTS.includes(hostname);
}

/** Un texto en un solo renglón y sin signos de control: lo que se imprime no puede traer saltos de línea ajenos. */
export function oneLine(value, max = 90) {
  const text = Array.from(String(value ?? ''), (ch) => (isControl(ch.codePointAt(0)) ? ' ' : ch))
    .join('')
    .replace(/ +/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Signos de control, saltos de línea y espacios raros (incluidos los separadores de línea de Unicode). */
function isControl(code) {
  return code <= 0x20 || (code >= 0x7f && code <= 0xa0) || code === 0x2028 || code === 0x2029;
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
 * ¿Sirve este elemento del plan? Devuelve null si está bien, o qué le falta. El nombre del archivo se
 * recompone con el id, el precio y la plantilla: si el sitio mandara otro, el video quedaría guardado con un
 * nombre que la página del admin no sabría leer.
 */
export function planItemProblem(item) {
  if (!item || typeof item !== 'object') return 'el sitio mandó un elemento vacío';
  if (typeof item.id !== 'string' || !UUID_RE.test(item.id)) return 'no trae un id de producto válido';
  if (!Number.isInteger(item.precio) || item.precio <= 0) return 'no trae un precio en pesos';
  if (typeof item.plantilla !== 'string' || !TEMPLATE_RE.test(item.plantilla)) return 'no trae una plantilla válida';
  if (typeof item.archivo !== 'string') return 'no trae el nombre del archivo';
  const [date, name, ...rest] = item.archivo.split('/');
  if (rest.length > 0 || !DATE_RE.test(date) || name !== `${item.id}-${item.precio}-${item.plantilla}`) {
    return 'el nombre del archivo no calza con el producto, el precio y la plantilla';
  }
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
 * ¿Sirve esta dirección firmada para subir `objectPath` (por ejemplo "2026-10-13/<id>-<precio>-estudio.mp4")?
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
