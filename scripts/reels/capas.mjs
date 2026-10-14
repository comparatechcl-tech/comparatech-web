// Las capas: cada renglón, pastilla o logo se dibuja UNA vez (con el mismo motor que usa el sitio para sus
// piezas, next/og, y su misma fuente Inter) y queda como imagen con transparencia.
// Después, cuadro a cuadro, solo se mueven. Aquí también vive lo que es de la marca: colores, logo e íconos.
// Es común a todas las plantillas: cada una decide qué capas pide y dónde las pone.
import sharp from 'sharp';
import og from 'next/og.js';
import { fuentes, ancho as anchoTexto } from './fuente.mjs';
import { precio as formatoPrecio } from './datos.mjs';

const { ImageResponse } = og;

// --- Lo que es de la marca (copiado de la identidad del sitio; aquí no se importa nada de src/) -----------
export const COLOR = {
  fondo: '#070B14',
  superficie: '#0B1220',
  cian: '#00D4FF',
  azul: '#087EFF',
  tinta: '#0A0E17',
  blanco: '#FFFFFF',
  apagado: '#94A3B8',
  nota: '#C3CCDA', // la letra chica: clara, para que se lea en un teléfono
};
export const MENOS = '−'; // el signo menos de verdad, no el guion

// El logo del sitio (lupa con dos flechas), tal como está en la identidad.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#087EFF"/><stop offset="1" stop-color="#00D4FF"/></linearGradient></defs><circle cx="14" cy="14" r="10.5" fill="none" stroke="url(#g)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="56 10" stroke-dashoffset="-7"/><line x1="21.4" y1="21.4" x2="27" y2="27" stroke="url(#g)" stroke-width="3.4" stroke-linecap="round"/><g stroke="#F5F7FA" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M9.3 12.3h8.4M17.7 12.3l-2.2-2.2M17.7 12.3l-2.2 2.2"/><path d="M18.7 16.3h-8.4M10.3 16.3l2.2-2.2M10.3 16.3l2.2 2.2"/></g></svg>`;
// Camión (envío gratis) y rayo (Full), en el cian de la marca.
const ICONO_ENVIO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${COLOR.cian}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v11H2zM13 10h5l4 4v3h-9zM6.5 17a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM17.5 17a2 2 0 1 0 0 4a2 2 0 0 0 0-4z"/></svg>`;
const ICONO_FULL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8l9-12h-7z" fill="${COLOR.cian}" stroke="${COLOR.cian}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Un SVG cuadrado convertido a PNG de `lado` px (lo hace sharp, sin red). */
async function pngDeSvg(svg, lado) {
  const caja = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  return sharp(Buffer.from(svg), { density: (72 * lado) / caja }).resize(lado, lado).png().toBuffer();
}
const dataUriDeSvg = async (svg, lado) => `data:image/png;base64,${(await pngDeSvg(svg, lado)).toString('base64')}`;

// --- El dibujante -----------------------------------------------------------------------------------------
let tipos = null;

/** Elemento para el dibujante sin JSX: e('div', {style}, hijos...). */
const e = (type, props, ...hijos) => ({ type, props: { ...(props ?? {}), children: hijos.length === 1 ? hijos[0] : hijos } });

