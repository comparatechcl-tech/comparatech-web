import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Inter en tres pesos para las piezas que dibuja next/og.
 *
 * La fuente que trae next/og tiene un solo peso, y sin negritas no hay cómo
 * darle jerarquía a una pieza (el precio y el descuento se ven igual que el
 * resto). Los archivos están en el repositorio (lib/content/fonts, licencia
 * OFL) y se leen del disco: no se le pide nada a otro servidor al dibujar.
 *
 * Las rutas que dibujan con estas fuentes tienen que figurar en
 * outputFileTracingIncludes (next.config.js): Vercel solo sube con cada ruta
 * los archivos que sabe que usa.
 */

export interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 600 | 800;
  style: 'normal';
}

const WEIGHTS = [400, 600, 800] as const;

let loading: Promise<OgFont[]> | null = null;

/** Se leen una vez por instancia del servidor. Si la lectura falla, la próxima llamada lo intenta de nuevo. */
export function interFonts(): Promise<OgFont[]> {
  if (!loading) {
    loading = Promise.all(
      WEIGHTS.map(async (weight) => ({
        name: 'Inter',
        data: await readFile(join(process.cwd(), 'src', 'lib', 'content', 'fonts', `inter-latin-${weight}-normal.woff`)),
        weight,
        style: 'normal' as const,
      }))
    ).catch((err) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}
