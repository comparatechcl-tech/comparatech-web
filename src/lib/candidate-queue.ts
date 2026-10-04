import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllPages } from '@/lib/candidate-sort';
import { buildPublishedCatalog, partitionCandidates } from '@/lib/prospect-filter';

/**
 * Qué cuenta como "por revisar", con una sola regla para la cola, la
 * pestaña del admin y el panel de resumen.
 *
 * Antes la pestaña y el panel contaban filas (cada color por separado) y la
 * cola contaba modelos: "Candidatos 209" al lado de "Por revisar: 195". Y
 * cuando se aprobaba un color, los otros colores del mismo modelo seguían
 * pendientes y volvían a la cola como si fueran nuevos.
 */

export interface CatalogRow {
  ml_product_id: string | null;
  ml_family_id: string | null;
  price: number;
}

type DbError = { code?: string; message: string } | null;

/** Lo publicado y activo: la misma lectura que usa la prospección para descartar familias. */
export async function readActiveCatalog(admin: SupabaseClient): Promise<{ rows: CatalogRow[]; error: string | null }> {
  const { rows, error } = await fetchAllPages<CatalogRow>(
    (from, to) =>
      admin
        .from('products')
        .select('ml_product_id, ml_family_id, price')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: CatalogRow[] | null; error: DbError }>
  );
  return { rows, error: error?.message ?? null };
}

/**
 * Pendientes que todavía vale la pena revisar: sin los que ya están
 * publicados ni los colores de un modelo ya publicado, salvo que sean
 * bastante más baratos (la misma regla que la prospección, ver
 * lib/prospect-filter). No escribe nada: si después se despublica el
 * modelo, esos colores vuelven a aparecer solos.
 */
export function reviewableCandidates<T extends { ml_product_id: string; ml_family_id?: string | null; price: number }>(
  rows: T[],
  catalog: CatalogRow[]
): T[] {
  return partitionCandidates(rows, buildPublishedCatalog(catalog)).fresh;
}

/**
 * Un representante por modelo: el color más barato de cada familia (con el
 * id como desempate), o la fila tal cual si no tiene familia. Es la misma
 * regla que groupByFamily, que arma las tarjetas de la cola.
 */
export function collapseToModels<T extends { id: string; ml_family_id?: string | null; price: number }>(rows: T[]): T[] {
  const byFamily = new Map<string, T>();
  const models: T[] = [];
  for (const row of rows) {
    if (!row.ml_family_id) {
      models.push(row);
      continue;
    }
    const best = byFamily.get(row.ml_family_id);
    if (!best || row.price < best.price || (row.price === best.price && row.id.localeCompare(best.id) < 0)) {
      byFamily.set(row.ml_family_id, row);
    }
  }
  return [...models, ...byFamily.values()];
}

/** Modelos por revisar, para el contador de la pestaña. 0 si algo falla. */
export async function countPendingModels(admin: SupabaseClient | null): Promise<number> {
  if (!admin) return 0;
  type Row = { id: string; ml_product_id: string; ml_family_id: string | null; price: number };
  const [pending, catalog] = await Promise.all([
    fetchAllPages<Row>(
      (from, to) =>
        admin
          .from('product_candidates')
          .select('id, ml_product_id, ml_family_id, price')
          .eq('status', 'pending_review')
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: DbError }>
    ),
    readActiveCatalog(admin),
  ]);
  if (pending.error) return 0;
  // Sin el catálogo se cuenta igual, solo sin descartar lo ya publicado.
  const rows = catalog.error ? pending.rows : reviewableCandidates(pending.rows, catalog.rows);
  return collapseToModels(rows).length;
}
