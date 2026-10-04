import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { readAdminEvents, type AdminEventRow } from '@/lib/admin-audit';

export const dynamic = 'force-dynamic';

/**
 * Quién hizo qué en el admin. Los links de afiliado son la única fuente de
 * ingresos: si las comisiones bajan, esta es la primera página que mirar.
 */

const ACTIONS: { value: string; label: string }[] = [
  { value: 'config_afiliado', label: 'Configuración de afiliado' },
  { value: 'guardar_link', label: 'Links guardados' },
  { value: 'reverificar', label: 'Revisiones' },
  { value: 'prueba_atribucion', label: 'Prueba de atribución' },
  { value: 'aprobar', label: 'Aprobaciones' },
  { value: 'rechazar', label: 'Rechazos' },
  { value: 'recuperar', label: 'Recuperados' },
  { value: 'editar_producto', label: 'Ediciones' },
  { value: 'ocultar_producto', label: 'Ocultados' },
  { value: 'mostrar_producto', label: 'Vueltos a mostrar' },
  { value: 'eliminar_producto', label: 'Eliminados' },
  { value: 'marcar_rrss', label: 'Redes sociales' },
  { value: 'reporte_afiliados', label: 'Reportes de ML' },
];

const TZ = 'America/Santiago';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('es-CL', { timeZone: TZ, day: 'numeric', month: 'short' });

/** "Hoy 10:42", "Ayer 18:05" o "3 oct. 09:15", en hora de Chile. */
function formatWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = timeFmt.format(date);
  const day = dayKey.format(date);
  if (day === dayKey.format(now)) return `Hoy ${time}`;
  if (day === dayKey.format(new Date(now.getTime() - 86_400_000))) return `Ayer ${time}`;
  return `${dateFmt.format(date)} ${time}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Cantidad de elementos que tocó la acción, si el registro la trae. */
function countOf(row: AdminEventRow): number | null {
  for (const side of [row.after, row.before]) {
    const r = asRecord(side);
    if (!r) continue;
    if (typeof r.count === 'number') return r.count;
    if (Array.isArray(r.ids)) return r.ids.length;
  }
  return null;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function describe(row: AdminEventRow): string {
  const after = asRecord(row.after);
  const count = countOf(row);
  switch (row.action) {
    case 'config_afiliado':
      return 'cambió la configuración de afiliado';
    case 'prueba_atribucion':
      return `anotó la prueba de atribución (${String(after?.status ?? '—')})`;
    case 'reverificar': {
      const n = typeof after?.revisados === 'number' ? after.revisados : null;
      return n === null ? 'revisó productos en Mercado Libre' : `revisó ${plural(n, 'producto', 'productos')} en Mercado Libre`;
    }
    case 'guardar_link': {
      if (typeof after?.name === 'string') return `guardó el link de ${after.name}`;
      const n = after ? Object.keys(after).length : 0;
      return `guardó ${plural(n, 'link', 'links')}`;
    }
    case 'aprobar':
      return count === null ? 'aprobó candidatos' : `aprobó ${plural(count, 'candidato', 'candidatos')}`;
    case 'rechazar':
      return count === null ? 'rechazó candidatos' : `rechazó ${plural(count, 'candidato', 'candidatos')}`;
    case 'recuperar':
      return count === null ? 'recuperó candidatos' : `recuperó ${plural(count, 'candidato', 'candidatos')}`;
    // Las acciones sobre un producto publicado (WP-09) y el reporte semanal
    // de la Central de Afiliados (Métricas) guardan el id o la semana en target.
    case 'editar_producto':
      return `editó un producto${row.target ? ` · ${row.target}` : ''}`;
    case 'ocultar_producto':
      return `ocultó un producto${row.target ? ` · ${row.target}` : ''}`;
    case 'mostrar_producto':
      return `volvió a mostrar un producto${row.target ? ` · ${row.target}` : ''}`;
    case 'eliminar_producto':
      return `eliminó un producto${row.target ? ` · ${row.target}` : ''}`;
    case 'marcar_rrss':
      return `cambió el estado en redes de un producto${row.target ? ` · ${row.target}` : ''}`;
    case 'reporte_afiliados':
      return `anotó el reporte de Mercado Libre${row.target ? ` de la semana del ${row.target}` : ''}`;
    default:
      return row.target ? `${row.action} · ${row.target}` : row.action;
  }
}

function short(value: unknown): string {
  if (value === null || value === undefined) return '(vacío)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Los campos que cambiaron, en una línea: "directLinks: false → true". */
function diffSummary(row: AdminEventRow): string | null {
  const before = asRecord(row.before);
  const after = asRecord(row.after);
  if (!before || !after) return null;
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
    (k) => k !== 'name' && JSON.stringify(before[k]) !== JSON.stringify(after[k])
  );
  if (keys.length === 0) return 'sin cambios';
  // Una tanda de links trae un campo por producto: con muchos basta el total.
  if (keys.length > 3) return `${keys.length} cambios`;
  return keys.map((k) => `${k}: ${short(before[k])} → ${short(after[k])}`).join(' · ');
}

export default async function ActividadPage({
  searchParams,
}: {
  searchParams: Promise<{ accion?: string }>;
}) {
  const { accion } = await searchParams;
  const action = accion && /^[a-z_]{1,40}$/.test(accion) ? accion : undefined;
  const result = await readAdminEvents(getSupabaseAdmin(), { action, limit: 200 });

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Actividad</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Los últimos 200 cambios hechos desde el admin, del más nuevo al más antiguo, en hora de Chile.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {[{ value: '', label: 'Todas' }, ...ACTIONS].map((a) => {
          const active = (action ?? '') === a.value;
          return (
            <Link
              key={a.value || 'todas'}
              href={a.value ? `/admin/actividad?accion=${a.value}` : '/admin/actividad'}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {a.label}
            </Link>
          );
        })}
      </nav>

      {!result.ok ? (
        result.missing ? (
          <p className="mt-8 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            Aplica la migración 0013 para ver la actividad
          </p>
        ) : (
          <p className="mt-8 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
            Error al leer la actividad: {result.error}
          </p>
        )
      ) : result.rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted">Todavía no hay actividad registrada{action ? ' de este tipo' : ''}.</p>
      ) : (
        <ul className="mt-6 divide-y divide-border rounded-xl border border-border bg-surface">
          {result.rows.map((row) => {
            const summary = diffSummary(row);
            const hasJson = row.before !== null || row.after !== null;
            return (
              <li key={row.id} className="px-4 py-3">
                <p className="text-sm text-fg">
                  <span className="text-muted">{formatWhen(row.at)}</span>
                  {' · '}
                  <strong className="font-medium">{row.actor}</strong>
                  {' · '}
                  {describe(row)}
                </p>
                {summary && <p className="mt-0.5 break-all text-xs text-muted">{summary}</p>}
                {hasJson && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted hover:text-fg">Ver detalle</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Antes</p>
                        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface2 p-2 text-[11px] text-fg">
                          {JSON.stringify(row.before, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted">Después</p>
                        <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-surface2 p-2 text-[11px] text-fg">
                          {JSON.stringify(row.after, null, 2)}
                        </pre>
                      </div>
                    </div>
                    {row.target && <p className="mt-1 break-all text-[11px] text-muted">Objetivo: {row.target}</p>}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
