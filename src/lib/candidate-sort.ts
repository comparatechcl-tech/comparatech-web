import { commissionRate, estimateCommission } from '@/lib/commission';
import { stripDiacritics } from '@/lib/text';
import type { ProductCandidate } from '@/lib/types';

/**
 * Cola de candidatos en "modo tanda": filtros, orden, agrupación por
 * familia y paginación, todo en memoria.
 *
 * Antes la cola se mostraba entera y en orden de llegada: con 200 candidatos
 * revisarla tomaba más de una hora y lo que más paga quedaba al fondo. Con
 * tandas de 30 ordenadas por comisión estimada, lo primero que se publica es
 * lo que más deja.
 *
 * Se hace en memoria y no en la consulta porque el orden por comisión
 * depende de la categoría raíz (lib/commission) y la agrupación por familia
 * necesita ver todos los colores a la vez. Son unos cientos de filas
 * livianas: no pesa.
 *
 * Sin imports del servidor: lo usan también componentes de cliente.
 */

/** Tamaño de una tanda: lo que se revisa cómodo de una sentada. */
export const PAGE_SIZE = 30;

/**
 * Tope de "Aprobar todo el filtro": 10 tandas seguidas, un par de minutos
 * con la pestaña abierta. Con más, se repite sobre lo que quede.
 */
export const MAX_APPROVE_ALL = 300;

/** Supabase devuelve como máximo 1000 filas por consulta (max-rows de PostgREST). */
export const SUPABASE_PAGE = 1000;

/** Columnas que existen desde siempre. */
export const BASE_CANDIDATE_COLUMNS =
  'id, ml_product_id, ml_family_id, name, brand, category, price, original_price, image_url, seller_nickname, seller_reputation, seller_sales_count, prospected_at';

/**
 * Columnas que agrega otra migración (posición en destacados, raíz, Full,
 * tienda oficial). Si todavía no existen, se lee sin ellas y la cola sigue
 * funcionando: solo se pierde el desempate por "más vendidos" y las
 * insignias.
 */
export const OPTIONAL_CANDIDATE_COLUMNS =
  'highlight_position, highlight_category_id, ml_root_category, is_full, official_store';

export type CandidateRow = Pick<
  ProductCandidate,
  | 'id'
  | 'ml_product_id'
  | 'ml_family_id'
  | 'name'
  | 'brand'
  | 'category'
  | 'price'
  | 'original_price'
  | 'image_url'
  | 'seller_nickname'
  | 'seller_reputation'
  | 'seller_sales_count'
  | 'prospected_at'
> &
  Partial<
    Pick<
      ProductCandidate,
      'highlight_position' | 'highlight_category_id' | 'ml_root_category' | 'is_full' | 'official_store'
    >
  >;

/** Un modelo: el color más barato representa a los demás. */
export interface CandidateGroup extends CandidateRow {
  siblings: CandidateRow[];
}

// ─── Filtros ───────────────────────────────────────────────────────────────

export type PriceBucket = 'hasta20' | '20a100' | '100a300' | 'sobre300';
export type DiscountMin = '10' | '20' | '30';
export type Arrival = 'hoy' | '3d' | 'antiguos';
export type CandidateSort = 'valor' | 'descuento' | 'vendidos' | 'nuevos' | 'precio_asc';

export interface CandidateFilters {
  cat?: string;
  precio?: PriceBucket;
  desc?: DiscountMin;
  ingreso?: Arrival;
  q?: string;
}

export const PRICE_OPTIONS: { value: PriceBucket; label: string }[] = [
  { value: 'hasta20', label: 'Menos de $20.000' },
  { value: '20a100', label: '$20.000 a $100.000' },
  { value: '100a300', label: '$100.000 a $300.000' },
  { value: 'sobre300', label: 'Más de $300.000' },
];

export const DISCOUNT_OPTIONS: { value: DiscountMin; label: string }[] = [
  { value: '10', label: '10% o más' },
  { value: '20', label: '20% o más' },
  { value: '30', label: '30% o más' },
];

