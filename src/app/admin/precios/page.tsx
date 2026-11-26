import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { fetchAllRows } from '@/lib/admin-stats';
import { startOfChileDay } from '@/lib/clicks';
import { canValidateByHand, rankForValidation, type ValidationRow } from '@/lib/manual-price';
import { mlProductUrl } from '@/lib/ml-urls';
import { MANUAL_PRICE_SOURCE, isManualPrice, priceState } from '@/lib/price-freshness';
import { PriceList, type PriceItem } from './PriceList';

export const dynamic = 'force-dynamic';

/** Los clics que se miran para ordenar: los mismos 30 días de "Los más populares". */
const CLICK_DAYS = 30;
/** Productos por tanda. Con 25 se alcanza cerca de la mitad de los clics del sitio. */
const PAGE = 25;
const MAX_SHOWN = 100;
/** Ids por consulta: viajan en la URL. */
const ID_CHUNK = 100;

type DbError = { code?: string; message: string } | null;

const BASE_COLUMNS =
  'id, slug, name, brand, image_url, price, original_price, price_checked_at, ml_product_id, is_active, is_hidden, inactive_reason, offer_info';
/** deleted_at es de la migración 0017: sin ella se lee sin él. */
const FULL_COLUMNS = `${BASE_COLUMNS}, deleted_at`;

async function readClickCounts(admin: SupabaseClient, now: Date): Promise<{ counts: Map<string, number>; error: string | null }> {
  const since = new Date(now.getTime() - CLICK_DAYS * 86_400_000).toISOString();
  const { rows, error } = await fetchAllRows<{ product_id: string | null }>(
    (from, to) =>
      admin
        .from('outbound_clicks')
        .select('product_id')
        .not('product_id', 'is', null)
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: unknown; error: DbError }>
  );
  const counts = new Map<string, number>();
  for (const { product_id } of rows) {
    if (product_id) counts.set(product_id, (counts.get(product_id) ?? 0) + 1);
  }
  return { counts, error: error ? error.message : null };
}

async function readProducts(admin: SupabaseClient, ids: string[]): Promise<{ rows: ValidationRow[]; error: string | null }> {
  const rows: ValidationRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const part = ids.slice(i, i + ID_CHUNK);
    let read: { data: unknown; error: DbError } = await admin.from('products').select(FULL_COLUMNS).in('id', part);
    if (read.error && isMissingSchemaError(read.error)) {
      read = await admin.from('products').select(BASE_COLUMNS).in('id', part);
    }
    if (read.error) return { rows, error: read.error.message };
    rows.push(...((read.data ?? []) as ValidationRow[]));
  }
  return { rows, error: null };
}

/** Cuántos precios se revisaron a mano hoy (hora de Chile). null si no se pudo contar. */
async function countValidatedToday(admin: SupabaseClient, now: Date): Promise<number | null> {
  const { count, error } = await admin
    .from('products')
    .select('id', { count: 'exact', head: true })
    .gte('price_checked_at', startOfChileDay(now).toISOString())
    .eq('offer_info->>source', MANUAL_PRICE_SOURCE);
  return error ? null : (count ?? 0);
}

/**
 * Precios de hoy: los productos que más se abren en Mercado Libre desde el
 * sitio, para que el dueño revise su precio a mano cuando tenga un rato
 * (lib/manual-price). Desde el 23-11-2026 Mercado Libre no entrega precios a
 * la aplicación: esta es la única forma de que un producto vuelva a mostrar
 * el precio de hoy. No es una tarea diaria: lo que no se revisa sigue con el
 * precio de su última revisión y su fecha.
 */
