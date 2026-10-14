// La plantilla "estudio": la foto real del producto, grande, sobre un fondo claro, y una hoja azul noche que
// sube desde abajo y va diciendo el descuento, el nombre y el precio. Según la forma de la foto se acomoda de
// dos maneras: una foto alta o cuadrada (un celular) ocupa todo lo que deja la hoja; una apaisada (un
// televisor) vive entera en la mitad de arriba y la hoja sube hasta ella.
//
// Esto es todo lo que una plantilla le entrega al armador (../../armar.mjs). Otra plantilla es otra carpeta al
// lado de esta, con un index.mjs que exporte lo mismo, y su nombre en ../index.mjs.
import { FPS, CTA_POR_DEFECTO, preparar, tiempos as tiemposSegunGancho, momentos, pintor } from './escena.mjs';

export { FPS, CTA_POR_DEFECTO };

/**
 * preparar(producto, cta, { zonas }) dibuja las capas una sola vez y devuelve la escena. La escena viaja tal
 * cual a los hilos que pintan, así que solo lleva datos (nada de funciones). Tiene que traer `dicho` (todo el
 * texto que va a salir escrito), `avisos` y lo que la propia plantilla necesite para pintar.
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
    `foto ${m.foto === 'fundida' ? 'sobre blanco' : 'en lámina'}, producto de ${m.original.w}x${m.original.h} px, mostrado a ${m.gancho ? `${m.gancho} (gancho), ` : ''}${m.nombre} (nombre) y ${m.precio} px (precio)`,
    `precio en ${m.precioTam} px, llamada "${cta}" en ${m.llamadaTam} px`,
  ];
}
