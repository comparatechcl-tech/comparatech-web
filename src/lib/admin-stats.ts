import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { isMeliLaUrl } from '@/lib/outbound';
import { chileDateKey, chileDayStart, shiftDateKey, startOfChileDay } from '@/lib/clicks';

/**
 * Números del panel "Resumen" del admin (/admin) y del contador de la
 * pestaña Problemas.
 *
 * Cada lectura devuelve {data, error} y nunca lanza: si una consulta falla,
 * el panel tiene que mostrar "—" y un aviso, no un 0. Un 0 por error se lee
 * como "todo al día" y así se pierden semanas sin publicar o links rotos
 * que no cobran comisión.
 *
 * Las tablas opcionales (cron_runs, outbound_clicks) se marcan con
 * `missing` cuando la migración todavía no está aplicada: no es un error de
 * la base, es algo que falta activar.
 *
 * Sin 'server-only' a propósito: los tests lo importan directo. Igual solo
 * lo usan componentes de servidor, que son los que tienen el cliente admin.
 */

export interface Stat<T> {
  data: T | null;
  error: string | null;
  /** La tabla o columna no existe todavía (migración sin aplicar). */
  missing?: boolean;
}

type DbError = { code?: string; message: string } | null;

function ok<T>(data: T): Stat<T> {
  return { data, error: null };
}

function fail<T>(error: DbError | string): Stat<T> {
  const message = (typeof error === 'string' ? error : error?.message) || 'error desconocido';
  return { data: null, error: message };
}

function missing<T>(): Stat<T> {
  return { data: null, error: null, missing: true };
}

const NO_ADMIN = 'Supabase admin no configurado';

// ---------------------------------------------------------------------------
// Lectura paginada
// ---------------------------------------------------------------------------

/** El tope por defecto de cada respuesta de PostgREST. */
const PAGE_SIZE = 1000;
/** Muy por encima del catálogo actual (~130 productos); evita un bucle infinito. */
const MAX_ROWS = 20_000;

/**
 * Lee todas las filas de a páginas. Sin esto, a partir de 1.000 productos o
 * candidatos los números quedarían cortados sin aviso.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>
): Promise<{ rows: T[]; error: DbError }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { rows, error };
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return { rows, error: null };
}

// ---------------------------------------------------------------------------
// Productos: cálculos puros sobre las filas
// ---------------------------------------------------------------------------

export interface ProductStatRow {
  id: string;
  name?: string;
  category?: string;
  affiliate_url: string | null;
  is_active: boolean;
  is_hidden?: boolean;
  inactive_reason: string | null;
  inactive_since?: string | null;
  ml_product_id: string | null;
  link_target_product_id: string | null;
  link_checked_at?: string | null;
  price_checked_at?: string | null;
}

/** Las columnas que necesitan el resumen y el contador de Problemas. */
export const PRODUCT_STAT_COLUMNS =
  'id, name, category, affiliate_url, is_active, is_hidden, inactive_reason, inactive_since, ml_product_id, link_target_product_id, link_checked_at, price_checked_at';

/**
 * Productos no ocultos. Los ocultos (o borrados) son una decisión tomada:
 * no cuentan como publicados ni como problemas.
 */
