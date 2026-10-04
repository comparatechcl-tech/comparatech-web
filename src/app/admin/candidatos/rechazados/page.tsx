import Link from 'next/link';
import Image from 'next/image';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { getCategoryInfo } from '@/lib/categories';
import { formatCLP, formatTimeAgo } from '@/lib/format';
import mlImageLoader from '@/lib/ml-image-loader';
import { fetchAllPages, matchesSearch, rejectReasonLabel } from '@/lib/candidate-sort';
import { RestoreButton } from './RestoreButton';

export const dynamic = 'force-dynamic';

const DAYS = 30;
/** Más que esto no se revisa a ojo: para algo puntual está el buscador. */
const MAX_SHOWN = 300;

interface RejectedRow {
  id: string;
  ml_product_id: string;
  name: string;
  brand: string | null;
  category: string;
  price: number;
  image_url: string;
  status: 'rejected' | 'expired';
  reviewed_at: string | null;
  prospected_at: string;
  reject_reason?: string | null;
  reviewed_by?: string | null;
}

const BASE_COLUMNS = 'id, ml_product_id, name, brand, category, price, image_url, status, reviewed_at, prospected_at';
/** Columnas de la migración 0014: sin ella, todo sale como "Motivo no registrado". */
const OPTIONAL_COLUMNS = 'reject_reason, reviewed_by';

async function readRejected(
  admin: SupabaseClient | null,
  since: string
): Promise<{ rows: RejectedRow[]; error: string | null }> {
  if (!admin) return { rows: [], error: null };
  const run = (columns: string) =>
    fetchAllPages<RejectedRow>(
      (from, to) =>
        admin
          .from('product_candidates')
          .select(columns)
          .in('status', ['rejected', 'expired'])
          // Los vencidos llevan en reviewed_at la hora en que vencieron. Los
          // que vencieron antes de ese cambio no tienen fecha: para esos vale
          // la de ingreso.
          .or(`reviewed_at.gte."${since}",and(reviewed_at.is.null,prospected_at.gte."${since}")`)
          .order('reviewed_at', { ascending: false, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: RejectedRow[] | null;
          error: { code?: string; message: string } | null;
        }>
    );

  let res = await run(`${BASE_COLUMNS}, ${OPTIONAL_COLUMNS}`);
  if (res.error && isMissingSchemaError(res.error)) res = await run(BASE_COLUMNS);
  return { rows: res.rows, error: res.error?.message ?? null };
}

/**
 * Rechazados y vencidos del último mes, para recuperar lo que se descartó
 * por error. Antes un rechazo era para siempre: la prospección no vuelve a
 * traer un candidato rechazado, así que un toque equivocado sacaba ese
 * producto del sitio para siempre.
 */
export default async function RechazadosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? '';

  const now = new Date();
  const since = new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  const admin = getSupabaseAdmin();
  const { rows, error } = await readRejected(admin, since);

  const matching = rows.filter((r) => matchesSearch(r, q));
  const shown = matching.slice(0, MAX_SHOWN);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Link href="/admin/candidatos" className="text-xs text-muted hover:text-fg">
        ← Volver a candidatos
      </Link>
      <h1 className="mt-2 font-heading text-2xl font-bold text-fg">Rechazados y vencidos</h1>
      <p className="mt-1 text-sm text-muted">
        Últimos {DAYS} días: {matching.length}
        {q ? ` de ${rows.length}` : ''}. &quot;Recuperar&quot; lo devuelve a la cola de revisión.
      </p>

      <form method="get" role="search" className="mt-5 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, marca o MLC…"
          aria-label="Buscar rechazados"
          className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-md border border-border px-4 py-2 text-sm font-medium text-fg transition hover:border-accent/50"
        >
          Buscar
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-400">No se pudieron leer los rechazados: {error}</p>}

      {shown.length === 0 && !error ? (
        <p className="mt-8 text-sm text-muted">
          {q ? 'Ningún rechazado calza con esa búsqueda.' : 'No hay rechazados en los últimos 30 días.'}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {shown.map((r) => {
            const when = formatTimeAgo(r.reviewed_at ?? r.prospected_at, now.getTime());
            return (
              <li key={r.id} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white">
                  {/* La URL se arma acá con el loader de ML: esta página es
                      de servidor y no puede pasarle una función a <Image>,
                      que es un componente de cliente. */}
                  <Image
                    unoptimized
                    src={mlImageLoader({ src: r.image_url, width: 96 })}
                    alt={r.name}
                    width={48}
                    height={48}
                    className="h-12 w-12 object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-medium text-fg">{r.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatCLP(r.price)} · {getCategoryInfo(r.category)?.name ?? r.category} · {r.ml_product_id}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-medium">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        r.status === 'expired' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {r.status === 'expired' ? 'Vencido' : 'Rechazado'}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-muted">
                      {rejectReasonLabel(r.reject_reason)}
                    </span>
                    {when && (
                      <span className="px-1 py-0.5 text-muted">
                        {when}
                        {r.reviewed_by ? ` · ${r.reviewed_by}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <RestoreButton id={r.id} />
              </li>
            );
          })}
        </ul>
      )}

      {matching.length > MAX_SHOWN && (
        <p className="mt-4 text-xs text-muted">
          Se muestran los {MAX_SHOWN} más recientes de {matching.length}. Usa el buscador para encontrar uno puntual.
        </p>
      )}
    </main>
  );
}
