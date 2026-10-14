// Prepara la foto real del producto para que se vea grande y bien apoyada en el fondo.
//
// Casi todas las fotos de Mercado Libre vienen sobre blanco, con aire alrededor. En ese caso se le quita el aire
// (para que lo grande sea el producto, no el margen) y el blanco se funde con el fondo del video ("fundida").
// Si la foto NO viene sobre blanco (una foto ambientada, un fondo de color), no se puede fundir: se muestra
// entera, como una lámina de esquinas redondas con su sombra ("lamina"). Nunca se deforma.
//
// Va en dos pasos porque la escena necesita saber la forma del producto antes de decidir a qué tamaño mostrarlo:
//   leerFoto(ruta)                  -> forma y tamaño real del producto
//   prepararFoto(leida, anchoMax)   -> la imagen lista para animar
import sharp from 'sharp';

const AIRE = 14; // px de blanco que se dejan alrededor del producto

async function leerRGB(ruta) {
  try {
    // Un toque de nitidez: las fotos de Mercado Libre vienen comprimidas y a pantalla completa se ven blandas.
    const { data, info } = await sharp(ruta)
      .rotate()
      .flatten({ background: '#ffffff' })
      .removeAlpha()
      .toColourspace('srgb')
      .sharpen({ sigma: 0.8, m1: 0.6, m2: 1.4 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || info.width < 16 || info.height < 16) throw new Error(`mide ${info.width}x${info.height} px`);
    return { w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
  } catch (e) {
    throw new Error(`No se puede leer la foto ${ruta} (${String(e.message).split('\n')[0]})`);
  }
}

function mediana(histograma, total) {
  let acumulado = 0;
  for (let v = 0; v < 256; v++) {
    acumulado += histograma[v];
    if (acumulado * 2 >= total) return v;
  }
  return 255;
}

/** Mira el borde de la foto: ¿es blanco (o casi) y parejo? */
function mirarBorde(img) {
  const ancho = 4;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const puntos = [];
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (y >= ancho && y < img.h - ancho && x >= ancho && x < img.w - ancho) {
        x = img.w - ancho - 1; // salta el interior
        continue;
      }
      const i = (y * img.w + x) * 3;
      puntos.push(i);
      hist[0][img.data[i]]++;
      hist[1][img.data[i + 1]]++;
      hist[2][img.data[i + 2]]++;
    }
  }
  const med = hist.map((h) => mediana(h, puntos.length));
  let parejos = 0;
  for (const i of puntos) {
    if (Math.abs(img.data[i] - med[0]) <= 12 && Math.abs(img.data[i + 1] - med[1]) <= 12 && Math.abs(img.data[i + 2] - med[2]) <= 12) parejos++;
  }
  return { med, parejo: parejos / puntos.length };
}

/**
 * Lee la foto y dice cómo es: { modo: 'fundida' | 'lamina', proporcion (ancho/alto del producto),
 * original: { w, h } (px reales del producto en la foto) }. Falla con un mensaje claro si no se puede leer.
 */
export async function leerFoto(ruta) {
  const cruda = await leerRGB(ruta);
  const borde = mirarBorde(cruda);
  const blanca = Math.min(...borde.med) >= 232 && Math.max(...borde.med) - Math.min(...borde.med) <= 10 && borde.parejo >= 0.8;
  if (!blanca) return { modo: 'lamina', proporcion: cruda.w / cruda.h, original: { w: cruda.w, h: cruda.h }, cruda };
  return recortarProducto(cruda, borde.med);
}

