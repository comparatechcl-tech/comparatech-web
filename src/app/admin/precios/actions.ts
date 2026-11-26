'use server';

/**
 * Acciones de "Precios de hoy" (/admin/precios): guardar el precio que el
 * dueño acaba de ver en la ficha de Mercado Libre, o anotar que el producto
 * ya no se vende.
 *
 * Escriben igual que la revisión automática (applyPricing): el precio queda
 * como el de hoy, el cambio entra al historial, y el sitio se vuelve a armar.
 * Cada acción verifica quién la pide y deja registro en admin_audit_log.
 */

import { revalidatePath, revalidateTag } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { requireAdmin } from '@/lib/admin-auth';
import { logAdminEvent } from '@/lib/admin-audit';
import { notifyIndexNow } from '@/lib/indexnow';
import { PRICED_COLUMNS, applyPricing, type PricedProduct, type PricingOutcome } from '@/lib/pricing';
import { SITE_URL } from '@/lib/site';
import {
  canUndoManual,
  canValidateByHand,
  checkManualPrice,
  manualPriceBefore,
  manualPriceOutcome,
  manualUnavailableOutcome,
  manualUndoPatch,
  parseManualBefore,
} from '@/lib/manual-price';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Fail = { ok: false; error: string };

export type SavePriceResult =
  | {
      ok: true;
      price: number;
      listPrice: number | null;
      checkedAt: string;
      /** El precio o el tachado eran otros: quedó anotado en el historial. */
      changed: boolean;
      /** Estaba en pausa y volvió al sitio. */
      reactivated: boolean;
    }
  /** Lo escrito llama la atención: se guarda solo si se confirma. */
  | { ok: false; confirm: string }
  | Fail;

export type UnavailableResult = { ok: true; wasOnSale: boolean } | Fail;

type Row = PricedProduct & {
  slug: string;
  name: string;
  category: string;
  is_hidden: boolean;
  price_checked_at: string | null;
  offer_info?: unknown;
  deleted_at?: string | null;
};

/** Con deleted_at (migración 0017) si existe; sin ella, sin él. */
const BASE_COLUMNS = `${PRICED_COLUMNS}, slug, name, category, is_hidden, price_checked_at, offer_info`;
const FULL_COLUMNS = `${BASE_COLUMNS}, deleted_at`;

type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

async function readProduct(admin: Admin, productId: string): Promise<{ row: Row | null; error: string | null }> {
  for (const columns of [FULL_COLUMNS, BASE_COLUMNS]) {
    const { data, error } = await admin.from('products').select(columns).eq('id', productId).maybeSingle();
    if (error && columns === FULL_COLUMNS && isMissingSchemaError(error)) continue;
    if (error) return { row: null, error: error.message };
    return { row: (data as unknown as Row | null) ?? null, error: null };
  }
  return { row: null, error: null };
}

/** Por qué no se puede revisar este producto a mano, o null si se puede. */
function notEditable(row: Row | null): string | null {
  if (!row) return 'Ese producto ya no existe.';
  if (row.is_hidden || row.deleted_at) return 'Ese producto está oculto o eliminado: no se muestra en el sitio.';
  if (!row.ml_product_id) return 'Ese producto no tiene ficha de Mercado Libre.';
  if (!canValidateByHand(row)) {
    return 'Este producto está fuera del sitio por su link, no por su precio: se arregla en Problemas.';
  }
  return null;
}

/**
 * El precio y la disponibilidad se ven en casi todas las páginas públicas
 * (ficha, listados, modelo, comparaciones, portada): se vuelve a armar todo,
 * como en las demás acciones del admin que cambian un precio.
 */
function refreshSite() {
  revalidateTag('catalog');
  revalidatePath('/', 'layout');
}

async function write(admin: Admin, outcome: PricingOutcome): Promise<string | null> {
  try {
    const failed = await applyPricing(admin, [outcome], 1);
    return failed === 0 ? null : 'No se pudo guardar en la base. Intenta de nuevo.';
  } catch (err) {
    console.error('[precios] no se pudo guardar:', err instanceof Error ? err.message : err);
    return 'No se pudo guardar en la base. Intenta de nuevo.';
  }
}

/**
 * Guarda como precio de hoy lo que el dueño ve en la ficha de Mercado Libre.
 *
 * `rawList` es el precio tachado de la ficha (vacío si no hay). Si lo
 * escrito se aleja mucho de lo guardado, no se guarda hasta que llegue con
 * `confirmed`: casi siempre es un dígito de más o de menos.
 */