export async function readProductStatRows<T extends ProductStatRow = ProductStatRow>(
  admin: SupabaseClient | null,
  columns: string = PRODUCT_STAT_COLUMNS
): Promise<Stat<T[]>> {
  if (!admin) return fail(NO_ADMIN);
  try {
    const { rows, error } = await fetchAllRows<T>((from, to) =>
      admin
        .from('products')
        .select(columns)
        .eq('is_hidden', false)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
    );
    if (error) return fail(error);
    return ok(rows);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Publicados: activos (el cron los ve con vendedor) y no ocultos. */
export function countPublished(rows: Pick<ProductStatRow, 'is_active' | 'is_hidden'>[]): number {
  return rows.filter((r) => r.is_active && !r.is_hidden).length;
}

/**
 * El mismo link para dos productos distintos: uno de los dos lleva al
 * comprador a la ficha equivocada. Se compara sin espacios ni "/" final, que
 * es como suelen variar los links pegados a mano.
 */
export function normalizeLink(url: string | null | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

export interface DuplicateLinkGroup<T> {
  url: string;
  products: T[];
}

export function findDuplicateLinkGroups<T extends Pick<ProductStatRow, 'id' | 'affiliate_url'>>(
  rows: T[]
): DuplicateLinkGroup<T>[] {
  const byUrl = new Map<string, T[]>();
  for (const row of rows) {
    const url = normalizeLink(row.affiliate_url);
    if (!url) continue;
    const list = byUrl.get(url);
    if (list) list.push(row);
    else byUrl.set(url, [row]);
  }
  return [...byUrl.entries()]
    .filter(([, products]) => products.length > 1)
    .map(([url, products]) => ({ url, products }));
}

/**
 * Activo sin link meli.la guardado: hoy se publica con un link directo (o
 * con la ficha pelada). Si los links directos se apagan o ML no los
 * atribuye, ese producto no tiene un link que pague comisión.
 */
export function lacksBackupLink(row: Pick<ProductStatRow, 'is_active' | 'affiliate_url'>): boolean {
  return row.is_active && !isMeliLaUrl(row.affiliate_url ?? '');
}

/** El link de afiliado abre otra ficha distinta a la publicada. */
export function pointsToOtherProduct(row: Pick<ProductStatRow, 'link_target_product_id' | 'ml_product_id'>): boolean {
  return Boolean(row.link_target_product_id) && row.link_target_product_id !== row.ml_product_id;
}

export function needsNewLink(row: Pick<ProductStatRow, 'is_active' | 'inactive_reason'>): boolean {
  return !row.is_active && row.inactive_reason === 'link_otro_producto';
}

/**
 * Productos que piden que alguien haga algo: link que lleva a otro
 * producto, link repetido o sin meli.la de respaldo. Los que están en pausa
 * porque ML no tiene vendedor NO cuentan: vuelven solos, y contarlos hacía
 * que la pestaña marcara 20 cuando solo 2 necesitaban algo.
 *
 * Se cuenta cada producto una vez aunque tenga más de un problema.
 */
export function actionNeededIds(rows: ProductStatRow[]): Set<string> {
  const visible = rows.filter((r) => !r.is_hidden);
  const ids = new Set<string>();
  for (const row of visible) {
    if (needsNewLink(row) || lacksBackupLink(row)) ids.add(row.id);
  }
  for (const group of findDuplicateLinkGroups(visible)) {
    for (const p of group.products) ids.add(p.id);
  }
  return ids;
}

export interface ActionBreakdown {
  /** Productos distintos que piden acción (uno con dos problemas cuenta una vez). */
  total: number;
  linkNuevo: number;
  /** Productos (no grupos) que comparten link con otro. */
  repetidos: number;
  sinRespaldo: number;
}

export function actionBreakdown(rows: ProductStatRow[]): ActionBreakdown {
  const visible = rows.filter((r) => !r.is_hidden);
  return {
    total: actionNeededIds(visible).size,
    linkNuevo: visible.filter(needsNewLink).length,
    repetidos: findDuplicateLinkGroups(visible).reduce((n, g) => n + g.products.length, 0),
    sinRespaldo: visible.filter(lacksBackupLink).length,
  };
}

/** Activos cuyo link todavía no se abrió para comprobar a qué ficha lleva. */
export function countUncheckedLinks(rows: Pick<ProductStatRow, 'is_active' | 'link_checked_at'>[]): number {
  return rows.filter((r) => r.is_active && !r.link_checked_at).length;
}

/** El instante más reciente de una lista de fechas ISO, o null. */
export function latestIso(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const v of values) {
    if (!v) continue;
    const ms = new Date(v).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = v;
    }
  }
  return best;
}

export function minutesSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor((now.getTime() - ms) / 60_000));
}

