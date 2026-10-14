// Un hilo que pinta cuadros. armar.mjs lanza varios: cada uno recibe la escena ya preparada y el nombre de su
// plantilla, arma su propio pintor y va pintando los cuadros que le piden, directo sobre memoria compartida.
import { parentPort, workerData } from 'node:worker_threads';
import { cargarPlantilla } from './plantillas/index.mjs';

const { pintor } = await cargarPlantilla(workerData.plantilla);
const pintar = pintor(workerData.escena, workerData.T);
parentPort.on('message', ({ i, t, memoria }) => {
  pintar(new Uint8Array(memoria), t);
  parentPort.postMessage({ i });
});
parentPort.postMessage({ listo: true });