export const ARRIVAL_OPTIONS: { value: Arrival; label: string }[] = [
  { value: 'hoy', label: 'Hoy' },
  { value: '3d', label: 'Últimos 3 días' },
  { value: 'antiguos', label: 'Más antiguos' },
];

export const SORT_OPTIONS: { value: CandidateSort; label: string }[] = [
  { value: 'valor', label: 'Mayor comisión estimada' },
  { value: 'descuento', label: 'Mayor descuento' },
  { value: 'vendidos', label: 'Más vendidos en ML' },
  { value: 'nuevos', label: 'Más nuevos' },
  { value: 'precio_asc', label: 'Precio menor a mayor' },
];

/** Motivos de rechazo en un toque. Se guardan en product_candidates.reject_reason. */
export const REJECT_REASONS = [
  { value: 'no_es_tecnologia', label: 'No es tecnología' },
  { value: 'muy_barato', label: 'Muy barato' },
  { value: 'accesorio', label: 'Accesorio o repuesto' },
  { value: 'duplicado', label: 'Duplicado' },
  { value: 'precio_alto_hoy', label: 'Precio alto hoy' },
  { value: 'precio_o_vendedor_raro', label: 'Precio o vendedor raro' },
  { value: 'otro', label: 'Otro' },
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number]['value'];

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === 'string' && REJECT_REASONS.some((r) => r.value === value);
}

/** Los rechazos de antes de la migración 0014 no tienen motivo. */
export function rejectReasonLabel(value: string | null | undefined): string {
  return REJECT_REASONS.find((r) => r.value === value)?.label ?? 'Motivo no registrado';
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pick<T extends string>(value: unknown, options: readonly { value: T }[]): T | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return options.find((o) => o.value === v)?.value;
}

