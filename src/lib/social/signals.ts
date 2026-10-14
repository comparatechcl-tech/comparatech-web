import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/admin-stats';
import { mapWithConcurrency } from '@/lib/ml-catalog';
import { isMissingSchemaError } from '@/lib/supabase/errors';

/**
 * Las dos señales de "tendencia y ganadores" que el puntaje de interés
 * (lib/social/interest) acepta además del historial de precios:
 *
 *  - mlPosition: el puesto del producto entre los más vendidos de su
 *    categoría en Mercado Libre. Lo anota la prospección en el candidato
 *    (product_candidates.highlight_position) el día en que lo encuentra.
 *  - recentClicks: cuántos clics en "Ver en Mercado Libre" quedaron anotados
 *    en el sitio en la última semana (outbound_clicks). Son clics, no
 *    personas: ver readRecentClicks.
 *
 * Son un extra chico (hasta 6 puntos) y nunca una condición: si una tabla no
 * existe todavía o una lectura falla, ese producto queda sin señal y se ordena
 * como antes. Por eso acá nada lanza.
 *
 * Las dos vienen de afuera y se pueden fabricar: los clics los manda
 * cualquiera a /api/e, y el puesto entre los más vendidos lo mueve quien
 * vende. Por eso solo ordenan: el piso de interés se mide sin ellas
 * (floorPoints en lib/social/interest), y con señales solas ningún producto
 * entra a lo que se publica.
 */

export interface InterestSignals {
  /** Mejor puesto visto en los más vendidos de su categoría (1 = el más vendido), o null. */
  mlPosition: number | null;
  /** Clics de la última semana en el sitio (un dato de afuera: ver readRecentClicks), o null si no tiene o no se pudo leer. */
  recentClicks: number | null;
}

/** Cómo leer las señales. */
export interface SignalOptions {
  /**
   * true: los clics se le piden a la base solo de estos productos. Es para
   * las listas chicas que se cargan seguido (el tablero de videos): sin esto,
   * cada carga leería los clics de la semana de todo el sitio, de a mil,
   * para quedarse con los de unos pocos productos. La selección completa lo
   * deja en false: necesita casi todo el catálogo, y pedirlo por id serían
   * decenas de consultas.
   */
  onlyTheirClicks?: boolean;
}

/** Cuánto hacia atrás se cuentan los clics: una semana alcanza para ver qué se está mirando ahora. */
export const CLICK_WINDOW_DAYS = 7;

/**
 * Hasta cuándo vale un puesto en los más vendidos. La frase que escribe el
 * puntaje dice "figuró": con más de un mes ya no describe lo que se vende hoy.
 */
export const POSITION_MAX_AGE_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * El tope de filas de fetchAllRows. Si los clics de una semana llegan a esto,
 * la lectura quedó cortada (o alguien está inflando la tabla): no se afirma
 * nada de ningún producto.
 */
const CLICK_ROWS_MAX = 20_000;

/** Productos por consulta cuando los clics se piden por producto: los ids viajan en la URL (36 caracteres cada uno). */
const CLICK_ID_CHUNK = 40;

/** Un id de producto. Lo que no calce no se manda en la consulta. */
const PRODUCT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Fichas por consulta: los ids viajan en la URL (unos 15 caracteres cada uno). */
const POSITION_CHUNK = 100;
const POSITION_CONCURRENCY = 4;

/** Un id de ficha de Mercado Libre ("MLC123456"). Lo que no calce no se manda en la consulta. */
const ML_ID_RE = /^[A-Z]{2,4}\d{1,15}$/;

type DbError = { code?: string; message: string } | null;
type DbResult = { data: unknown; error: DbError };

interface ClickRow {
  product_id: string | null;
  client_key?: string | null;
}

interface CandidateRow {
  ml_product_id: string | null;
  highlight_position: number | null;
  prospected_at: string | null;
  checked_at?: string | null;
}

function warn(what: string, detail: unknown): void {
  const message = detail instanceof Error ? detail.message : typeof detail === 'string' ? detail : String(detail);
  console.warn(`[social] no se pudo leer ${what}:`, message);
}

/**
 * Clics de la última semana por producto.
 *
 * Una misma llave cuenta una vez por producto y por día. La llave
 * (client_key, ver lib/click-client-key) sale de la IP, del navegador que el
 * visitante dice ser y de la fecha: alcanza para que el dueño probando sus
 * propios botones, o alguien que recarga la página, no sumen de más.
 *
 * No alcanza contra quien quiera inflar un producto a propósito: cambiando el
 * navegador que dice ser, una sola persona manda doce clics con doce llaves
 * distintas, y sin llave (no se pudo calcular) cada fila cuenta. Este número
 * NO es "cuánta gente lo miró": es un dato que viene de afuera y se puede
 * fabricar. Por eso vale poco (3 puntos como mucho), no cuenta para el piso
 * de interés y, si la tabla llega a su tope, no se afirma nada de nadie.
 *
 * `onlyThese`: los clics se piden solo de los productos de `wanted`, por
 * tandas (ver SignalOptions.onlyTheirClicks).
 */
