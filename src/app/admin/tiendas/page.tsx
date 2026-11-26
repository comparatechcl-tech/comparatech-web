import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fetchAllRows } from '@/lib/admin-stats';
import { priceDateLabel, priceState } from '@/lib/price-freshness';
import { publicStoreOffers, readAllOffers, type PublicStoreOffer, type StoreOfferRow } from '@/lib/store-offers';
import { readStoreSettings } from '@/lib/store-settings';
import { STORES, getStore, storeProductUrl } from '@/lib/stores';
import { shortProductName } from '@/lib/text';
import { StoreOffers } from '@/components/product/StoreOffers';
import { orderStoreCards } from './list';
import { ProductCard, VisibilitySwitch, type OfferItem, type ProductItem, type SearchableStore } from './StoreManager';

export const dynamic = 'force-dynamic';

/** Los clics que se miran para ordenar: los mismos 30 días de "Precios de hoy". */
const CLICK_DAYS = 30;
/** Cuántos productos sin tienda se ofrecen de una vez. */
const SUGGESTED = 20;
const ID_CHUNK = 100;

type DbError = { code?: string; message: string } | null;

interface ProductRow {
  id: string;
  slug: string;
  name: string;
  image_url: string;
  price: number;
  price_checked_at: string | null;
  is_hidden: boolean;
}

const PRODUCT_COLUMNS = 'id, slug, name, image_url, price, price_checked_at, is_hidden';