/** Lee filtros, orden y página desde los searchParams de la URL. */
export function parseCandidateQuery(sp: Record<string, string | string[] | undefined>): {
  filters: CandidateFilters;
  sort: CandidateSort;
  page: number;
} {
  const first = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const page = Number.parseInt(first('p') ?? '1', 10);
  return {
    filters: {
      cat: first('cat'),
      precio: pick(first('precio'), PRICE_OPTIONS),
      desc: pick(first('desc'), DISCOUNT_OPTIONS),
      ingreso: pick(first('ingreso'), ARRIVAL_OPTIONS),
      q: first('q')?.slice(0, 100),
    },
    sort: pick(first('orden'), SORT_OPTIONS) ?? 'valor',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Descuento en porcentaje entero; 0 si no hay precio de antes o no es mayor. */
export function discountPct(row: Pick<CandidateRow, 'price' | 'original_price'>): number {
  const original = row.original_price;
  if (!original || original <= row.price || row.price <= 0) return 0;
  return Math.round(((original - row.price) / original) * 100);
}

/**
 * Comisión de una venta directa. Sin raíz conocida se asume 7% (la tasa de
 * tecnología, la más baja): mejor subestimar que prometer de más.
 */
export function candidateCommission(row: Pick<CandidateRow, 'price' | 'ml_root_category'>): {
  amount: number;
  rate: number;
  assumed: boolean;
} {
  const root = row.ml_root_category ?? null;
  const rate = commissionRate(root);
  return { amount: estimateCommission(row.price, root), rate: rate.direct, assumed: rate.source === 'asumido' };
}

function normalize(text: string): string {
  return stripDiacritics(text.toLowerCase());
}

function matchesPrice(price: number, bucket: PriceBucket): boolean {
  switch (bucket) {
    case 'hasta20':
      return price < 20_000;
    case '20a100':
      return price >= 20_000 && price < 100_000;
    case '100a300':
      return price >= 100_000 && price < 300_000;
    case 'sobre300':
      return price >= 300_000;
  }
}

function matchesArrival(prospectedAt: string, arrival: Arrival, now: Date): boolean {
  const at = new Date(prospectedAt).getTime();
  if (Number.isNaN(at)) return arrival === 'antiguos';
  const threeDaysAgo = now.getTime() - 3 * DAY_MS;
  switch (arrival) {
    case 'hoy':
      return at >= startOfTodayChile(now).getTime();
    case '3d':
      return at >= threeDaysAgo;
    case 'antiguos':
      return at < threeDaysAgo;
  }
}

/** Busca cada palabra en nombre, marca o MLC, sin importar tildes ni mayúsculas. */
export function matchesSearch(
  row: Pick<CandidateRow, 'name' | 'brand' | 'ml_product_id'>,
  q: string | undefined
): boolean {
  const words = normalize(q ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(`${row.name} ${row.brand ?? ''} ${row.ml_product_id}`);
  return words.every((w) => haystack.includes(w));
}

type FacetKey = 'cat' | 'precio' | 'desc' | 'ingreso';

export function matchesFilters(
  row: CandidateRow,
  filters: CandidateFilters,
  now: Date,
  skip?: FacetKey
): boolean {
  if (skip !== 'cat' && filters.cat && row.category !== filters.cat) return false;
  if (skip !== 'precio' && filters.precio && !matchesPrice(row.price, filters.precio)) return false;
  if (skip !== 'desc' && filters.desc && discountPct(row) < Number(filters.desc)) return false;
  if (skip !== 'ingreso' && filters.ingreso && !matchesArrival(row.prospected_at, filters.ingreso, now)) return false;
  return matchesSearch(row, filters.q);
}

// ─── Agrupación y orden ────────────────────────────────────────────────────

function cheaperFirst(a: CandidateRow, b: CandidateRow): number {
  return a.price - b.price || a.id.localeCompare(b.id);
}

/**
 * Un modelo en varios colores aparece una sola vez: lo representa el más
 * barato, que es el que conviene publicar (el sitio igual muestra una sola
 * tarjeta por familia). Los demás quedan en `siblings`.
 */
export function groupByFamily(rows: CandidateRow[]): CandidateGroup[] {
  const families = new Map<string, CandidateRow[]>();
  const groups: CandidateGroup[] = [];
  for (const row of rows) {
    if (!row.ml_family_id) {
      groups.push({ ...row, siblings: [] });
      continue;
    }
    const list = families.get(row.ml_family_id);
    if (list) list.push(row);
    else families.set(row.ml_family_id, [row]);
  }
  for (const members of families.values()) {
    const [rep, ...siblings] = [...members].sort(cheaperFirst);
    groups.push({ ...rep, siblings });
  }
  return groups;
}

/** Posición en los destacados de ML; sin posición va al final. */
function highlightRank(row: CandidateRow): number {
  const p = row.highlight_position;
  return typeof p === 'number' && p > 0 ? p : Number.POSITIVE_INFINITY;
}

function byRank(a: CandidateRow, b: CandidateRow): number {
  const ra = highlightRank(a);
  const rb = highlightRank(b);
  if (ra === rb) return 0;
  return ra < rb ? -1 : 1;
}

function newerFirst(a: CandidateRow, b: CandidateRow): number {
  return (Date.parse(b.prospected_at) || 0) - (Date.parse(a.prospected_at) || 0);
}

const value = (r: CandidateRow) => candidateCommission(r).amount;

const COMPARATORS: Record<CandidateSort, (a: CandidateRow, b: CandidateRow) => number> = {
  valor: (a, b) => value(b) - value(a) || byRank(a, b) || discountPct(b) - discountPct(a),
  descuento: (a, b) => discountPct(b) - discountPct(a) || value(b) - value(a),
  vendidos: (a, b) => byRank(a, b) || value(b) - value(a),
  nuevos: (a, b) => newerFirst(a, b),
  precio_asc: (a, b) => a.price - b.price,
};

/** Ordena sin mutar. El id desempata al final para que las páginas no bailen entre visitas. */
export function sortCandidates<T extends CandidateRow>(rows: T[], sort: CandidateSort): T[] {
  const cmp = COMPARATORS[sort];
  return [...rows].sort((a, b) => cmp(a, b) || a.id.localeCompare(b.id));
}

export function paginate<T>(
  items: T[],
  page: number,
  perPage = PAGE_SIZE
): { items: T[]; page: number; pages: number; total: number } {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((current - 1) * perPage, current * perPage), page: current, pages, total };
}

// ─── Conteos para los chips ────────────────────────────────────────────────

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface CandidateFacets {
  cat: FacetOption[];
  precio: FacetOption[];
  desc: FacetOption[];
  ingreso: FacetOption[];
}

/**
 * Cuántos modelos quedarían al tocar cada chip, respetando los demás filtros
 * activos (el de la misma fila se reemplaza por la opción, para poder
 * cambiar de una a otra). Se cuenta igual que la vista —filtrar y después
 * agrupar— para que el número del chip sea exactamente lo que aparece al
 * tocarlo, aunque los colores de un modelo caigan en filtros distintos.
 */
export function facetCounts(
  rows: CandidateRow[],
  filters: CandidateFilters,
  now: Date,
  categoryLabel: (slug: string) => string = (slug) => slug
): CandidateFacets {
  const countWith = (next: CandidateFilters) =>
    groupByFamily(rows.filter((r) => matchesFilters(r, next, now))).length;

  const categories = Array.from(
    new Set(rows.filter((r) => matchesFilters(r, filters, now, 'cat')).map((r) => r.category))
  );
  const cat = categories
    .map((slug) => ({ value: slug, label: categoryLabel(slug), count: countWith({ ...filters, cat: slug }) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es'));

  const countBy = <K extends 'precio' | 'desc' | 'ingreso'>(
    key: K,
    options: { value: NonNullable<CandidateFilters[K]>; label: string }[]
  ): FacetOption[] => options.map((o) => ({ ...o, count: countWith({ ...filters, [key]: o.value }) }));

  return {
    cat,
    precio: countBy('precio', PRICE_OPTIONS),
    desc: countBy('desc', DISCOUNT_OPTIONS),
    ingreso: countBy('ingreso', ARRIVAL_OPTIONS),
  };
}

/**
 * Filtra, agrupa, ordena y corta la página pedida. `ids` trae los modelos de
 * todas las páginas en el orden de la vista (hasta MAX_APPROVE_ALL), para
 * "Aprobar todo el filtro".
 */
export function buildCandidateView(
  rows: CandidateRow[],
  query: { filters: CandidateFilters; sort: CandidateSort; page: number },
  now: Date
): { items: CandidateGroup[]; page: number; pages: number; total: number; totalAll: number; ids: string[] } {
  const totalAll = groupByFamily(rows).length;
  const filtered = rows.filter((r) => matchesFilters(r, query.filters, now));
  const sorted = sortCandidates(groupByFamily(filtered), query.sort);
  return { ...paginate(sorted, query.page), totalAll, ids: sorted.slice(0, MAX_APPROVE_ALL).map((g) => g.id) };
}

// ─── Utilidades de lectura ─────────────────────────────────────────────────

/**
 * Medianoche de hoy en Chile. El "hoy" del admin es el de Santiago, no el
 * de UTC: a las 21:00 en Chile ya es mañana en UTC y el contador de
 * "revisados hoy" se reiniciaría a mitad de la tarde.
 */
export function startOfTodayChile(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Algunos motores escriben la medianoche como "24".
  const hours = get('hour') % 24;
  const elapsed = ((hours * 60 + get('minute')) * 60 + get('second')) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed);
}

type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };

/**
 * Lee una tabla completa de a bloques. Supabase corta cada respuesta en 1000
 * filas sin avisar: con 1.200 pendientes, una sola consulta mostraba 1000 y
 * los conteos quedaban mal. `fetchPage` tiene que usar un orden estable
 * (con el id al final) para que los bloques no se pisen.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = SUPABASE_PAGE,
  maxRows = 20_000
): Promise<{ rows: T[]; error: PageResult<T>['error'] }> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { rows, error };
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return { rows, error: null };
}
