// Las piezas propias de la plantilla "bloques": la etiqueta del precio (una etiqueta de tienda cian, con su
// punta y su agujero, girada como si estuviera pegada), los bloques de color con texto ("−45%") y la losa de la
// llamada del cierre.
// Los textos los dibuja capas.mjs (el mismo dibujante y la misma letra de todas las plantillas); aquí solo se
// arman encima de sus fondos de color. Todo se hace una vez por video y queda como capa RGBA.
import sharp from 'sharp';
import * as capas from '../../capas.mjs';
import { COLOR, ALTO_MAYUSCULA, arribaDeLetra, lineaBase } from '../../capas.mjs';
import { rgb, limitar } from '../../pintar.mjs';
import { precio as formatoPrecio } from '../../datos.mjs';
import { ancho as anchoTexto } from '../../fuente.mjs';

/** Una capa transparente vacía. */
export const lienzo = (w, h) => ({ w, h, data: new Uint8Array(w * h * 4) });

/** Pone un color con transparencia `a` (0 a 1) sobre un punto de una capa RGBA (alfa sin multiplicar). */
function sobre(capa, i, r, g, b, a) {
  const d = capa.data;
  const da = d[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  const k = da * (1 - a);
  d[i] = Math.round((r * a + d[i] * k) / oa);
  d[i + 1] = Math.round((g * a + d[i + 1] * k) / oa);
  d[i + 2] = Math.round((b * a + d[i + 2] * k) / oa);
  d[i + 3] = Math.round(oa * 255);
}

/** Un rectángulo de esquinas redondas, con el borde suave, sobre una capa RGBA. */
export function rellenar(capa, x, y, w, h, radio, color, alfa = 1) {
  const [cr, cg, cb] = typeof color === 'string' ? rgb(color) : color;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hx = w / 2 - radio;
  const hy = h / 2 - radio;
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(capa.h, Math.ceil(y + h));
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(capa.w, Math.ceil(x + w));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const qx = Math.abs(px + 0.5 - cx) - hx;
      const qy = Math.abs(py + 0.5 - cy) - hy;
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radio;
      const cubre = limitar(0.5 - dist) * alfa;
      if (cubre > 0) sobre(capa, (py * capa.w + px) * 4, cr, cg, cb, cubre);
    }
  }
}

/** Un anillo (borde de un círculo) sobre una capa RGBA. */
function anillo(capa, cx, cy, radio, grosor, color, alfa) {
  const [cr, cg, cb] = rgb(color);
  for (let py = Math.floor(cy - radio - grosor - 1); py <= Math.ceil(cy + radio + grosor + 1); py++) {
    for (let px = Math.floor(cx - radio - grosor - 1); px <= Math.ceil(cx + radio + grosor + 1); px++) {
      if (px < 0 || py < 0 || px >= capa.w || py >= capa.h) continue;
      const dist = Math.abs(Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - radio - grosor / 2) - grosor / 2;
      const cubre = limitar(0.5 - dist) * alfa;
      if (cubre > 0 && capa.data[(py * capa.w + px) * 4 + 3] > 0) sobre(capa, (py * capa.w + px) * 4, cr, cg, cb, cubre);
    }
  }
}

/** Abre un agujero redondo (transparente, con borde suave) en una capa RGBA. */
function perforar(capa, cx, cy, radio) {
  for (let py = Math.floor(cy - radio - 1); py <= Math.ceil(cy + radio + 1); py++) {
    for (let px = Math.floor(cx - radio - 1); px <= Math.ceil(cx + radio + 1); px++) {
      if (px < 0 || py < 0 || px >= capa.w || py >= capa.h) continue;
      const cubre = limitar(radio + 0.5 - Math.hypot(px + 0.5 - cx, py + 0.5 - cy));
      const i = (py * capa.w + px) * 4 + 3;
      capa.data[i] = Math.round(capa.data[i] * (1 - cubre));
    }
  }
}

