// Precarga para las pruebas que lanzan el comando de verdad en otro proceso:
//   node --import scripts/reels/pruebas/sin-red.mjs scripts/reels/generar.mjs --sitio http://127.0.0.1:<puerto>
// Deja pasar solo los pedidos a 127.0.0.1 (el sitio de mentira). Cualquier otro destino no sale a la red: se
// anota y falla, así una prueba que se equivoca de sitio se nota en vez de molestar a un servidor de verdad.
//
// Con la variable REELS_PRUEBA_CORTE (el nombre de una señal: SIGINT, SIGTERM...) hace además de alguien que
// corta el proceso justo cuando está bajando la primera foto, que es cuando ya existe la carpeta temporal de
// ese video: deja un archivo dentro, como si el video estuviera a medias, y avisa la señal. La señal se avisa
// desde adentro (process.emit) y no con kill, porque en Windows un kill mata el proceso sin avisarle a nadie.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const realFetch = globalThis.fetch;
const cut = process.env.REELS_PRUEBA_CORTE || '';
let cutDone = false;

/** Directo al error estándar y sin esperar: lo que sigue puede ser el fin del proceso. */
const note = (text) => fs.writeSync(2, `[prueba] ${text}\n`);

globalThis.fetch = (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname === '127.0.0.1') return realFetch(input, init);

  if (cut && !cutDone && url.hostname.endsWith('.mlstatic.com')) {
    cutDone = true;
    const dirs = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('comparatech-reel-'));
    for (const dir of dirs) fs.writeFileSync(path.join(os.tmpdir(), dir, 'reel.mp4.parcial'), Buffer.alloc(4096));
    note(`carpetas temporales al cortar: ${dirs.length}`);
    setImmediate(() => process.emit(cut));
    // Si nadie atiende la señal, el proceso no puede quedarse esperando para siempre ni terminar "bien".
    setTimeout(() => {
      note('nadie atendió la señal');
      process.exit(98);
    }, 5000);
    return new Promise(() => {});
  }

  note(`intento de salir a la red: ${url.host}`);
  return Promise.reject(new Error(`una prueba intentó salir a la red: ${url.host}`));
};
