// Convierte el logo y los dos íconos de las etiquetas a PNG y los imprime como constantes para pegar al final
// de src/lib/content/offer-template.tsx.
//   node scripts/piezas/iconos.mjs   -> imprime LOGO_PNG, ICON_SHIPPING e ICON_FULL
//
// Por qué PNG y no <svg> en línea: medido al diseñar la historia, cada <svg> en línea le sumaba al dibujo cerca
// de un cuarto del tiempo, fuera del tamaño que fuera; el mismo dibujo como PNG chico no se nota. Si cambia el
// logo o un ícono, se edita aquí y se vuelven a pegar las constantes.
import sharp from 'sharp';

const CIAN = '#00D4FF';

// El logo del sitio (lupa con dos flechas), tal como está en la identidad.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#087EFF"/><stop offset="1" stop-color="#00D4FF"/></linearGradient></defs><circle cx="14" cy="14" r="10.5" fill="none" stroke="url(#g)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="56 10" stroke-dashoffset="-7"/><line x1="21.4" y1="21.4" x2="27" y2="27" stroke="url(#g)" stroke-width="3.4" stroke-linecap="round"/><g stroke="#F5F7FA" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M9.3 12.3h8.4M17.7 12.3l-2.2-2.2M17.7 12.3l-2.2 2.2"/><path d="M18.7 16.3h-8.4M10.3 16.3l2.2-2.2M10.3 16.3l2.2 2.2"/></g></svg>`;
// Camión (envío gratis) y rayo (Full), en el cian de la marca.
const ENVIO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${CIAN}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h11v11H2zM13 10h5l4 4v3h-9zM6.5 17a2 2 0 1 0 0 4a2 2 0 0 0 0-4zM17.5 17a2 2 0 1 0 0 4a2 2 0 0 0 0-4z"/></svg>`;
const FULL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8l9-12h-7z" fill="${CIAN}" stroke="${CIAN}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** PNG de `lado` px. `colores` limita la paleta para que la constante pese menos (el logo tiene un degradado: necesita más). */
async function png(svg, lado, colores) {
  const caja = Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  const buf = await sharp(Buffer.from(svg), { density: (72 * lado) / caja })
    .resize(lado, lado)
    .png({ compressionLevel: 9, palette: true, colours: colores, dither: 0 })
    .toBuffer();
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// El logo a 186 px: se dibuja a 62 (tres veces más chico, exacto) en la cabecera y a 168 cuando falta la foto.
// Los íconos a 56 px: el doble de los 28 a los que se dibujan.
const salida = {
  LOGO_PNG: await png(LOGO, 186, 128),
  ICON_SHIPPING: await png(ENVIO, 56, 16),
  ICON_FULL: await png(FULL, 56, 16),
};
for (const [nombre, uri] of Object.entries(salida)) console.log(`const ${nombre} = '${uri}';`);
console.error(Object.entries(salida).map(([n, u]) => `${n}: ${u.length} caracteres`).join(' · '));