async function readClickCounts(admin: SupabaseClient, now: Date): Promise<Map<string, number>> {
  const since = new Date(now.getTime() - CLICK_DAYS * 86_400_000).toISOString();
  const { rows } = await fetchAllRows<{ product_id: string | null }>(
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
  return counts;
}

async function readProducts(admin: SupabaseClient, ids: string[]): Promise<ProductRow[]> {
  const rows: ProductRow[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await admin
      .from('products')
      .select(PRODUCT_COLUMNS)
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (error) break;
    rows.push(...((data ?? []) as ProductRow[]));
  }
  return rows;
}

/** Productos del sitio cuyo nombre contiene todas las palabras escritas. */
async function searchProducts(admin: SupabaseClient, q: string): Promise<ProductRow[]> {
  const words = q
    .replace(/[%_,()\\]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 5);
  if (words.length === 0) return [];
  let query = admin.from('products').select(PRODUCT_COLUMNS).eq('is_hidden', false);
  for (const word of words) query = query.ilike('name', `%${word}%`);
  const { data, error } = await query.order('seller_sales_count', { ascending: false, nullsFirst: false }).limit(SUGGESTED);
  return error ? [] : ((data ?? []) as ProductRow[]);
}

function offerItem(row: StoreOfferRow): OfferItem {
  const store = getStore(row.store);
  return {
    id: row.id,
    store: row.store,
    storeName: store?.name ?? row.store,
    href: store ? storeProductUrl(store, row.url, row.external_id) : row.url,
    title: row.title,
    seller: row.seller,
    price: row.price,
    checkedAt: row.checked_at,
    status: row.status,
    lastError: row.last_error,
    readable: store?.price === 'ficha',
  };
}

/** Una muestra del bloque público, con montos inventados, para verlo antes de enlazar nada. */
function sampleOffers(now: Date): PublicStoreOffer[] {
  const checkedAt = now.toISOString();
  return [
    { store: 'paris', storeName: 'Paris', price: 1_049_990, checkedAt, url: 'https://www.paris.cl/', seller: null, commission: true },
    { store: 'maconline', storeName: 'MacOnline', price: 1_099_990, checkedAt, url: 'https://www.maconline.com/', seller: null, commission: false },
  ];
}

/** Con qué buscar el producto en una tienda: el nombre corto, sin signos. Se puede corregir antes de buscar. */
function searchQuery(name: string): string {
  return shortProductName(name, 45)
    .replace(/[^\p{L}\p{N} +.\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FILTER_LINK = 'inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium';

/**
 * Otras tiendas: enlazar productos del sitio con su ficha en tiendas que
 * dejan leer su precio (lib/stores), para mostrarlo junto al de Mercado
 * Libre. Enlazar se hace una vez por producto; después el precio se revisa
 * solo, dos veces al día (/api/cron/tiendas).
 */
export default async function TiendasPage({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 60);
  const onlyLinked = !q && sp.ver === 'enlazados';
  const now = new Date();
  const admin = getSupabaseAdmin();

  if (!admin) {
    return <main className="mx-auto max-w-4xl px-4 py-8 text-sm text-red-400">Supabase admin no configurado.</main>;
  }

  const [offers, settings, clicks] = await Promise.all([readAllOffers(admin), readStoreSettings(admin), readClickCounts(admin, now)]);
  const rows = offers.available ? offers.rows : [];
  const byProduct = new Map<string, StoreOfferRow[]>();
  for (const row of rows) byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), row]);

  const linkedIds = [...byProduct.keys()];
  // Sin búsqueda: los más abiertos. Se piden de más: algunos están ocultos y otros ya están entre los enlazados.
  const topIds = [...clicks.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .filter((id) => !byProduct.has(id))
    .slice(0, SUGGESTED + 30);
  const [linkedProducts, otherProducts] = await Promise.all([
    readProducts(admin, linkedIds),
    q ? searchProducts(admin, q) : onlyLinked ? Promise.resolve([]) : readProducts(admin, topIds),
  ]);

  const toItem = (product: ProductRow): ProductItem => {
    const state = priceState(product.price_checked_at, now.getTime());
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      image: product.image_url,
      mlPrice: product.price,
      mlDate: state !== 'sin_precio' && product.price_checked_at ? priceDateLabel(product.price_checked_at) : null,
      clicks: clicks.get(product.id) ?? 0,
      offers: (byProduct.get(product.id) ?? []).map(offerItem),
      query: searchQuery(product.name),
    };
  };

  // Una sola lista, por clics: una tarjeta no cambia de lugar cuando se le guarda una tienda (ver ./list).
  // Con búsqueda, lo que calza, en el orden de la búsqueda.
  const items: ProductItem[] = q
    ? otherProducts.map(toItem)
    : orderStoreCards(
        [...linkedProducts, ...otherProducts.filter((p) => !p.is_hidden)].map((p) => ({ ...toItem(p), linked: byProduct.has(p.id) })),
        SUGGESTED
      );

  const searchable: SearchableStore[] = STORES.filter((s) => s.price === 'ficha' && s.searchUrl).map((s) => ({ key: s.key, name: s.name }));
  const readableNames = STORES.filter((s) => s.price === 'ficha').map((s) => s.name);
  const shownPrices = linkedProducts
    .filter((p) => !p.is_hidden)
    .reduce((sum, p) => sum + publicStoreOffers(byProduct.get(p.id) ?? [], now.getTime()).length, 0);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Otras tiendas</h1>
      <p className="mt-1 text-sm text-muted">
        Acá enlazas un producto del sitio con su ficha en otra tienda. Se hace <strong className="text-fg">una sola vez por producto</strong>: desde
        ahí el sitio revisa solo el precio de esa tienda, dos veces al día, y lo muestra en la ficha junto al de Mercado Libre, con su fecha. Por
        ahora se pueden leer {readableNames.join(' y ')}: son tiendas que no prohíben leer sus precios con un programa. No es una tarea diaria:
        enlaza los que quieras, cuando tengas un rato.
      </p>

      {!offers.available && (
        <div role="alert" className="mt-5 rounded-xl border border-amber-500/50 bg-amber-500/5 p-4 text-sm text-fg">
          {offers.missing ? (
            <>
              <p className="font-semibold">Falta un paso tuyo antes de poder guardar: correr la migración 0022 en Supabase.</p>
              <p className="mt-1 text-muted">
                Mientras tanto puedes buscar y revisar fichas para ver cómo funciona, pero <strong className="text-fg">Guardar</strong> va a
                responder que falta ese paso. El sitio sigue igual.
              </p>
            </>
          ) : (
            <p>No se pudieron leer las tiendas enlazadas: {offers.error}</p>
          )}
        </div>
      )}

      <VisibilitySwitch show={settings.show} shown={shownPrices} />

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium text-accent">Ver un ejemplo de cómo queda en la ficha</summary>
        <div className="mt-1 rounded-lg border border-dashed border-border px-3 pb-3">
          {/* "vista-previa" no es un producto: un clic acá no se cuenta. */}
          <StoreOffers offers={sampleOffers(now)} productId="vista-previa" />
        </div>
        <p className="mt-1 text-xs text-muted">
          Es una muestra con montos inventados. El bloque aparece solo en los productos que tengan una tienda enlazada, debajo del
          precio de Mercado Libre.
        </p>
      </details>

      <ol className="mt-5 list-decimal space-y-1.5 rounded-xl border border-border bg-surface py-4 pl-9 pr-4 text-sm text-fg">
        <li>
          En la tarjeta del producto toca <strong>Buscar en Paris</strong> (puedes corregir el texto antes) o pega el link de la ficha de la
          tienda y toca <strong>Revisar</strong>.
        </li>
        <li>
          El sitio lee la ficha y te muestra qué dice la tienda: el nombre y el precio. Fíjate que sea el mismo producto, con la misma
          capacidad, y no un pack ni un accesorio.
        </li>
        <li>
          Si es, toca <strong>Es el mismo producto: guardar</strong>. La tienda queda en la misma tarjeta y su precio se actualiza solo.
        </li>
      </ol>
      <p className="mt-3 text-xs text-muted">
        El precio que se guarda es el que la tienda publica para cualquiera. El de la Tarjeta Cencosud de Paris no se toma nunca.
      </p>

      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold text-fg">
          {q ? `Productos con "${q}"` : onlyLinked ? 'Productos con una tienda enlazada' : 'Los productos más abiertos'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {linkedIds.length === 0
            ? 'Todavía no hay ningún producto enlazado.'
            : `${linkedIds.length} ${linkedIds.length === 1 ? 'producto enlazado' : 'productos enlazados'}, ${shownPrices} ${
                shownPrices === 1 ? 'precio listo' : 'precios listos'
              } para mostrar.`}
        </p>

        <form action="/admin/tiendas" method="get" className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar otro producto del sitio por su nombre"
            aria-label="Buscar un producto del sitio"
            className="min-h-11 w-full rounded-md border border-border bg-surface2 px-3 text-base text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            maxLength={60}
          />
          <button
            type="submit"
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-fg hover:border-accent"
          >
            Buscar en el sitio
          </button>
        </form>

        {(linkedIds.length > 0 || q) && (
          <p className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/admin/tiendas"
              aria-current={!q && !onlyLinked ? 'page' : undefined}
              className={`${FILTER_LINK} ${!q && !onlyLinked ? 'border-accent text-fg' : 'border-border text-muted hover:text-fg'}`}
            >
              Los más abiertos
            </Link>
            {linkedIds.length > 0 && (
              <Link
                href="/admin/tiendas?ver=enlazados"
                aria-current={onlyLinked ? 'page' : undefined}
                className={`${FILTER_LINK} ${onlyLinked ? 'border-accent text-fg' : 'border-border text-muted hover:text-fg'}`}
              >
                Solo los enlazados ({linkedIds.length})
              </Link>
            )}
          </p>
        )}

        {items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            {q
              ? 'Ningún producto del sitio calza con eso.'
              : onlyLinked
                ? 'Cuando enlaces un producto con una tienda, aparece acá.'
                : 'No hay productos con clics en los últimos 30 días.'}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {items.map((item) => {
              const shown = publicStoreOffers(byProduct.get(item.id) ?? [], now.getTime());
              return (
                <ProductCard
                  key={item.id}
                  item={item}
                  stores={searchable}
                  // En la vista previa el clic no se cuenta: "vista-previa" no es un producto.
                  preview={shown.length > 0 ? <StoreOffers offers={shown} productId="vista-previa" /> : undefined}
                />
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
