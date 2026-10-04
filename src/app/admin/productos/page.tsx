import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Flame, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { RrssStatus } from '@/lib/types';
import { CATEGORIES } from '@/lib/categories';
import { readAffiliateSettings } from '@/lib/settings';
import { resolveOutboundUrl } from '@/lib/outbound';
import { SITE_URL } from '@/lib/site';
import { MIN_DEAL_DISCOUNT } from '@/lib/queries/products';
import { ProductsList } from './ProductsList';
import type { AdminProduct } from './ProductAdminCard';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
/** Tope para las vistas que se ordenan en memoria (descuento, "solo en oferta"). */
const MAX_IN_MEMORY = 1000;

const RRSS_FILTERS: { value: RrssStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'sin_usar', label: 'Sin usar' },
  { value: 'seleccionado', label: 'Seleccionado' },
  { value: 'publicado', label: 'Publicado' },
];

type Estado = 'publicados' | 'fuera' | 'ocultos' | 'sin_verificar' | 'sin_meli' | 'eliminados';

const ESTADOS: { value: Estado | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'publicados', label: 'Publicados' },
  { value: 'fuera', label: 'Fuera del sitio' },
  { value: 'ocultos', label: 'Ocultos' },
  { value: 'sin_verificar', label: 'Link sin verificar' },
  { value: 'sin_meli', label: 'Sin respaldo meli.la' },
  { value: 'eliminados', label: 'Eliminados' },
];

type Orden = 'nuevos' | 'descuento' | 'precio';

const ORDENES: { value: Orden; label: string }[] = [
  { value: 'nuevos', label: 'Más nuevos' },
  { value: 'descuento', label: 'Mayor descuento' },
  { value: 'precio', label: 'Precio' },
];

/**
 * Columnas de la lista. Sin description ni specs: son lo más pesado de la
 * fila, la lista no las muestra y todo lo que se lee viaja en el HTML.
 */
const BASE_COLUMNS = [
  'id',
  'slug',
  'name',
  'brand',
  'category',
  'price',
  'original_price',
  'image_url',
  'affiliate_url',
  'seller_reputation',
  'seller_sales_count',
  'is_featured',
  'is_active',
  'is_hidden',
  'ml_product_id',
  'ml_domain_id',
  'ml_family_id',
  'seller_id',
  'rrss_status',
  'created_at',
  'inactive_reason',
  'inactive_since',
  'price_checked_at',
  'winner_item_id',
  'link_target_product_id',
  'link_checked_at',
].join(',');
const COLUMNS_0016 = 'offer_info,ml_category_id,ml_root_category';
const COLUMNS_0017 = 'rrss_published_at,rrss_channel,deleted_at,admin_note';

/** De la lectura más completa a la mínima, por si falta alguna migración. */
const TIERS = [
  { columns: `${BASE_COLUMNS},${COLUMNS_0016},${COLUMNS_0017}`, has0017: true },
  { columns: `${BASE_COLUMNS},${COLUMNS_0016}`, has0017: false },
  { columns: `${BASE_COLUMNS},${COLUMNS_0017}`, has0017: true },
  { columns: BASE_COLUMNS, has0017: false },
];

interface Filters {
  categoria?: string;
  rrss?: string;
  oferta?: string;
  q?: string;
  estado?: Estado;
  orden: Orden;
  page: number;
}

/**
 * Lo que se escribe en el buscador va dentro del filtro or() de PostgREST:
 * comas, paréntesis y comodines romperían la consulta o la cambiarían.
 */