/** Pega una capa RGBA sobre otra. */
export function pegar(capa, src, x, y) {
  x = Math.round(x);
  y = Math.round(y);
  for (let sy = 0; sy < src.h; sy++) {
    const py = y + sy;
    if (py < 0 || py >= capa.h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const px = x + sx;
      if (px < 0 || px >= capa.w) continue;
      const s = (sy * src.w + sx) * 4;
      const a = src.data[s + 3] / 255;
      if (a > 0) sobre(capa, (py * capa.w + px) * 4, src.data[s], src.data[s + 1], src.data[s + 2], a);
    }
  }
}

/** Dónde hay algo pintado en una capa (para medir lo que de verdad ocupa). */
export function ocupado(capa) {
  let x0 = capa.w;
  let x1 = -1;
  let y0 = capa.h;
  let y1 = -1;
  for (let y = 0; y < capa.h; y++) {
    for (let x = 0; x < capa.w; x++) {
      if (capa.data[(y * capa.w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, x1, y0, y1 };
}

/**
 * Gira una capa dibujada al doble de su tamaño y la deja a tamaño normal. Cada punto sale de 4 muestras, con el
 * color multiplicado por su transparencia: los bordes quedan finos y sin halo. Grados negativos: sube a la
 * derecha (como una etiqueta pegada un poco chueca).
 */
export function girarYReducir(doble, grados) {
  const a = (grados * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const w = Math.ceil((Math.abs(doble.w * cos) + Math.abs(doble.h * sin)) / 2) + 4;
  const h = Math.ceil((Math.abs(doble.w * sin) + Math.abs(doble.h * cos)) / 2) + 4;
  const sw = doble.w;
  const sh = doble.h;
  const src = doble.data;
  // Fuente con el color multiplicado por la transparencia.
  const pm = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const al = src[i * 4 + 3] / 255;
    pm[i * 4] = src[i * 4] * al;
    pm[i * 4 + 1] = src[i * 4 + 1] * al;
    pm[i * 4 + 2] = src[i * 4 + 2] * al;
    pm[i * 4 + 3] = src[i * 4 + 3];
  }
  const muestra = (fx, fy, acc) => {
    const x = fx - 0.5;
    const y = fy - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    for (let k = 0; k < 4; k++) {
      const xx = x0 + (k & 1);
      const yy = y0 + (k >> 1);
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      const p = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
      const i = (yy * sw + xx) * 4;
      acc[0] += pm[i] * p;
      acc[1] += pm[i + 1] * p;
      acc[2] += pm[i + 2] * p;
      acc[3] += pm[i + 3] * p;
    }
  };
  const out = lienzo(w, h);
  const acc = [0, 0, 0, 0];
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      for (let s = 0; s < 4; s++) {
        // Posición de la muestra, en la escala doble y respecto del centro.
        const u = (ox + 0.25 + 0.5 * (s & 1) - w / 2) * 2;
        const v = (oy + 0.25 + 0.5 * (s >> 1) - h / 2) * 2;
        muestra(u * cos + v * sin + sw / 2, -u * sin + v * cos + sh / 2, acc);
      }
      const al = acc[3] / 4;
      if (al < 0.5) continue;
      const i = (oy * w + ox) * 4;
      out.data[i] = Math.round(limitar(acc[0] / 4 / (al / 255), 0, 255));
      out.data[i + 1] = Math.round(limitar(acc[1] / 4 / (al / 255), 0, 255));
      out.data[i + 2] = Math.round(limitar(acc[2] / 4 / (al / 255), 0, 255));
      out.data[i + 3] = Math.round(al);
    }
  }
  return out;
}

/** La misma capa, toda de un color (para el eco del golpe de la etiqueta). */
export function silueta(capa, color = [255, 255, 255]) {
  const data = new Uint8Array(capa.data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = capa.data[i + 3];
  }
  return { w: capa.w, h: capa.h, data };
}

/**
 * La forma de una etiqueta de tienda: un rectángulo con la punta a la izquierda y las esquinas redondeadas,
 * de `ancho` x `alto` px con la punta de `punta` px, puesta en (x, y) sobre una capa de `w` x `h`. La dibuja
 * sharp desde un SVG (bordes suaves y esquinas de radio `radio` exactas).
 */
async function formaEtiqueta(w, h, x, y, ancho, alto, punta, radio, color) {
  // Se dibuja el contorno metido `radio` px hacia adentro, con un trazo de 2 x radio y uniones redondas: así cada
  // esquina queda redondeada con ese radio y la forma mide justo ancho x alto.
  const fi = Math.atan(alto / 2 / punta); // inclinación de los lados de la punta
  const enPunta = radio / Math.sin(fi);
  const enHombro = radio * Math.tan(fi / 2);
  const pts = [
    [x + punta + enHombro, y + radio],
    [x + ancho - radio, y + radio],
    [x + ancho - radio, y + alto - radio],
    [x + punta + enHombro, y + alto - radio],
    [x + enPunta, y + alto / 2],
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="${pts.map((p) => p.map((v) => v.toFixed(2)).join(',')).join(' ')}" fill="${color}" stroke="${color}" stroke-width="${2 * radio}" stroke-linejoin="round"/></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/**
 * La etiqueta del precio: una etiqueta de tienda cian, con la punta y un agujero grande a la izquierda (con su
 * aro oscuro: por el agujero se ve el fondo), el "$" chico arriba y las cifras grandes en tinta oscura, sobre un
 * bloque azul corrido (su sombra dura). Va girada `giro` grados. Prueba de `tamMax` hacia abajo hasta que la
 * etiqueta girada quepa en `anchoMax`. Siempre es el precio real.
 */
export async function etiquetaPrecio(valor, { tamMax, anchoMax, giro = -3 }) {
  const cifras = formatoPrecio(valor).slice(1);
  for (let tam = tamMax; tam >= 64; tam -= 6) {
    const T = tam * 2; // se dibuja al doble y se reduce al girarla: bordes finos
    // Antes de dibujar: si las cifras solas ya no caben, se prueba al tiro un tamaño más chico.
    if (anchoTexto(cifras, 800, tam, -0.03 * tam) + 0.95 * tam > anchoMax) continue;
    const dig = await capas.renglon(cifras, { tam: T, alto: Math.round(T * 1.06), peso: 800, color: COLOR.tinta, espaciado: -0.03 * T, anchoMax: 2 * anchoMax });
    if (!dig) continue;
    const signo = await capas.renglon('$', { tam: Math.round(T * 0.5), alto: Math.round(T * 0.62), peso: 800, color: COLOR.tinta, anchoMax: T });
    const cap = dig.tinta.y1 - dig.tinta.y0; // alto real de las cifras
    const padV = Math.round(0.21 * T);
    const alto = cap + 2 * padV;
    const punta = Math.round(0.34 * alto);
    // El agujero mide unos 38 px en pantalla (al doble, 0,12 del tamaño y nunca más de 40 de radio): a 360 px de
    // ancho se lee como el agujero de una etiqueta y no como una viñeta.
    const radioAgujero = Math.round(Math.min(0.12 * T, 40));
    const aro = Math.round(0.035 * T);
    const xAgujero = Math.round(0.72 * punta);
    const xTexto = xAgujero + radioAgujero + aro + Math.round(0.1 * T);
    const xCifras = xTexto + (signo.tinta.x1 - signo.tinta.x0) + Math.round(0.035 * T);
    const ancho = xCifras + (dig.tinta.x1 - dig.tinta.x0) + Math.round(0.2 * T);
    const corrido = Math.round(0.07 * T); // la sombra dura (bloque azul) va corrida abajo a la derecha
    const m = 8;
    const radio = Math.round(0.09 * T);
    const W2 = ancho + corrido + 2 * m;
    const H2 = alto + corrido + 2 * m;
    const base = await formaEtiqueta(W2, H2, m + corrido, m + corrido, ancho, alto, punta, radio, COLOR.azul);
    const cara = await formaEtiqueta(W2, H2, m, m, ancho, alto, punta, radio, COLOR.cian);
    // Las cifras: su tinta empieza en padV; el "$" se alinea con el borde de arriba de las cifras.
    pegar(cara, dig, m + xCifras - dig.tinta.x0, m + padV - dig.tinta.y0);
    pegar(cara, signo, m + xTexto - signo.tinta.x0, m + padV - signo.tinta.y0 + Math.round(0.02 * T));
    // El agujero, con un aro oscuro alrededor. Atraviesa la etiqueta entera: por él se ve el fondo.
    anillo(cara, m + xAgujero, m + alto / 2, radioAgujero, aro, COLOR.tinta, 0.78);
    perforar(cara, m + xAgujero, m + alto / 2, radioAgujero);
    pegar(base, cara, 0, 0);
    perforar(base, m + xAgujero, m + alto / 2, radioAgujero);
    const capa = girarYReducir(base, giro);
    const t = ocupado(capa);
    if (t.x1 + 1 > anchoMax) continue;
    // Dónde empieza el "$" en la etiqueta ya girada y reducida (con 3 px de aire): a la izquierda de eso solo
    // hay punta y agujero. Sirve para que la etiqueta pueda asomar cortada por la izquierda sin cortar el precio.
    const a = (giro * Math.PI) / 180;
    const enCapa = (sx, sy) => ((sx - W2 / 2) * Math.cos(a) - (sy - H2 / 2) * Math.sin(a)) / 2 + capa.w / 2;
    const inicioPrecio = Math.floor(Math.min(enCapa(m + xTexto, m + padV), enCapa(m + xTexto, m + alto - padV))) - 3;
    // El eco del golpe sale solo de la cara cian (sin el bloque azul de atrás), en un cian claro.
    const eco = silueta(girarYReducir(cara, giro), [170, 238, 255]);
    return { capa, eco, tinta: t, inicioPrecio, tam, texto: formatoPrecio(valor) };
  }
  throw new Error(`El precio no cabe en la etiqueta: ${cifras}`);
}

/** Un bloque de color con un texto adentro (el "−45%" blanco con letra oscura). */
export async function bloqueTexto(texto, { tam, fondo = COLOR.blanco, color = COLOR.tinta, padX = Math.round(tam * 0.26), padY = Math.round(tam * 0.26), radio = Math.round(tam * 0.16), anchoMax = 2000 }) {
  const alto = Math.round(tam * 1.2);
  const r = await capas.renglon(texto, { tam, alto, peso: 800, color, espaciado: -0.025 * tam, anchoMax: anchoMax * 2 });
  if (!r) return null;
  // Se centra por las mayúsculas (una "j" que cuelga no lo descuadra).
  const tw = r.tinta.x1 - r.tinta.x0;
  const th = Math.round(ALTO_MAYUSCULA * tam);
  const capa = lienzo(tw + 2 * padX, th + 2 * padY);
  if (capa.w > anchoMax) return null;
  rellenar(capa, 0, 0, capa.w, capa.h, radio, fondo);
  pegar(capa, r, padX - r.tinta.x0, padY - Math.round(arribaDeLetra(tam, alto)));
  return Object.assign(capa, { texto, tam });
}

/**
 * La losa de la llamada del cierre: un bloque cian con la llamada en tinta oscura, en uno o dos renglones
 * centrados. Si es larga se achica y, si ni así cabe, se corta con puntos suspensivos (capas.bloque).
 */
export async function losaLlamada(cta, { anchoMax }) {
  const padX = 44;
  const padY = 30;
  const llamada = await capas.bloque(cta, { anchoMax: anchoMax - 2 * padX, peso: 800, color: COLOR.tinta, pasos: [80, 74, 68, 62, 56, 50, 44, 40].map((tam) => ({ tam, alto: Math.round(tam * 1.16), espaciado: -0.02 * tam })) });
  const anchoTexto = Math.max(...llamada.capas.map((c) => c.tinta.x1 - c.tinta.x0));
  // Centrada por las mayúsculas: de lo alto de la primera línea a la línea base de la última.
  const arriba = arribaDeLetra(llamada.tam, llamada.alto);
  const altoLetra = (llamada.capas.length - 1) * llamada.alto + lineaBase(llamada.tam, llamada.alto) - arriba;
  const capa = lienzo(anchoTexto + 2 * padX, Math.round(altoLetra + 2 * padY));
  rellenar(capa, 0, 0, capa.w, capa.h, 22, COLOR.cian);
  llamada.capas.forEach((c, i) => pegar(capa, c, Math.round((capa.w - (c.tinta.x1 - c.tinta.x0)) / 2) - c.tinta.x0, Math.round(padY - arriba + i * llamada.alto)));
  return Object.assign(capa, { filas: llamada.filas, tam: llamada.tam });
}
