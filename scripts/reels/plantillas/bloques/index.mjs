// La plantilla "bloques": enérgica y directa. Desde el cuadro 0 la pantalla son bloques de color de la marca con
// el descuento enorme y, debajo, la tarjeta blanca con la foto real; los bloques suben de un empujón y la tarjeta
// crece; el precio se estampa como una etiqueta de tienda cian sobre el borde de la tarjeta; cierra con tres
// barras que suben y la llamada en una losa cian. Mismo largo que "estudio" (9 a 10 s), pero con cortes marcados
// y el precio medio segundo antes.
//
// Entrega al armador (../../armar.mjs) lo mismo que estudio/index.mjs.
import { FPS, CTA_POR_DEFECTO, preparar, tiempos as tiemposSegunGancho, momentos, pintor } from './escena.mjs';

export { FPS, CTA_POR_DEFECTO };

/**
 * preparar(producto, cta, { zonas }) dibuja las capas una sola vez y devuelve la escena (solo datos: viaja tal
 * cual a los hilos que pintan), con `dicho` (todo el texto que va a salir escrito) y `avisos`.
 */
export { preparar };

/** El guion de esta escena: en qué segundo pasa cada cosa. `fin` es el largo del video y `portada` el cuadro que se guarda como portada. */
export const tiempos = (escena) => tiemposSegunGancho(Boolean(escena.A));

/** momentos(T): los cuadros de la hoja de contactos. pintor(escena, T): devuelve pintar(lienzo, segundo). */
export { momentos, pintor };

/** Lo que se cuenta en la consola de cómo quedó, para revisar de un vistazo. */
export function describir(escena, cta) {
  const m = escena.medidas;
  return [
    `foto ${m.foto === 'fundida' ? 'sobre blanco' : 'en lámina'}, producto de ${m.original.w}x${m.original.h} px, mostrado a ${m.producto} px en tarjetas de ${m.tarjeta} (${escena.apaisada ? 'apaisada' : 'alta'})`,
    `${m.numeroTam ? `número del gancho en ${m.numeroTam} px, ` : ''}precio en ${m.precioTam} px en la etiqueta, llamada "${cta}" en ${m.llamadaTam} px`,
  ];
}
