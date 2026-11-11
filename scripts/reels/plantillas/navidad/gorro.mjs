// El gorro grande del Viejito Pascuero (variantes "gorro" y "producida" de la plantilla "navidad"; muestras del
// 11-11-2026, el dueño: "pondría un gorro navideño real más gigante en vez de eso loguito pequeño").
//
// No es un SVG plano como el gorrito de dibujos.mjs: se pinta punto por punto con luz, como un objeto con volumen.
//   - la copa es un tubo de terciopelo rojo que sube desde el ala, se dobla arriba y cae hacia un lado; cada punto
//     se ilumina según hacia dónde mira (luz de arriba a la izquierda), con el brillo de borde del terciopelo, unos
//     pliegues en el doblez, la sombra que le hace el ala y un grano fino de tela;
//   - el ala y el pompón son de piel blanca: una base con volumen y encima cientos de mechones chicos, cada uno con
//     su luz y su sombra, que además rompen el borde (no queda una orilla lisa);
//   - el gorro deja una sombra blanda sobre lo que tiene debajo (el logo).
// Todo sale de números fijos (azar con semilla): mismo dibujo en cada video. Nada de imágenes de afuera.
//
// Las medidas van en "lados de logo" (U): el logo ocupa de (0, 0) a (1, 1). Así el mismo gorro sirve para el logo
// grande del cierre y para el chico de la pastilla de arriba.
import { azar, limitar, W, H } from '../../pintar.mjs';

// --- La forma ---------------------------------------------------------------------------------------------------
// El ala: una banda de piel apenas curva (va alrededor de la cabeza: el medio queda más abajo), inclinada.
const ALA = { x0: -0.12, y0: 0.07, x1: 0.98, y1: -0.05, comba: 0.06, grueso: 0.125 };
// La copa: el eje del tubo (una curva de Bézier) desde el ala hasta la punta, y su radio en la base y en la punta.
const COPA = { p0: [0.42, 0.0], p1: [0.44, -0.72], p2: [1.0, -1.08], p3: [1.36, -0.1], r0: 0.45, rFin: 0.06 };
const POMPON = 0.2; // radio
const BORDE = 0.12; // margen del lienzo alrededor de lo dibujado (para la sombra)

const LUZ = unir([-0.5, -0.7, 0.52]); // de arriba a la izquierda y un poco de frente

function unir(v) {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}
const lineal = (c) => (c / 255) ** 2.2;
const srgb = (v) => Math.round(255 * limitar(v) ** (1 / 2.2));
const suaveEntre = (a, b, x) => {
  const t = limitar((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const ROJO = [205, 18, 44].map(lineal); // terciopelo
const BRILLO_ROJO = [1.0, 0.42, 0.46]; // el brillo de borde del terciopelo
const PIEL = [236, 238, 243].map(lineal);

function bezier(t, p) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p.p0[k] + 3 * u * u * t * p.p1[k] + 3 * u * t * t * p.p2[k] + t * t * t * p.p3[k]);
}
function tangente(t, p) {
  const u = 1 - t;
  const v = [0, 1].map((k) => 3 * u * u * (p.p1[k] - p.p0[k]) + 6 * u * t * (p.p2[k] - p.p1[k]) + 3 * t * t * (p.p3[k] - p.p2[k]));
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
const radioCopa = (t) => COPA.rFin + (COPA.r0 - COPA.rFin) * (1 - t) ** 1.25;
/** El eje del ala en u (0 a 1) y su medio grueso. */
function ala(u) {
  return {
    x: ALA.x0 + (ALA.x1 - ALA.x0) * u,
    y: ALA.y0 + (ALA.y1 - ALA.y0) * u + ALA.comba * 4 * u * (1 - u),
    g: ALA.grueso * (0.9 + 0.2 * 4 * u * (1 - u)),
  };
}
/** El medio del ala, en lados de logo: donde el gorro se apoya en el logo (desde ahí se gira y se aplasta). */
export const APOYO_EN_LOGO = { x: ala(0.5).x, y: ala(0.5).y };

// --- El lienzo (color lineal premultiplicado, para sumar capas sin ensuciar los bordes) --------------------------
function lienzo(w, h) {
  return { w, h, c: new Float32Array(w * h * 4) };
}
/** Pone un punto de color `col` (lineal) con cobertura `a` encima de lo que hay. */
function sobre(L, x, y, col, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= L.w || y >= L.h) return;
  const i = (y * L.w + x) * 4;
  const k = 1 - a;
  L.c[i] = col[0] * a + L.c[i] * k;
  L.c[i + 1] = col[1] * a + L.c[i + 1] * k;
  L.c[i + 2] = col[2] * a + L.c[i + 2] * k;
  L.c[i + 3] = a + L.c[i + 3] * k;
}

/** Un ruido fijo por punto, de -1 a 1 (el grano de la tela). */
const grano = (x, y) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (((n ^ (n >>> 16)) >>> 0) / 4294967296) * 2 - 1;
};

