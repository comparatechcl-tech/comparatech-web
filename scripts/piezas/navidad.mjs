// El moño de la temática de Navidad de las piezas, en PNG, impreso como constante para pegar al final de
// src/lib/content/christmas.ts (CHRISTMAS_BOW_PNG).
//   node scripts/piezas/navidad.mjs             -> imprime la constante
//   node scripts/piezas/navidad.mjs mono.png    -> además guarda el PNG, para mirarlo
//
// El dibujo es el mismo del reel "navidad" (scripts/reels/plantillas/navidad/adornos.mjs, MONO_SVG): se cambia
// allá y se vuelve a pegar la constante. PNG y no <svg> en línea por lo mismo que los íconos (ver iconos.mjs).
import fs from 'node:fs';
import sharp from 'sharp';
import { MONO_SVG } from '../reels/plantillas/navidad/adornos.mjs';

// En la historia se dibuja a 132x99: el doble. Paleta corta para que la constante pese poco.
const ANCHO = 264;
const png = await sharp(Buffer.from(MONO_SVG), { density: (72 * ANCHO) / 200 })
  .resize(ANCHO, Math.round((ANCHO * 150) / 200))
  .png({ compressionLevel: 9, palette: true, colours: 96, dither: 0 })
  .toBuffer();
if (process.argv[2]) fs.writeFileSync(process.argv[2], png);
console.log(`export const CHRISTMAS_BOW_PNG = 'data:image/png;base64,${png.toString('base64')}';`);
console.error(`CHRISTMAS_BOW_PNG: ${png.length} bytes`);