async function readRecentClicks(
  admin: SupabaseClient,
  wanted: ReadonlySet<string>,
  now: Date,
  onlyThese: boolean = false
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const since = new Date(now.getTime() - CLICK_WINDOW_DAYS * DAY_MS).toISOString();

  // Una sola lectura de toda la semana, o una por tanda de productos.
  const groups: (string[] | null)[] = [];
  if (onlyThese) {
    const ids = [...wanted].filter((id) => PRODUCT_ID_RE.test(id));
    for (let i = 0; i < ids.length; i += CLICK_ID_CHUNK) groups.push(ids.slice(i, i + CLICK_ID_CHUNK));
    if (groups.length === 0) return counts;
  } else {
    groups.push(null);
  }

  const read = (columns: string, ids: string[] | null) =>
    fetchAllRows<ClickRow>((from, to) => {
      let query = admin.from('outbound_clicks').select(columns).gte('created_at', since);
      if (ids) query = query.in('product_id', ids);
      // Con un orden fijo las páginas no se pisan.
      return query.order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<DbResult>;
    });

  try {
    let columns = 'product_id, client_key';
    const rows: ClickRow[] = [];
    for (const ids of groups) {
      let page = await read(columns, ids);
      // La columna client_key se agregó después que la tabla: sin ella se cuenta cada fila.
      if (page.error && isMissingSchemaError(page.error) && columns !== 'product_id') {
        columns = 'product_id';
        page = await read(columns, ids);
      }
      if (page.error) {
        // Sin la tabla (migración 0015 sin aplicar) no hay nada que avisar.
        if (!isMissingSchemaError(page.error)) warn('los clics recientes', page.error.message);
        return counts;
      }
      for (const row of page.rows) rows.push(row);
      if (rows.length >= CLICK_ROWS_MAX) {
        warn('los clics recientes', `hay ${CLICK_ROWS_MAX} o más en ${CLICK_WINDOW_DAYS} días: la lectura queda cortada`);
        return counts;
      }
    }

    const seen = new Map<string, Set<string>>();
    for (const row of rows) {
      const id = row.product_id;
      if (!id || !wanted.has(id)) continue;
      if (row.client_key) {
        let keys = seen.get(id);
        if (!keys) {
          keys = new Set();
          seen.set(id, keys);
        }
        if (keys.has(row.client_key)) continue;
        keys.add(row.client_key);
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  } catch (err) {
    warn('los clics recientes', err);
    return new Map();
  }
}

/**
 * El mejor puesto de cada ficha en los más vendidos, por ml_product_id.
 *
 * La fecha del puesto es prospected_at: la prospección escribe las dos cosas
 * juntas. checked_at no sirve para esto, porque se renueva cada vez que el
 * cron vuelve a mirar el precio del candidato y el puesto no se toca: un
 * candidato recuperado meses después traería un puesto de hace meses con
 * fecha de ayer. Solo si prospected_at no viene se usa checked_at.
 */
async function readMlPositions(admin: SupabaseClient, mlIds: string[], now: Date): Promise<Map<string, number>> {
  const best = new Map<string, number>();
  const unique = [...new Set(mlIds)].filter((id) => ML_ID_RE.test(id));
  if (unique.length === 0) return best;

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += POSITION_CHUNK) chunks.push(unique.slice(i, i + POSITION_CHUNK));
  const oldest = now.getTime() - POSITION_MAX_AGE_DAYS * DAY_MS;
  // Sin la tabla o sin la columna (migración 0018) no vale la pena seguir preguntando por las demás tandas.
  let missing = false;

  try {
    await mapWithConcurrency(chunks, POSITION_CONCURRENCY, async (chunk) => {
      if (missing) return;
      const { data, error } = (await admin
        .from('product_candidates')
        .select('ml_product_id, highlight_position, prospected_at, checked_at')
        .in('ml_product_id', chunk)
        .not('highlight_position', 'is', null)) as DbResult;
      if (error) {
        if (isMissingSchemaError(error)) missing = true;
        else warn('el puesto en los más vendidos', error.message);
        return;
      }
      for (const row of (data ?? []) as CandidateRow[]) {
        const position = row.highlight_position;
        if (!row.ml_product_id || typeof position !== 'number' || !Number.isInteger(position) || position < 1) continue;
        const seenAt = new Date(row.prospected_at ?? row.checked_at ?? '').getTime();
        if (!Number.isFinite(seenAt) || seenAt < oldest) continue;
        const known = best.get(row.ml_product_id);
        if (known === undefined || position < known) best.set(row.ml_product_id, position);
      }
    });
  } catch (err) {
    warn('el puesto en los más vendidos', err);
  }
  return best;
}

/**
 * Las señales de cada producto, por id. Solo trae entrada el que tiene al
 * menos una: sin entrada es "sin señales", que para el puntaje es lo mismo
 * que antes de que existieran.
 *
 * Nunca lanza. Solo lee.
 */
export async function readInterestSignals<T extends { id: string; ml_product_id?: string | null }>(
  admin: SupabaseClient,
  rows: T[],
  now: Date,
  options: SignalOptions = {}
): Promise<Map<string, InterestSignals>> {
  const signals = new Map<string, InterestSignals>();
  if (rows.length === 0) return signals;

  try {
    const mlIds = rows.map((p) => p.ml_product_id).filter((id): id is string => typeof id === 'string' && id !== '');
    const [clicks, positions] = await Promise.all([
      readRecentClicks(admin, new Set(rows.map((p) => p.id)), now, options.onlyTheirClicks === true),
      readMlPositions(admin, mlIds, now),
    ]);
    for (const p of rows) {
      const recentClicks = clicks.get(p.id) ?? null;
      const mlPosition = p.ml_product_id ? positions.get(p.ml_product_id) ?? null : null;
      if (recentClicks !== null || mlPosition !== null) signals.set(p.id, { mlPosition, recentClicks });
    }
  } catch (err) {
    warn('las señales de interés', err);
    return new Map();
  }
  return signals;
}
