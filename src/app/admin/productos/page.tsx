import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { Product, RrssStatus } from '@/lib/types';
import { CATEGORIES } from '@/lib/categories';
import { ProductsList } from './ProductsList';

export const dynamic = 'force-dynamic';

const RRSS_FILTERS: { value: RrssStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'sin_usar', label: 'Sin usar' },
  { value: 'seleccionado', label: 'Seleccionado' },
  { value: 'publicado', label: 'Publicado' },
];

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ categoria?: string; rrss?: string }>;
}) {
  const { categoria, rrss } = await searchParams;

  const admin = getSupabaseAdmin();
  let query = admin
    ?.from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (categoria) query = query?.eq('category', categoria);
  if (rrss) query = query?.eq('rrss_status', rrss);

  const products: Product[] = admin ? ((await query)?.data ?? []) : [];

  function buildHref(next: { categoria?: string; rrss?: string }) {
    const params = new URLSearchParams();
    const finalCategoria = next.categoria !== undefined ? next.categoria : categoria;
    const finalRrss = next.rrss !== undefined ? next.rrss : rrss;
    if (finalCategoria) params.set('categoria', finalCategoria);
    if (finalRrss) params.set('rrss', finalRrss);
    const qs = params.toString();
    return qs ? `/admin/productos?${qs}` : '/admin/productos';
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold text-fg">Productos aprobados</h1>
      <p className="mt-1 text-sm text-muted">
        {products.length} producto{products.length === 1 ? '' : 's'}. Marca cuáles ya se usaron en RRSS para no
        repetir contenido.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildHref({ categoria: undefined })}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              !categoria ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'
            }`}
          >
            Todas las categorías
          </Link>
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={buildHref({ categoria: c.slug })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                categoria === c.slug ? 'border-accent text-accent' : 'border-border text-muted hover:text-fg'
              }`}
            >
              {c.name}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          {RRSS_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={buildHref({ rrss: f.value === 'todos' ? undefined : f.value })}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                (f.value === 'todos' && !rrss) || rrss === f.value
                  ? 'border-accent text-accent'
                  : 'border-border text-muted hover:text-fg'
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <ProductsList products={products} />
      </div>
    </main>
  );
}