/**
 * Días de calendario (hora de Chile) entre la fecha y hoy. Algo aprobado
 * ayer a las 23:50 lleva "1 día", no 0, que es como lo cuenta la dueña.
 */
export function chileDaysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const toUtcDay = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diff = Math.round((toUtcDay(chileDateKey(now)) - toUtcDay(chileDateKey(date))) / 86_400_000);
  return Math.max(0, diff);
}

// ---------------------------------------------------------------------------
// Cobertura por categoría
// ---------------------------------------------------------------------------

export interface CategoryCoverage {
  category: string;
  publicados: number;
  pendientes: number;
}

/**
 * Publicados y candidatos por revisar de cada categoría, de la que tiene
 * más movimiento a la que menos. Muestra dónde el sitio está flaco y dónde
 * hay material esperando.
 */
export function buildCoverage(
  products: Pick<ProductStatRow, 'is_active' | 'is_hidden' | 'category'>[],
  pending: { category: string | null }[]
): CategoryCoverage[] {
  const map = new Map<string, CategoryCoverage>();
  const get = (category: string) => {
    let entry = map.get(category);
    if (!entry) {
      entry = { category, publicados: 0, pendientes: 0 };
      map.set(category, entry);
    }
    return entry;
  };
  for (const p of products) {
    if (p.is_active && !p.is_hidden && p.category) get(p.category).publicados += 1;
  }
  for (const c of pending) {
    if (c.category) get(c.category).pendientes += 1;
  }
  return [...map.values()].sort(
    (a, b) => b.publicados + b.pendientes - (a.publicados + a.pendientes) || a.category.localeCompare(b.category)
  );
}

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

export interface CandidateStats {
  porRevisar: number;
  nuevosHoy: number;
  /** Por revisar, sin tocar, para la cobertura por categoría. */
  pending: { category: string | null; prospected_at: string | null }[];
}