function cleanSearch(raw: string | undefined): string | undefined {
  const clean = (raw ?? '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || undefined;
}

function discountOf(p: { price: number; original_price: number | null }): number {
  if (!p.original_price || p.original_price <= p.price) return 0;
  return Math.round((1 - p.price / p.original_price) * 100);
}

async function readProducts(
  admin: SupabaseClient,
  f: Filters
): Promise<{ rows: AdminProduct[]; total: number; error: string | null }> {
  // Descuento no es una columna: esas vistas se ordenan en memoria.
  const inMemory = f.orden === 'descuento' || Boolean(f.oferta);

  for (const tier of TIERS) {
    // Sin la migración 0017 no hay eliminados (antes se borraban de verdad).
    if (f.estado === 'eliminados' && !tier.has0017) continue;

    let query = admin.from('products').select(tier.columns, { count: 'exact' });
    if (f.categoria) query = query.eq('category', f.categoria);
    if (f.rrss) query = query.eq('rrss_status', f.rrss);
    if (f.q) {
      const like = `%${f.q}%`;
      query = query.or(`name.ilike.${like},brand.ilike.${like},ml_product_id.ilike.${like},slug.ilike.${like}`);
    }

    switch (f.estado) {
      case 'publicados':
        query = query.eq('is_active', true).eq('is_hidden', false);
        break;
      case 'fuera':
        query = query.eq('is_active', false).eq('is_hidden', false);
        break;
      case 'ocultos':
        query = query.eq('is_hidden', true);
        break;
      case 'sin_verificar':
        query = query.is('link_checked_at', null);
        break;
      case 'sin_meli':
        // Ni meli.la ni el acortador antiguo (mercadolibre.com/sec): si los
        // links directos se apagan, estos se quedan sin link que pague.
        query = query.not('affiliate_url', 'ilike', 'https://meli.la/%').not('affiliate_url', 'ilike', '%mercadolibre.com/sec/%');
        break;
    }
    // Los eliminados quedan fuera de todas las vistas salvo la suya.
    if (tier.has0017) {
      query = f.estado === 'eliminados' ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
    }

    query =
      f.orden === 'precio'
        ? query.order('price', { ascending: true })
        : query.order('created_at', { ascending: false });

    const from = (f.page - 1) * PAGE_SIZE;
    const { data, error, count } = inMemory
      ? await query.limit(MAX_IN_MEMORY)
      : await query.range(from, from + PAGE_SIZE - 1);

    if (error && isMissingSchemaError(error)) continue;
    if (error) return { rows: [], total: 0, error: error.message };

    let rows = (data ?? []) as unknown as AdminProduct[];
    if (!inMemory) return { rows, total: count ?? rows.length, error: null };

    if (f.oferta) rows = rows.filter((p) => discountOf(p) >= MIN_DEAL_DISCOUNT);
    if (f.orden === 'descuento' || f.oferta) rows = [...rows].sort((a, b) => discountOf(b) - discountOf(a));
    return { rows: rows.slice(from, from + PAGE_SIZE), total: rows.length, error: null };
  }
  return { rows: [], total: 0, error: null };
}

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{
    categoria?: string;
    rrss?: string;
    oferta?: string;
    q?: string;
    estado?: string;
    orden?: string;
    p?: string;
  }>;
}) {
  const sp = await searchParams;
  const estado = ESTADOS.some((e) => e.value === sp.estado && e.value !== 'todos') ? (sp.estado as Estado) : undefined;
  const orden: Orden = ORDENES.some((o) => o.value === sp.orden) ? (sp.orden as Orden) : 'nuevos';
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.p ?? '1', 10) || 1));
  const filters: Filters = {
    categoria: sp.categoria || undefined,
    rrss: RRSS_FILTERS.some((r) => r.value === sp.rrss && r.value !== 'todos') ? sp.rrss : undefined,
    oferta: sp.oferta ? '1' : undefined,
    q: cleanSearch(sp.q),
    estado,
    orden,
    page,
  };

  const admin = getSupabaseAdmin();
  const settings = await readAffiliateSettings(admin);
  const { rows, total, error } = admin
    ? await readProducts(admin, filters)
    : { rows: [], total: 0, error: 'Supabase admin no configurado' };
  const products: AdminProduct[] = rows.map((p) => ({ ...p, outbound_url: resolveOutboundUrl(p, settings) }));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  type HrefKey = 'categoria' | 'rrss' | 'oferta' | 'q' | 'estado' | 'orden' | 'p';
  /** Cambiar un filtro vuelve a la página 1: la actual podría no existir. */
  function buildHref(next: Partial<Record<HrefKey, string | undefined>>) {
    const current: Record<HrefKey, string | undefined> = {
      categoria: filters.categoria,
      rrss: filters.rrss,
      oferta: filters.oferta,
      q: filters.q,
      estado: filters.estado,
      orden: filters.orden === 'nuevos' ? undefined : filters.orden,
      p: undefined,
    };
    const merged = { ...current, ...next };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/productos?${qs}` : '/admin/productos';
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'
    }`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Productos aprobados</h1>
      <p className="mt-1 text-sm text-muted">
        {total} producto{total === 1 ? '' : 's'}
        {pages > 1 && ` · página ${page} de ${pages}`}. Desde cada uno sale el kit para redes: imágenes y textos
        listos para publicar.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {/* Formulario GET: buscar funciona sin JavaScript y conserva el resto
            de los filtros. */}
        <form action="/admin/productos" method="get" className="flex gap-2">
          {filters.categoria && <input type="hidden" name="categoria" value={filters.categoria} />}
          {filters.rrss && <input type="hidden" name="rrss" value={filters.rrss} />}
          {filters.oferta && <input type="hidden" name="oferta" value={filters.oferta} />}
          {filters.estado && <input type="hidden" name="estado" value={filters.estado} />}
          {filters.orden !== 'nuevos' && <input type="hidden" name="orden" value={filters.orden} />}
          <label className="relative flex-1">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ''}
              placeholder="Buscar por nombre, marca o MLC…"
              className="w-full rounded-md border border-border bg-surface2 py-2 pl-8 pr-3 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-ink transition hover:bg-accent/90"
          >
            Buscar
          </button>
          {filters.q && (
            <Link
              href={buildHref({ q: undefined })}
              className="flex items-center rounded-md border border-border px-3 text-xs text-muted hover:text-fg"
            >
              Limpiar
            </Link>
          )}
        </form>

        <div className="flex flex-wrap gap-2">
          {ESTADOS.map((e) => (
            <Link
              key={e.value}
              href={buildHref({ estado: e.value === 'todos' ? undefined : e.value })}
              className={chip((e.value === 'todos' && !filters.estado) || filters.estado === e.value)}
            >
              {e.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href={buildHref({ categoria: undefined })} className={chip(!filters.categoria)}>
            Todas las categorías
          </Link>
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={buildHref({ categoria: c.slug })} className={chip(filters.categoria === c.slug)}>
              {c.name}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildHref({ oferta: filters.oferta ? undefined : '1' })}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
              filters.oferta ? 'border-accent bg-accent/10 text-accent' : 'border-border text-muted hover:text-fg'
            }`}
          >
            <Flame size={12} /> Solo en oferta
          </Link>
          {RRSS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={buildHref({ rrss: f.value === 'todos' ? undefined : f.value })}
              className={chip((f.value === 'todos' && !filters.rrss) || filters.rrss === f.value)}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Orden:</span>
          {ORDENES.map((o) => (
            <Link
              key={o.value}
              href={buildHref({ orden: o.value === 'nuevos' ? undefined : o.value })}
              className={chip(filters.orden === o.value)}
            >
              {o.label}
            </Link>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-6 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          No se pudo leer los productos: {error}
        </p>
      )}

      <div className="mt-8">
        {/* key: al cambiar de página o filtro, la selección parte de cero. */}
        <ProductsList key={`${page}-${JSON.stringify(filters)}`} products={products} siteUrl={SITE_URL} />
      </div>

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between text-xs" aria-label="Paginación">
          {page > 1 ? (
            <Link
              href={buildHref({ p: page - 1 > 1 ? String(page - 1) : undefined })}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-muted hover:text-fg"
            >
              <ChevronLeft size={13} /> Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link
              href={buildHref({ p: String(page + 1) })}
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-muted hover:text-fg"
            >
              Siguiente <ChevronRight size={13} />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
