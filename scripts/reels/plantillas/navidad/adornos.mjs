// Los adornos de la plantilla "navidad": el moño, las chispas doradas, la guirnalda de luces de arriba, la
// nieve que cae sobre la hoja azul noche, el gorro del Viejito Pascuero sobre el logo y, en el cierre, el Viejito
// Pascuero y el arbolito (los dibujos están en dibujos.mjs). Nada de esto es texto ni tapa la foto del producto:
// la guirnalda cuelga en la franja de arriba (la que tapan las apps), la nieve cae solo sobre la hoja oscura y el
// Viejito Pascuero sale recién en el cierre, cuando ya no hay producto en pantalla.
//
// El moño es el mismo de las piezas de historia (src/lib/content/christmas.ts): scripts/piezas/navidad.mjs lo
// toma de aquí para imprimir su constante. Si se cambia el dibujo, se vuelve a pegar allá.
import sharp from 'sharp';
import { W, H, azar, limitar } from '../../pintar.mjs';
import { GORRO_SVG, VIEJITO_SVG, RINCON_SVG } from './dibujos.mjs';

// Los colores de los adornos. La marca sigue siendo azul noche y cian: el rojo y el dorado van solo en el moño,
// las luces y las chispas.
export const ROJO = '#C81E3A';
export const DORADO = '#E9B949';

/** El moño (rojo, con el nudo dorado), en un lienzo de 200x150. */
export const MONO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150">
<defs>
<linearGradient id="lazo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0566B"/><stop offset=".55" stop-color="#C81E3A"/><stop offset="1" stop-color="#8E0F24"/></linearGradient>
<linearGradient id="cola" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B3172F"/><stop offset="1" stop-color="#7A0B1D"/></linearGradient>
<linearGradient id="oro" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset=".5" stop-color="#E9B949"/><stop offset="1" stop-color="#B8862B"/></linearGradient>
</defs>
<path d="M92 74 L58 140 L74 133 L82 148 L106 80 Z" fill="url(#cola)"/>
<path d="M108 74 L142 140 L126 133 L118 148 L94 80 Z" fill="url(#cola)"/>
<path d="M100 70 C82 30 40 6 20 24 C2 40 14 78 52 84 C72 87 90 80 100 72 Z" fill="url(#lazo)"/>
<path d="M100 70 C118 30 160 6 180 24 C198 40 186 78 148 84 C128 87 110 80 100 72 Z" fill="url(#lazo)"/>
<path d="M100 71 C86 50 58 36 38 42 C56 50 78 60 100 71 Z" fill="#7A0B1D" opacity=".5"/>
<path d="M100 71 C114 50 142 36 162 42 C144 50 122 60 100 71 Z" fill="#7A0B1D" opacity=".5"/>
<path d="M34 30 C46 22 64 26 76 38" fill="none" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="4" stroke-linecap="round"/>
<path d="M166 30 C154 22 136 26 124 38" fill="none" stroke="#FFFFFF" stroke-opacity=".28" stroke-width="4" stroke-linecap="round"/>
<rect x="85" y="56" width="30" height="32" rx="11" fill="url(#oro)"/>
<rect x="85" y="56" width="30" height="32" rx="11" fill="none" stroke="#8A5E14" stroke-opacity=".45" stroke-width="2"/>
</svg>`;

/** El moño como PNG de `ancho` px (el alto sale de su proporción, 4:3). */
export async function monoPng(ancho) {
  const alto = Math.round((ancho * 150) / 200);
  return sharp(Buffer.from(MONO_SVG), { density: (72 * ancho) / 200 }).resize(ancho, alto).png().toBuffer();
}

/** Una chispa de cuatro puntas (de `lado` px) en el color pedido. */
const chispaSvg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 2 C34 22 42 30 62 32 C42 34 34 42 32 62 C30 42 22 34 2 32 C22 30 30 22 32 2 Z" fill="${color}"/><circle cx="32" cy="32" r="5" fill="#FFFFFF" fill-opacity=".85"/></svg>`;

