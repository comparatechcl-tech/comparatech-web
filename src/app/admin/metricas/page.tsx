import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { getCategoryInfo } from '@/lib/categories';
import { formatCLP } from '@/lib/format';
import {
  chileDateKey,
  chileDayStart,
  shiftDateKey,
  weekStartOf,
  type LinkMode,
  type Placement,
} from '@/lib/clicks';
import { AffiliateReportForm, type AffiliateReportRow } from './AffiliateReportForm';

export const dynamic = 'force-dynamic';

/**
 * Métricas de clics hacia Mercado Libre.
 *
 * Las comisiones se ven en la Central de Afiliados hasta 60 días después de
 * la compra; los clics se ven al tiro. Esta página dice qué secciones,
 * categorías y productos mueven gente hacia ML, cuáles no mueven a nadie, y
 * compara los clics propios con los que informa ML para detectar a tiempo
 * si los links dejaron de atribuirse.
 */

const PLACEMENT_LABELS: Record<Placement, string> = {
  'home-ofertas': 'Portada · ofertas',
  'home-nuevos': 'Portada · recién agregados',
  home: 'Portada',
  categoria: 'Categoría',
  ofertas: 'Ofertas',
  buscar: 'Búsqueda',
  ficha: 'Ficha del producto',
  'ficha-sticky': 'Ficha · barra fija',
  alternativas: 'Ficha · alternativas',
  comparador: 'Comparador',
  social: 'Página para redes (/hoy)',
  otro: 'Otro',
};

const LINK_MODE_LABELS: Record<LinkMode, string> = {
  meli_la: 'meli.la (link generado en ML)',
  directo: 'Directo a la ficha',
  otro: 'Otro',
};

/** Páginas de 1.000 filas: el tope por defecto de cada respuesta de Supabase. */
const PAGE_SIZE = 1000;
/** Tope de filas que se agrupan en memoria. Muy lejos del tráfico actual. */
const MAX_ROWS = 50_000;
const DAYS = 30;
const NO_CLICK_DAYS = 14;
const REPORT_WEEKS = 8;

interface ClickRow {
  product_id: string | null;
  placement: string;
  link_mode: string | null;
  src: string | null;
  is_mobile: boolean | null;
  created_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  is_active: boolean;
  is_hidden: boolean;
  created_at: string;
}

type DbError = { code?: string; message: string } | null;

/** Lee todas las filas de a páginas, hasta MAX_ROWS. */
async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<{ rows: T[]; error: DbError; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error, truncated: false };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, error: null, truncated: false };
  }
  return { rows, error: null, truncated: true };
}

