// Las plantillas del reel. Cada una vive en su carpeta y entrega lo mismo (ver estudio/index.mjs): el armador
// no sabe nada de cómo se ve cada una. Agregar una es agregar su carpeta y una línea aquí.
//
// El nombre va en el nombre del archivo que se sube ({fecha}/{producto}-{precio}-{plantilla}.mp4), por eso solo
// lleva letras minúsculas y números.
const PLANTILLAS = {
  estudio: () => import('./estudio/index.mjs'),
  bloques: () => import('./bloques/index.mjs'),
};

export const PLANTILLA_POR_DEFECTO = 'estudio';

export const nombresDePlantillas = () => Object.keys(PLANTILLAS);

export const existePlantilla = (nombre) => typeof nombre === 'string' && Object.hasOwn(PLANTILLAS, nombre);

/** Si la plantilla no existe, lo dice y nombra las que hay. No carga nada: sirve para avisar antes de empezar. */
export function revisarPlantilla(nombre) {
  if (!existePlantilla(nombre)) throw new Error(`No existe la plantilla "${nombre}". Las que hay: ${nombresDePlantillas().join(', ')}.`);
}

/** Carga la plantilla pedida. */
export async function cargarPlantilla(nombre) {
  revisarPlantilla(nombre);
  return PLANTILLAS[nombre]();
}
