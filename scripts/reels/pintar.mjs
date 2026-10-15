// El dibujante de cuadros: un lienzo RGB de 1080x1920 en memoria y las pocas operaciones que hacen falta.
// Todo se calcula aquí, punto por punto, para que los movimientos lentos no tiemblen: la foto se mueve y se
// agranda en fracciones de pixel (un filtro de video las redondea a pixeles enteros y se nota).
// Es común a todas las plantillas; los fondos propios de cada una viven en su carpeta.

export const W = 1080;
export const H = 1920;

// --- Curvas de movimiento -------------------------------------------------------------------------------
export const limitar = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** Avance de 0 a 1 entre los segundos `desde` y `hasta`. */
export const fase = (t, desde, hasta) => limitar((t - desde) / (hasta - desde));
export const mezcla = (a, b, p) => a + (b - a) * p;
export const suave = {
  sale: (p) => 1 - (1 - p) ** 3,
  saleFuerte: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
  entra: (p) => p ** 3,
  entraSale: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  /** Llega pasándose un poco y vuelve (para lo que "salta" a su lugar). */
  rebote: (p) => (p >= 1 ? 1 : 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2),
};

/** Números al azar que salen iguales en cada corrida (el video tiene que poder repetirse idéntico). */
export function azar(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// --- Capas con transparencia (textos, pastillas, logo) -------------------------------------------------
/**
 * Pone una capa RGBA sobre el lienzo. `recorte` = [x0, y0, x1, y1] limita dónde se dibuja: con eso se hace
 * el texto que "sube desde detrás de una línea".
 */
export function poner(dst, capa, x, y, opacidad = 1, recorte = null) {
  if (opacidad <= 0.004) return;
  x = Math.round(x);
  y = Math.round(y);
  // El recorte puede venir con fracciones (cuando lo que se recorta va en movimiento): se lleva a pixeles enteros.
  const x0 = Math.max(x, 0, recorte ? Math.ceil(recorte[0]) : 0);
  const y0 = Math.max(y, 0, recorte ? Math.ceil(recorte[1]) : 0);
  const x1 = Math.min(x + capa.w, W, recorte ? Math.floor(recorte[2]) : W);
  const y1 = Math.min(y + capa.h, H, recorte ? Math.floor(recorte[3]) : H);
  if (x1 <= x0 || y1 <= y0) return;
  const src = capa.data;
  const op = Math.round(limitar(opacidad) * 256);
  for (let yy = y0; yy < y1; yy++) {
    let s = ((yy - y) * capa.w + (x0 - x)) * 4;
    let d = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++, s += 4, d += 3) {
      const a = (src[s + 3] * op) >> 8;
      if (a === 0) continue;
      if (a >= 255) {
        dst[d] = src[s];
        dst[d + 1] = src[s + 1];
        dst[d + 2] = src[s + 2];
        continue;
      }
      const ia = 255 - a;
      dst[d] = ((src[s] * a + dst[d] * ia + 127) / 255) | 0;
      dst[d + 1] = ((src[s + 1] * a + dst[d + 1] * ia + 127) / 255) | 0;
      dst[d + 2] = ((src[s + 2] * a + dst[d + 2] * ia + 127) / 255) | 0;
    }
  }
}

/**
 * Como `poner`, con un brillo que cruza la capa: una franja inclinada, centrada en `centro` (x de pantalla),
 * tiñe la tinta hacia `color`. Es el destello que pasa una vez por el precio cuando termina de llegar.
 */