/** Candidatos por revisar y cuántos entraron hoy (hora de Chile). */
export async function readCandidateStats(admin: SupabaseClient | null, now: Date): Promise<Stat<CandidateStats>> {
  if (!admin) return fail(NO_ADMIN);
  try {
    const { rows, error } = await fetchAllRows<{ category: string | null; prospected_at: string | null }>(
      (from, to) =>
        admin
          .from('product_candidates')
          .select('category, prospected_at')
          .eq('status', 'pending_review')
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
    );
    if (error) return fail(error);
    const todayStart = startOfChileDay(now).getTime();
    const nuevosHoy = rows.filter((r) => r.prospected_at && new Date(r.prospected_at).getTime() >= todayStart).length;
    return ok({ porRevisar: rows.length, nuevosHoy, pending: rows });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export interface LastApproval {
  /** null si nunca se aprobó nada. */
  days: number | null;
  at: string | null;
}

/** Días desde el último candidato aprobado (= el último producto publicado a mano). */
export async function readDaysSinceLastApproval(
  admin: SupabaseClient | null,
  now: Date
): Promise<Stat<LastApproval>> {
  if (!admin) return fail(NO_ADMIN);
  try {
    const { data, error } = await admin
      .from('product_candidates')
      .select('reviewed_at')
      .eq('status', 'approved')
      .not('reviewed_at', 'is', null)
      .order('reviewed_at', { ascending: false })
      .limit(1);
    if (error) return fail(error);
    const at = ((data ?? [])[0] as { reviewed_at?: string | null } | undefined)?.reviewed_at ?? null;
    return ok({ days: chileDaysSince(at, now), at });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Bitácora de crons (cron_runs, migración 0018): prospección y correo
// ---------------------------------------------------------------------------

export interface CronRunRow {
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  summary: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Últimas corridas de la prospección. `missing` si la tabla no existe. */
export async function readProspectRuns(admin: SupabaseClient | null, limit = 10): Promise<Stat<CronRunRow[]>> {
  if (!admin) return fail(NO_ADMIN);
  try {
    const { data, error } = await admin
      .from('cron_runs')
      .select('started_at, finished_at, ok, summary')
      .eq('job', 'prospect')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) return isMissingSchemaError(error) ? missing() : fail(error);
    return ok((data ?? []) as CronRunRow[]);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export type DigestStatus = 'enviado' | 'fallo' | 'sin_datos';

export interface DigestInfo {
  status: DigestStatus;
  at: string | null;
}

/**
 * Cómo salió el último correo diario, según lo que anotó la prospección en
 * summary.digest. Las corridas de prueba (dry run) no mandan correo y se
 * saltan.
 */
export function digestFromRuns(runs: CronRunRow[]): DigestInfo {
  for (const run of runs) {
    const digest = asRecord(asRecord(run.summary)?.digest);
    if (!digest || typeof digest.ok !== 'boolean') continue;
    if (digest.skipped) continue;
    return { status: digest.ok ? 'enviado' : 'fallo', at: run.finished_at ?? run.started_at };
  }
  return { status: 'sin_datos', at: null };
}

export interface ProspectInfo {
  at: string;
  /** null si no se sabe cuántos entraron. */
  nuevos: number | null;
  source: 'cron_runs' | 'candidatos';
}

/** La corrida exitosa más reciente con su cantidad de candidatos nuevos. */
export function prospectFromRuns(runs: CronRunRow[]): ProspectInfo | null {
  for (const run of runs) {
    if (run.ok !== true) continue;
    const summary = asRecord(run.summary);
    const inserted = summary?.inserted;
    return {
      at: run.finished_at ?? run.started_at,
      nuevos: typeof inserted === 'number' ? inserted : null,
      source: 'cron_runs',
    };
  }
  return null;
}

/**
 * Margen para contar como "de la misma corrida" los candidatos que entraron
 * junto al último. Hoy entran todos en un mismo upsert, con la misma hora
 * exacta; el margen cubre una corrida que inserte en más de una tanda.
 */
const SAME_RUN_WINDOW_MS = 10 * 60_000;

/**
 * Última prospección. Con la bitácora se usa la última corrida que terminó
 * bien; sin ella (o sin corridas), la fecha del candidato más reciente.
 */
export async function readLastProspect(
  admin: SupabaseClient | null,
  runs: Stat<CronRunRow[]>
): Promise<Stat<ProspectInfo | null>> {
  const fromRuns = runs.data ? prospectFromRuns(runs.data) : null;
  if (fromRuns) return ok(fromRuns);
  if (!admin) return fail(NO_ADMIN);
  try {
    const { data, error } = await admin
      .from('product_candidates')
      .select('prospected_at')
      .order('prospected_at', { ascending: false })
      .limit(1);
    if (error) return fail(error);
    const at = ((data ?? [])[0] as { prospected_at?: string | null } | undefined)?.prospected_at ?? null;
    if (!at) return ok(null);

    const since = new Date(new Date(at).getTime() - SAME_RUN_WINDOW_MS).toISOString();
    const counted = await admin
      .from('product_candidates')
      .select('id', { count: 'exact', head: true })
      .gte('prospected_at', since);
    if (counted.error) return fail(counted.error);
    return ok({ at, nuevos: counted.count ?? null, source: 'candidatos' });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Clics hacia Mercado Libre (outbound_clicks, migración 0015)
// ---------------------------------------------------------------------------

export interface ClickCounts {
  hoy: number;
  ultimos7: number;
}

/** Clics de hoy y de los últimos 7 días (hoy incluido), en hora de Chile. */
export async function readClickCounts(admin: SupabaseClient | null, now: Date): Promise<Stat<ClickCounts>> {
  if (!admin) return fail(NO_ADMIN);
  const today = chileDateKey(now);
  const count = (sinceKey: string) =>
    admin
      .from('outbound_clicks')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', chileDayStart(sinceKey).toISOString());
  try {
    // Un conteo con head:true no sirve para saber si la tabla existe:
    // supabase-js convierte el 404 del HEAD en un éxito con count null, sin
    // error. Una lectura normal de una fila sí trae el código PGRST205.
    const probe = await admin.from('outbound_clicks').select('id').limit(1);
    if (probe.error) return isMissingSchemaError(probe.error) ? missing() : fail(probe.error);

    const [hoy, semana] = await Promise.all([count(today), count(shiftDateKey(today, -6))]);
    const error = hoy.error ?? semana.error;
    if (error) return isMissingSchemaError(error) ? missing() : fail(error);
    if (hoy.count === null || semana.count === null) return fail('la base no devolvió el conteo de clics');
    return ok({ hoy: hoy.count, ultimos7: semana.count });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Todo junto, para /admin
// ---------------------------------------------------------------------------

export interface AdminSummary {
  publicados: Stat<number>;
  porRevisar: Stat<number>;
  nuevosHoy: Stat<number>;
  diasSinPublicar: Stat<LastApproval>;
  requierenAccion: Stat<ActionBreakdown>;
  linksSinVerificar: Stat<number>;
  coberturaPorCategoria: Stat<CategoryCoverage[]>;
  ultimoPrecioMin: Stat<number | null>;
  ultimaProspeccion: Stat<ProspectInfo | null>;
  correoAyer: Stat<DigestInfo>;
  clics: Stat<ClickCounts>;
  linksRepetidos: Stat<DuplicateLinkGroup<ProductStatRow>[]>;
  /** Mensajes de las consultas que fallaron, sin repetir, para el aviso rojo. */
  errors: string[];
}

function derive<T, R>(source: Stat<T>, fn: (data: T) => R): Stat<R> {
  if (source.data === null) return { data: null, error: source.error, missing: source.missing };
  return ok(fn(source.data));
}

export async function readAdminSummary(admin: SupabaseClient | null, now: Date = new Date()): Promise<AdminSummary> {
  const [products, candidates, lastApproval, runs, clics] = await Promise.all([
    readProductStatRows(admin),
    readCandidateStats(admin, now),
    readDaysSinceLastApproval(admin, now),
    readProspectRuns(admin),
    readClickCounts(admin, now),
  ]);
  const ultimaProspeccion = await readLastProspect(admin, runs);

  const coberturaPorCategoria: Stat<CategoryCoverage[]> =
    products.data && candidates.data
      ? ok(buildCoverage(products.data, candidates.data.pending))
      : fail(products.error ?? candidates.error ?? 'error desconocido');

  const correoAyer: Stat<DigestInfo> = runs.missing
    ? { data: { status: 'sin_datos', at: null }, error: null, missing: true }
    : derive(runs, digestFromRuns);

  const summary: Omit<AdminSummary, 'errors'> = {
    publicados: derive(products, countPublished),
    porRevisar: derive(candidates, (c) => c.porRevisar),
    nuevosHoy: derive(candidates, (c) => c.nuevosHoy),
    diasSinPublicar: lastApproval,
    requierenAccion: derive(products, actionBreakdown),
    linksSinVerificar: derive(products, countUncheckedLinks),
    coberturaPorCategoria,
    ultimoPrecioMin: derive(products, (rows) => minutesSince(latestIso(rows.map((r) => r.price_checked_at)), now)),
    ultimaProspeccion,
    correoAyer,
    clics,
    linksRepetidos: derive(products, findDuplicateLinkGroups),
  };

  const errors = [
    ...new Set(
      [products, candidates, lastApproval, runs, clics, ultimaProspeccion]
        .map((s) => s.error)
        .filter((e): e is string => Boolean(e))
    ),
  ];
  return { ...summary, errors };
}

/**
 * El número de la pestaña Problemas. null si la base falló: la pestaña
 * prefiere no mostrar nada antes que un 0 que diga "todo bien".
 */
export async function readActionNeededCount(admin: SupabaseClient | null): Promise<number | null> {
  const products = await readProductStatRows(
    admin,
    'id, affiliate_url, is_active, is_hidden, inactive_reason, ml_product_id, link_target_product_id'
  );
  if (!products.data) {
    if (products.error && products.error !== NO_ADMIN) console.error(`[admin-stats] ${products.error}`);
    return null;
  }
  return actionNeededIds(products.data).size;
}
