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
  canValidateByHand,
  checkManualPrice,
  manualPriceOutcome,
  manualUnavailableOutcome,
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
  deleted_at?: string | null;
};

/** Con deleted_at (migración 0017) si existe; sin ella, sin él. */
const BASE_COLUMNS = `${PRICED_COLUMNS}, slug, name, category, is_hidden, price_checked_at`;
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
    before: {
      precio: product.price,
      tachado: product.original_price ?? null,
      revisado: product.price_checked_at,
      a_la_venta: product.is_active,
    },
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
    before: { precio: product.price, a_la_venta: product.is_active },
    after: { nombre: product.name, a_la_venta: false, motivo: 'ya no se vende en Mercado Libre' },
  });
  await notifyIndexNow([`${SITE_URL}/producto/${product.slug}`]);

  return { ok: true, wasOnSale: product.is_active };
}