export function ponerConBrillo(dst, capa, x, y, opacidad, centro, ancho, color, fuerza) {
  x = Math.round(x);
  y = Math.round(y);
  const x0 = Math.max(x, 0);
  const y0 = Math.max(y, 0);
  const x1 = Math.min(x + capa.w, W);
  const y1 = Math.min(y + capa.h, H);
  const src = capa.data;
  const op = limitar(opacidad);
  for (let yy = y0; yy < y1; yy++) {
    let s = ((yy - y) * capa.w + (x0 - x)) * 4;
    let d = (yy * W + x0) * 3;
    const corrida = (yy - y - capa.h / 2) * 0.36; // la franja va inclinada
    for (let xx = x0; xx < x1; xx++, s += 4, d += 3) {
      const a = (src[s + 3] / 255) * op;
      if (a <= 0.003) continue;
      const u = (xx + corrida - centro) / ancho;
      const b = u > -1 && u < 1 ? fuerza * (1 - u * u) ** 2 : 0;
      dst[d] = Math.round(dst[d] + (src[s] + (color[0] - src[s]) * b - dst[d]) * a);
      dst[d + 1] = Math.round(dst[d + 1] + (src[s + 1] + (color[1] - src[s + 1]) * b - dst[d + 1]) * a);
      dst[d + 2] = Math.round(dst[d + 2] + (src[s + 2] + (color[2] - src[s + 2]) * b - dst[d + 2]) * a);
    }
  }
}

/**
 * Como `poner`, pero la capa se dibuja a otra escala. (x, y) es dónde queda en pantalla el punto de apoyo de
 * la capa; `ancla` dice cuál es ese punto: [0.5, 0.5] el centro, [0, 0.5] el medio del borde izquierdo.
 * Es para movimientos cortos (el precio que cae, una pastilla que salta, el logo): en reposo se usa `poner`.
 */
export function ponerEscalada(dst, capa, x, y, escala, opacidad = 1, ancla = [0.5, 0.5]) {
  if (opacidad <= 0.004) return;
  const w = capa.w * escala;
  const h = capa.h * escala;
  const xi = x - w * ancla[0];
  const yi = y - h * ancla[1];
  const x0 = Math.max(0, Math.floor(xi));
  const y0 = Math.max(0, Math.floor(yi));
  const x1 = Math.min(W, Math.ceil(xi + w));
  const y1 = Math.min(H, Math.ceil(yi + h));
  const src = capa.data;
  const op = limitar(opacidad);
  for (let yy = y0; yy < y1; yy++) {
    const v = limitar((yy + 0.5 - yi) / escala - 0.5, 0, capa.h - 1);
    const vy = Math.min(capa.h - 2, Math.floor(v));
    const fy = v - vy;
    for (let xx = x0; xx < x1; xx++) {
      const u = limitar((xx + 0.5 - xi) / escala - 0.5, 0, capa.w - 1);
      const ux = Math.min(capa.w - 2, Math.floor(u));
      const fx = u - ux;
      const i = (vy * capa.w + ux) * 4;
      const j = i + capa.w * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      // Se promedia con el color ya multiplicado por su transparencia: si no, los bordes se ensucian.
      const a00 = src[i + 3] * w00;
      const a10 = src[i + 7] * w10;
      const a01 = src[j + 3] * w01;
      const a11 = src[j + 7] * w11;
      const a = a00 + a10 + a01 + a11;
      if (a < 0.5) continue;
      const k = (a / 255) * op;
      const d = (yy * W + xx) * 3;
      for (let c = 0; c < 3; c++) {
        const col = (src[i + c] * a00 + src[i + 4 + c] * a10 + src[j + c] * a01 + src[j + 4 + c] * a11) / a;
        dst[d + c] = Math.round(dst[d + c] + (col - dst[d + c]) * k);
      }
    }
  }
}

/** Un rectángulo de color liso (el tachado de la cifra sin descuento, la línea del cierre). */
export function rectangulo(dst, x, y, w, h, color, opacidad = 1) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(W, Math.round(x + w));
  const y1 = Math.min(H, Math.round(y + h));
  const a = limitar(opacidad);
  for (let yy = y0; yy < y1; yy++) {
    let d = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++, d += 3) {
      dst[d] = Math.round(dst[d] + (color[0] - dst[d]) * a);
      dst[d + 1] = Math.round(dst[d + 1] + (color[1] - dst[d + 1]) * a);
      dst[d + 2] = Math.round(dst[d + 2] + (color[2] - dst[d + 2]) * a);
    }
  }
}

