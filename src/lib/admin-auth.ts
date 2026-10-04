import 'server-only';
import { headers } from 'next/headers';
import { checkBasicAuth } from '@/lib/basic-auth';

/**
 * Verificación dentro de cada acción del admin.
 *
 * El middleware protege las páginas de /admin, pero una server action se
 * puede invocar con un POST directo a cualquier ruta del sitio: el
 * middleware no la cubre si el POST llega fuera de /admin. Por eso cada
 * acción que escribe en la base llama a esto primero.
 *
 * Devuelve el nombre de la persona, para dejar registro de quién hizo qué.
 */
export async function requireAdmin(): Promise<string> {
  const name = checkBasicAuth((await headers()).get('authorization'));
  if (!name) throw new Error('No autorizado');
  return name;
}
