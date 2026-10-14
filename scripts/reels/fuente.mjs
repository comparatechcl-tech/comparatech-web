// Medidas de Inter leídas de los propios WOFF: ancho de avance de cada carácter, para saber cuánto ocupa
// un texto ANTES de dibujarlo (así un nombre largo se parte o se achica en vez de desbordar).
// Mismo método que scripts/piezas/medir-fuente.mjs del sitio (tablas cmap + hmtx), pero para cualquier carácter.
// Las fuentes son las mismas de las piezas del sitio (src/lib/content/fonts): es lo único de src/ que usa el reel.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const CARPETA = fileURLToPath(new URL('../../src/lib/content/fonts/', import.meta.url));

function tablas(archivo) {
  const b = fs.readFileSync(archivo);
  const n = b.readUInt16BE(12);
  const t = {};
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const tag = b.toString('latin1', o, o + 4);
    const off = b.readUInt32BE(o + 4);
    const comp = b.readUInt32BE(o + 8);
    const orig = b.readUInt32BE(o + 12);
    let d = b.subarray(off, off + comp);
    if (comp < orig) d = zlib.inflateSync(d);
    t[tag] = d;
  }
  return t;
}

function mapa(cmap) {
  const n = cmap.readUInt16BE(2);
  let mejor = null;
  for (let i = 0; i < n; i++) {
    const o = 4 + i * 8;
    const plat = cmap.readUInt16BE(o);
    const off = cmap.readUInt32BE(o + 4);
    const fmt = cmap.readUInt16BE(off);
    if (fmt === 12) { mejor = { off, fmt }; break; }
    if (fmt === 4 && (plat === 3 || plat === 0) && !mejor) mejor = { off, fmt };
  }
  const m = new Map();
  if (!mejor) return m;
  const o = mejor.off;
  if (mejor.fmt === 12) {
    const g = cmap.readUInt32BE(o + 12);
    for (let i = 0; i < g; i++) {
      const p = o + 16 + i * 12;
      const a = cmap.readUInt32BE(p), z = cmap.readUInt32BE(p + 4), s = cmap.readUInt32BE(p + 8);
      for (let c = a; c <= z; c++) m.set(c, s + (c - a));
    }
  } else {
    const seg = cmap.readUInt16BE(o + 6) / 2;
    const end = o + 14, start = end + seg * 2 + 2, delta = start + seg * 2, range = delta + seg * 2;
    for (let i = 0; i < seg; i++) {
      const z = cmap.readUInt16BE(end + i * 2), a = cmap.readUInt16BE(start + i * 2);
      const d = cmap.readInt16BE(delta + i * 2), r = cmap.readUInt16BE(range + i * 2);
      for (let c = a; c <= z && c !== 0xffff; c++) {
        let gid;
        if (r === 0) gid = (c + d) & 0xffff;
        else {
          gid = cmap.readUInt16BE(range + i * 2 + r + (c - a) * 2);
          if (gid !== 0) gid = (gid + d) & 0xffff;
        }
        if (gid) m.set(c, gid);
      }
    }
  }
  return m;
}

const PESOS = [400, 600, 800];
const medidas = new Map();

/** Los tres pesos de Inter, como los pide next/og. */
export function fuentes() {
  return PESOS.map((weight) => ({
    name: 'Inter',
    data: fs.readFileSync(path.join(CARPETA, `inter-latin-${weight}-normal.woff`)),
    weight,
    style: 'normal',
  }));
}

function medida(peso) {
  if (medidas.has(peso)) return medidas.get(peso);
  const t = tablas(path.join(CARPETA, `inter-latin-${peso}-normal.woff`));
  const upm = t.head.readUInt16BE(18);
  const nh = t.hhea.readUInt16BE(34);
  const m = mapa(t.cmap);
  const cache = new Map();
  const avance = (cp) => {
    if (cache.has(cp)) return cache.get(cp);
    const g = m.get(cp);
    const v = g === undefined ? null : t.hmtx.readUInt16BE(Math.min(g, nh - 1) * 4) / upm;
    cache.set(cp, v);
    return v;
  };
  const r = { avance, tiene: (cp) => m.has(cp) };
  medidas.set(peso, r);
  return r;
}

/** Ancho de un carácter en em. Lo que la fuente no trae se cuenta ancho (1 em): mejor achicar de más que desbordar. */
export function avance(ch, peso) {
  return medida(peso).avance(ch.codePointAt(0)) ?? 1;
}

/** ¿La fuente puede dibujar todo el texto? */
export function dibujable(texto, peso = 600) {
  const m = medida(peso);
  return [...texto].every((c) => m.tiene(c.codePointAt(0)));
}

/**
 * Quita lo que Inter no sabe dibujar (emojis, letras de otros alfabetos). Si quedara, el dibujante saldría a
 * buscar otra fuente a internet; aquí todo se arma sin red. Donde había un signo que se quita queda un
 * espacio, para que no se peguen dos palabras.
 */
export function limpia(texto, peso = 600) {
  const m = medida(peso);
  return [...String(texto ?? '').normalize('NFC')]
    .map((c) => (m.tiene(c.codePointAt(0)) && !/\s/.test(c) ? c : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?%)])/g, '$1')
    .replace(/([(¿¡]) /g, '$1')
    .replace(/\(\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ancho de un texto en px a un tamaño dado, con interletrado en px por carácter. */
export function ancho(texto, peso, tamano, interletrado = 0) {
  let em = 0;
  let n = 0;
  for (const ch of texto) {
    em += avance(ch, peso);
    n += 1;
  }
  return em * tamano + interletrado * n;
}
