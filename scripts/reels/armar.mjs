// El armador: con el producto ya resuelto y una plantilla, pinta los cuadros (en varios hilos) y se los pasa a
// ffmpeg. Lo usan hacer.mjs (un video a mano) y generar.mjs (los videos del día). Aquí no se lee la línea de
// comando ni se escribe en la consola: quien llama decide qué mostrar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { revisarLlamada } from './datos.mjs';
import { limpia } from './fuente.mjs';
import * as capas from './capas.mjs';
import { W, H } from './pintar.mjs';
import { CRF_NORMAL, buscarFfmpeg, revisarMusica, abrirVideo, hojaDeContactos } from './video.mjs';
import { cargarPlantilla, PLANTILLA_POR_DEFECTO } from './plantillas/index.mjs';

// El video se baja y se comparte desde el teléfono: no conviene que pase de unos 4 MB. Casi siempre queda
// bajo eso con la calidad normal; si un producto se pasa (una foto con mucho detalle), se arma de nuevo con un
// poco menos de calidad, hasta que quepa.
export const PESO_MAX = 4 * 1024 * 1024;
const CALIDADES = [CRF_NORMAL, 20, 23, 26];

/**
 * Corre `tarea` con la red cortada. Dibujar las capas no necesita la red, pero el dibujante (next/og) sale a
 * buscar una fuente si le llega un signo que Inter no tiene. Los textos ya vienen limpios; si igual algo lo
 * intentara, falla aquí en vez de salir a buscar.
 */
async function sinRed(tarea) {
  const antes = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('Sin red: este video se arma solo con archivos locales.'));
  try {
    return await tarea();
  } finally {
    globalThis.fetch = antes;
  }
}

/** Pinta los cuadros uno tras otro en este mismo hilo. Es el camino simple (un solo hilo). */
function pintarEnFila(pintar, fps, cuadros, escribir) {
  let cortado = false;
  const fin = (async () => {
    const dst = new Uint8Array(W * H * 3);
    const buf = Buffer.from(dst.buffer);
    for (let i = 0; i < cuadros; i++) {
      if (cortado) throw new Error('Se dejó de pintar antes de terminar');
      pintar(dst, i / fps);
      await escribir(buf);
    }
  })();
  fin.catch(() => {}); // el error se atiende donde se espera `fin`
  return { fin, cortar: () => (cortado = true) };
}

/**
 * Pinta los cuadros en varios hilos a la vez y los entrega a ffmpeg en orden. Cada cuadro se pinta completo
 * y no depende del anterior, así que da lo mismo quién pinta cuál: el video sale idéntico al de un solo hilo.
 * `cortar()` suelta los hilos antes de tiempo (si ffmpeg falló, no tiene sentido seguir pintando).
 */
function pintarEnHilos(trabajo, fps, cuadros, hilos, escribir) {
  let cortar;
  const fin = new Promise((resolve, reject) => {
    const obreros = [];
    const libres = []; // obreros sin tarea
    const memorias = Array.from({ length: hilos + 2 }, () => new SharedArrayBuffer(W * H * 3)); // tope de cuadros "en vuelo"
    const enUso = new Map(); // número de cuadro -> su memoria
    const pintados = new Set();
    let siguiente = 0; // próximo cuadro a repartir
    let entregado = 0; // próximo cuadro a entregar a ffmpeg
    let entregando = false;
    let cerrado = false;
    const terminar = (err) => {
      if (cerrado) return;
      cerrado = true;
      for (const o of obreros) o.terminate();
      if (err) reject(err);
      else resolve();
    };
    cortar = () => terminar(new Error('Se dejó de pintar antes de terminar'));
    const repartir = () => {
      while (libres.length && memorias.length && siguiente < cuadros) {
        const memoria = memorias.pop();
        enUso.set(siguiente, memoria);
        libres.pop().postMessage({ i: siguiente, t: siguiente / fps, memoria });
        siguiente++;
      }
    };
    const entregar = async () => {
      if (entregando) return;
      entregando = true;
      while (!cerrado && pintados.has(entregado)) {
        const memoria = enUso.get(entregado);
        await escribir(Buffer.from(new Uint8Array(memoria))); // copia: a ffmpeg no se le pasa memoria compartida
        pintados.delete(entregado);
        enUso.delete(entregado);
        memorias.push(memoria);
        entregado++;
        repartir();
      }
      entregando = false;
      if (entregado === cuadros) terminar();
    };
    for (let h = 0; h < hilos; h++) {
      const o = new Worker(new URL('./obrero.mjs', import.meta.url), { workerData: trabajo });
      obreros.push(o);
      o.on('error', terminar);
      o.on('exit', (codigo) => {
        if (!cerrado) terminar(new Error(`Un hilo de dibujo se cerró antes de tiempo (código ${codigo})`));
      });
      o.on('message', (m) => {
        if (!m.listo) pintados.add(m.i);
        libres.push(o);
        repartir();
        entregar().catch(terminar);
      });
    }
  });
  fin.catch(() => {}); // el error se atiende donde se espera `fin`
  return { fin, cortar };
}

