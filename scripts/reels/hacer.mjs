// Reel de oferta de ComparaTech: arma el video vertical de UN producto desde cero, solo con sus datos y su
// foto. Sin persona, sin voz, sin internet y sin mirar el reloj: mismos datos, mismo video.
//
//   node scripts/reels/hacer.mjs <productos.json> <número> <salida.mp4> [opciones]
//
//   --plantilla estudio   cómo se ve el video (por defecto, "estudio"; las que hay están en plantillas/)
//   --cta "texto"         la llamada del cierre (por defecto, la de la plantilla: "Más ofertas en el perfil")
//   --portada foto.jpg    guarda además la escena del precio completa como imagen, para usarla de portada
//   --hoja hoja.jpg       guarda además una hoja con 8 cuadros del video ya armado, para revisarlo de un vistazo
//   --zonas               pinta en rojo lo que tapan las apps (solo para revisar: ese video no se publica)
//   --musica archivo      usa ese audio en vez del silencio (recortado al largo del video, entra y sale suave)
//   --volumen 0.6         volumen de la música, de 0 a 1 (por defecto, 1)
//   --hilos N             cuántos hilos pintan (por defecto, según el equipo)
//
// Sale 1080x1920, 30 cuadros por segundo, H.264 + pista AAC, listo para Reels, TikTok y Shorts.
// Si falta la foto, el nombre o el precio, termina con código 1 y no arma nada. Cómo está hecho: LEEME.md.
// Los videos de cada día no se arman con este comando sino con generar.mjs, que usa el mismo armador.
import path from 'node:path';
import { leerProducto, precio as formatoPrecio } from './datos.mjs';
import { PLANTILLA_POR_DEFECTO, revisarPlantilla } from './plantillas/index.mjs';

const USO = 'Uso: node scripts/reels/hacer.mjs <productos.json> <número de producto> <salida.mp4> [--plantilla estudio] [--cta "texto"] [--portada portada.jpg] [--hoja hoja.jpg] [--zonas] [--musica archivo] [--volumen 0.6]';
const CON_VALOR = ['plantilla', 'cta', 'portada', 'hoja', 'musica', 'volumen', 'hilos'];
const coma = (n, d = 1) => n.toFixed(d).replace('.', ',');

/** Lee la línea de comando. Una opción que no se conoce es un error: mejor avisar que ignorarla. */
function argumentos(argv) {
  const sueltos = [];
  const op = { zonas: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      sueltos.push(a);
      continue;
    }
    const igual = a.indexOf('=');
    const clave = (igual > 0 ? a.slice(2, igual) : a.slice(2)).toLowerCase();
    if (clave === 'zonas' && igual < 0) op.zonas = true;
    else if (CON_VALOR.includes(clave)) {
      const valor = igual > 0 ? a.slice(igual + 1) : argv[++i];
      if (valor === undefined || (igual < 0 && valor.startsWith('--'))) throw new Error(`Falta el valor de --${clave}.\n${USO}`);
      op[clave] = valor;
    } else throw new Error(`No conozco la opción ${a}.\n${USO}`);
  }
  if (sueltos.length !== 3) throw new Error(sueltos.length < 3 ? `Faltan datos.\n${USO}` : `Sobran datos (${sueltos.slice(3).join(' ')}). Si la llamada lleva espacios, va entre comillas.\n${USO}`);
  const numero = Number(sueltos[1]);
  if (!Number.isInteger(numero) || numero < 1) throw new Error(`El número de producto tiene que ser 1, 2, 3... (llegó "${sueltos[1]}").\n${USO}`);
  if (!/\.mp4$/i.test(sueltos[2])) throw new Error(`La salida tiene que terminar en .mp4 (llegó "${sueltos[2]}").\n${USO}`);
  let volumen = 1;
  if (op.volumen !== undefined) {
    volumen = Number(String(op.volumen).replace(',', '.'));
    if (!Number.isFinite(volumen) || volumen < 0 || volumen > 1) throw new Error(`El volumen va de 0 a 1 (llegó "${op.volumen}").`);
    if (!op.musica) throw new Error('--volumen solo sirve junto con --musica.');
  }
  let hilos = null;
  if (op.hilos !== undefined) {
    hilos = Number(op.hilos);
    if (!Number.isInteger(hilos) || hilos < 1 || hilos > 16) throw new Error(`--hilos va de 1 a 16 (llegó "${op.hilos}").`);
  }
  for (const k of ['portada', 'hoja']) if (op[k] !== undefined && !/\.jpe?g$/i.test(op[k])) throw new Error(`--${k} tiene que terminar en .jpg (llegó "${op[k]}").`);
  const ruta = (r) => (r === undefined ? null : path.resolve(r));
  return { json: path.resolve(sueltos[0]), numero, salida: path.resolve(sueltos[2]), plantilla: op.plantilla ?? PLANTILLA_POR_DEFECTO, cta: op.cta, portada: ruta(op.portada), hoja: ruta(op.hoja), musica: ruta(op.musica), volumen, hilos, zonas: op.zonas };
}