/** Foto sobre blanco: encuentra el producto y lo recorta con un poco de blanco alrededor. */
function recortarProducto(img, med) {
  const d = img.data;
  // 1. Si el fondo es "casi blanco" se lleva a blanco puro, para que no quede un rectángulo apenas gris.
  if (Math.min(...med) < 253) {
    const g = med.map((m) => 255 / Math.max(1, m - 1));
    for (let i = 0; i < d.length; i += 3) {
      d[i] = Math.min(255, d[i] * g[0]);
      d[i + 1] = Math.min(255, d[i + 1] * g[1]);
      d[i + 2] = Math.min(255, d[i + 2] * g[2]);
    }
  }
  // 2. Dónde está el producto: filas y columnas con algo que no sea blanco.
  const UMBRAL = 238;
  const cols = new Uint32Array(img.w);
  const filas = new Uint32Array(img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 3;
      if (d[i] < UMBRAL || d[i + 1] < UMBRAL || d[i + 2] < UMBRAL) {
        cols[x]++;
        filas[y]++;
      }
    }
  }
  const MIN = 3; // una fila con menos puntos que esto es ruido de la compresión, no producto
  let x0 = 0;
  let x1 = img.w - 1;
  let y0 = 0;
  let y1 = img.h - 1;
  while (x0 < x1 && cols[x0] < MIN) x0++;
  while (x1 > x0 && cols[x1] < MIN) x1--;
  while (y0 < y1 && filas[y0] < MIN) y0++;
  while (y1 > y0 && filas[y1] < MIN) y1--;
  if (x1 - x0 < 8 || y1 - y0 < 8) {
    // Foto prácticamente en blanco: se usa entera.
    x0 = 0;
    y0 = 0;
    x1 = img.w - 1;
    y1 = img.h - 1;
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  // 3. Recorte con un poco de blanco alrededor (blanco agregado si la foto no lo trae).
  const w = bw + AIRE * 2;
  const h = bh + AIRE * 2;
  const out = new Uint8Array(w * h * 3).fill(255);
  for (let y = 0; y < h; y++) {
    const sy = y0 - AIRE + y;
    if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 - AIRE + x;
      if (sx < 0 || sx >= img.w) continue;
      const s = (sy * img.w + sx) * 3;
      const o = (y * w + x) * 3;
      out[o] = d[s];
      out[o + 1] = d[s + 1];
      out[o + 2] = d[s + 2];
    }
  }
  // 4. Los últimos px de cada orilla se llevan a blanco de a poco: si el producto llega al borde de la foto,
  //    se desvanece en vez de terminar en un corte seco.
  const PLUMA = 10;
  for (let y = 0; y < h; y++) {
    const ky = Math.min(1, (Math.min(y, h - 1 - y) + 0.5) / PLUMA);
    for (let x = 0; x < w; x++) {
      const k = Math.min(ky, Math.min(1, (Math.min(x, w - 1 - x) + 0.5) / PLUMA));
      if (k >= 1) continue;
      const o = (y * w + x) * 3;
      out[o] = 255 - (255 - out[o]) * k;
      out[o + 1] = 255 - (255 - out[o + 1]) * k;
      out[o + 2] = 255 - (255 - out[o + 2]) * k;
    }
  }
  return { modo: 'fundida', proporcion: bw / bh, original: { w: bw, h: bh }, recorte: { w, h, data: out } };
}

const deRaw = (img) => sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.w, height: img.h, channels: 3 } });
const aImagen = ({ data, info }) => ({ w: info.width, h: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) });

/**
 * Deja la foto lista para animar, sabiendo que el producto se va a mostrar como máximo a `anchoMax` px de ancho:
 *   { modo, img: { w, h, data RGB }, caja: { x, y, w, h }, proporcion, original }
 * `caja` es dónde está el producto dentro de `img` (lo demás es blanco o sombra). Si la foto es más grande que
 * eso se achica una sola vez, con el mejor filtro; si es más chica se deja como viene (se agranda al dibujar).
 */
export async function prepararFoto(leida, anchoMax) {
  const { modo, proporcion, original } = leida;
  if (modo === 'fundida') {
    const r = leida.recorte;
    const f = Math.min(1, anchoMax / original.w);
    let img = r;
    if (f < 0.995) img = aImagen(await deRaw(r).resize(Math.round(r.w * f), Math.round(r.h * f), { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }));
    const k = img.w / r.w;
    return { modo, img, caja: { x: AIRE * k, y: AIRE * k, w: original.w * k, h: original.h * k }, proporcion, original };
  }
  // Lámina: la foto entera, con esquinas redondas y su sombra, sobre blanco.
  const fw = Math.round(anchoMax);
  const fh = Math.round(anchoMax / proporcion);
  const radio = Math.round(Math.min(fw, fh) * 0.05);
  const margen = 80; // sitio para la sombra
  const w = fw + margen * 2;
  const h = fh + margen * 2;
  const foto = await deRaw(leida.cruda)
    .resize(fw, fh, { kernel: 'lanczos3', fit: 'fill' })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${fw}" height="${fh}"><rect width="${fw}" height="${fh}" rx="${radio}" ry="${radio}" fill="#fff"/></svg>`), blend: 'dest-in' }])
    .png()
    .toBuffer();
  const sombra = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="${margen + 10}" y="${margen + 26}" width="${fw - 20}" height="${fh - 20}" rx="${radio}" ry="${radio}" fill="#1B2A4A" fill-opacity="0.3"/></svg>`))
    .blur(26)
    .png()
    .toBuffer();
  const img = aImagen(
    await sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
      .composite([
        { input: sombra, left: 0, top: 0 },
        { input: foto, left: margen, top: margen },
      ])
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  );
  return { modo, img, caja: { x: margen, y: margen, w: fw, h: fh }, proporcion, original };
}

/**
 * Una copia de la foto ya achicada por `k` (con el mejor filtro, una sola vez). El dibujo cuadro a cuadro
 * es fino entre 0,7 y 1,6 veces; cuando la foto se va a mostrar bastante más chica (en la escena del precio),
 * se parte de esta copia.
 */
export async function achicar(foto, k) {
  const w = Math.max(2, Math.round(foto.img.w * k));
  const h = Math.max(2, Math.round(foto.img.h * k));
  const img = aImagen(await deRaw(foto.img).resize(w, h, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }));
  const kx = w / foto.img.w;
  const ky = h / foto.img.h;
  return { ...foto, img, caja: { x: foto.caja.x * kx, y: foto.caja.y * ky, w: foto.caja.w * kx, h: foto.caja.h * ky } };
}
