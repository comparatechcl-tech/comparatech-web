// Lee el producto y decide qué se puede decir en pantalla. Todo sale del dato: aquí no se inventa nada.
// Si falta lo esencial (foto, nombre o precio) se detiene con un error claro: no se arma un video a medias.
// Es común a todas las plantillas: reciben el producto ya resuelto y solo deciden cómo mostrarlo.
import fs from 'node:fs';
import path from 'node:path';
import { limpia } from './fuente.mjs';

/** $219.990, a la chilena. */
export function precio(n) {
  return `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

/**
 * Un número que puede venir como número o como texto ("579990", "579.990", "$579.990", "27.5", "27,5").
 * Devuelve null si no es un número.
 */
export function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\s$%]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 219.990 -> 219990 (punto de miles)
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ''); // 219,990 -> 219990 (coma de miles)
  else if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.'); // 27,5 -> 27.5
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/**
 * La fecha del precio en hora de Chile, siempre con dos cifras: { fecha: '04/07', hora: '09:05' }.
 * Sale del dato (precio_revisado), nunca del reloj del PC. Devuelve null si el dato no es una fecha.
 */
export function fechaChile(iso) {
  if (iso == null || iso === '') return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hourCycle: 'h23',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const p = (tipo) => String(partes.find((x) => x.type === tipo)?.value ?? '').padStart(2, '0');
  return { fecha: `${p('day')}/${p('month')}`, hora: `${p('hour')}:${p('minute')}` };
}

/** Un campo de sí o no: true/false, 1/0, "si"/"no". Devuelve null si el campo no viene. */
function siNo(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'si', 'sí', '1'].includes(s)) return true;
    if (['false', 'no', '0'].includes(s)) return false;
  }
  return null;
}

// "Envío gratis" cuenta solo si se dice a secas: "envío gratis sobre $30.000" o "sin envío gratis" no cuentan.
const ENVIO = /(sin\s+|no\s+(?:tiene\s+|incluye\s+|trae\s+)?)?env[ií]o\s+gratis(?!\s*(?:sobre|desde|a\s+partir|a\s+contar|en\s+compras|por\s+compras|para\s+compras|con\s+compras|si\s|solo\s|s[oó]lo\s|\*))/giu;
// "Full" (el despacho de Mercado Libre) cuenta solo como "con Full" / "llega con Full". Así "Full HD" o
// "Full Frame" (que son del producto) nunca pasan por envío Full.
const FULL = /(?<![\p{L}\d])con\s+Full(?![\p{L}\d])(?!\s*[-–]?\s*(?:HD|Frame|Size|Array|View|Screen|Vision|Color|Touch|Motion|Face|\d))/iu;

function diceEnvioGratis(texto) {
  for (const m of texto.matchAll(ENVIO)) if (!m[1]) return true;
  return false;
}

/**
 * Lee productos.json y devuelve el producto pedido, ya resuelto (ver resolverProducto). La foto es el archivo
 * `foto_local`, que se busca al lado del propio productos.json.
 */
export function leerProducto(rutaJson, n) {
  if (!fs.existsSync(rutaJson)) throw new Error(`No encuentro el archivo de productos: ${rutaJson}`);
  let json;
  try {
    json = JSON.parse(fs.readFileSync(rutaJson, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`El archivo de productos no se puede leer (${rutaJson}): ${e.message}`);
  }
  const lista = Array.isArray(json) ? json : json?.productos;
  if (!Array.isArray(lista) || lista.length === 0) throw new Error(`No hay productos en ${rutaJson}`);
  const p = lista.find((x) => Number(x?.n) === n) ?? (lista.some((x) => x?.n != null) ? null : lista[n - 1]);
  if (!p) throw new Error(`No existe el producto ${n} en ${rutaJson} (hay ${lista.length})`);
  const quien = `producto ${n}`;
  // El precio y el nombre se revisan antes que la foto: si falta lo primero, ese es el error que se muestra.
  const sinFoto = !p.foto_local || typeof p.foto_local !== 'string';
  const foto = sinFoto ? null : path.resolve(path.dirname(rutaJson), p.foto_local);
  return { numero: n, ...resolverProducto(p, { foto, quien, sinFoto: `Falta la foto del ${quien} (no trae foto_local)` }) };
}

/**
 * Resuelve un producto crudo (una entrada de productos.json, o lo que arma generar.mjs con el plan del sitio):
 * textos ya limpios, números validados y `avisos` (cosas que no impiden armar el video pero conviene saber).
 * `foto` es la ruta del archivo de la foto y `quien` cómo se nombra al producto en los mensajes ("producto 2").
 * Si falta lo esencial lanza un error: quien llama no arma nada.
 */
export function resolverProducto(p, { foto, quien = 'producto', sinFoto = null }) {
  const avisos = [];

  const valor = numero(p.precio);
  if (valor === null || valor <= 0) throw new Error(`El ${quien} no tiene precio (precio: ${JSON.stringify(p.precio ?? null)})`);
  const nombre = limpia(String(p.nombre_corto || p.nombre || '').replace(/[″“”]/g, '"').replace(/[′‘’]/g, "'"));
  if (!nombre) throw new Error(`El ${quien} no tiene nombre`);

  // El descuento se muestra solo si el dato trae las dos cosas (la cifra tachada, precio_lista, y el porcentaje)
  // y calzan entre sí.
  if (!Number.isInteger(valor)) throw new Error(`El precio del ${quien} no es un número entero de pesos (${JSON.stringify(p.precio)}): no se arma el video`);
  const listaLeida = numero(p.precio_lista);
  // Un precio_lista con decimales tampoco se redondea: se trata como si no viniera.
  const lista_ = listaLeida !== null && Number.isInteger(listaLeida) ? listaLeida : null;
  const desc = numero(p.descuento) === null ? null : Math.round(numero(p.descuento));
  let conLista = lista_ !== null && lista_ > valor && desc !== null && desc > 0 && desc < 100;
  if (conLista && Math.abs((1 - valor / lista_) * 100 - desc) > 2) {
    conLista = false;
    avisos.push(`el descuento del dato (${desc}%) no calza con los precios (${precio(valor)} y ${precio(lista_)}): no se muestra descuento.`);
  } else if (!conLista && (lista_ !== null || desc !== null) && p.precio_lista != null && p.descuento != null) {
    avisos.push('el precio sin descuento (precio_lista) o el descuento del dato no calzan con el precio: no se muestra descuento.');
  }
  const baja = numero(p.baja_historial) === null ? null : Math.round(numero(p.baja_historial));

  // "Envío gratis" y "Full": mandan los campos envio_gratis y full si vienen. Si no, solo cuando los textos del
  // propio producto lo dicen de forma inequívoca. Antes de buscar se quita el nombre, para que un televisor
  // "Full HD" no pase por envío Full.
  let dicho = [p.motivo, ...Object.values(p.textos && typeof p.textos === 'object' ? p.textos : {})].filter((t) => typeof t === 'string').join('\n');
  for (const q of [p.nombre, p.nombre_corto].filter((t) => typeof t === 'string' && t).sort((a, b) => b.length - a.length)) dicho = dicho.split(q).join(' ');
  const envioGratis = siNo(p.envio_gratis) ?? diceEnvioGratis(dicho);
  const full = siNo(p.full) ?? FULL.test(dicho);

  if (!foto || typeof foto !== 'string') throw new Error(sinFoto ?? `Falta la foto del ${quien}`);
  if (!fs.existsSync(foto) || !fs.statSync(foto).isFile()) throw new Error(`Falta la foto del ${quien}: no existe ${foto}`);

  const revisado = fechaChile(p.precio_revisado);
  if (!revisado) avisos.push('el dato no trae una fecha de precio válida (precio_revisado): el video sale sin "Precio revisado".');

  return {
    nombre,
    marca: limpia(p.marca) || null,
    precio: Math.round(valor),
    precioLista: conLista ? Math.round(lista_) : null,
    descuento: conLista ? desc : null,
    bajaHistorial: baja !== null && baja > 0 && baja < 100 ? baja : null,
    revisado,
    envioGratis,
    full,
    foto,
    avisos,
  };
}

// Frases que no pueden salir en pantalla (ni siquiera en la llamada del cierre, que se escribe a mano). La cifra
// tachada la pone el vendedor: no se dice que sea un "precio normal" ni un "precio de lista".
const PROHIBIDO = ['imperdible', 'mejor precio', 'el más barato', 'el mas barato', 'la más barata', 'la mas barata', 'solo hoy', 'sólo hoy', 'últimas unidades', 'ultimas unidades', 'rebajado', 'ahorra', 'recomendado', 'probamos', 'lo probé', 'revisamos', 'precio normal', 'precio de lista'];

/** Revisa la llamada del cierre: sin direcciones web (en un reel no se pueden tocar) y sin frases prohibidas. */
export function revisarLlamada(cta) {
  if (/https?:|www\.|\.(cl|com|app|net|org|io)\b/i.test(cta)) throw new Error(`La llamada del cierre no puede llevar una dirección web ("${cta}"): en un reel no se puede tocar. Usa algo como "Link en el perfil".`);
  const baja = cta.toLowerCase();
  const mala = PROHIBIDO.find((f) => baja.includes(f)) ?? (/\bantes\s+\$/i.test(cta) ? 'antes $' : null);
  if (mala) throw new Error(`La llamada del cierre no puede decir "${mala}": en pantalla solo va lo que sale de los datos.`);
}