async function loadData(admin: SupabaseClient, now: Date) {
  const today = chileDateKey(now);
  const firstDay = shiftDateKey(today, -(DAYS - 1));

  const reportsRes = await admin
    .from('affiliate_reports')
    .select('week_start, ml_clicks, ml_sales, ml_pending_clp, ml_approved_clp, notes')
    .order('week_start', { ascending: false })
    .limit(REPORT_WEEKS);
  const reports = (reportsRes.data ?? []) as AffiliateReportRow[];

  // Se cargan los clics desde lo más antiguo que haga falta: los 30 días de
  // los gráficos o la semana más antigua con reporte de ML a la vista.
  const oldestReport = reports.length > 0 ? reports[reports.length - 1].week_start : null;
  const sinceKey = oldestReport && oldestReport < firstDay ? oldestReport : firstDay;

  const [clicksRes, productsRes, firstClickRes] = await Promise.all([
    fetchAll<ClickRow>((from, to) =>
      admin
        .from('outbound_clicks')
        .select('product_id, placement, link_mode, src, is_mobile, created_at')
        .gte('created_at', chileDayStart(sinceKey).toISOString())
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAll<ProductRow>((from, to) =>
      admin
        .from('products')
        .select('id, name, slug, category, is_active, is_hidden, created_at')
        .order('id', { ascending: true })
        .range(from, to)
    ),
    admin
      .from('outbound_clicks')
      .select('created_at')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    today,
    firstDay,
    reports,
    reportsMissing: isMissingSchemaError(reportsRes.error),
    clicks: clicksRes.rows,
    clicksError: clicksRes.error,
    clicksMissing: isMissingSchemaError(clicksRes.error),
    truncated: clicksRes.truncated,
    products: productsRes.rows,
    firstClickAt: (firstClickRes.data as { created_at: string } | null)?.created_at ?? null,
  };
}

function countBy<K>(items: Iterable<K>): Map<K, number> {
  const out = new Map<K, number>();
  for (const k of items) out.set(k, (out.get(k) ?? 0) + 1);
  return out;
}

function sortedEntries<K>(map: Map<K, number>): [K, number][] {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/** "29/09" a partir de AAAA-MM-DD. */
function dayMonth(dateKey: string): string {
  const [, m, d] = dateKey.split('-');
  return `${d}/${m}`;
}

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
function weekday(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function daysBetween(fromKey: string, toKey: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / 86_400_000);
}

export default async function MetricasPage() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-heading text-2xl font-bold text-fg">Métricas</h1>
        <p className="mt-2 text-sm text-muted">Falta configurar Supabase admin (SUPABASE_SERVICE_ROLE_KEY).</p>
      </main>
    );
  }

  const now = new Date();
  const data = await loadData(admin, now);

  if (data.clicksMissing) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="font-heading text-2xl font-bold text-fg">Métricas</h1>
        <MissingMigration />
      </main>
    );
  }

  const { today, firstDay } = data;
  const productsById = new Map(data.products.map((p) => [p.id, p]));

  // Cada clic con su día en hora de Chile, una sola vez.
  const clicks = data.clicks.map((c) => ({ ...c, day: chileDateKey(new Date(c.created_at)) }));
  const recent = clicks.filter((c) => c.day >= firstDay);

  const total = recent.length;
  const todayCount = recent.filter((c) => c.day === today).length;
  const last7 = recent.filter((c) => c.day >= shiftDateKey(today, -6)).length;
  const mobile = recent.filter((c) => c.is_mobile === true).length;

  // Clics por día: los 30 días aunque alguno tenga cero, para que un día
  // sin clics se vea como un hueco y no desaparezca.
  const perDay = countBy(recent.map((c) => c.day));
  const days = Array.from({ length: DAYS }, (_, i) => shiftDateKey(today, -i));
  const maxDay = Math.max(1, ...days.map((d) => perDay.get(d) ?? 0));

  const byPlacement = sortedEntries(countBy(recent.map((c) => c.placement)));
  const byLinkMode = sortedEntries(countBy(recent.map((c) => c.link_mode ?? 'otro')));
  const bySrc = sortedEntries(countBy(recent.map((c) => c.src ?? 'Directo / sin origen')));
  const byCategory = sortedEntries(
    countBy(
      recent.map((c) => {
        const product = c.product_id ? productsById.get(c.product_id) : undefined;
        if (!product) return 'Producto eliminado';
        return getCategoryInfo(product.category)?.name ?? product.category;
      })
    )
  );

  const byProduct = sortedEntries(countBy(recent.flatMap((c) => (c.product_id ? [c.product_id] : []))));
  const top = byProduct.slice(0, 20);

  // Publicados sin clics: solo los que llevan 14 días o más en el sitio. Uno
  // agregado ayer sin clics no dice nada todavía.
  const noClickFrom = shiftDateKey(today, -(NO_CLICK_DAYS - 1));
  const clickedRecently = new Set(
    clicks.filter((c) => c.day >= noClickFrom && c.product_id).map((c) => c.product_id as string)
  );
  const cutoff = chileDayStart(noClickFrom).getTime();
  const withoutClicks = data.products
    .filter(
      (p) =>
        p.is_active && !p.is_hidden && new Date(p.created_at).getTime() < cutoff && !clickedRecently.has(p.id)
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const publishedCount = data.products.filter((p) => p.is_active && !p.is_hidden).length;

  const firstClickDay = data.firstClickAt ? chileDateKey(new Date(data.firstClickAt)) : null;
  const measuringDays = firstClickDay ? daysBetween(firstClickDay, today) + 1 : 0;

  // Clics propios por semana (lunes a domingo, hora de Chile), para cruzar
  // con lo que informa ML.
  const perWeek = countBy(clicks.map((c) => weekStartOf(c.day) ?? c.day));
  const currentWeek = weekStartOf(today) ?? today;
  const defaultWeek = shiftDateKey(currentWeek, -7);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Métricas</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Clics en &quot;Ver en Mercado Libre&quot; de los últimos {DAYS} días (uno por producto y por visita). Las
        comisiones tardan hasta 60 días en verse en ML; los clics se ven al tiro y avisan antes si algo cambió.
      </p>

      {data.clicksError && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          No se pudieron leer los clics: {data.clicksError.message}
        </p>
      )}
      {data.truncated && (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          Hay más de {MAX_ROWS.toLocaleString('es-CL')} clics en el período: se muestran los primeros.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Hoy" value={todayCount} />
        <Stat label="Últimos 7 días" value={last7} />
        <Stat label={`Últimos ${DAYS} días`} value={total} />
        <Stat label="Desde celular" value={pct(mobile, total)} />
      </div>

      {firstClickDay === null ? (
        <p className="mt-8 rounded-xl border border-border bg-surface p-5 text-sm text-muted">
          Todavía no hay clics registrados. Se empiezan a contar apenas alguien toca &quot;Ver en Mercado Libre&quot; en
          el sitio.
        </p>
      ) : (
        <>
          <Section title="Clics por día">
            <table className="w-full text-sm">
              <tbody>
                {days.map((d) => {
                  const n = perDay.get(d) ?? 0;
                  return (
                    <tr key={d} className="border-b border-border/50 last:border-0">
                      <td className="w-20 py-1 pr-3 text-xs text-muted">
                        {weekday(d)} {dayMonth(d)}
                      </td>
                      <td className="py-1">
                        <div className="h-2.5 rounded-full bg-surface2">
                          <div
                            className="h-2.5 rounded-full bg-accent"
                            style={{ width: `${(n / maxDay) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="w-12 py-1 pl-3 text-right tabular-nums text-fg">{n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Por sección del sitio">
              <BreakdownTable
                rows={byPlacement.map(([k, n]) => [PLACEMENT_LABELS[k as Placement] ?? k, n])}
                total={total}
              />
            </Section>
            <Section title="Por categoría">
              <BreakdownTable rows={byCategory} total={total} />
            </Section>
            <Section title="Por tipo de link">
              <BreakdownTable
                rows={byLinkMode.map(([k, n]) => [LINK_MODE_LABELS[k as LinkMode] ?? k, n])}
                total={total}
              />
            </Section>
            <Section
              title="Por origen de la visita"
              hint="Sale de ?src= o utm_source en el link con el que llegó la persona (por ejemplo ?src=telegram)."
            >
              <BreakdownTable rows={bySrc} total={total} />
            </Section>
          </div>

          <Section title="Productos con más clics">
            {top.length === 0 ? (
              <p className="text-sm text-muted">Sin clics en el período.</p>
            ) : (
              <ol className="divide-y divide-border/50 text-sm">
                {top.map(([id, n], i) => {
                  const p = productsById.get(id);
                  return (
                    <li key={id} className="flex items-center gap-3 py-2">
                      <span className="w-6 text-right text-xs text-muted">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-fg">
                        {p ? (
                          <Link href={`/producto/${p.slug}`} target="_blank" className="hover:text-accent">
                            {p.name}
                          </Link>
                        ) : (
                          'Producto eliminado'
                        )}
                      </span>
                      {p && !(p.is_active && !p.is_hidden) && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                          fuera del sitio
                        </span>
                      )}
                      <span className="tabular-nums text-fg">{n}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>

          <Section
            title={`Publicados sin clics en ${NO_CLICK_DAYS} días (${withoutClicks.length} de ${publishedCount})`}
            hint="Productos publicados hace más de 14 días que nadie abrió en Mercado Libre. Revisa precio, foto y nombre, o si conviene reemplazarlos."
          >
            {measuringDays < NO_CLICK_DAYS && (
              <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                La medición empezó hace {measuringDays} {measuringDays === 1 ? 'día' : 'días'}: esta lista es confiable
                recién a los {NO_CLICK_DAYS} días.
              </p>
            )}
            {withoutClicks.length === 0 ? (
              <p className="text-sm text-muted">Todos los productos publicados tuvieron al menos un clic.</p>
            ) : (
              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {withoutClicks.slice(0, 60).map((p) => (
                  <li key={p.id} className="truncate">
                    <Link href={`/producto/${p.slug}`} target="_blank" className="text-muted hover:text-accent">
                      {p.name}
                    </Link>
                  </li>
                ))}
                {withoutClicks.length > 60 && (
                  <li className="text-xs text-muted">y {withoutClicks.length - 60} más</li>
                )}
              </ul>
            )}
          </Section>
        </>
      )}

      <section className="mt-10 rounded-xl border border-border bg-surface p-5">
        <h2 className="font-heading text-lg font-semibold text-fg">Datos de la Central de Afiliados</h2>
        <p className="mt-1 text-sm text-muted">
          Una vez por semana, copia desde la Central de Afiliados de Mercado Libre los clics, las ventas y las
          comisiones de la semana anterior.
        </p>

        {data.reportsMissing ? (
          <MissingMigration />
        ) : (
          <>
            {data.reports.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">Semana</th>
                      <th className="py-2 pr-3 text-right font-medium">Clics propios</th>
                      <th className="py-2 pr-3 text-right font-medium">Clics ML</th>
                      <th className="py-2 pr-3 text-right font-medium">ML vs propios</th>
                      <th className="py-2 pr-3 text-right font-medium">Ventas</th>
                      <th className="py-2 pr-3 text-right font-medium">Comisión</th>
                      <th className="py-2 text-right font-medium">Ganancia por clic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reports.map((r) => {
                      const own = perWeek.get(r.week_start) ?? 0;
                      const commission =
                        r.ml_pending_clp === null && r.ml_approved_clp === null
                          ? null
                          : (r.ml_pending_clp ?? 0) + (r.ml_approved_clp ?? 0);
                      const measured = firstClickDay !== null && shiftDateKey(r.week_start, 6) >= firstClickDay;
                      return (
                        <tr key={r.week_start} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pr-3 text-fg">
                            {dayMonth(r.week_start)} – {dayMonth(shiftDateKey(r.week_start, 6))}
                            {r.week_start === currentWeek && <span className="ml-1 text-xs text-muted">(en curso)</span>}
                            {r.notes && <span className="block text-xs text-muted">{r.notes}</span>}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-fg">{measured ? own : '—'}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-fg">{r.ml_clicks ?? '—'}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-fg">
                            {measured && own > 0 && r.ml_clicks !== null ? pct(r.ml_clicks, own) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-fg">{r.ml_sales ?? '—'}</td>
                          <td className="py-2 pr-3 text-right tabular-nums text-fg">
                            {commission === null ? '—' : formatCLP(commission)}
                            {r.ml_pending_clp !== null && r.ml_pending_clp > 0 && (
                              <span className="block text-[10px] text-muted">
                                {formatCLP(r.ml_pending_clp)} pendiente
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right tabular-nums text-fg">
                            {measured && own > 0 && commission !== null ? formatCLP(Math.round(commission / own)) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-3 space-y-1 text-xs text-muted">
                  <p>
                    <strong className="text-fg">Ganancia por clic</strong>: comisión (pendiente + aprobada) dividida por
                    los clics propios de esa semana.
                  </p>
                  <p>
                    <strong className="text-fg">ML vs propios</strong>: clics que cuenta ML como porcentaje de los
                    nuestros. Si cae de golpe de una semana a otra, revisa los links. Comparación orientativa: ML también
                    cuenta aperturas de meli.la hechas por el servidor y no prueba atribución.
                  </p>
                </div>
              </div>
            )}

            <AffiliateReportForm reports={data.reports} defaultWeek={defaultWeek} />
          </>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-heading text-2xl font-bold tabular-nums text-fg">
        {typeof value === 'number' ? value.toLocaleString('es-CL') : value}
      </p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-heading text-base font-semibold text-fg">{title}</h2>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BreakdownTable({ rows, total }: { rows: [string, number][]; total: number }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Sin clics en el período.</p>;
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([label, n]) => (
          <tr key={label} className="border-b border-border/50 last:border-0">
            <td className="py-1.5 pr-3">
              <span className="block truncate text-fg">{label}</span>
              <div className="mt-1 h-1.5 rounded-full bg-surface2">
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </td>
            <td className="w-12 py-1.5 text-right align-top tabular-nums text-fg">{n}</td>
            <td className="w-12 py-1.5 text-right align-top text-xs text-muted">{pct(n, total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MissingMigration() {
  return (
    <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-400">
      <p className="font-semibold">Aplica la migración 0015</p>
      <p className="mt-1">
        La medición de clics necesita dos tablas nuevas. En Supabase, abre el <strong>SQL Editor</strong>, pega el
        contenido de <code>supabase/migrations/0015_clics.sql</code> y ejecútalo. Mientras tanto el sitio funciona
        igual; solo que los clics no se guardan.
      </p>
    </div>
  );
}