/**
 * Un tubo (la copa o la base del ala) pintado como un cilindro: cada punto toma el tramo del eje que le queda más
 * adentro, y de ahí sale hacia dónde mira. `tramos` es la lista de { x, y, tx, ty, r, t } (en pixeles del lienzo).
 * `recorte(x, y)` dice si el punto se pinta. Devuelve, por punto, { v, t, cubre }.
 */
function tubo(L, tramos, recorte) {
  const prof = new Float32Array(L.w * L.h).fill(-1);
  const datos = new Float32Array(L.w * L.h * 3);
  for (const s of tramos) {
    const x0 = Math.max(0, Math.floor(s.x - s.r - 1));
    const x1 = Math.min(L.w - 1, Math.ceil(s.x + s.r + 1));
    const y0 = Math.max(0, Math.floor(s.y - s.r - 1));
    const y1 = Math.min(L.h - 1, Math.ceil(s.y + s.r + 1));
    const nx = -s.ty;
    const ny = s.tx;
    const r2 = (s.r + 1) * (s.r + 1);
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - s.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - s.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const p = 1 - d / s.r;
        const i = y * L.w + x;
        if (p <= prof[i]) continue;
        prof[i] = p;
        datos[i * 3] = (dx * nx + dy * ny) / s.r; // de -1 a 1, de un costado al otro
        datos[i * 3 + 1] = s.t;
        datos[i * 3 + 2] = limitar(s.r - d + 0.5); // cuánto del punto cubre (borde suave)
      }
    }
  }
  const lista = [];
  for (let i = 0; i < L.w * L.h; i++) {
    if (prof[i] === -1 || datos[i * 3 + 2] <= 0) continue;
    const x = i % L.w;
    const y = (i / L.w) | 0;
    if (recorte && !recorte(x, y)) continue;
    lista.push({ x, y, v: limitar(datos[i * 3], -1, 1), t: datos[i * 3 + 1], cubre: datos[i * 3 + 2] });
  }
  return lista;
}

/** Hacia dónde mira un punto del tubo: el costado (v) sobre la perpendicular del eje (nx, ny). */
function normalTubo(v, nx, ny) {
  const nz = Math.sqrt(Math.max(0, 1 - v * v));
  return [v * nx, v * ny, nz];
}
const luzDe = (n) => Math.max(0, n[0] * LUZ[0] + n[1] * LUZ[1] + n[2] * LUZ[2]);

/**
 * Dibuja el gorro para un logo de `U` pixeles de lado. Devuelve la capa RGBA { w, h, data } y dónde va su esquina
 * de arriba a la izquierda respecto de la del logo (dx, dy, en pixeles). Con `espejo` la punta cae a la izquierda
 * (la luz sigue viniendo de arriba a la izquierda).
 */