// --- La foto del producto -------------------------------------------------------------------------------
function catmullRom(d) {
  d = Math.abs(d);
  if (d < 1) return (1.5 * d - 2.5) * d * d + 1;
  if (d < 2) return ((-0.5 * d + 2.5) * d - 4) * d + 2;
  return 0;
}

/**
 * Para un eje: los 4 puntos de la foto que pesan en cada punto de la pantalla, y cuánto pesa cada uno
 * (en 1024-avos, para hacer la cuenta con enteros, que es mucho más rápido).
 * Lo que cae fuera de la foto vale blanco: se le deja peso cero (abajo se trabaja con "cuánto falta para
 * blanco") y el índice se lleva a uno válido.
 */
function pesos(origen, escala, largoFoto, desde, hasta) {
  const cuenta = hasta - desde;
  const indice = new Int32Array(cuenta * 4);
  const peso = new Int32Array(cuenta * 4);
  for (let o = 0; o < cuenta; o++) {
    const u = (desde + o + 0.5 - origen) / escala - 0.5;
    const i0 = Math.floor(u) - 1;
    for (let k = 0; k < 4; k++) {
      const i = i0 + k;
      const fuera = i < 0 || i >= largoFoto;
      indice[o * 4 + k] = fuera ? 0 : i;
      peso[o * 4 + k] = fuera ? 0 : Math.round(catmullRom(i - u) * 1024);
    }
  }
  return { indice, peso };
}

/**
 * Dibuja la foto (RGB sobre blanco) a la escala y en la posición pedidas, con fracciones de pixel, y la
 * MULTIPLICA con lo que haya debajo: el blanco de la foto desaparece y el producto queda apoyado en el fondo.
 * `yTope` corta el dibujo (lo que queda bajo la hoja oscura no se calcula).
 * Pensada para escalas entre 0,7 y 1,6: para achicar más, se le pasa una copia de la foto ya achicada.
 */
export function ponerFoto(dst, foto, x, y, escala, yTope = H) {
  const x0 = Math.max(0, Math.floor(x));
  const x1 = Math.min(W, Math.ceil(x + foto.w * escala));
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(H, Math.min(Math.ceil(yTope), Math.ceil(y + foto.h * escala)));
  const ow = x1 - x0;
  const oh = y1 - y0;
  if (ow <= 0 || oh <= 0) return;
  const px = pesos(x, escala, foto.w, x0, x1);
  const py = pesos(y, escala, foto.h, y0, y1);
  // Filas de la foto que hacen falta.
  const f0 = Math.max(0, Math.floor((y0 + 0.5 - y) / escala - 0.5) - 1);
  const f1 = Math.min(foto.h, Math.floor((y1 - 0.5 - y) / escala - 0.5) + 3);
  const filas = f1 - f0;
  if (filas <= 0) return;
  const src = foto.data;
  const ancho3 = ow * 3;
  // Pasada horizontal: se guarda "valor - 255" (lo que le falta para blanco, en negativo), por 1024.
  const tmp = new Int32Array(filas * ancho3);
  const ix = px.indice;
  const wx = px.peso;
  for (let f = 0; f < filas; f++) {
    const base = (f0 + f) * foto.w * 3;
    let t = f * ancho3;
    for (let o = 0, q = 0; o < ow; o++, q += 4, t += 3) {
      const a = base + ix[q] * 3;
      const b = base + ix[q + 1] * 3;
      const c = base + ix[q + 2] * 3;
      const e = base + ix[q + 3] * 3;
      const wa = wx[q];
      const wb = wx[q + 1];
      const wc = wx[q + 2];
      const we = wx[q + 3];
      const blanco = 255 * (wa + wb + wc + we);
      tmp[t] = wa * src[a] + wb * src[b] + wc * src[c] + we * src[e] - blanco;
      tmp[t + 1] = wa * src[a + 1] + wb * src[b + 1] + wc * src[c + 1] + we * src[e + 1] - blanco;
      tmp[t + 2] = wa * src[a + 2] + wb * src[b + 2] + wc * src[c + 2] + we * src[e + 2] - blanco;
    }
  }
  // Pasada vertical y multiplicación con el fondo.
  const iy = py.indice;
  const wy = py.peso;
  const ultima = filas - 1;
  for (let o = 0, q = 0; o < oh; o++, q += 4) {
    // Una fila fuera de las calculadas siempre trae peso cero: da igual cuál se lea.
    const ta = Math.min(ultima, Math.max(0, iy[q] - f0)) * ancho3;
    const tb = Math.min(ultima, Math.max(0, iy[q + 1] - f0)) * ancho3;
    const tc = Math.min(ultima, Math.max(0, iy[q + 2] - f0)) * ancho3;
    const te = Math.min(ultima, Math.max(0, iy[q + 3] - f0)) * ancho3;
    const wa = wy[q];
    const wb = wy[q + 1];
    const wc = wy[q + 2];
    const we = wy[q + 3];
    let d = ((y0 + o) * W + x0) * 3;
    for (let i = 0; i < ancho3; i++, d++) {
      // Cuánto le falta a este punto para blanco, redondeado (el 524288 es medio punto en esta escala).
      const v = (wa * tmp[ta + i] + wb * tmp[tb + i] + wc * tmp[tc + i] + we * tmp[te + i] + 524288) >> 20;
      if (v >= 0) continue; // blanco: no cambia nada
      if (v <= -255) {
        dst[d] = 0;
        continue;
      }
      const m = dst[d] * (255 + v) + 128;
      dst[d] = (m + (m >> 8)) >> 8; // dividir por 255, con enteros
    }
  }
}