async function main() {
  const inicio = Date.now();
  const a = argumentos(process.argv.slice(2));
  // Este programa no necesita la red. Si algo intentara usarla, falla aquí en vez de salir a buscar.
  globalThis.fetch = () => Promise.reject(new Error('Sin red: este video se arma solo con archivos locales.'));

  // 1. Los datos y las piezas. Si falta la foto, el nombre o el precio, o la foto no se puede leer, se corta
  //    aquí: no se arma nada. El armador (con el dibujante y los hilos) se carga después de revisar lo
  //    básico, para que un dato mal escrito se sepa al tiro.
  revisarPlantilla(a.plantilla);
  const producto = leerProducto(a.json, a.numero);
  const { prepararReel, PESO_MAX } = await import('./armar.mjs');
  const reel = await prepararReel(producto, { plantilla: a.plantilla, cta: a.cta, zonas: a.zonas, musica: a.musica });
  const tPreparar = (Date.now() - inicio) / 1000;
  console.log(`Producto ${a.numero}: ${producto.nombre} · ${formatoPrecio(producto.precio)}`);
  console.log(`  En pantalla: ${reel.escrito.join(' | ')}`);
  for (const aviso of reel.avisos) console.log(`  Aviso: ${aviso}`);
  if (a.zonas) console.log('  Aviso: con --zonas el video (y la portada) salen con las zonas pintadas en rojo. Es para revisar, no para publicar.');

  // 2. El video, con su portada y su hoja de contactos si se pidieron.
  const r = await reel.armar({ salida: a.salida, portada: a.portada, hoja: a.hoja, volumen: a.volumen, hilos: a.hilos });
  if (r.calidadBajada) console.log(`  Aviso: con la calidad normal pasaba de ${coma(PESO_MAX / 1048576, 0)} MB, así que se armó de nuevo con un poco menos de calidad (crf ${r.crf}).`);
  if (r.pasaDelTope) console.log(`  Aviso: ni con menos calidad baja de ${coma(PESO_MAX / 1048576, 0)} MB.`);

  console.log(`  Video: ${a.salida}`);
  console.log(`    ${coma(reel.segundos)} s (${reel.cuadros} cuadros), ${coma(r.peso / 1048576)} MB, ${a.musica ? `con música (volumen ${coma(a.volumen, 2)})` : 'con pista de audio en silencio'}`);
  for (const linea of reel.descripcion) console.log(`    ${linea}`);
  if (a.portada) console.log(`  Portada: ${a.portada}`);
  if (a.hoja) console.log(`  Hoja de contactos: ${a.hoja}`);
  console.log(`  Demoró ${coma((Date.now() - inicio) / 1000)} s (preparar ${coma(tPreparar)} s, dibujar y comprimir ${coma(r.segundosArmando)} s con ${r.hilos} ${r.hilos === 1 ? 'hilo' : 'hilos'})`);
}

main().catch((err) => {
  console.error(`No se pudo armar el video: ${err.message}`);
  process.exit(1);
});
