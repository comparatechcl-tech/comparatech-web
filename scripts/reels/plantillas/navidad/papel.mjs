// El papel de regalo de la variante "regalo" de la plantilla "navidad" (muestras del 12-11-2026; el dueño, de la
// cinta de "producida": "me gustó la idea pero sería bueno ver otra variante"). Entre la escena del precio y el
// cierre, la pantalla se envuelve para regalo y se abre:
//   1. una hoja de papel de regalo (rojo con lunares dorados y copos blancos) entra desde la derecha y tapa el
//      precio, con su sombra sobre lo que va tapando;
//   2. sobre la cinta dorada que cruza el papel salta un moño dorado grande: la pantalla es un regalo;
//   3. el papel se rasga de arriba abajo por el medio: las dos mitades se van a los lados, con el borde roto
//      blanco del revés del papel, y detrás ya está el cierre. Saltan chispas doradas por la rotura.
// No tapa nada que haya que leer: cuando entra lo escrito del cierre el papel ya se fue.
import { W, H, azar, limitar, mezcla, suave, ponerEscalada } from '../../pintar.mjs';

// Los tramos del avance p (de 0 a 1): el papel entra, el moño salta y el papel se rasga.
export const TRAMOS = { entra: [0, 0.36], mono: [0.3, 0.52], rasga: [0.52, 1] };
const CENTRO_Y = 860; // el medio de lo que dejan libre las apps (de y=220 a 1500)
const SOMBRA = 60; // la sombra del papel sobre lo que tapa
const REVES = [246, 240, 230]; // el revés del papel: blanco, apenas crema
const ROJO = [176, 18, 40];
const ORO = [238, 192, 84];
const ORO_CLARO = [255, 232, 160];
const NIEVE = [252, 248, 244];
const COS = Math.cos(0.5);
const SEN = Math.sin(0.5); // el estampado va girado unos 29°
const CELDA = 92;
const CINTA = 46; // media altura de la cinta dorada que cruza el papel (en y=CENTRO_Y)
const ORO_OSCURO = [150, 104, 28];

const tramo = (p, [a, b]) => limitar((p - a) / (b - a));

/** Cuánto ha entrado la hoja: dónde está su borde izquierdo (W = fuera de la pantalla, 0 = la tapa entera). */
export function bordeDelPapel(p) {
  return Math.round(mezcla(W + SOMBRA, 0, suave.sale(tramo(p, TRAMOS.entra))));
}

/** Cuánto se ha abierto cada mitad hacia su lado, en px (al final, las dos ya salieron de la pantalla). */
export function aperturaDelPapel(p) {
  return (W / 2 + 90) * suave.entra(tramo(p, TRAMOS.rasga));
}

/**
 * Los dos bordes rotos, uno por mitad, como desvío desde x=540 en cada fila. Picos de 4 a 22 px que cambian cada
 * 18 a 46 px de alto: el papel no se rompe derecho. Siempre los mismos.
 */
export function bordesRotos() {
  const al = azar(1212);
  const izq = new Float32Array(H);
  const der = new Float32Array(H);
  for (const borde of [izq, der]) {
    let y = 0;
    let antes = (al() - 0.5) * 20;
    while (y < H) {
      const alto = 18 + al() * 28;
      const pico = (al() - 0.5) * 2 * (4 + al() * 18);
      for (let k = 0; k < alto && y + k < H; k++) borde[y + k] = mezcla(antes, pico, k / alto) + Math.sin((y + k) / 9) * 1.5;
      antes = pico;
      y += Math.ceil(alto);
    }
  }
  // El de la derecha sigue al de la izquierda, corrido apenas: son las dos orillas de la misma rotura.
  for (let y = 0; y < H; y++) der[y] = 0.75 * izq[y] + 0.25 * der[y] + 3;
  return { izq, der };
}

/** Las chispas de la rotura: dónde (alto), cuándo (en el tramo de rasgar) y de qué tamaño. Siempre las mismas. */
export function chispasDelPapel() {
  const al = azar(2512);
  return Array.from({ length: 12 }, (_, i) => ({ y: 260 + ((i + al() * 0.7) / 12) * 1180, cuando: 0.02 + 0.5 * al(), tam: 0.4 + 0.45 * al(), oro: al() < 0.75, lado: al() < 0.5 ? -1 : 1 }));
}