export function dibujarGorro(U, { espejo = false, sombra = true } = {}) {
  const fx = (x) => (espejo ? 1 - x : x); // el espejo se hace en la forma, no en la imagen: así la luz no se da vuelta
  // El lienzo: de x=-0.35 a 1.75 y de y=-1.1 a 0.45 (en lados de logo), con margen.
  const X0 = -0.35 - BORDE;
  const Y0 = -1.1 - BORDE;
  const w = Math.ceil((2.1 + 2 * BORDE) * U);
  const h = Math.ceil((1.55 + 2 * BORDE) * U);
  const ox = espejo ? (X0 + w / U - 1) * U : -X0 * U; // dónde queda x=0 del logo en el lienzo
  const oy = -Y0 * U;
  const aLienzo = (x, y) => [ox + fx(x) * U, oy + y * U];
  const L = lienzo(w, h);
  const al = azar(2512);

  // 1. La copa de terciopelo.
  const tramos = [];
  const N = Math.max(160, Math.round(1.3 * U));
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, y] = aLienzo(...bezier(t, COPA));
    let [tx, ty] = tangente(t, COPA);
    if (espejo) tx = -tx;
    tramos.push({ x, y, tx, ty, r: radioCopa(t) * U, t });
  }
  // El ala tapa la base de la copa: la copa no se pinta bajo el eje del ala.
  const ejeAla = (xLienzo) => {
    const xl = fx((xLienzo - ox) / U);
    const u = limitar((xl - ALA.x0) / (ALA.x1 - ALA.x0));
    return oy + ala(u).y * U;
  };
  const puntosCopa = tubo(L, tramos, (x, y) => y + 0.5 < ejeAla(x + 0.5));
  for (const p of puntosCopa) {
    const s = tramos[Math.round(p.t * N)];
    let v = p.v;
    // Pliegues de la tela donde se dobla la punta: el costado "se ondula" un poco.
    const doblez = suaveEntre(0.28, 0.42, p.t) * (1 - suaveEntre(0.6, 0.74, p.t));
    v = limitar(v + 0.07 * doblez * Math.sin(2 * Math.PI * (p.t * 5 + v * 0.3)), -1, 1);
    const n = normalTubo(v, -s.ty, s.tx);
    const lam = luzDe(n);
    const borde = (1 - n[2]) ** 2.2; // el terciopelo brilla en el borde
    // Las arrugas del doblez: surcos oscuros y su filo claro, no del todo parejos.
    const onda = Math.sin(2 * Math.PI * (p.t * 6 + v * (0.5 + 0.25 * Math.sin(p.t * 23))));
    const surco = doblez * Math.max(0, onda) ** 3;
    const filo = doblez * Math.max(0, -onda) ** 6;
    // La sombra del ala sobre la base de la copa, y la que hace la punta doblada sobre el costado de la copa.
    const sobreAla = (ejeAla(p.x + 0.5) - ALA.grueso * U - (p.y + 0.5)) / U;
    const ao = 1 - 0.55 * Math.exp(-Math.max(0, sobreAla) / 0.07);
    const k = (0.07 + 1.0 * lam) * ao * (1 - 0.35 * surco) * (1 + 0.04 * grano(p.x, p.y));
    const brillo = borde * (0.12 + 0.95 * lam) * 0.5 + 0.22 * filo * lam;
    const col = [0, 1, 2].map((c) => ROJO[c] * k + BRILLO_ROJO[c] * brillo * ROJO[0]);
    sobre(L, p.x, p.y, col, p.cubre);
  }

  // 2. El ala de piel: una base con volumen y encima los mechones.
  const tramosAla = [];
  const NA = Math.max(100, Math.round(1.1 * U));
  for (let i = 0; i <= NA; i++) {
    const u = i / NA;
    const a = ala(u);
    const b = ala(Math.min(1, u + 0.001));
    const c0 = ala(Math.max(0, u - 0.001));
    let tx = (b.x - c0.x) * (espejo ? -1 : 1);
    let ty = b.y - c0.y;
    const l = Math.hypot(tx, ty);
    const [x, y] = aLienzo(a.x, a.y);
    tramosAla.push({ x, y, tx: tx / l, ty: ty / l, r: a.g * U, t: u });
  }
  const sombraPiel = [0.1, 0.12, 0.2];
  const mechon = (cx, cy, rho, nBase, tono, sombraFuerza = 0.11) => {
    // Primero su sombra (corrida hacia abajo a la derecha), después el mechón con su luz.
    for (const [ddx, ddy, esSombra] of [[0.28 * rho, 0.42 * rho, true], [0, 0, false]]) {
      const x0 = Math.floor(cx + ddx - rho - 1);
      const x1 = Math.ceil(cx + ddx + rho + 1);
      const y0 = Math.floor(cy + ddy - rho - 1);
      const y1 = Math.ceil(cy + ddy + rho + 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dx = (x + 0.5 - cx - ddx) / rho;
          const dy = (y + 0.5 - cy - ddy) / rho;
          const q = dx * dx + dy * dy;
          if (q >= 1) continue;
          const a = limitar((1 - Math.sqrt(q)) / 0.6); // borde blando: la piel no tiene orilla
          if (esSombra) {
            sobre(L, x, y, sombraPiel, a * sombraFuerza);
            continue;
          }
          const nz = Math.sqrt(1 - q);
          const n = unir([nBase[0] + 0.5 * dx, nBase[1] + 0.5 * dy, nBase[2] + 0.5 * nz]);
          const lam = luzDe(n);
          const k = (0.26 + 0.78 * lam) * tono;
          sobre(L, x, y, [PIEL[0] * k * 0.97, PIEL[1] * k * 0.98, PIEL[2] * k], a * 0.92);
        }
      }
    }
  };
  for (const p of tubo(L, tramosAla, null)) {
    const s = tramosAla[Math.round(p.t * NA)];
    const n = normalTubo(p.v, -s.ty, s.tx);
    const k = (0.16 + 0.85 * luzDe(n)) * (1 + 0.03 * grano(p.x, p.y));
    sobre(L, p.x, p.y, [PIEL[0] * k * 0.96, PIEL[1] * k * 0.97, PIEL[2] * k], p.cubre);
  }
  const cuantosAla = Math.round(2300 * (U / 240) ** 0.5);
  for (let i = 0; i < cuantosAla; i++) {
    const u = -0.02 + 1.04 * al();
    const lado = (al() * 2 - 1) * 1.12;
    const a = ala(limitar(u));
    const s = tramosAla[Math.round(limitar(u) * NA)];
    const nb = normalTubo(limitar(lado, -0.98, 0.98), -s.ty, s.tx);
    const [x, y] = aLienzo(a.x + (u - limitar(u)) * (ALA.x1 - ALA.x0), a.y);
    const cx = x + -s.ty * lado * a.g * U + (al() - 0.5) * 0.02 * U;
    const cy = y + s.tx * lado * a.g * U + (al() - 0.5) * 0.02 * U;
    mechon(cx, cy, U * (0.018 + 0.022 * al()), nb, 0.92 + 0.1 * al());
  }

  // 3. El pompón, al final de la punta: primero su sombra sobre la punta, después la bola y sus mechones.
  const tFin = tangente(1, COPA);
  const [pxL, pyL] = aLienzo(COPA.p3[0] + tFin[0] * 0.07, COPA.p3[1] + tFin[1] * 0.07 + 0.04);
  const R = POMPON * U;
  for (let y = Math.floor(pyL - R * 1.6); y <= pyL + R * 1.6; y++) {
    for (let x = Math.floor(pxL - R * 1.6); x <= pxL + R * 1.6; x++) {
      const d = Math.hypot(x + 0.5 - pxL + 0.12 * R * (espejo ? -1 : 1), y + 0.5 - pyL + 0.25 * R) / (R * 1.25);
      if (d < 1) sobre(L, x, y, sombraPiel, 0.35 * (1 - d * d) ** 2);
    }
  }
  for (let y = Math.floor(pyL - R - 1); y <= pyL + R + 1; y++) {
    for (let x = Math.floor(pxL - R - 1); x <= pxL + R + 1; x++) {
      const dx = (x + 0.5 - pxL) / R;
      const dy = (y + 0.5 - pyL) / R;
      const q = dx * dx + dy * dy;
      if (q >= 1) continue;
      const n = [dx, dy, Math.sqrt(1 - q)];
      const k = 0.16 + 0.85 * luzDe(n);
      sobre(L, x, y, [PIEL[0] * k * 0.96, PIEL[1] * k * 0.97, PIEL[2] * k], limitar((1 - Math.sqrt(q)) * R));
    }
  }
  const cuantosPompon = Math.round(520 * (U / 240) ** 0.5);
  for (let i = 0; i < cuantosPompon; i++) {
    const ang = al() * Math.PI * 2;
    const rr = Math.sqrt(al()) * 1.02;
    const dx = Math.cos(ang) * rr;
    const dy = Math.sin(ang) * rr;
    const nz = Math.sqrt(Math.max(0.05, 1 - Math.min(1, rr * rr)));
    mechon(pxL + dx * R, pyL + dy * R, U * (0.026 + 0.03 * al()), [dx, dy, nz], 0.9 + 0.12 * al(), 0.16);
  }

  // 4. A color normal (sRGB, sin premultiplicar), con la sombra blanda que el gorro deja debajo.
  const alfa = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alfa[i] = L.c[i * 4 + 3];
  const sombraA = sombra ? desenfocar(alfa, w, h, Math.max(1, Math.round(0.035 * U))) : null;
  const corrX = Math.round(0.02 * U) * (espejo ? -1 : 1);
  const corrY = Math.round(0.06 * U);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = L.c[i * 4 + 3];
      let sa = 0;
      if (sombraA) {
        const sx = x - corrX;
        const sy = y - corrY;
        if (sx >= 0 && sy >= 0 && sx < w && sy < h) sa = 0.55 * sombraA[sy * w + sx];
      }
      // El gorro sobre su sombra (la sombra es casi negra azulada).
      const at = a + sa * (1 - a);
      if (at <= 0.002) continue;
      const fondoSombra = [0.002, 0.004, 0.012];
      for (let c = 0; c < 3; c++) {
        const premult = L.c[i * 4 + c] + fondoSombra[c] * sa * (1 - a);
        data[i * 4 + c] = srgb(premult / at);
      }
      data[i * 4 + 3] = Math.round(at * 255);
    }
  }
  return recortar({ w, h, data, dx: -ox, dy: -oy });
}

