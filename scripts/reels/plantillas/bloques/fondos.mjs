// Los fondos y las formas de la plantilla "bloques": la noche azul de la marca, los bloques de color del gancho
// (con sus bordes inclinados), la noche con el bloque azul detrás de la tarjeta (escenas del nombre y del precio),
// la tarjeta blanca donde va el producto y las barras que suben en los cortes.
// Los fondos grandes se pintan una vez por hilo; las formas que se mueven se dibujan cuadro a cuadro.
import { W, H, limitar, mezcla, azar } from '../../pintar.mjs';

const CIAN_ARRIBA = [0, 214, 255];
const CIAN_ABAJO = [0, 196, 246];
const AZUL_ARRIBA = [8, 126, 255];
const AZUL_ABAJO = [6, 106, 232];

/** La y de un borde inclinado en la columna x. Los bordes suben hacia la derecha. */
export const bordeEn = (b, x) => b.y - b.pendiente * (x - W / 2);

/** El color de la noche en la fila y (sin grano). */
function noche(y) {
  const v = y / H;
  const arriba = [16, 30, 58];
  const medio = [9, 16, 31];
  const abajo = [6, 9, 17];
  if (v < 0.55) {
    const s = v / 0.55;
    return arriba.map((c, i) => mezcla(c, medio[i], s * s * (3 - 2 * s)));
  }
  const s = (v - 0.55) / 0.45;
  return medio.map((c, i) => mezcla(c, abajo[i], s));
}

/**
 * La noche: azul muy oscuro, más claro arriba, con una luz azul suave detrás de la tarjeta. Lleva un grano
 * mínimo para que el degradado no se vea en franjas después de comprimir.
 */
export function fondoNoche() {
  const b = new Uint8Array(W * H * 3);
  const al = azar(5);
  for (let y = 0; y < H; y++) {
    const base = noche(y);
    const dy = (y - 760) / 820;
    for (let x = 0; x < W; x++) {
      const dx = (x - 540) / 760;
      const luz = Math.exp(-(dx * dx + dy * dy) * 1.6);
      const d = (y * W + x) * 3;
      const grano = (al() - 0.5) * 1.2;
      b[d] = limitar(Math.round(base[0] + 4 * luz + grano), 0, 255);
      b[d + 1] = limitar(Math.round(base[1] + 22 * luz + grano), 0, 255);
      b[d + 2] = limitar(Math.round(base[2] + 46 * luz + grano), 0, 255);
    }
  }
  return b;
}

/**
 * El fondo del gancho: arriba una franja de noche (ahí las apps ponen su título), después un bloque cian, uno
 * azul y abajo noche otra vez (ahí las apps ponen su texto). Los dos bordes entre bloques van inclinados.
 * `cortes` = { techo, b1: { y, pendiente }, b2: { y, pendiente } }.
 */
export function fondoGancho(cortes) {
  const b = new Uint8Array(W * H * 3);
  const al = azar(9);
  for (let y = 0; y < H; y++) {
    const n = noche(y);
    const vc = limitar((y - cortes.techo) / (cortes.b1.y - cortes.techo));
    const cian = CIAN_ARRIBA.map((c, i) => mezcla(c, CIAN_ABAJO[i], vc));
    const va = limitar((y - cortes.b1.y) / (cortes.b2.y - cortes.b1.y));
    const azul = AZUL_ARRIBA.map((c, i) => mezcla(c, AZUL_ABAJO[i], va));
    for (let x = 0; x < W; x++) {
      // Cuánto de este punto cae bajo cada borde (con el borde suave).
      const t0 = limitar(y + 1 - cortes.techo);
      const t1 = limitar(y + 1 - bordeEn(cortes.b1, x + 0.5));
      const t2 = limitar(y + 1 - bordeEn(cortes.b2, x + 0.5));
      const d = (y * W + x) * 3;
      const grano = (al() - 0.5) * 1.2;
      for (let c = 0; c < 3; c++) {
        let v = mezcla(n[c], cian[c], t0);
        v = mezcla(v, azul[c], t1);
        v = mezcla(v, n[c], t2);
        b[d + c] = limitar(Math.round(v + grano), 0, 255);
      }
    }
  }
  return b;
}

/**
 * El fondo de la tarjeta y del precio: la noche con un bloque azul de la marca detrás de la tarjeta, de y=`techo`
 * hasta un borde inclinado (`borde` = { y, pendiente }). Es la firma de "bloques" en la portada: la tarjeta queda
 * sobre un bloque de color y no sobre la noche lisa. El borde va arriba de la mitad de la pantalla, así que la
 * columna de botones y la franja de abajo siguen oscuras.
 */
