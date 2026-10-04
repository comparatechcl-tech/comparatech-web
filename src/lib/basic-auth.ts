import { safeEqual } from '@/lib/safe-equal';

/**
 * Credenciales del admin, una por persona.
 *
 * Antes había una sola clave compartida (ADMIN_USER / ADMIN_PASSWORD): si
 * alguien dejaba el equipo había que cambiársela a todos, y no quedaba
 * registro de quién aprobó qué. Con ADMIN_USERS cada persona tiene su clave
 * y las acciones del admin saben quién las hizo.
 *
 * Sin 'server-only' a propósito: la usa el middleware (Edge), además de las
 * acciones del servidor a través de admin-auth.
 */

export interface AdminCredential {
  name: string;
  password: string;
}

/**
 * ADMIN_USERS='nombre:clave,nombre2:clave2'. Se separa cada persona por ','
 * y el nombre de la clave por el PRIMER ':', así la clave puede llevar ':'
 * (pero no ','). Si ADMIN_USERS está vacía se usa el par antiguo
 * ADMIN_USER / ADMIN_PASSWORD, para no dejar a nadie afuera mientras se
 * cambia la variable en Vercel.
 */
export function getAdminCredentials(env: NodeJS.ProcessEnv = process.env): AdminCredential[] {
  const list: AdminCredential[] = [];
  for (const entry of (env.ADMIN_USERS ?? '').split(',')) {
    const sep = entry.indexOf(':');
    if (sep <= 0) continue;
    const name = entry.slice(0, sep).trim();
    const password = entry.slice(sep + 1);
    // Una clave vacía dejaría entrar a cualquiera que escriba solo el nombre.
    if (name && password) list.push({ name, password });
  }
  if (list.length > 0) return list;

  const user = env.ADMIN_USER?.trim();
  const password = env.ADMIN_PASSWORD;
  return user && password ? [{ name: user, password }] : [];
}

/**
 * atob entrega un "binary string" (un carácter por byte). Se vuelve a armar
 * como UTF-8 para que una clave con ñ o tildes calce con la de la variable.
 */
function decodeBase64Utf8(encoded: string): string | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Revisa la cabecera Authorization de Basic Auth. Devuelve el nombre de la
 * persona si la clave es correcta, o null si falta, viene mal armada o no
 * calza con ninguna.
 */
export function checkBasicAuth(header: string | null): string | null {
  if (!header) return null;
  const match = /^Basic\s+(\S+)\s*$/i.exec(header);
  if (!match) return null;

  const decoded = decodeBase64Utf8(match[1]);
  if (decoded === null) return null;
  const sep = decoded.indexOf(':');
  if (sep < 0) return null;
  const name = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);

  // Se recorre la lista completa aunque ya haya calzado alguien, para que el
  // tiempo de respuesta no delate en qué posición está cada nombre.
  let found: string | null = null;
  for (const cred of getAdminCredentials()) {
    const nameOk = safeEqual(name, cred.name);
    const passwordOk = safeEqual(password, cred.password);
    if (nameOk && passwordOk && found === null) found = cred.name;
  }
  return found;
}