/** Un SVG convertido a capa RGBA { w, h, data } para el pintor. */
async function capaDeSvg(svg, w, h, caja) {
  const { data, info } = await sharp(Buffer.from(svg), { density: (72 * w) / caja }).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

/**
 * Dónde va el gorro respecto del logo, en fracciones del lado del logo: su esquina de arriba a la izquierda y su
 * ancho (el alto sale de la proporción del dibujo, 120x100). Así se apoya en el borde de arriba de la lupa,
 * inclinado. Es la misma posición de la cabecera de las historias (src/lib/content/offer-template.tsx).
 */
export const GORRO_EN_LOGO = { x: -0.113, y: -0.339, ancho: 0.806 };

/** Las capas fijas de los adornos (se dibujan una vez por video y viajan en la escena a los hilos). */
export async function capasDeAdornos({ logoChico, logoGrande }) {
  const anchoChico = Math.round(logoChico * GORRO_EN_LOGO.ancho);
  const anchoGrande = Math.round(logoGrande * GORRO_EN_LOGO.ancho);
  return {
    // El moño del cierre, al doble de como se muestra (se anima achicado, igual que el logo).
    mono: await capaDeSvg(MONO_SVG, 320, 240, 200),
    chispaOro: await capaDeSvg(chispaSvg('#F6CF62'), 64, 64, 64),
    chispaBlanca: await capaDeSvg(chispaSvg('#FFF6DD'), 64, 64, 64),
    // El gorro: uno al tamaño del logo de la pastilla de arriba y otro para el logo grande del cierre (que se
    // anima achicado, así que va al mismo tamaño de su capa).
    gorroChico: await capaDeSvg(GORRO_SVG, anchoChico, Math.round((anchoChico * 100) / 120), 120),
    gorroGrande: await capaDeSvg(GORRO_SVG, anchoGrande, Math.round((anchoGrande * 100) / 120), 120),
    // El Viejito Pascuero (280x308) y el arbolito con el bastón (200x170) del cierre, al tamaño en que se muestran.
    viejito: await capaDeSvg(VIEJITO_SVG, 280, 308, 200),
    rincon: await capaDeSvg(RINCON_SVG, 200, 170, 200),
  };
}

// --- La guirnalda de luces ------------------------------------------------------------------------------------
// Dos tramos de cable que cuelgan de lado a lado en la franja de arriba (la que tapan las apps: ahí no va nada
// que haya que leer), con ampolletas que titilan despacio. Arriba de la pastilla de la marca (y=226).
const CABLE_Y = 118; // donde se cuelga (los extremos y el centro)
const CABLE_CAIDA = 64; // cuánto baja cada tramo en su mitad
const TRAMOS = 2;
/** La altura del cable en x. */
export function cableY(x) {
  const tramo = W / TRAMOS;
  const u = (((x % tramo) + tramo) % tramo) / tramo;
  return CABLE_Y + CABLE_CAIDA * 4 * u * (1 - u);
}

const COLORES_LUCES = [
  [246, 207, 98], // dorado
  [226, 58, 82], // rojo
  [0, 212, 255], // cian de la marca
  [40, 184, 104], // verde (un blanco cálido no se ve sobre el fondo claro)
];

/** Dónde va cada ampolleta, de qué color y con qué ritmo titila. Siempre las mismas. */
export function ampolletas() {
  const al = azar(41);
  const lista = [];
  const cuantas = 14;
  for (let i = 0; i < cuantas; i++) {
    const x = Math.round(((i + 0.5) * W) / cuantas);
    lista.push({ x, y: cableY(x) + 13, color: COLORES_LUCES[i % COLORES_LUCES.length], fase: al(), ritmo: 0.45 + 0.35 * al() });
  }
  return lista;
}

/** Pinta el cable sobre el fondo (una vez, en el fondo que después se copia cuadro a cuadro). */
export function pintarCable(fondo) {
  const color = [64, 78, 104];
  for (let x = 0; x < W; x++) {
    const y = cableY(x);
    const y0 = Math.floor(y - 1.5);
    for (let yy = y0; yy <= y0 + 4; yy++) {
      if (yy < 0 || yy >= H) continue;
      const k = limitar(1.6 - Math.abs(yy + 0.5 - y)) * 0.7; // 2 px de grueso, con el borde suave
      if (k <= 0) continue;
      const d = (yy * W + x) * 3;
      for (let c = 0; c < 3; c++) fondo[d + c] = Math.round(fondo[d + c] + (color[c] - fondo[d + c]) * k);
    }
  }
  // El casquillo de cada ampolleta: un rectángulo chico y oscuro bajo el cable.
  for (const a of ampolletas()) {
    for (let yy = Math.round(a.y - 13); yy < Math.round(a.y - 5); yy++) {
      for (let xx = a.x - 4; xx <= a.x + 4; xx++) {
        const d = (yy * W + xx) * 3;
        for (let c = 0; c < 3; c++) fondo[d + c] = Math.round(fondo[d + c] + (color[c] - fondo[d + c]) * 0.85);
      }
    }
  }
}

/** Un punto de luz blando, con centro en fracciones de pixel: (1 - (d/r)²)² de `fuerza`, teñido de `color`. */
export function luz(dst, cx, cy, r, color, fuerza, yMin = 0, yMax = H) {
  if (fuerza <= 0.004) return;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(yMin, Math.floor(cy - r));
  const y1 = Math.min(yMax - 1, H - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const q = (dx * dx + dy * dy) / r2;
      if (q >= 1) continue;
      const k = fuerza * (1 - q) * (1 - q);
      const d = (y * W + x) * 3;
      dst[d] = dst[d] + (color[0] - dst[d]) * k;
      dst[d + 1] = dst[d + 1] + (color[1] - dst[d + 1]) * k;
      dst[d + 2] = dst[d + 2] + (color[2] - dst[d + 2]) * k;
    }
  }
}