export default async function PreciosPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const sp = await searchParams;
  const wanted = Number(sp.ver);
  const shown = Number.isFinite(wanted) && wanted > PAGE ? Math.min(Math.floor(wanted), MAX_SHOWN) : PAGE;
  const now = new Date();
  const admin = getSupabaseAdmin();

  if (!admin) {
    return <main className="mx-auto max-w-4xl px-4 py-8 text-sm text-red-400">Supabase admin no configurado.</main>;
  }

  const clicks = await readClickCounts(admin, now);
  // Más de los que se muestran: algunos de los más abiertos pueden estar ocultos o eliminados.
  const topIds = [...clicks.counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, shown + 60)
    .map(([id]) => id);
  const [products, validatedToday] = await Promise.all([readProducts(admin, topIds), countValidatedToday(admin, now)]);

  const ranked = rankForValidation(products.rows, clicks.counts).filter((r) => canValidateByHand(r.row));
  const totalClicks = [...clicks.counts.values()].reduce((sum, n) => sum + n, 0);
  const visible = ranked.slice(0, shown);
  const coveredClicks = visible.reduce((sum, r) => sum + r.clicks, 0);

  const items: PriceItem[] = visible.map(({ row, clicks: n }) => {
    const today = priceState(row.price_checked_at, now.getTime()) === 'hoy';
    return {
    id: row.id,
    name: row.name,
    brand: row.brand?.trim() || null,
    image: row.image_url,
    price: row.price,
    listPrice: typeof row.original_price === 'number' && row.original_price > row.price ? row.original_price : null,
    checkedAt: row.price_checked_at,
    today,
    // Guardado a mano hoy: la tarjeta ofrece deshacerlo.
    manualToday: today && isManualPrice(row),
    active: row.is_active,
    clicks: n,
    mlUrl: mlProductUrl(row.ml_product_id as string),
    };
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Precios de hoy</h1>
      <p className="mt-1 text-sm text-muted">
        Mercado Libre ya no le entrega precios al sitio. Acá puedes revisar a mano los productos que más se abren:
        miras la ficha, confirmas o corriges el precio y queda como <strong className="text-fg">precio de hoy</strong>{' '}
        por 12 horas. No es una obligación: lo que no revises sigue mostrando el precio de su última revisión, con su
        fecha.
      </p>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          Toca <strong>Ver en Mercado Libre</strong>. Se abre la ficha sin tu link de afiliado: mirar no cuenta como
          clic.
        </li>
        <li>
          Escribe en el primer cuadro el precio que muestra la ficha (el número grande). Si es el mismo que está
          guardado, toca <strong>Sigue igual</strong>. Después, <strong>Guardar precio de hoy</strong>.
        </li>
        <li>
          Si la ficha muestra un precio tachado, escríbelo en <strong>Precio tachado</strong>: con eso el sitio muestra
          el descuento. Si no muestra ninguno, deja ese cuadro vacío.
        </li>
        <li>
          Si el producto ya no se vende, toca <strong>Ya no se vende</strong>.
        </li>
        <li>
          Si guardaste algo mal, toca <strong>Me equivoqué: deshacer y corregir</strong> en la misma tarjeta. El sitio
          vuelve al precio de antes y el monto equivocado no queda en el historial.
        </li>
      </ol>

      <p className="mt-4 text-sm text-muted">
        {validatedToday !== null && (
          <>
            Hoy llevas <strong className="text-fg">{validatedToday}</strong>{' '}
            {validatedToday === 1 ? 'precio revisado' : 'precios revisados'}.{' '}
          </>
        )}
        {totalClicks > 0 && visible.length > 0 && (
          <>
            Estos {visible.length} productos juntan {Math.round((coveredClicks / totalClicks) * 100)}% de los clics hacia
            Mercado Libre de los últimos {CLICK_DAYS} días.
          </>
        )}
      </p>
      <p className="mt-2 text-sm text-muted">
        Los que queden con descuento o hayan bajado de precio aparecen en{' '}
        <Link href="/admin/historias" className="font-medium text-accent hover:underline">
          Historias
        </Link>{' '}
        durante las 6 horas siguientes, listos para compartir.
      </p>

      {clicks.error && <p className="mt-3 text-sm text-amber-400">No pude leer todos los clics: el orden puede no ser exacto.</p>}
      {products.error && <p className="mt-3 text-sm text-red-400">No se pudo leer el catálogo: {products.error}</p>}

      <PriceList items={items} />

      {ranked.length > shown && shown < MAX_SHOWN && (
        <p className="mt-5">
          <Link
            href={`/admin/precios?ver=${Math.min(shown + PAGE, MAX_SHOWN)}`}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm font-medium text-fg hover:border-accent"
          >
            Ver {PAGE} más
          </Link>
        </p>
      )}
    </main>
  );
}
