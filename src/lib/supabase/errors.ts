/**
 * ¿El error viene de una tabla o columna que todavía no existe?
 *
 * Las migraciones se aplican a mano en Supabase y el código se publica solo
 * con cada push. En el rato entre una cosa y la otra, el sitio tiene que
 * seguir funcionando sin la parte nueva en vez de caerse entero.
 *
 * - 42P01: tabla inexistente (Postgres).
 * - 42703: columna inexistente (Postgres).
 * - PGRST204: columna que no está en el caché de esquema de PostgREST.
 * - PGRST205: tabla que no está en el caché de esquema de PostgREST.
 */
const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

export function isMissingSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err?.code) return false;
  return MISSING_SCHEMA_CODES.has(err.code);
}