export function fondoProducto({ techo, borde }) {
  const b = fondoNoche();
  const al = azar(13);
  const yFin = Math.ceil(Math.max(bordeEn(borde, 0), bordeEn(borde, W))) + 1;
  for (let y = Math.max(0, Math.floor(techo)); y < Math.min(H, yFin); y++) {
    const v = limitar((y - techo) / (borde.y - techo));
    const azul = AZUL_ARRIBA.map((c, i) => mezcla(c, AZUL_ABAJO[i], v));
    const t0 = limitar(y + 1 - techo);
    for (let x = 0; x < W; x++) {
      const dentro = t0 * (1 - limitar(y + 1 - bordeEn(borde, x + 0.5)));
      if (dentro <= 0) continue;
      const d = (y * W + x) * 3;
      const grano = (al() - 0.5) * 1.2;
      for (let c = 0; c < 3; c++) b[d + c] = limitar(Math.round(mezcla(b[d + c], azul[c] + grano, dentro)), 0, 255);
    }
  }
  return b;
}

/** Copia un fondo corrido `dy` filas (positivo: más abajo). Lo que queda fuera del fondo no se toca. */
export function copiarFondo(dst, fondo, dy) {
  dy = Math.round(dy);
  const y0 = Math.max(0, dy);
  const y1 = Math.min(H, H + dy);
  if (y1 <= y0) return;
  dst.set(fondo.subarray((y0 - dy) * W * 3, (y1 - dy) * W * 3), y0 * W * 3);
}

/**
 * Un rectángulo de esquinas redondas, en cualquier posición con fracciones de pixel y con los bordes suaves.
 * Si se da `colorAbajo`, el color pasa de `color` (arriba) a `colorAbajo` (abajo).
 */
export function losa(dst, x, y, w, h, radio, color, opacidad = 1, colorAbajo = null) {
  const y0 = Math.max(0, Math.floor(y));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    const cubreY = limitar(Math.min(yy + 1, y + h) - Math.max(yy, y));
    const yc = yy + 0.5;
    const alBorde = Math.min(yc - y, y + h - yc);
    let entra = 0;
    if (alBorde < radio) {
      const k = radio - alBorde;
      entra = radio - Math.sqrt(Math.max(0, radio * radio - k * k));
    }
    const xa = x + entra;
    const xb = x + w - entra;
    const col = colorAbajo ? [0, 1, 2].map((c) => mezcla(color[c], colorAbajo[c], limitar((yc - y) / h))) : color;
    let d = (yy * W + Math.max(0, Math.floor(xa))) * 3;
    for (let xx = Math.max(0, Math.floor(xa)); xx < Math.min(W, Math.ceil(xb)); xx++, d += 3) {
      const a = limitar(Math.min(xx + 1, xb) - Math.max(xx, xa)) * cubreY * opacidad;
      if (a <= 0) continue;
      if (a >= 0.999) {
        dst[d] = col[0];
        dst[d + 1] = col[1];
        dst[d + 2] = col[2];
      } else {
        dst[d] = Math.round(dst[d] + (col[0] - dst[d]) * a);
        dst[d + 1] = Math.round(dst[d + 1] + (col[1] - dst[d + 1]) * a);
        dst[d + 2] = Math.round(dst[d + 2] + (col[2] - dst[d + 2]) * a);
      }
    }
  }
}

/**
 * La tarjeta del producto: blanca (apenas más fría abajo) sobre un bloque de color corrido abajo a la derecha,
 * su sombra dura. `escala` la agranda o achica desde su centro (cuando entra de golpe).
 */
export function tarjeta(dst, x, y, w, h, { radio = 34, corrido = 18, sombra = [0, 212, 255], escala = 1 } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const ww = w * escala;
  const hh = h * escala;
  const xx = cx - ww / 2;
  const yy = cy - hh / 2;
  losa(dst, xx + corrido * escala, yy + corrido * escala, ww, hh, radio * escala, sombra);
  losa(dst, xx, yy, ww, hh, radio * escala, [255, 255, 255], 1, [238, 242, 249]);
}

/**
 * Una barra que sube desde abajo y tapa todo lo que queda bajo su borde (inclinado como los del gancho): de un
 * color, o copiando un fondo (la barra de noche, que es el fondo del cierre).
 */
export function cortina(dst, yBorde, pendiente, color, fondo = null) {
  const b = { y: yBorde, pendiente };
  const yMin = Math.min(bordeEn(b, 0), bordeEn(b, W));
  const yMax = Math.max(bordeEn(b, 0), bordeEn(b, W));
  for (let y = Math.max(0, Math.floor(yMin)); y < H; y++) {
    const fila = y * W * 3;
    if (y >= yMax + 1) {
      if (fondo) dst.set(fondo.subarray(fila, fila + W * 3), fila);
      else for (let d = fila; d < fila + W * 3; d += 3) {
        dst[d] = color[0];
        dst[d + 1] = color[1];
        dst[d + 2] = color[2];
      }
      continue;
    }
    for (let x = 0; x < W; x++) {
      const a = limitar(y + 1 - bordeEn(b, x + 0.5));
      if (a <= 0) continue;
      const d = fila + x * 3;
      for (let c = 0; c < 3; c++) {
        const v = fondo ? fondo[d + c] : color[c];
        dst[d + c] = a >= 1 ? v : Math.round(dst[d + c] + (v - dst[d + c]) * a);
      }
    }
  }
}
