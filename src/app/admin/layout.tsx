import { getSupabaseAdmin } from '@/lib/supabase/server';
import { AdminTabs } from './AdminTabs';

export const dynamic = 'force-dynamic';

// Las acciones del admin consultan Mercado Libre en el momento ("Revisar
// todos ahora" revisa decenas de productos): sin esto quedan sujetas al
// tope por defecto de Vercel.
export const maxDuration = 60;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = getSupabaseAdmin();

  // Los contadores en las pestañas dicen de un vistazo si hay algo que hacer,
  // sin tener que esperar al correo de la mañana.
  const [pending, problems] = admin
    ? await Promise.all([
        admin
          .from('product_candidates')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending_review'),
        admin
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', false)
          .eq('is_hidden', false),
      ])
    : [{ count: 0 }, { count: 0 }];

  return (
    <div>
      <div className="border-b border-border bg-surface">
        <AdminTabs pending={pending.count ?? 0} problems={problems.count ?? 0} />
      </div>
      {children}
    </div>
  );
}