/** Las ampolletas en el segundo `t`: un halo grande y suave y el vidrio, que titila. */
export function pintarAmpolletas(dst, t, lista, yMax = H) {
  for (const a of lista) {
    const brillo = 0.62 + 0.38 * Math.sin(2 * Math.PI * (a.fase + a.ritmo * t));
    luz(dst, a.x, a.y + 6, 34, a.color, 0.2 + 0.16 * brillo, 0, yMax);
    luz(dst, a.x, a.y + 4, 11, a.color, 0.92, 0, yMax);
    luz(dst, a.x - 2, a.y + 1, 3.6, [255, 255, 255], 0.35 + 0.45 * brillo, 0, yMax);
  }
}

// --- La nieve acumulada en el borde de la hoja (variantes "gorro" y "producida") -------------------------------
// Un montón de nieve parejo a lo largo del borde de arriba de la hoja azul noche, como nieve sobre un techo: se ve
// desde el primer cuadro y en la portada. Mide hasta 20 px sobre el borde (la foto termina 30 px más arriba: no la
// toca) y cuelga unos pocos px sobre la hoja (lo escrito empieza 40 px o más bajo el borde).
const NIEVE_ALTO_MAX = 20;
/** Los montones: siempre los mismos. Cada uno es una loma de radio `r` que asoma `alto` (en fracción de r). */
export function nieveDelBorde() {
  const al = azar(73);
  const lomas = [];
  for (let x = -14; x < W + 14; ) {
    const r = 12 + 16 * al();
    lomas.push({ x, r, alto: 0.32 + 0.38 * al() });
    x += r * (0.75 + 0.6 * al());
  }
  // Por columna: cuánto sube la nieve sobre el borde y cuánto cuelga bajo él (las gotas que se descuelgan).
  const arriba = new Float32Array(W);
  const abajo = new Float32Array(W);
  for (const l of lomas) {
    for (let x = Math.max(0, Math.floor(l.x - l.r)); x < Math.min(W, Math.ceil(l.x + l.r)); x++) {
      const u = (x + 0.5 - l.x) / l.r;
      if (Math.abs(u) >= 1) continue;
      arriba[x] = Math.max(arriba[x], Math.min(NIEVE_ALTO_MAX, 4 + l.r * l.alto * Math.sqrt(1 - u * u)));
    }
  }
  for (let x = 0; x < W; x++) abajo[x] = 3 + 2.5 * (0.5 + 0.5 * Math.sin(x / 23 + 1.3 * Math.sin(x / 61)));
  for (let i = 0; i < 9; i++) {
    const cx = 40 + al() * (W - 80);
    const r = 5 + 5 * al();
    const largo = 6 + 8 * al();
    for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, Math.ceil(cx + r)); x++) {
      const u = (x + 0.5 - cx) / r;
      if (Math.abs(u) < 1) abajo[x] = Math.max(abajo[x], 3 + largo * Math.sqrt(1 - u * u));
    }
  }
  return { arriba, abajo };
}