export async function saveManualPrice(
  productId: string,
  rawPrice: string,
  rawList: string,
  confirmed = false
): Promise<SavePriceResult> {
  const actor = await requireAdmin();
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return { ok: false, error: 'Producto no válido.' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const read = await readProduct(admin, productId);
  if (read.error) return { ok: false, error: read.error };
  const blocked = notEditable(read.row);
  if (blocked) return { ok: false, error: blocked };
  const product = read.row as Row;

  const check = checkManualPrice(product.price, rawPrice, rawList);
  if (!check.ok) return check;
  if (check.confirm && confirmed !== true) return { ok: false, confirm: check.confirm };

  const now = new Date().toISOString();
  const outcome = manualPriceOutcome(product, check.input, now);
  const failed = await write(admin, outcome);
  if (failed) return { ok: false, error: failed };

  refreshSite();
  await logAdminEvent(admin, {
    actor,
    action: 'precio_manual',
    target: product.id,
    // Todo lo que hace falta para dejarlo como estaba (undoManualPrice).
    before: manualPriceBefore(product),
    after: { nombre: product.name, precio: check.input.price, tachado: check.input.listPrice, a_la_venta: true },
  });
  // Bing (de donde lee ChatGPT) vuelve a leer la ficha con el precio de hoy. Nunca lanza.
  await notifyIndexNow([`${SITE_URL}/producto/${product.slug}`]);

  return {
    ok: true,
    price: check.input.price,
    listPrice: check.input.listPrice,
    checkedAt: now,
    changed: outcome.priceChanged,
    reactivated: outcome.reactivated,
  };
}

/** El dueño abrió la ficha y el producto ya no se vende: queda en pausa. */
export async function markUnavailable(productId: string): Promise<UnavailableResult> {
  const actor = await requireAdmin();
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return { ok: false, error: 'Producto no válido.' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const read = await readProduct(admin, productId);
  if (read.error) return { ok: false, error: read.error };
  const blocked = notEditable(read.row);
  if (blocked) return { ok: false, error: blocked };
  const product = read.row as Row;

  const outcome = manualUnavailableOutcome(product, new Date().toISOString());
  const failed = await write(admin, outcome);
  if (failed) return { ok: false, error: failed };

  refreshSite();
  await logAdminEvent(admin, {
    actor,
    action: 'precio_manual',
    target: product.id,
    before: manualPriceBefore(product),
    after: { nombre: product.name, a_la_venta: false, motivo: 'ya no se vende en Mercado Libre' },
  });
  await notifyIndexNow([`${SITE_URL}/producto/${product.slug}`]);

  return { ok: true, wasOnSale: product.is_active };
}

export type UndoResult =
  | {
      ok: true;
      /** Lo que el producto tenía antes, y vuelve a tener. */
      price: number;
      listPrice: number | null;
      checkedAt: string | null;
      active: boolean;
    }
  | Fail;

const NOTHING_TO_UNDO =
  'No hay nada que deshacer: lo último que cambió el precio de este producto no fue un guardado a mano de hoy.';

/**
 * Deshace el último precio guardado a mano (o el "Ya no se vende") de un
 * producto: lo deja como estaba y borra del historial la fila que ese
 * guardado anotó. En el teléfono un toque de más guarda un monto que nadie
 * revisó; sin esto, corregirlo dejaba en el historial una subida y una baja
 * que nunca existieron, y la ficha podía decir "Bajó $X".
 *
 * Solo deshace si lo último que dejó al producto como está fue ese guardado
 * (canUndoManual): lo anotado en Actividad dice cómo estaba antes.
 */
export async function undoManualPrice(productId: string): Promise<UndoResult> {
  const actor = await requireAdmin();
  if (typeof productId !== 'string' || !UUID_RE.test(productId)) return { ok: false, error: 'Producto no válido.' };

  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: 'Supabase admin no configurado' };

  const read = await readProduct(admin, productId);
  if (read.error) return { ok: false, error: read.error };
  const product = read.row;
  if (!product) return { ok: false, error: 'Ese producto ya no existe.' };

  const log = await admin
    .from('admin_audit_log')
    .select('at, before')
    .eq('action', 'precio_manual')
    .eq('target', productId)
    .order('at', { ascending: false })
    .limit(1);
  if (log.error) return { ok: false, error: 'No se pudo leer lo que había antes. Intenta de nuevo.' };
  const event = ((log.data ?? []) as { at: string; before: unknown }[])[0] ?? null;
  const before = event ? parseManualBefore(event.before) : null;
  const now = new Date();
  if (!event || !before || !canUndoManual(product, event, now.getTime())) return { ok: false, error: NOTHING_TO_UNDO };

  const savedAt = product.price_checked_at as string;
  const { error: updateError } = await admin
    .from('products')
    .update(manualUndoPatch(before, now.toISOString()))
    .eq('id', productId);
  if (updateError) {
    console.error('[precios] no se pudo deshacer:', updateError.message);
    return { ok: false, error: 'No se pudo deshacer. Intenta de nuevo.' };
  }

  // La fila que ese guardado dejó en el historial: misma hora y sin vendedor.
  // Sin la tabla (migración 0016) no hay nada que borrar.
  const { error: historyError } = await admin
    .from('price_history')
    .delete()
    .eq('product_id', productId)
    .eq('observed_at', savedAt)
    .is('seller_id', null);
  if (historyError && !isMissingSchemaError(historyError)) {
    console.warn('[precios] deshecho, pero no se pudo borrar la fila del historial:', historyError.message);
  }

  refreshSite();
  await logAdminEvent(admin, {
    actor,
    action: 'precio_deshacer',
    target: product.id,
    before: { precio: product.price, tachado: product.original_price ?? null, revisado: savedAt, a_la_venta: product.is_active },
    after: {
      nombre: product.name,
      precio: before.precio,
      tachado: before.tachado,
      revisado: before.revisado,
      a_la_venta: before.a_la_venta,
    },
  });
  await notifyIndexNow([`${SITE_URL}/producto/${product.slug}`]);

  return { ok: true, price: before.precio, listPrice: before.tachado, checkedAt: before.revisado, active: before.a_la_venta };
}