/** El color del papel en (u, v): las coordenadas sobre la hoja (se mueve con ella). */
function colorDelPapel(u, v, out) {
  // La cinta dorada de lado a lado: más oscura en los bordes (se curva) y con un brillo de raso.
  const w = (v - CENTRO_Y) / CINTA;
  if (Math.abs(w) <= 1) {
    const borde = Math.abs(w) > 0.88;
    const brillo = Math.exp(-(((w + 0.25) / 0.28) ** 2)) + 0.35 * Math.sin(u / 140) * Math.exp(-(((w - 0.4) / 0.2) ** 2));
    const base = borde ? ORO_OSCURO : ORO.map((o, i) => mezcla(ORO_OSCURO[i], o, 0.55 + 0.45 * Math.sqrt(1 - w * w)));
    for (let k = 0; k < 3; k++) out[k] = limitar(base[k] + (ORO_CLARO[k] - base[k]) * 0.7 * limitar(brillo), 0, 255);
    return;
  }
  // Luz pareja con un brillo ancho en diagonal (el papel es un poco satinado).
  const luz = 0.9 + 0.1 * Math.cos((u - 260) / 520) + 0.1 * Math.exp(-(((u * 0.6 + v * 0.4 - 900) / 260) ** 2));
  let r = ROJO[0] * luz;
  let g = ROJO[1] * luz;
  let b = ROJO[2] * luz;
  // El estampado: una grilla girada; en las celdas pares un lunar dorado, en las impares un copo blanco.
  const a = u * COS + v * SEN;
  const c = -u * SEN + v * COS;
  const ca = Math.floor(a / CELDA);
  const cc = Math.floor(c / CELDA);
  const da = a - (ca + 0.5) * CELDA;
  const dc = c - (cc + 0.5) * CELDA;
  let cubre = 0;
  let col = ORO;
  if (((ca + cc) & 1) === 0) {
    const dist = Math.sqrt(da * da + dc * dc);
    cubre = limitar(10.5 - dist);
    // El lunar con brillo arriba a la izquierda.
    col = dist < 10.5 && da + dc < -6 ? ORO_CLARO : ORO;
  } else {
    // Un copo: tres palitos cruzados (0°, 60° y 120°) de 34 px, con puntas.
    for (const [cs, sn] of [[1, 0], [0.5, 0.866], [-0.5, 0.866]]) {
      const largo = Math.abs(da * cs + dc * sn);
      const ancho = Math.abs(da * sn - dc * cs);
      if (largo <= 17) cubre = Math.max(cubre, limitar(2.4 - ancho));
      // Las puntas en V del copo.
      if (largo > 9 && largo < 15) cubre = Math.max(cubre, limitar(2 - Math.abs(ancho - (largo - 9) * 0.7)));
    }
    col = NIEVE;
    cubre *= 0.92;
  }
  if (cubre > 0) {
    r = mezcla(r, col[0], cubre);
    g = mezcla(g, col[1], cubre);
    b = mezcla(b, col[2], cubre);
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

/**
 * Junta los dos cuadros: en `dst` viene pintado el del precio y en `cierre` el del cierre (el mismo segundo). `p` es
 * el avance del papel (0 a 1), `bordes` lo de bordesRotos(), `chispas` lo de chispasDelPapel() y `N` trae el moño y
 * las chispas (capas de adornos.mjs).
 */
/** El moño de los adornos (rojo), en dorado: sobre el papel rojo no se vería. Se hace una vez por video. */
export function monoDorado(mono) {
  const data = new Uint8Array(mono.data);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const luz = (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255;
    const t = limitar((luz - 0.1) / 0.55);
    for (let k = 0; k < 3; k++) data[i + k] = Math.round(t < 0.5 ? mezcla(ORO_OSCURO[k], ORO[k], t * 2) : mezcla(ORO[k], ORO_CLARO[k], (t - 0.5) * 2));
  }
  return { ...mono, data };
}

export function pintarPapel(dst, cierre, p, bordes, chispas, N, mono) {
  const x0 = bordeDelPapel(p);
  const abre = aperturaDelPapel(p);
  const rasgando = p >= TRAMOS.rasga[0];
  const col = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    // Mientras entra, la hoja va corrida x0 px; ya entera, queda quieta. Al rasgarse, cada mitad se corre hacia su lado.
    const corteI = W / 2 + bordes.izq[y] - abre; // la mitad izquierda llega hasta aquí
    const corteD = W / 2 + bordes.der[y] + abre; // la derecha empieza aquí
    for (let x = 0; x < W; x++) {
      const d = (y * W + x) * 3;
      if (!rasgando) {
        if (x < x0) {
          // Todavía el precio, con la sombra del papel que viene.
          const lejos = x0 - x;
          if (lejos < SOMBRA) {
            const s = 0.45 * (1 - lejos / SOMBRA) ** 2;
            for (let k = 0; k < 3; k++) dst[d + k] = Math.round(dst[d + k] * (1 - s));
          }
          continue;
        }
        colorDelPapel(x - x0, y, col);
        // El borde de la hoja que entra se ve un poco más claro: es el doblez.
        const doblez = Math.max(0, 1 - (x - x0) / 14) * 0.35;
        for (let k = 0; k < 3; k++) dst[d + k] = Math.round(limitar(col[k] + (255 - col[k]) * doblez, 0, 255));
        continue;
      }
      // Rasgando: la mitad izquierda (corrida -abre), el cierre en medio y la mitad derecha (corrida +abre).
      if (x < corteI || x > corteD) {
        const izquierda = x < corteI;
        const u = izquierda ? x + abre : x - abre; // dónde estaba ese punto de la hoja antes de abrirse
        const orilla = izquierda ? corteI - x : x - corteD; // distancia al borde roto
        // El revés blanco asoma en el borde roto, más ancho en los picos.
        const fibra = 5 + 7 * Math.abs(Math.sin(y / 23 + (izquierda ? 0 : 2))) + (izquierda ? bordes.izq[y] : bordes.der[y]) * 0.15;
        if (orilla < fibra) {
          const k2 = limitar(orilla); // borde suave hacia el cierre
          for (let k = 0; k < 3; k++) dst[d + k] = Math.round(mezcla(cierre[d + k], REVES[k] - 10 * (1 - orilla / fibra), k2));
        } else {
          colorDelPapel(u, y, col);
          // Cerca del borde roto el papel se levanta un poco: más luz.
          const levanta = orilla < fibra + 24 ? 0.12 * (1 - (orilla - fibra) / 24) : 0;
          for (let k = 0; k < 3; k++) dst[d + k] = Math.round(limitar(col[k] + (255 - col[k]) * levanta, 0, 255));
        }
      } else {
        // El cierre, con la sombra de las dos mitades sobre él.
        const lejos = Math.min(x - corteI, corteD - x);
        const s = lejos < 40 ? 0.5 * (1 - lejos / 40) ** 2 : 0;
        for (let k = 0; k < 3; k++) dst[d + k] = Math.round(cierre[d + k] * (1 - s));
      }
    }
  }
  // El moño dorado salta sobre la cinta cuando el papel ya tapó todo; al rasgarse, crece un poco y se desvanece.
  const pm = tramo(p, TRAMOS.mono);
  if (pm > 0) {
    const pr = tramo(p, [TRAMOS.rasga[0], TRAMOS.rasga[0] + 0.18]);
    const k = 1.75 * (0.5 + 0.5 * suave.rebote(pm)) * (1 + 0.3 * suave.sale(pr));
    ponerEscalada(dst, mono, W / 2, CENTRO_Y, k, Math.min(1, pm * 3) * (1 - pr));
    // Dos chispas al posarse.
    for (const [lado, capa] of [[-1, N.chispaOro], [1, N.chispaBlanca]]) {
      const pc = tramo(p, [TRAMOS.mono[0] + 0.1, TRAMOS.mono[1] + 0.06]);
      if (pc > 0 && pc < 1) ponerEscalada(dst, capa, W / 2 + lado * 250, CENTRO_Y - 90, 0.55 * (0.4 + 0.6 * suave.sale(pc)), Math.sin(Math.PI * pc));
    }
  }
  // Las chispas de la rotura: aparecen en el borde mientras se abre y se apagan.
  if (rasgando) {
    const pr = tramo(p, TRAMOS.rasga);
    for (const ch of chispas) {
      const pp = (pr - ch.cuando) / 0.35;
      if (pp <= 0 || pp >= 1) continue;
      const y = Math.round(ch.y);
      const x = W / 2 + ch.lado * (aperturaDelPapel(TRAMOS.rasga[0] + ch.cuando * (TRAMOS.rasga[1] - TRAMOS.rasga[0])) + 10);
      if (x < 20 || x > 904) continue; // nunca a la derecha de x=924 (la columna de botones de las apps)
      const capa = ch.oro ? N.chispaOro : N.chispaBlanca;
      ponerEscalada(dst, capa, x, y, ch.tam * (0.4 + 0.6 * suave.sale(pp)), Math.sin(Math.PI * pp));
    }
  }
}
