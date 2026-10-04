/**
 * Compara dos secretos sin delatar, por el tiempo de respuesta, cuántos
 * caracteres acertó quien está probando claves. Un `===` corta en el primer
 * carácter distinto, y con suficientes intentos esa diferencia de tiempo se
 * puede medir.
 *
 * Sin imports de Node (nada de crypto.timingSafeEqual) a propósito: la usa
 * el middleware, que corre en el runtime Edge, y también los route handlers
 * en Node.
 */
const encoder = new TextEncoder();

export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  // El largo distinto se acumula en el mismo resultado en vez de salir
  // antes: así el recorrido dura lo mismo aunque los largos no calcen.
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
