import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { directLinksUsable } from '@/lib/admin-settings';
import { getCategoryInfo } from '@/lib/categories';
import {
  BASE_CANDIDATE_COLUMNS,
  OPTIONAL_CANDIDATE_COLUMNS,
  buildCandidateView,
  facetCounts,
  fetchAllPages,
  groupByFamily,
  parseCandidateQuery,
  startOfTodayChile,
  type CandidateRow,
} from '@/lib/candidate-sort';
import { readActiveCatalog, reviewableCandidates } from '@/lib/candidate-queue';
import { CandidatesList } from './CandidatesList';
import { CandidateFilters } from './CandidateFilters';

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/candidatos';

function categoryName(slug: string): string {
  return getCategoryInfo(slug)?.name ?? (slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Sin categoría');
}

/**
 * Todos los pendientes, de a 1000 (el tope por consulta de Supabase). Si
 * las columnas opcionales todavía no existen, se leen sin ellas.
 */
async function readPending(admin: SupabaseClient | null): Promise<{ rows: CandidateRow[]; error: string | null }> {
  if (!admin) return { rows: [], error: null };
  const run = (columns: string) =>
    fetchAllPages<CandidateRow>(
      (from, to) =>
        admin
          .from('product_candidates')
          .select(columns)
          .eq('status', 'pending_review')
          .order('prospected_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: CandidateRow[] | null;
          error: { code?: string; message: string } | null;
        }>
    );

  let res = await run(`${BASE_CANDIDATE_COLUMNS}, ${OPTIONAL_CANDIDATE_COLUMNS}`);
  if (res.error && isMissingSchemaError(res.error)) res = await run(BASE_CANDIDATE_COLUMNS);
  return { rows: res.rows, error: res.error?.message ?? null };
}

/** Productos a la vista por categoría (activos y no ocultos ni eliminados). */
async function readPublishedByCategory(admin: SupabaseClient | null): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!admin) return counts;
  const run = (excludeDeleted: boolean) =>
    fetchAllPages<{ category: string }>((from, to) => {
      let query = admin.from('products').select('category').eq('is_active', true).eq('is_hidden', false);
      if (excludeDeleted) query = query.is('deleted_at', null);
      return query.order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{
        data: { category: string }[] | null;
        error: { code?: string; message: string } | null;
      }>;
    });

  // deleted_at lo agrega otra migración: sin ella, se cuentan todos.
  let res = await run(true);
  if (res.error && isMissingSchemaError(res.error)) res = await run(false);
  for (const p of res.rows) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return counts;
}

/**
 * Revisados hoy (hora de Chile). Con la migración 0014 se cuentan solo los
 * que revisó una persona: la prospección también da de baja candidatos cada
 * mañana y esos no son trabajo del admin.
 */
async function countReviewedToday(admin: SupabaseClient | null, now: Date): Promise<number> {
  if (!admin) return 0;
  const since = startOfTodayChile(now).toISOString();
  // Un candidato recuperado vuelve a pending_review con reviewed_at = hora de
  // la recuperación: no es trabajo hecho, así que no se cuenta.
  const base = () =>
    admin
      .from('product_candidates')
      .select('id', { count: 'exact', head: true })
      .gte('reviewed_at', since)
      .neq('status', 'pending_review');

  const byPerson = await base().not('reviewed_by', 'is', null);
  if (!byPerson.error && byPerson.count !== null) return byPerson.count;
  // Un conteo head:true no trae cuerpo: si falta reviewed_by (migración
  // 0014 sin aplicar) PostgREST responde 400 con un error sin código, que
  // isMissingSchemaError no reconoce (probado contra producción). Ante
  // cualquier falla se cuenta sin el filtro; si eso también falla, 0.
  const all = await base();
  return all.error ? 0 : (all.count ?? 0);
}

export default async function CandidatosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseCandidateQuery(await searchParams);
  const admin = getSupabaseAdmin();
  const now = new Date();

  const [pending, published, todayReviewed, directLinks, catalog] = await Promise.all([
    readPending(admin),
    readPublishedByCategory(admin),
    countReviewedToday(admin, now),
    directLinksUsable(admin),
    admin ? readActiveCatalog(admin) : Promise.resolve({ rows: [], error: null }),
  ]);

  // Sin los otros colores de un modelo que ya se publicó (salvo que sean
  // bastante más baratos): antes, al aprobar un color, los demás seguían en
  // la cola y volvían como tarjeta nueva. Si el catálogo no se pudo leer,
  // se muestra todo.
  const rows = catalog.error ? pending.rows : reviewableCandidates(pending.rows, catalog.rows);

  const view = buildCandidateView(rows, query, now);
  const facets = facetCounts(rows, query.filters, now, categoryName);
  const filtered =
    Boolean(query.filters.cat || query.filters.precio || query.filters.desc || query.filters.ingreso || query.filters.q);

  // Cobertura: dónde faltan productos publicados y cuánto hay por revisar.
  const pendingByCategory = new Map<string, number>();
  for (const g of groupByFamily(rows)) {
    pendingByCategory.set(g.category, (pendingByCategory.get(g.category) ?? 0) + 1);
  }
  const coverage = [...pendingByCategory.entries()].sort((a, b) => b[1] - a[1]);

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    const { cat, precio, desc, ingreso, q } = query.filters;
    for (const [k, v] of Object.entries({ cat, precio, desc, ingreso, q })) if (v) params.set(k, v);
    if (query.sort !== 'valor') params.set('orden', query.sort);
    if (page > 1) params.set('p', String(page));
    const qs = params.toString();
    return qs ? `${BASE_PATH}?${qs}` : BASE_PATH;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-2xl font-bold text-fg">Candidatos a revisar</h1>
          <p className="mt-1 text-sm text-muted">
            Por revisar: <strong className="text-fg">{filtered ? `${view.total} de ${view.totalAll}` : view.totalAll}</strong>{' '}
            · Página {view.page} de {view.pages}
          </p>
        </div>
        <Link
          href={`${BASE_PATH}/rechazados`}
          className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-fg"
        >
          Ver rechazados
        </Link>
      </div>

      {pending.error && (
        <p className="mt-4 text-sm text-red-400">No se pudieron leer los candidatos: {pending.error}</p>
      )}

      {coverage.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {coverage.map(([slug, count]) => {
            const live = published.get(slug) ?? 0;
            return (
              <li key={slug}>
                <span className="font-medium text-fg">{categoryName(slug)}</span>: {live} publicado
                {live === 1 ? '' : 's'} · {count} por revisar
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6">
        <CandidateFilters facets={facets} filters={query.filters} sort={query.sort} />
      </div>

      <div className="mt-6">
        {view.items.length === 0 && !pending.error ? (
          <p className="text-sm text-muted">
            {filtered ? 'Ningún candidato calza con estos filtros.' : 'No hay candidatos pendientes por ahora.'}
          </p>
        ) : (
          <CandidatesList
            // Otra página u otros filtros: selección y avisos parten de cero.
            key={pageHref(view.page)}
            candidates={view.items}
            directLinks={directLinks}
            todayReviewed={todayReviewed}
            now={now.getTime()}
          />
        )}
      </div>

      {view.pages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-2 text-sm" aria-label="Páginas">
          {view.page > 1 ? (
            <Link href={pageHref(view.page - 1)} className="min-h-11 rounded-md border border-border px-3 py-2 text-muted hover:text-fg">
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted">
            Página {view.page} de {view.pages}
          </span>
          {view.page < view.pages ? (
            <Link href={pageHref(view.page + 1)} className="min-h-11 rounded-md border border-border px-3 py-2 text-muted hover:text-fg">
              Siguiente →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
