// Los fondos de la plantilla "estudio": el fondo claro donde se apoya el producto y la hoja azul noche que
// sube desde abajo. Se pintan una vez (son grandes) y después, cuadro a cuadro, solo se copian.
import { W, H, limitar, mezcla, azar } from '../../pintar.mjs';

/**
 * El "estudio": un fondo claro con una luz blanca detrás del producto. Lleva un grano mínimo, del tamaño de
 * un escalón de color, para que el degradado no se vea en franjas después de comprimir el video.
 */
export function fondoEstudio() {
  const b = new Uint8Array(W * H * 3);
  const al = azar(7);
  const arriba = [243, 246, 251];
  const abajo = [222, 229, 240];
  for (let y = 0; y < H; y++) {
    const v = limitar((y - 160) / 1340);
    const s = v * v * (3 - 2 * v);
    const base = [mezcla(arriba[0], abajo[0], s), mezcla(arriba[1], abajo[1], s), mezcla(arriba[2], abajo[2], s)];
    const dy = (y - 700) / 760;
    for (let x = 0; x < W; x++) {
      const dx = (x - 540) / 660;
      const luz = Math.exp(-(dx * dx + dy * dy) * 1.15);
      const d = (y * W + x) * 3;
      const grano = al() - 0.5;
      for (let c = 0; c < 3; c++) b[d + c] = limitar(Math.round(base[c] + (255 - base[c]) * luz + grano), 0, 255);
    }
  }
  return b;
}

/**
 * La hoja oscura de la marca que sube desde abajo: azul noche, esquinas de arriba redondas, un filete cian
 * en el borde y una sombra blanda sobre el fondo claro. Devuelve una función que la dibuja con su borde de
 * arriba en la fila `tope`.
 */
export function hojaOscura({ radio = 64, sombraAlto = 70 } = {}) {
  const alto = H + 260; // alcanza para taparlo todo aunque el tope quede sobre la pantalla
  const cuerpo = new Uint8Array(W * alto * 3);
  const al = azar(11);
  const c0 = [17, 33, 62]; // #11213E arriba
  const c1 = [7, 11, 20]; // #070B14 abajo
  for (let y = 0; y < alto; y++) {
    const v = limitar(y / 900);
    const s = 1 - (1 - v) * (1 - v);
    for (let x = 0; x < W; x++) {
      // Una luz muy leve desde la izquierda, como en el panel del precio de las piezas del sitio.
      const lado = 1 - 0.22 * limitar(x / W) * (1 - s);
      const d = (y * W + x) * 3;
      const grano = (al() - 0.5) * 1.2;
      for (let c = 0; c < 3; c++) cuerpo[d + c] = limitar(Math.round(mezcla(c0[c], c1[c], s) * lado + grano), 0, 255);
    }
  }
  // Cabeza: las filas donde hay esquina, filete y sombra. Por punto: cuánto cubre la hoja y cuánta sombra cae fuera.
  const filasCabeza = sombraAlto + radio;
  const cubre = new Float32Array(W * filasCabeza);
  const filete = new Float32Array(W * filasCabeza);
  const sombra = new Float32Array(W * filasCabeza);
  for (let f = 0; f < filasCabeza; f++) {
    const y = f - sombraAlto; // fila relativa al tope de la hoja
    for (let x = 0; x < W; x++) {
      // Distancia con signo al borde de la hoja (negativa adentro).
      let dist;
      const ex = x < radio ? radio - (x + 0.5) : x >= W - radio ? x + 0.5 - (W - radio) : 0;
      const ey = radio - (y + 0.5);
      if (ex > 0 && ey > 0) dist = Math.hypot(ex, ey) - radio;
      else dist = -(y + 0.5);
      const i = f * W + x;
      cubre[i] = limitar(0.5 - dist);
      filete[i] = limitar(0.5 - dist) * limitar(dist + 2.5) * 0.42;
      sombra[i] = dist > 0 ? 0.2 * Math.exp(-((dist / 30) ** 2)) : 0.2;
    }
  }
  const cian = [0, 212, 255];
  const tinte = [9, 20, 46];
  return function dibujar(dst, tope) {
    tope = Math.round(tope);
    // Cabeza.
    for (let f = 0; f < filasCabeza; f++) {
      const y = tope - sombraAlto + f;
      if (y < 0 || y >= H) continue;
      const filaCuerpo = f - sombraAlto;
      for (let x = 0; x < W; x++) {
        const i = f * W + x;
        const d = (y * W + x) * 3;
        const cu = cubre[i];
        if (cu < 1) {
          const so = sombra[i] * (1 - cu);
          if (so > 0.002) for (let c = 0; c < 3; c++) dst[d + c] = dst[d + c] + (tinte[c] - dst[d + c]) * so;
        }
        if (cu > 0 && filaCuerpo >= 0) {
          const s = (filaCuerpo * W + x) * 3;
          const fi = filete[i];
          for (let c = 0; c < 3; c++) {
            const col = cuerpo[s + c] + (cian[c] - cuerpo[s + c]) * fi;
            dst[d + c] = Math.round(dst[d + c] + (col - dst[d + c]) * cu);
          }
        }
      }
    }
    // Cuerpo: filas completas, se copian tal cual.
    const desde = Math.max(0, tope + radio);
    for (let y = desde; y < H; y++) {
      const s = (y - tope) * W * 3;
      dst.set(cuerpo.subarray(s, s + W * 3), y * W * 3);
    }
  };
}

/**
 * Un golpe de luz sobre la hoja (cuando pega el precio): aclara la hoja desde su borde de arriba y se apaga
 * hacia abajo. Respeta las esquinas redondas. Se dibuja antes que los textos, así las letras quedan nítidas.
 */
export function destelloHoja(dst, tope, radio, color, fuerza, alto = 560) {
  if (fuerza <= 0.004) return;
  const y0 = Math.max(0, tope);
  const y1 = Math.min(H, tope + alto);
  for (let y = y0; y < y1; y++) {
    const r = y - tope;
    const k = fuerza * (1 - r / alto) ** 2;
    let borde = 0;
    if (r < radio) borde = Math.ceil(radio - Math.sqrt(Math.max(0, radio * radio - (radio - r - 0.5) ** 2)));
    let d = (y * W + borde) * 3;
    for (let x = borde; x < W - borde; x++, d += 3) {
      dst[d] = dst[d] + (color[0] - dst[d]) * k;
      dst[d + 1] = dst[d + 1] + (color[1] - dst[d + 1]) * k;
      dst[d + 2] = dst[d + 2] + (color[2] - dst[d + 2]) * k;
    }
  }
}
