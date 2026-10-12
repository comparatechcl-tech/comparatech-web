// Lee los anchos de avance de Inter (los WOFF de src/lib/content/fonts) para armar las tablas W600 y W800
// que la plantilla de la historia (src/lib/content/story-template.tsx) usa al medir textos.
// Uso: node scripts/piezas/medir-fuente.mjs  -> imprime, por peso, los anchos en milésimas de em.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const RAIZ = path.resolve(import.meta.dirname, '../..');

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
    const enc = cmap.readUInt16BE(o + 2);
    const off = cmap.readUInt32BE(o + 4);
    const fmt = cmap.readUInt16BE(off);
    if (fmt === 12) { mejor = { off, fmt }; break; }
    if (fmt === 4 && (plat === 3 || plat === 0) && !mejor) mejor = { off, fmt, enc };
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
          const p = range + i * 2 + r + (c - a) * 2;
          gid = cmap.readUInt16BE(p);
          if (gid !== 0) gid = (gid + d) & 0xffff;
        }
        if (gid) m.set(c, gid);
      }
    }
  }
  return m;
}

const CARACTERES = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~áéíóúüñÁÉÍÓÚÜÑ¿¡°ºª·–—…−×®™';

for (const peso of [400, 600, 800]) {
  const t = tablas(path.join(RAIZ, 'src/lib/content/fonts', `inter-latin-${peso}-normal.woff`));
  const upm = t.head.readUInt16BE(18);
  const nh = t.hhea.readUInt16BE(34);
  const m = mapa(t.cmap);
  const ancho = (c) => {
    const g = m.get(c.codePointAt(0));
    if (g === undefined) return null;
    const i = Math.min(g, nh - 1);
    return Math.round((t.hmtx.readUInt16BE(i * 4) / upm) * 1000);
  };
  const faltan = [...CARACTERES].filter((c) => ancho(c) === null);
  console.log(`\n== Inter ${peso} (upm ${upm}, ${m.size} caracteres) — faltan: ${faltan.join(' ') || 'ninguno'}`);
  // ASCII 32..126 en orden, como lista compacta
  const ascii = [];
  for (let c = 32; c <= 126; c++) ascii.push(ancho(String.fromCodePoint(c)) ?? 0);
  console.log('ascii:', ascii.join(','));
  const extra = {};
  for (const c of [...CARACTERES].filter((c) => c.codePointAt(0) > 126)) extra[c] = ancho(c);
  console.log('extra:', JSON.stringify(extra));
}