/**
 * Prepara el reel de un producto: revisa la llamada del cierre, busca ffmpeg y dibuja todas las capas (si la
 * foto no se puede leer, falla aquí y no se arma nada). Devuelve lo que se va a decir en pantalla, para
 * mostrarlo antes de armar, y `armar(...)`, que es lo que de verdad pinta y comprime.
 *
 * `producto` es lo que devuelve resolverProducto o leerProducto (datos.mjs).
 */
export async function prepararReel(producto, { plantilla = PLANTILLA_POR_DEFECTO, cta = null, zonas = false, musica = null } = {}) {
  const P = await cargarPlantilla(plantilla);
  const llamada = limpia(cta ?? '', 800) || P.CTA_POR_DEFECTO;
  revisarLlamada(llamada);
  const ffmpeg = buscarFfmpeg();
  if (musica) {
    const problema = revisarMusica(ffmpeg, musica);
    if (problema) throw new Error(`No se puede usar la música ${musica}: ${problema}.`);
  }

  const escena = await sinRed(() => P.preparar(producto, llamada, { zonas }));
  const T = P.tiempos(escena);
  const cuadros = Math.round(T.fin * P.FPS);

  /**
   * Arma el video en `salida` (y, si se piden, la portada y la hoja de contactos). `pesoMax` es el tope en
   * bytes (0 = sin tope). Devuelve cuánto pesa, con qué calidad quedó y cuánto demoró en pintar y comprimir.
   */
  async function armar({ salida, portada = null, hoja = null, volumen = 1, hilos = null, pesoMax = PESO_MAX }) {
    for (const r of [salida, portada, hoja]) if (r) fs.mkdirSync(path.dirname(r), { recursive: true });

    // La portada: la escena del precio completa y quieta, pintada directo (no sale del video comprimido).
    if (portada) {
      const dst = new Uint8Array(W * H * 3);
      P.pintor(escena, T)(dst, T.portada);
      await sharp(Buffer.from(dst.buffer), { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(portada);
    }

    // El video: varios hilos pintan los cuadros y ffmpeg los comprime a medida que llegan.
    const cuantos = hilos ?? Math.max(1, Math.min(6, Math.floor(os.availableParallelism() / 2)));
    const inicio = Date.now();
    let crf = CALIDADES[0];
    let peso = 0;
    for (const calidad of CALIDADES) {
      crf = calidad;
      const video = abrirVideo(ffmpeg, { salida, ancho: W, alto: H, fps: P.FPS, cuadros, musica, volumen, crf });
      const pintura = cuantos > 1 ? pintarEnHilos({ plantilla, escena, T }, P.FPS, cuadros, cuantos, video.escribir) : pintarEnFila(P.pintor(escena, T), P.FPS, cuadros, video.escribir);
      try {
        // Si ffmpeg falla a mitad de camino, se corta ahí con su mensaje en vez de seguir pintando.
        await Promise.race([pintura.fin, video.fin]);
        video.cerrar();
        await video.fin;
      } catch (e) {
        pintura.cortar();
        video.abortar();
        await video.fin.catch(() => {});
        throw e;
      }
      peso = fs.statSync(salida).size;
      if (!pesoMax || peso <= pesoMax) break;
    }
    const segundosArmando = (Date.now() - inicio) / 1000;

    // La hoja de contactos, sacada del video ya terminado (así se revisa lo que de verdad quedó).
    if (hoja) {
      const rotular = (segundos, rotulo, anchoMax) => capas.renglon([{ t: segundos }, { t: `   ${rotulo}`, color: '#9CA3AF' }], { tam: 27, alto: 56, peso: 600, color: '#F3F4F6', anchoMax });
      await hojaDeContactos(ffmpeg, salida, hoja, P.momentos(T), P.FPS, rotular);
    }

    return { peso, crf, calidadBajada: crf !== CALIDADES[0], pasaDelTope: Boolean(pesoMax) && peso > pesoMax, hilos: cuantos, segundosArmando };
  }

  return {
    plantilla,
    cta: llamada,
    cuadros,
    segundos: cuadros / P.FPS,
    // Todo lo que va a salir escrito, una vez cada cosa y en el orden en que aparece: para revisarlo antes de publicar.
    escrito: [...new Set(escena.dicho.map((t) => (typeof t === 'string' ? `"${t}"` : `"${t.texto}" (${t.nota})`)))],
    avisos: [...producto.avisos, ...escena.avisos],
    descripcion: P.describir(escena, llamada),
    armar,
  };
}