/** Desenfoque (tres pasadas de caja) de un canal. */
function desenfocar(src, w, h, r) {
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  for (let pasada = 0; pasada < 3; pasada++) {
    for (let y = 0; y < h; y++) {
      let suma = 0;
      for (let x = -r; x <= r; x++) suma += x >= 0 && x < w ? a[y * w + x] : 0;
      for (let x = 0; x < w; x++) {
        b[y * w + x] = suma / (2 * r + 1);
        const sale = x - r;
        const entra = x + r + 1;
        if (sale >= 0) suma -= a[y * w + sale];
        if (entra < w) suma += a[y * w + entra];
      }
    }
    for (let x = 0; x < w; x++) {
      let suma = 0;
      for (let y = -r; y <= r; y++) suma += y >= 0 && y < h ? b[y * w + x] : 0;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = suma / (2 * r + 1);
        const sale = y - r;
        const entra = y + r + 1;
        if (sale >= 0) suma -= b[sale * w + x];
        if (entra < h) suma += b[entra * w + x];
      }
    }
  }
  return a;
}

/** Corta el lienzo a lo dibujado (más 2 px), corrigiendo dónde queda respecto del logo. */
function recortar(capa) {
  let x0 = capa.w;
  let y0 = capa.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < capa.h; y++) {
    for (let x = 0; x < capa.w; x++) {
      if (capa.data[(y * capa.w + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  x0 = Math.max(0, x0 - 2);
  y0 = Math.max(0, y0 - 2);
  x1 = Math.min(capa.w - 1, x1 + 2);
  y1 = Math.min(capa.h - 1, y1 + 2);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(capa.data.subarray(((y0 + y) * capa.w + x0) * 4, ((y0 + y) * capa.w + x0 + w) * 4), y * w * 4);
  return { w, h, data, dx: capa.dx + x0, dy: capa.dy + y0 };
}

/**
 * Achica una capa `f` veces (un número entero) promediando bloques de f x f, con el color pesado por su
 * transparencia. El gorro se dibuja más grande y se achica: así los mechones chicos no quedan dentados.
 */
export function achicarCapa(capa, f) {
  if (f === 1) return capa;
  const w = Math.floor(capa.w / f);
  const h = Math.floor(capa.h / f);
  const data = new Uint8Array(w * h * 4);
  const src = capa.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let yy = 0; yy < f; yy++) {
        for (let xx = 0; xx < f; xx++) {
          const i = ((y * f + yy) * capa.w + x * f + xx) * 4;
          const k = src[i + 3];
          r += src[i] * k;
          g += src[i + 1] * k;
          b += src[i + 2] * k;
          a += k;
        }
      }
      const d = (y * w + x) * 4;
      if (a > 0) {
        data[d] = Math.round(r / a);
        data[d + 1] = Math.round(g / a);
        data[d + 2] = Math.round(b / a);
      }
      data[d + 3] = Math.round(a / (f * f));
    }
  }
  return { w, h, data, dx: capa.dx / f, dy: capa.dy / f };
}

const hechos = new Map(); // los videos del día se arman en el mismo proceso: el gorro se dibuja una vez
/**
 * El gorro listo para un logo de `lado` px: se dibuja `f` veces más grande y se achica. Devuelve la capa y dónde va
 * su esquina de arriba a la izquierda respecto de la del logo (dx, dy). Nadie la modifica: se comparte.
 */
export function gorroParaLogo(lado, { espejo = false, f = 2 } = {}) {
  const clave = `${lado}|${espejo}|${f}`;
  if (!hechos.has(clave)) hechos.set(clave, achicarCapa(dibujarGorro(lado * f, { espejo }), f));
  return hechos.get(clave);
}

/**
 * Pone una capa girada `angulo` radianes y escalada (sx, sy) alrededor de su punto de apoyo `ancla` (en fracciones
 * de la capa), que queda en (x, y) de la pantalla. Es para el gorro que cae y se balancea. Mezcla con el color
 * pesado por su transparencia, como ponerEscalada.
 */
export function ponerGirada(dst, capa, x, y, { sx = 1, sy = 1, angulo = 0, opacidad = 1, ancla = [0.5, 0.5], yMax = H } = {}) {
  if (opacidad <= 0.004) return;
  const cos = Math.cos(angulo);
  const sin = Math.sin(angulo);
  const ax = capa.w * ancla[0];
  const ay = capa.h * ancla[1];
  // Las cuatro esquinas en la pantalla, para saber qué recorrer.
  const esquinas = [[0, 0], [capa.w, 0], [0, capa.h], [capa.w, capa.h]].map(([u, v]) => {
    const px = (u - ax) * sx;
    const py = (v - ay) * sy;
    return [x + px * cos - py * sin, y + px * sin + py * cos];
  });
  const x0 = Math.max(0, Math.floor(Math.min(...esquinas.map((e) => e[0]))));
  const x1 = Math.min(W, Math.ceil(Math.max(...esquinas.map((e) => e[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...esquinas.map((e) => e[1]))));
  const y1 = Math.min(H, yMax, Math.ceil(Math.max(...esquinas.map((e) => e[1]))));
  const src = capa.data;
  const op = limitar(opacidad);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      // De la pantalla a la capa: deshacer el giro y la escala.
      const qx = xx + 0.5 - x;
      const qy = yy + 0.5 - y;
      const u = (qx * cos + qy * sin) / sx + ax - 0.5;
      const v = (-qx * sin + qy * cos) / sy + ay - 0.5;
      if (u < -1 || v < -1 || u > capa.w || v > capa.h) continue;
      const ux = Math.floor(u);
      const vy = Math.floor(v);
      const fx = u - ux;
      const fy = v - vy;
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [cx, cy, peso] of [[ux, vy, (1 - fx) * (1 - fy)], [ux + 1, vy, fx * (1 - fy)], [ux, vy + 1, (1 - fx) * fy], [ux + 1, vy + 1, fx * fy]]) {
        if (cx < 0 || cy < 0 || cx >= capa.w || cy >= capa.h || peso <= 0) continue;
        const i = (cy * capa.w + cx) * 4;
        const k = src[i + 3] * peso;
        a += k;
        r += src[i] * k;
        g += src[i + 1] * k;
        b += src[i + 2] * k;
      }
      if (a < 0.5) continue;
      const k = (a / 255) * op;
      const d = (yy * W + xx) * 3;
      dst[d] = Math.round(dst[d] + (r / a - dst[d]) * k);
      dst[d + 1] = Math.round(dst[d + 1] + (g / a - dst[d + 1]) * k);
      dst[d + 2] = Math.round(dst[d + 2] + (b / a - dst[d + 2]) * k);
    }
  }
}
