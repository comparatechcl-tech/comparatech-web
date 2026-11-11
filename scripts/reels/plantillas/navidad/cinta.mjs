// La cinta de la variante "producida" de la plantilla "navidad" (muestras del 11-11-2026; el dueño: "haría un cambio
// o corte de imagen algo más producido"). Entre la escena del precio y el cierre, una cinta de raso rojo con filete
// dorado barre la pantalla de abajo hacia arriba, un poco inclinada, en 0,45 s: delante de ella sigue el precio y
// detrás ya está el cierre. La tela ondula apenas, tiene su brillo de raso, deja una sombra blanda a los dos lados
// y suelta chispas doradas al pasar. No tapa nada que haya que leer: cuando entra lo escrito del cierre ya se fue.
import { W, H, azar, limitar, mezcla, suave, ponerEscalada } from '../../pintar.mjs';

const INCLINACION = 0.27; // radianes (unos 15°): los bordes de la cinta suben hacia la derecha
const MEDIO_ANCHO = 210; // la cinta mide 420 px de ancho
const SOMBRA = 46; // la sombra blanda a cada lado
const SEN = Math.sin(INCLINACION);
const COS = Math.cos(INCLINACION);
const LARGO = W * SEN + H * COS; // de la esquina de arriba a la izquierda a la de abajo a la derecha

/** Dónde va el centro de la cinta (medido a lo ancho de la pantalla inclinada) con el avance `p` de 0 a 1. */
export function centroCinta(p) {
  const desde = LARGO + MEDIO_ANCHO + SOMBRA + 40; // aún bajo la pantalla
  const hasta = -MEDIO_ANCHO - SOMBRA - 40; // ya pasó por arriba
  // Arranca y frena suave, pero cruza casi pareja: se ve unos 10 cuadros (con una curva más fuerte pasaba en 5).
  return mezcla(desde, hasta, 0.5 - 0.5 * Math.cos(Math.PI * limitar(p)));
}

/** Las chispas que suelta la cinta: dónde (a lo largo de la cinta), cuándo y de qué tamaño. Siempre las mismas. */
export function chispasDeCinta() {
  const al = azar(311);
  return Array.from({ length: 14 }, (_, i) => ({ a: 0.04 + 0.92 * ((i + al() * 0.8) / 14), cuando: 0.15 + 0.55 * al(), tam: 0.45 + 0.4 * al(), oro: al() < 0.7, atras: 30 + 70 * al() }));
}

const ROJO = [196, 18, 44];
const ROJO_OSCURO = [104, 6, 22];
const RASO = [255, 150, 160];
const ORO_OSCURO = [150, 104, 28];
const ORO = [233, 185, 73];
const ORO_CLARO = [255, 236, 170];

/**
 * Junta los dos cuadros: en `dst` viene pintado el del precio y en `cierre` el del cierre (el mismo segundo). Pone
 * el cierre detrás de la cinta, la cinta encima y su sombra a los dos lados. `p` es el avance de la cinta (0 a 1)
 * y `N` trae las chispas (capas de adornos.mjs).
 */