/** Sombra de apoyo bajo el producto: una mancha blanda, ancha y muy baja, apenas azulada. */
export function sombraDeApoyo(dst, cx, cy, a, b, fuerza, yTope = H) {
  const x0 = Math.max(0, Math.floor(cx - a * 1.5));
  const x1 = Math.min(W, Math.ceil(cx + a * 1.5));
  const y0 = Math.max(0, Math.floor(cy - b * 2.6));
  const y1 = Math.min(H, Math.min(Math.ceil(yTope), Math.ceil(cy + b * 2.6)));
  for (let yy = y0; yy < y1; yy++) {
    const dy = (yy + 0.5 - cy) / b;
    const gy = Math.exp(-dy * dy);
    let d = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++, d += 3) {
      const dx = (xx + 0.5 - cx) / a;
      const dx2 = dx * dx;
      const k = fuerza * gy * Math.exp(-dx2 * dx2);
      if (k < 0.002) continue;
      dst[d] = dst[d] * (1 - k) + 0.5;
      dst[d + 1] = dst[d + 1] * (1 - k * 0.94) + 0.5;
      dst[d + 2] = dst[d + 2] * (1 - k * 0.8) + 0.5;
    }
  }
}

// --- Luces ---------------------------------------------------------------------------------------------
/** Un resplandor cian redondo, como capa RGBA (para detrás del logo en el cierre). */
export function resplandor(ancho, alto, fuerza = 0.2) {
  const data = new Uint8Array(ancho * alto * 4);
  const al = azar(23);
  for (let y = 0; y < alto; y++) {
    const dy = (y + 0.5 - alto / 2) / (alto / 2);
    for (let x = 0; x < ancho; x++) {
      const dx = (x + 0.5 - ancho / 2) / (ancho / 2);
      const r2 = dx * dx + dy * dy;
      const a = r2 >= 1 ? 0 : fuerza * (1 - r2) ** 2;
      const i = (y * ancho + x) * 4;
      data[i] = 0;
      data[i + 1] = 212;
      data[i + 2] = 255;
      data[i + 3] = limitar(Math.round(a * 255 + al() - 0.5), 0, 255);
    }
  }
  return { w: ancho, h: alto, data };
}
