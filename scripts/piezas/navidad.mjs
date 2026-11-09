// Los dibujos de la temática de Navidad de las piezas (historia y feed), en PNG, escritos como constantes en
// src/lib/content/christmas-art.ts:
//   node scripts/piezas/navidad.mjs > src/lib/content/christmas-art.ts
//   node scripts/piezas/navidad.mjs --ver carpeta     -> además guarda cada PNG, para mirarlo
//
// Los dibujos son los del reel "navidad" (scripts/reels/plantillas/navidad: MONO_SVG en adornos.mjs; el gorro, el
// Viejito Pascuero y el rincón del arbolito en dibujos.mjs): se cambian allá y se vuelve a correr esto. PNG y no
// <svg> en línea por lo mismo que los íconos (ver iconos.mjs): cada <svg> en línea le suma al dibujo cerca de un
// cuarto del tiempo. Van al doble de como se dibujan en la pieza, con la paleta corta para que pesen poco.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MONO_SVG } from '../reels/plantillas/navidad/adornos.mjs';
import { GORRO_SVG, VIEJITO_SVG, RINCON_SVG } from '../reels/plantillas/navidad/dibujos.mjs';

const DIBUJOS = [
  { nombre: 'CHRISTMAS_BOW_PNG', svg: MONO_SVG, caja: [200, 150], ancho: 264, nota: 'El moño del listón (se dibuja a 132x99).' },
  { nombre: 'CHRISTMAS_HAT_PNG', svg: GORRO_SVG, caja: [120, 100], ancho: 100, nota: 'El gorro del Viejito Pascuero sobre el logo de la cabecera (se dibuja a 50x42).' },
  { nombre: 'CHRISTMAS_SANTA_PNG', svg: VIEJITO_SVG, caja: [200, 220], ancho: 360, nota: 'El Viejito Pascuero que se asoma abajo a la derecha de la historia (se dibuja a 180x198).' },
  { nombre: 'CHRISTMAS_CORNER_PNG', svg: RINCON_SVG, caja: [200, 170], ancho: 380, nota: 'El arbolito y el bastón de dulce, abajo a la izquierda de la historia (se dibuja a 190x162).' },
];

const iVer = process.argv.indexOf('--ver');
const ver = iVer > 0 ? process.argv[iVer + 1] : null;
if (ver) fs.mkdirSync(ver, { recursive: true });

const lineas = [
  '/**',
  ' * Los dibujos de la temática de Navidad de las piezas (lib/content/christmas), hechos a mano en SVG y pasados',
  ' * a PNG. NO SE EDITA A MANO: lo escribe scripts/piezas/navidad.mjs con los dibujos del reel "navidad".',
  ' */',
  '',
];
for (const d of DIBUJOS) {
  const alto = Math.round((d.ancho * d.caja[1]) / d.caja[0]);
  const png = await sharp(Buffer.from(d.svg), { density: (72 * d.ancho) / d.caja[0] })
    .resize(d.ancho, alto)
    .png({ compressionLevel: 9, palette: true, colours: 128, dither: 0 })
    .toBuffer();
  if (ver) fs.writeFileSync(path.join(ver, `${d.nombre}.png`), png);
  lineas.push(`/** ${d.nota} */`, `export const ${d.nombre} = 'data:image/png;base64,${png.toString('base64')}';`, '');
  console.error(`${d.nombre}: ${d.ancho}x${alto}, ${png.length} bytes`);
}
process.stdout.write(lineas.join('\n'));
