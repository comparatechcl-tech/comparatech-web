// La plantilla "navidad": "impacto" (la del reel diario) con adornos de Navidad. Mismos momentos, mismos tiempos
// (10,6 s con gancho) y mismo reparto de la pantalla. Cambia lo que dice arriba ("Regalo por menos de $X mil"), la
// llamada del cierre ("Guárdalo para tus compras de Navidad") y se suman una guirnalda de luces arriba, nieve
// sobre la hoja azul noche, chispas doradas cuando pega el precio, el gorro del Viejito Pascuero en el logo y, en
// el cierre, un moño rojo, el Viejito Pascuero con su saco y un arbolito (ver escena.mjs).
//
// El dueño la aprobó el 09-11-2026: va en el reel diario alternada con "impacto" (VIDEO_TEMPLATES en
// src/lib/social/videos.ts). Se saca de ahí cuando termine la temporada.
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
    `precio en ${m.precioTam} px, llamada "${cta}" en ${m.llamadaTam} px, con adornos de Navidad`,
  ];
}