/** Dibuja un elemento sobre transparente y lo devuelve como capa { w, h, data RGBA }. */
async function dibujar(elemento, w, h) {
  tipos ??= fuentes();
  const respuesta = new ImageResponse(elemento, { width: w, height: h, fonts: tipos });
  const png = Buffer.from(await respuesta.arrayBuffer());
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** Dónde hay tinta de verdad en una capa. */
export function tinta(capa) {
  let x0 = capa.w;
  let x1 = -1;
  let y0 = capa.h;
  let y1 = -1;
  for (let y = 0; y < capa.h; y++) {
    for (let x = 0; x < capa.w; x++) {
      if (capa.data[(y * capa.w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1 };
}

/** Recorta una capa a un ancho (para no arrastrar transparencia de sobra). */
function recortarAncho(capa, ancho) {
  ancho = Math.min(capa.w, Math.max(2, ancho));
  const data = new Uint8Array(ancho * capa.h * 4);
  for (let y = 0; y < capa.h; y++) data.set(capa.data.subarray(y * capa.w * 4, (y * capa.w + ancho) * 4), y * ancho * 4);
  return { w: ancho, h: capa.h, data };
}

// Inter: las mayúsculas y las cifras miden 0,727 del tamaño y quedan centradas en el alto del renglón.
export const ALTO_MAYUSCULA = 0.727;
/** Dentro de un renglón de `alto` px con letra de `tam` px: dónde empiezan las mayúsculas y dónde está la línea base. */
export const arribaDeLetra = (tam, alto) => alto / 2 - (ALTO_MAYUSCULA / 2) * tam;
export const lineaBase = (tam, alto) => alto / 2 + (ALTO_MAYUSCULA / 2) * tam;

/**
 * Un renglón de texto. `trozos` es un texto o una lista de { t, color } para colorear partes.
 * Se dibuja con aire de sobra y se mide la tinta real: si no cabe en `anchoMax` devuelve null y quien llama
 * prueba más chico. Así ningún texto se sale ni se corta, mida lo que mida.
 */
export async function renglon(trozos, { tam, peso = 600, color = COLOR.blanco, espaciado = 0, alto, anchoMax }) {
  const partes = typeof trozos === 'string' ? [{ t: trozos }] : trozos;
  const lienzo = Math.ceil(anchoMax + 60);
  const capa = await dibujar(
    e(
      'div',
      { style: { display: 'flex', alignItems: 'center', width: lienzo, height: alto, fontFamily: 'Inter', fontSize: tam, fontWeight: peso, letterSpacing: espaciado, lineHeight: `${alto}px`, whiteSpace: 'pre', color } },
      ...partes.map((p) => e('span', { style: { color: p.color ?? color } }, p.t))
    ),
    lienzo,
    alto
  );
  const t = tinta(capa);
  if (!t || t.x1 >= anchoMax) return null;
  const r = recortarAncho(capa, t.x1 + 3);
  r.tinta = t;
  r.tam = tam;
  return r;
}

const textoDe = (trozos) => (typeof trozos === 'string' ? trozos : trozos.map((p) => p.t).join(''));

/**
 * Un solo renglón que tiene que caber: prueba los tamaños de `pasos` de mayor a menor y, si ni en el más chico
 * cabe, le va quitando letras del final y pone puntos suspensivos. Devuelve la capa con `.texto` (lo que quedó).
 */
export async function renglonQueQuepa(texto, opciones, pasos) {
  for (const paso of pasos) {
    const r = await renglon(texto, { ...opciones, ...paso });
    if (r) return Object.assign(r, { texto: textoDe(texto) });
  }
  if (typeof texto !== 'string') throw new Error(`No hay tamaño en que quepa: ${textoDe(texto)}`);
  const ultimo = { ...opciones, ...pasos[pasos.length - 1] };
  let corto = texto;
  while (corto.length > 3) {
    corto = corto.slice(0, -1).trimEnd();
    if (anchoTexto(`${corto}…`, ultimo.peso ?? 600, ultimo.tam, ultimo.espaciado ?? 0) > ultimo.anchoMax - 8) continue;
    const r = await renglon(`${corto}…`, ultimo);
    if (r) return Object.assign(r, { texto: `${corto}…` });
  }
  throw new Error(`No se pudo acomodar el texto: ${texto}`);
}

// --- Textos largos: uno o dos renglones parejos -----------------------------------------------------------
const NUMERO = /^\d+([.,]\d+)?["”]?$/;
const UNIDAD = /^(gb|tb|mb|kg|g|gr|lt|l|ml|cc|cm|mm|m|w|hz|mah|v|btu|mp|fps|k|pulgadas|pulg|litros|kilos|watts|canales|nucleos|núcleos)$/i;
const CONECTORES = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'y', 'e', 'o', 'u', 'a', 'en', 'para', 'por']);

/**
 * Parte un texto en uno o dos renglones parejos que quepan en `max`, midiendo con los anchos reales de la
 * fuente. No deja un "de" colgando ni separa un número de su unidad ("15 / pulgadas") si hay otra forma.
 * Devuelve null si no cabe ni en dos.
 */
export function partir(texto, max, tam, peso, espaciado) {
  const ancho = (t) => anchoTexto(t, peso, tam, espaciado);
  if (ancho(texto) <= max) return [texto];
  const palabras = texto.split(' ');
  let mejor = null;
  let costoMejor = Infinity;
  for (let i = 1; i < palabras.length; i++) {
    const uno = palabras.slice(0, i).join(' ');
    const dos = palabras.slice(i).join(' ');
    const w1 = ancho(uno);
    const w2 = ancho(dos);
    if (w1 > max || w2 > max) continue;
    const antes = palabras[i - 1];
    const despues = palabras[i];
    let castigo = 0;
    if (NUMERO.test(antes) && UNIDAD.test(despues)) castigo = 5000;
    else if (CONECTORES.has(antes.toLowerCase())) castigo = 400;
    else if (/^\d{1,2}$/.test(despues) && /^[A-Za-zÁÉÍÓÚÑáéíóúñ]+$/.test(antes)) castigo = 200;
    const costo = Math.abs(w1 - w2) + castigo;
    if (costo < costoMejor) {
      costoMejor = costo;
      mejor = Object.assign([uno, dos], { feo: castigo >= 5000 });
    }
  }
  return mejor;
}

/**
 * Renglones de un texto largo (el nombre, la llamada del cierre): prueba los tamaños de `pasos` (cada uno
 * { tam, alto, espaciado }) y, si ni en el más chico cabe en dos renglones, le quita palabras del final y
 * pone puntos suspensivos. Devuelve { capas, filas (los textos), tam, alto }.
 */
export async function bloque(texto, { anchoMax, pasos, peso = 600, color = COLOR.blanco }) {
  const margen = anchoMax - 8; // un poco de aire: la tinta real puede pasarse uno o dos px de la medida
  let intento = texto;
  for (let vuelta = 0; vuelta < 80; vuelta++) {
    let reserva = null; // cabe, pero separando un número de su unidad: se usa solo si un poco más chico no mejora
    for (const paso of pasos) {
      if (reserva && paso.tam < reserva.tam * 0.8) break;
      const espaciado = paso.espaciado ?? 0;
      const filas = partir(intento, margen, paso.tam, peso, espaciado);
      if (!filas) continue;
      const capas = [];
      for (const fila of filas) capas.push(await renglon(fila, { tam: paso.tam, alto: paso.alto, peso, color, espaciado, anchoMax }));
      if (!capas.every(Boolean)) continue;
      const armado = { capas, filas: [...filas], tam: paso.tam, alto: paso.alto };
      if (!filas.feo) return armado;
      reserva ??= armado;
    }
    if (reserva) return reserva;
    // No cupo: una palabra menos y puntos suspensivos.
    const palabras = intento.replace(/…$/, '').trim().split(' ');
    if (palabras.length <= 1) {
      // Una sola palabra más ancha que el renglón: se corta por letras.
      const sola = palabras[0];
      if (sola.length <= 4) break;
      intento = `${sola.slice(0, sola.length - 2)}…`;
    } else {
      intento = `${palabras.slice(0, -1).join(' ').replace(/[\s,;:\-–—(]+$/, '')}…`;
    }
  }
  throw new Error(`No se pudo acomodar el texto: ${texto}`);
}

// --- Piezas sueltas -----------------------------------------------------------------------------------------
/** La marca del sitio en una pastilla oscura (va arriba, sobre el fondo claro, todo el video). */
export async function pastillaMarca(h) {
  const logo = await dataUriDeSvg(LOGO_SVG, 132);
  const w = 340;
  const capa = await dibujar(
    e(
      'div',
      { style: { display: 'flex', width: w, height: h, fontFamily: 'Inter' } },
      e(
        'div',
        { style: { display: 'flex', alignItems: 'center', height: h, padding: '0 26px 0 14px', borderRadius: h / 2, backgroundColor: COLOR.superficie } },
        e('img', { src: logo, width: 44, height: 44 }),
        e('div', { style: { display: 'flex', marginLeft: 10, fontSize: 33, fontWeight: 800, letterSpacing: -1, color: COLOR.blanco } }, e('span', {}, 'Compara'), e('span', { style: { color: COLOR.cian } }, 'Tech'))
      )
    ),
    w,
    h
  );
  return recortarAncho(capa, tinta(capa).x1 + 2);
}

/** Etiqueta de envío, como las de las piezas del sitio. `chica` es la que va apilada al lado del descuento. */
async function etiqueta(texto, iconoSvg, chica) {
  const m = chica ? { tam: 30, h: 48, icono: 28, izq: 14, der: 18 } : { tam: 31, h: 56, icono: 30, izq: 18, der: 24 };
  const icono = await dataUriDeSvg(iconoSvg, m.icono * 2);
  const w = Math.ceil(anchoTexto(texto, 600, m.tam) + m.icono + m.izq + m.der + 40);
  const capa = await dibujar(
    e(
      'div',
      { style: { display: 'flex', width: w, height: m.h, fontFamily: 'Inter' } },
      e(
        'div',
        { style: { display: 'flex', alignItems: 'center', height: m.h, padding: `0 ${m.der}px 0 ${m.izq}px`, borderRadius: m.h / 2, fontSize: m.tam, fontWeight: 600, color: COLOR.blanco, background: 'rgba(255,255,255,0.08)', border: '2px solid rgba(255,255,255,0.2)' } },
        e('img', { src: icono, width: m.icono, height: m.icono }),
        e('div', { style: { display: 'flex', marginLeft: 9 } }, texto)
      )
    ),
    w,
    m.h
  );
  return Object.assign(recortarAncho(capa, tinta(capa).x1 + 2), { texto });
}
export const etiquetaEnvio = (chica = false) => etiqueta('Envío gratis', ICONO_ENVIO_SVG, chica);
export const etiquetaFull = (chica = false) => etiqueta('Full', ICONO_FULL_SVG, chica);

/**
 * El precio: el "$" chico y arriba, en cian; las cifras, lo más grandes que quepan (con tope).
 * Mismas proporciones que el precio de las piezas del sitio. Siempre es el precio real, entero: nunca se cuenta.
 */
export async function capaPrecio(valor, { anchoMax, tamMax }) {
  const INTERLINEA = 0.74; // con este interlineado la caja del texto mide lo que miden las cifras
  const cifras = formatoPrecio(valor).slice(1);
  for (let tam = tamMax; tam >= 60; tam -= 6) {
    const alto = Math.round(tam * INTERLINEA) + 8;
    const lienzo = Math.ceil(anchoMax + 60);
    const capa = await dibujar(
      e(
        'div',
        { style: { display: 'flex', alignItems: 'center', width: lienzo, height: alto, fontFamily: 'Inter', fontWeight: 800, color: COLOR.blanco } },
        e(
          'div',
          { style: { display: 'flex', alignItems: 'flex-start' } },
          e('div', { style: { display: 'flex', fontSize: Math.round(tam * 0.5), lineHeight: INTERLINEA, marginTop: Math.round(tam * 0.04), marginRight: Math.round(tam * 0.05), color: COLOR.cian } }, '$'),
          e('div', { style: { display: 'flex', fontSize: tam, lineHeight: INTERLINEA, letterSpacing: -0.027 * tam } }, cifras)
        )
      ),
      lienzo,
      alto
    );
    const t = tinta(capa);
    if (t && t.x1 < anchoMax) return Object.assign(recortarAncho(capa, t.x1 + 3), { tinta: t, tam, texto: formatoPrecio(valor) });
  }
  throw new Error(`El precio no cabe: ${cifras}`);
}

/** La pastilla cian del descuento, grande: "−45%" (o "Bajó 15%"). */
export async function pastillaDescuento(texto, tam) {
  const h = tam + 12;
  const lado = Math.round(tam * 0.24);
  const espaciado = -0.022 * tam;
  const w = Math.ceil(anchoTexto(texto, 800, tam, espaciado) + lado * 2 + 60);
  const capa = await dibujar(
    e(
      'div',
      { style: { display: 'flex', width: w, height: h, fontFamily: 'Inter' } },
      e('div', { style: { display: 'flex', alignItems: 'center', height: h, padding: `0 ${lado}px`, borderRadius: Math.round(tam * 0.24), fontSize: tam, fontWeight: 800, letterSpacing: espaciado, lineHeight: `${h}px`, whiteSpace: 'pre', color: COLOR.tinta, backgroundColor: COLOR.cian } }, texto)
    ),
    w,
    h
  );
  return Object.assign(recortarAncho(capa, tinta(capa).x1 + 1), { texto, tam });
}

/** El logo grande del cierre, al doble del tamaño al que se muestra (se anima achicado). */
export async function logoGrande(lado) {
  const png = await pngDeSvg(LOGO_SVG, lado);
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/** "ComparaTech" grande, para el cierre. */
export async function nombreMarca(tam) {
  return renglon([{ t: 'Compara' }, { t: 'Tech', color: COLOR.cian }], { tam, alto: Math.round(tam * 1.2), peso: 800, espaciado: -tam * 0.03, anchoMax: 1000 });
}