/**
 * Pinta la nieve acumulada sobre el borde de la hoja (su borde de arriba en la fila `borde`, con esquinas de radio
 * `radio`). La luz viene de arriba: la loma es blanca arriba y azulada abajo, y lo que cuelga sobre la hoja queda
 * en sombra.
 */
export function pintarNieveDelBorde(dst, borde, radio, nieve) {
  if (borde + radio + 30 < 0 || borde - NIEVE_ALTO_MAX > H) return;
  const ALTO = [252, 253, 255];
  const BAJO = [196, 210, 232];
  const SOMBRA = [150, 168, 198];
  for (let x = 0; x < W; x++) {
    const lado = x < radio ? radio - x - 0.5 : x > W - radio ? x + 0.5 - (W - radio) : 0;
    if (lado >= radio) continue;
    const curva = radio - Math.sqrt(radio * radio - lado * lado); // el borde baja en las esquinas redondas
    const e = borde + curva;
    const enEsquina = 1 - lado / radio; // en la esquina la nieve se desliza: menos alta
    const sube = nieve.arriba[x] * (0.35 + 0.65 * enEsquina);
    const cuelga = nieve.abajo[x] * (0.5 + 0.5 * enEsquina);
    // La pendiente de la loma (para que el lado que mira a la luz quede más claro).
    const pend = x > 0 && x < W - 1 ? (nieve.arriba[x + 1] - nieve.arriba[x - 1]) / 2 : 0;
    const y0 = Math.max(0, Math.floor(e - sube));
    const y1 = Math.min(H - 1, Math.ceil(e + cuelga));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      // Cuánto cubre el punto: borde suave arriba y abajo.
      const cubre = limitar(yc - (e - sube) + 0.5) * limitar(e + cuelga - yc + 0.5);
      if (cubre <= 0) continue;
      let color;
      if (yc <= e) {
        const u = limitar((e - yc) / Math.max(1, sube)); // 0 en el borde, 1 en lo alto de la loma
        const k = limitar(0.25 + 0.75 * u ** 0.6 + 0.08 * pend);
        color = [0, 1, 2].map((c) => BAJO[c] + (ALTO[c] - BAJO[c]) * k);
      } else {
        const u = limitar((yc - e) / Math.max(1, cuelga));
        color = [0, 1, 2].map((c) => BAJO[c] + (SOMBRA[c] - BAJO[c]) * u);
      }
      const d = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) dst[d + c] = Math.round(dst[d + c] + (color[c] - dst[d + c]) * cubre);
    }
  }
}

// --- La nieve -------------------------------------------------------------------------------------------------
/** Los copos: siempre los mismos, cada uno con su lugar de partida, su velocidad, su tamaño y su vaivén. */
export function copos(cuantos = 90) {
  const al = azar(97);
  const lista = [];
  for (let i = 0; i < cuantos; i++) {
    const cerca = al() < 0.25; // uno de cada cuatro, más grande y más rápido (está más cerca)
    lista.push({
      x: al() * W,
      y: al() * (H + 40),
      v: cerca ? 95 + 50 * al() : 42 + 40 * al(),
      r: cerca ? 4.2 + 2.2 * al() : 2 + 1.8 * al(),
      a: cerca ? 0.55 + 0.25 * al() : 0.28 + 0.3 * al(),
      vaiven: 6 + 22 * al(),
      fase: al() * Math.PI * 2,
      ritmo: 0.35 + 0.5 * al(),
    });
  }
  return lista;
}

/**
 * Pinta la nieve del segundo `t`, solo bajo la fila `desde` (el borde de la hoja oscura: sobre el fondo claro
 * un copo blanco no se ve, y no debe pasar por encima de la foto). `avance(t)` es cuánto cayó la nieve hasta
 * ese segundo, en segundos "de caída": así puede apurarse un momento (al subir la hoja) sin saltar.
 */
export function pintarNieve(dst, t, lista, desde, avance) {
  const caida = avance(t);
  const alto = H + 40;
  for (const c of lista) {
    const y = ((((c.y + c.v * caida) % alto) + alto) % alto) - 20;
    if (y + c.r < desde) continue;
    const x = c.x + c.vaiven * Math.sin(c.fase + c.ritmo * t * Math.PI * 2);
    luz(dst, x, y, c.r * 1.6, [255, 255, 255], c.a, Math.max(0, Math.ceil(desde)));
  }
}
