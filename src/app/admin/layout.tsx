import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { readAffiliateSettings } from '@/lib/settings';
import { directLinksInUse, readAttributionStatus } from '@/lib/admin-settings';
import { readActionNeededCount } from '@/lib/admin-stats';
import { countPendingModels } from '@/lib/candidate-queue';
import { AdminTabs } from './AdminTabs';

export const dynamic = 'force-dynamic';

// Las acciones del admin consultan Mercado Libre en el momento ("Revisar
// todos ahora" revisa decenas de productos): sin esto quedan sujetas al
// tope por defecto de Vercel.
export const maxDuration = 60;

// El admin pide clave, pero igual se le dice a los buscadores que no lo
// indexen: una URL filtrada no debería terminar en Google.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = getSupabaseAdmin();

  // Los contadores en las pestañas dicen de un vistazo si hay algo que hacer,
  // sin tener que esperar al correo de la mañana. Problemas cuenta solo lo
  // que pide acción: los que están en pausa vuelven solos. Candidatos cuenta
  // modelos, igual que la cola (lib/candidate-queue): antes contaba cada
  // color y el número no calzaba con el de la cola.
  //
  // Qué cuenta como problema depende del modo de links: con los directos en
  // uso, un link guardado malo no le llega a ningún comprador. Por eso la
  // configuración se lee antes que los productos.
  const pendingCount = countPendingModels(admin);
  const [settings, attribution] = await Promise.all([readAffiliateSettings(admin), readAttributionStatus(admin)]);
  const [pending, problems] = await Promise.all([
    pendingCount,
    readActionNeededCount(admin, directLinksInUse(settings, attribution)),
  ]);

  // Links directos encendidos sin una compra de prueba que confirme que ML
  // los atribuye: cada clic podría estar dejando de pagar comisión. Se
  // muestra en todas las pestañas hasta que se confirme o se apaguen.
  const unverifiedDirect = settings.directLinks && attribution.status !== 'confirmada';

  return (
    <div>
      {/* Sobre la cabecera del sitio (z-40): al bajar, las pestañas quedan
          arriba y tapan la cabecera, que en el admin no hace falta. */}
      <div className="sticky top-0 z-50 border-b border-border bg-surface">
        <AdminTabs pending={pending} problems={problems ?? 0} />
      </div>
      {unverifiedDirect && (
        <div className="border-b border-red-500/30 bg-red-500/10">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-red-400">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Links directos encendidos sin comprobar. Si Mercado Libre no los atribuye, estos clics no te pagan
                comisión.
              </span>
            </p>
            <Link
              href="/admin/configuracion"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-red-500/40 bg-surface px-3 py-2 text-sm font-medium text-fg transition hover:border-red-400"
            >
              Ir a Configuración
            </Link>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
