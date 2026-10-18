import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/admin-stats';
import {
  CLEANUP_VIEWS,
  LONG_PAUSE_DAYS,
  LOW_COMMISSION_CLP,
  RECENT_POST_DAYS,
  analyzeCatalog,
  cleanupView,
  isCleanupView,
  typeCounts,
  type CleanupRow,
  type CleanupView,
} from '@/lib/catalog-cleanup';
import { CleanupList } from './CleanupList';

export const dynamic = 'force-dynamic';

/** Filas que se dibujan por vista: el teléfono no necesita más para decidir. */
const MAX_SHOWN = 100;

const DAY_MS = 86_400_000;

type DbError = { code?: string; message: string } | null;

const COLUMNS =
  'id, slug, name, image_url, price, category, ml_domain_id, ml_root_category, ml_family_id, is_active, inactive_since, inactive_reason, created_at, is_featured';

async function readSignals(admin: SupabaseClient, now: Date) {
  const page = <T,>(build: (from: number, to: number) => unknown) =>
    fetchAllRows<T>((from, to) => build(from, to) as PromiseLike<{ data: unknown; error: DbError }>);
  const [clicks, posts, refresh] = await Promise.all([
    page<{ product_id: string | null }>((from, to) =>
      admin
        .from('outbound_clicks')
        .select('product_id')
        .gte('created_at', new Date(now.getTime() - 30 * DAY_MS).toISOString())
        .order('id', { ascending: true })
        .range(from, to)
    ),
    page<{ product_id: string | null }>((from, to) =>
      admin
        .from('social_posts')
        .select('product_id')
        .neq('status', 'error')
        .gte('posted_at', new Date(now.getTime() - RECENT_POST_DAYS * DAY_MS).toISOString())
        .order('id', { ascending: true })
        .range(from, to)
    ),
    admin
      .from('cron_runs')
      .select('summary')
      .eq('job', 'refresh-prices')
      .eq('ok', true)
      .order('started_at', { ascending: false })
      .limit(1),
  ]);

  const clickCount = new Map<string, number>();
  for (const { product_id } of clicks.rows) {
    if (product_id) clickCount.set(product_id, (clickCount.get(product_id) ?? 0) + 1);
  }
  const summary = ((refresh.data ?? [])[0] as { summary?: { elapsed_ms?: unknown } } | undefined)?.summary;
  return {
    clicks: clickCount,
    recentlyPosted: new Set(posts.rows.map((p) => p.product_id).filter((id): id is string => Boolean(id))),
    warnings: [
      clicks.error ? 'No pude leer los clics: las sugerencias no los están considerando.' : null,
      posts.error ? 'No pude leer lo publicado en redes: revisa antes de sacar algo que hayas publicado.' : null,
    ].filter((w): w is string => Boolean(w)),
    lastRefreshSeconds: typeof summary?.elapsed_ms === 'number' ? Math.round(summary.elapsed_ms / 100) / 10 : null,
  };
}

/**
 * Limpiar el catálogo: lo que se coló al aprobar en bloque, lo que lleva días
 * sin vendedor, lo que casi no deja comisión y los colores repetidos (ver
 * lib/catalog-cleanup). Sacarlo es el mismo borrado lógico de Productos.
 */
export default async function LimpiarPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tipo?: string }>;
}) {
  const sp = await searchParams;
  const view: CleanupView = isCleanupView(sp.vista) ? sp.vista : 'sugeridos';
  const now = new Date();
  const admin = getSupabaseAdmin();

  if (!admin) {
    return <main className="mx-auto max-w-4xl px-4 py-8 text-sm text-red-400">Supabase admin no configurado.</main>;
  }

  const [products, signals] = await Promise.all([
    fetchAllRows<CleanupRow>(
      (from, to) =>
        admin
          .from('products')
          .select(COLUMNS)
          .eq('is_hidden', false)
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
    ),
    readSignals(admin, now),
  ]);

  const items = analyzeCatalog(products.rows, { clicks: signals.clicks, recentlyPosted: signals.recentlyPosted, now });
  const types = typeCounts(items);
  const type = sp.tipo ?? types[0]?.domainId ?? '';
  const counts = Object.fromEntries(
    CLEANUP_VIEWS.map((v) => [v.value, v.value === 'tipo' ? null : cleanupView(items, v.value, now).length])
  );
  const list = cleanupView(items, view, now, type);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <Link href="/admin/productos" className="inline-flex min-h-11 items-center text-sm text-muted hover:text-fg">
        ← Productos
      </Link>
      <h1 className="font-heading text-2xl font-bold text-fg">Limpiar catálogo</h1>
      <p className="mt-1 text-sm text-muted">
        Hay <strong className="text-fg">{items.length.toLocaleString('es-CL')}</strong> productos en el sitio y la
        revisión de precios los mira todos cada 30 minutos
        {signals.lastRefreshSeconds !== null && (
          <>
            {' '}
            (la última tardó <strong className="text-fg">{signals.lastRefreshSeconds.toLocaleString('es-CL')} s</strong>{' '}
            de 60)
          </>
        )}
        . Lo que saques se oculta del sitio y deja de revisarse. No se pierde: lo repones con &quot;Deshacer&quot; o
        desde Productos → Eliminados.
      </p>
      <p className="mt-2 text-xs text-muted">
        Sugeridos: en pausa hace más de {LONG_PAUSE_DAYS} días, menos de ${LOW_COMMISSION_CLP.toLocaleString('es-CL')} de
        comisión por venta, u otro color de un modelo que ya está. Nunca se sugiere lo fijado en la portada, lo que
        tuvo clics este mes ni lo publicado en redes en los últimos {RECENT_POST_DAYS} días.
      </p>
      {products.error && <p className="mt-3 text-sm text-red-400">No se pudo leer el catálogo: {products.error.message}</p>}
      {signals.warnings.map((w) => (
        <p key={w} className="mt-3 text-sm text-amber-400">
          {w}
        </p>
      ))}

      <nav aria-label="Vistas" className="mt-5 flex flex-wrap gap-2">
        {CLEANUP_VIEWS.map((v) => {
          const active = v.value === view;
          const count = counts[v.value];
          return (
            <Link
              key={v.value}
              href={`/admin/productos/limpiar?vista=${v.value}`}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
                active ? 'border-accent bg-accent/10 text-fg' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {v.label}
              {count !== null && <span className="text-[11px] text-muted">{count}</span>}
            </Link>
          );
        })}
      </nav>

      {view === 'tipo' && (
        // Formulario GET: funciona sin JavaScript.
        <form action="/admin/productos/limpiar" method="get" className="mt-3 flex gap-2">
          <input type="hidden" name="vista" value="tipo" />
          <label htmlFor="tipo" className="sr-only">
            Tipo de producto
          </label>
          <select
            id="tipo"
            name="tipo"
            defaultValue={type}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-fg"
          >
            {types.map((t) => (
              <option key={t.domainId} value={t.domainId}>
                {t.label} ({t.count})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="min-h-11 rounded-md border border-border px-4 text-sm font-medium text-fg hover:border-accent"
          >
            Ver
          </button>
        </form>
      )}

      <CleanupList key={`${view}-${type}`} items={list.slice(0, MAX_SHOWN)} total={list.length} view={view} />
    </main>
  );
}
