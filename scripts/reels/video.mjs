// Todo lo que toca ffmpeg: encontrarlo, comprimir el video (con silencio o con música) y sacar la hoja de
// contactos. ffmpeg solo comprime: los cuadros llegan ya pintados. Es común a todas las plantillas.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import sharp from 'sharp';

// La calidad normal del video (crf de x264: más bajo, mejor imagen y más peso). Con 17 los reels de muestra
// pesan entre 2 y 4 MB.
export const CRF_NORMAL = 17;

/** Dónde está ffmpeg en este equipo: el de la variable FFMPEG, el de la consola o el que instaló WinGet. */
export function buscarFfmpeg() {
  const candidatos = [process.env.FFMPEG, 'ffmpeg'];
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages');
  if (process.env.LOCALAPPDATA && fs.existsSync(winget)) {
    for (const paquete of fs.readdirSync(winget).filter((n) => n.startsWith('Gyan.FFmpeg'))) {
      for (const version of fs.readdirSync(path.join(winget, paquete))) candidatos.push(path.join(winget, paquete, version, 'bin', 'ffmpeg.exe'));
    }
  }
  for (const c of candidatos.filter(Boolean)) {
    if (spawnSync(c, ['-version'], { stdio: 'ignore' }).status === 0) return c;
  }
  throw new Error('No encuentro ffmpeg. Instálalo o indica dónde está con la variable FFMPEG.');
}

/** ¿Se puede leer este archivo como audio? Devuelve null si sí, o el motivo si no. */
export function revisarMusica(ffmpeg, musica) {
  if (!fs.existsSync(musica) || !fs.statSync(musica).isFile()) return 'el archivo no existe';
  const r = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', musica, '-map', '0:a:0', '-t', '0.2', '-f', 'null', '-'], { encoding: 'utf8' });
  return r.status === 0 ? null : 'no es un archivo de audio que ffmpeg pueda leer';
}

/**
 * Abre ffmpeg para recibir los cuadros (RGB crudo) y dejar el MP4 listo para Reels, TikTok y Shorts:
 * H.264 yuv420p, un cuadro clave cada 2 segundos, arranque rápido y una pista AAC.
 * La pista es silencio (las redes rechazan un video sin pista) o, si se da `musica`, ese archivo recortado a
 * la duración del video, con entrada y salida suaves y el volumen pedido.
 * El video se escribe con otro nombre y solo al terminar bien toma el definitivo: nunca queda uno a medias.
 */
export function abrirVideo(ffmpeg, { salida, ancho, alto, fps, cuadros, musica = null, volumen = 1, crf = CRF_NORMAL }) {
  const duracion = cuadros / fps;
  const D = duracion.toFixed(3);
  const parcial = `${salida}.parcial`;
  const audio = musica ? ['-stream_loop', '-1', '-i', musica] : ['-f', 'lavfi', '-t', D, '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
  const filtroAudio = musica
    ? `[1:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${D},asetpts=PTS-STARTPTS,volume=${volumen.toFixed(3)},afade=t=in:st=0:d=0.4,afade=t=out:st=${(duracion - 0.9).toFixed(3)}:d=0.9[a]`
    : '[1:a:0]anull[a]';
  const ff = spawn(
    ffmpeg,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${ancho}x${alto}`, '-r', String(fps), '-i', 'pipe:0',
      ...audio,
      // Los colores se pasan a la norma de video HD (BT.709) y queda anotado, para que cada app los lea igual.
      '-filter_complex', `[0:v]scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p[v];${filtroAudio}`,
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf), '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
      '-r', String(fps), '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-sc_threshold', '0', '-bf', '2',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', musica ? '192k' : '128k', '-ar', '44100', '-ac', '2',
      '-t', D, '-movflags', '+faststart', '-f', 'mp4',
      parcial,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] }
  );
  let error = '';
  ff.stderr.on('data', (d) => (error += d));
  ff.stdin.on('error', () => {}); // si ffmpeg muere, el motivo llega por 'close'
  const quitarParcial = () => {
    try {
      fs.unlinkSync(parcial);
    } catch {
      // no había nada que quitar
    }
  };
  const fin = new Promise((resolve, reject) => {
    ff.on('error', (e) => {
      quitarParcial();
      reject(e);
    });
    ff.on('close', (codigo) => {
      if (codigo === 0) {
        try {
          fs.renameSync(parcial, salida);
          resolve();
        } catch (e) {
          quitarParcial();
          reject(new Error(`No se pudo guardar ${salida}: puede estar abierto en otro programa. Ciérralo y vuelve a correr. (${e.code || e.message})`));
        }
      } else {
        quitarParcial();
        reject(new Error(`ffmpeg terminó con error ${codigo}: ${error.trim().slice(-600)}`));
      }
    });
  });
  fin.catch(() => {}); // el error se atiende donde se espera `fin`
  return {
    /** Entrega un cuadro y espera a que ffmpeg lo reciba (así la memoria del cuadro se puede volver a usar). */
    escribir: (buf) => new Promise((ok) => ff.stdin.write(buf, ok)),
    cerrar: () => ff.stdin.end(),
    /** Corta a ffmpeg sin dejar nada: `fin` termina con error y el video a medias se borra. */
    abortar: () => ff.kill(),
    fin,
  };
}

/**
 * Hoja de contactos: los cuadros pedidos (`momentos` = [{ t, rotulo }]), sacados del video YA terminado, en
 * dos filas, cada uno con su segundo y qué momento es. `rotular(segundos, rotulo, anchoMax)` devuelve la capa
 * con el texto del rótulo.
 */
export async function hojaDeContactos(ffmpeg, video, salida, momentos, fps, rotular) {
  const indices = momentos.map((m) => Math.round(m.t * fps));
  const MW = 540;
  const MH = 960;
  const elegir = indices.map((n) => `eq(n\\,${n})`).join('+');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `select='${elegir}',scale=${MW}:${MH}:flags=lanczos,tile=${indices.length}x1`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`No se pudo sacar la hoja de contactos: ${String(r.stderr).slice(-400)}`);
  const SEP = 16;
  const ROTULO = 56;
  const porFila = Math.ceil(indices.length / 2);
  const piezas = [];
  for (let i = 0; i < indices.length; i++) {
    const mini = await sharp(r.stdout).extract({ left: i * MW, top: 0, width: MW, height: MH }).png().toBuffer();
    const x = SEP + (i % porFila) * (MW + SEP);
    const y = SEP + Math.floor(i / porFila) * (MH + ROTULO + SEP);
    const rotulo = await rotular(`${(indices[i] / fps).toFixed(1).replace('.', ',')} s`, momentos[i].rotulo, MW);
    piezas.push({ input: mini, left: x, top: y + ROTULO });
    piezas.push({ input: Buffer.from(rotulo.data.buffer, rotulo.data.byteOffset, rotulo.data.length), raw: { width: rotulo.w, height: rotulo.h, channels: 4 }, left: x + 4, top: y });
  }
  await sharp({ create: { width: porFila * MW + (porFila + 1) * SEP, height: 2 * (MH + ROTULO) + 3 * SEP, channels: 3, background: '#1f2937' } })
    .composite(piezas)
    .jpeg({ quality: 88 })
    .toFile(salida);
}