export function pintarCinta(dst, cierre, p, chispas, N) {
  const c = centroCinta(p);
  const onda = (a) => 12 * Math.sin(a / 160 + 6 * p) + 5 * Math.sin(a / 63 - 9 * p); // la tela ondula al pasar
  const brilloEn = (a) => -0.28 + 0.32 * Math.sin(a / 310 + 3.5 * p); // el brillo del raso se corre a lo largo
  const alcance = MEDIO_ANCHO + SOMBRA + 20;
  for (let y = 0; y < H; y++) {
    const filaS = y * COS;
    const filaA = -y * SEN;
    // Qué parte de la fila toca la cinta (o su sombra): de ahí a la izquierda es una cosa y a la derecha la otra.
    const xA = (c - alcance - filaS) / SEN;
    const xB = (c + alcance - filaS) / SEN;
    const xIni = Math.max(0, Math.floor(Math.min(xA, xB)));
    const xFin = Math.min(W, Math.ceil(Math.max(xA, xB)));
    // Lo que queda bajo la cinta (después de su paso: valores más grandes) ya es el cierre.
    const xCierreDesde = Math.max(0, Math.min(W, xFin));
    if (xCierreDesde < W) dst.set(cierre.subarray((y * W + xCierreDesde) * 3, (y + 1) * W * 3), (y * W + xCierreDesde) * 3);
    for (let x = xIni; x < xFin; x++) {
      const a = x * COS + filaA; // a lo largo de la cinta
      const q = x * SEN + filaS - c + onda(a); // a lo ancho: negativo, del lado del precio
      const d = (y * W + x) * 3;
      if (q > MEDIO_ANCHO || q < -MEDIO_ANCHO) {
        // Fuera de la cinta: el cuadro que toca (el cierre si ya pasó) con la sombra blanda de la cinta.
        const lejos = Math.abs(q) - MEDIO_ANCHO;
        if (q > MEDIO_ANCHO) for (let k = 0; k < 3; k++) dst[d + k] = cierre[d + k];
        const s = lejos < SOMBRA ? 0.42 * (1 - lejos / SOMBRA) ** 2 : 0;
        if (s > 0) for (let k = 0; k < 3; k++) dst[d + k] = Math.round(dst[d + k] * (1 - s));
        continue;
      }
      const v = q / MEDIO_ANCHO; // de -1 a 1 a lo ancho de la cinta
      const av = Math.abs(v);
      let col;
      if (av > 0.9) {
        // El filete dorado, con un brillo en su medio.
        const u = 1 - Math.abs((av - 0.95) / 0.05);
        const k = limitar(0.35 + 0.65 * u ** 1.5 + (v < 0 ? 0.12 : -0.08));
        col = k < 0.5 ? ORO_OSCURO.map((o, i) => mezcla(o, ORO[i], k * 2)) : ORO.map((o, i) => mezcla(o, ORO_CLARO[i], (k - 0.5) * 2));
      } else if (av > 0.86) {
        col = ROJO_OSCURO;
      } else {
        // El raso: más oscuro hacia los bordes (la cinta se curva), con un brillo ancho que se corre.
        const curva = Math.sqrt(1 - (v / 0.86) ** 2);
        const b = Math.exp(-(((v - brilloEn(a)) / 0.2) ** 2));
        const b2 = 0.4 * Math.exp(-(((v - 0.55) / 0.1) ** 2));
        const k = 0.55 + 0.45 * curva;
        col = ROJO.map((r, i) => limitar(r * k + (RASO[i] - r * k) * 0.62 * (b + b2), 0, 255));
      }
      // Borde suave entre la cinta y lo de afuera.
      const cubre = limitar(MEDIO_ANCHO - Math.abs(q) + 0.5);
      for (let k = 0; k < 3; k++) {
        const fuera = q > 0 ? cierre[d + k] : dst[d + k];
        dst[d + k] = Math.round(fuera + (col[k] - fuera) * cubre);
      }
    }
  }
  // Las chispas que quedan atrás de la cinta, del lado del cierre: aparecen al pasar y se apagan.
  for (const ch of chispas) {
    const pp = (p - ch.cuando) / 0.3;
    if (pp <= 0 || pp >= 1) continue;
    // Un poco atrás de donde estaba el borde de la cinta cuando la soltó, repartidas de lado a lado.
    const s = centroCinta(ch.cuando) + MEDIO_ANCHO + ch.atras;
    const x = 30 + ch.a * 860; // nunca a la derecha de x=924 (la columna de botones de las apps)
    const y = (s - x * SEN) / COS;
    if (y < 10 || y > H - 10) continue;
    const capa = ch.oro ? N.chispaOro : N.chispaBlanca;
    ponerEscalada(dst, capa, x, y, ch.tam * (0.4 + 0.6 * suave.sale(pp)), Math.sin(Math.PI * pp));
  }
}
