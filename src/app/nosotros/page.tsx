import type { Metadata } from 'next';
import { ListOrdered, ShieldCheck, RefreshCw, ThumbsUp } from 'lucide-react';
import { BrandFace } from '@/components/brand/BrandFace';
import { SocialLinks } from '@/components/brand/SocialLinks';

/**
 * Cómo funciona el sitio, en cuatro pasos. Cada frase dice solo lo que el
 * sitio hace de verdad y de forma automática: nadie revisa ni prueba los
 * productos uno por uno, así que nada acá puede prometerlo.
 */
const STEPS = [
  { icon: ListOrdered, title: 'Traemos', desc: 'Los productos salen de las listas de más vendidos de Mercado Libre Chile.' },
  { icon: ShieldCheck, title: 'Filtramos', desc: 'Solo mostramos productos de vendedores con buena reputación en Mercado Libre.' },
  { icon: RefreshCw, title: 'Actualizamos', desc: 'El precio se actualiza solo, varias veces al día.' },
  { icon: ThumbsUp, title: 'Tú decides', desc: 'Comparas acá y compras en Mercado Libre.' },
];

export const metadata: Metadata = {
  title: 'Nosotros',
  alternates: { canonical: '/nosotros' },
  description: 'Cómo funciona ComparaTech: de dónde salen los productos y los precios, y cómo gana dinero el sitio.',
};

export default function NosotrosPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-4 font-heading text-2xl font-bold">Nosotros</h1>

      <div className="space-y-4 text-sm leading-relaxed text-muted">
        <p>
          ComparaTech junta en un solo lugar precios y especificaciones de
          productos de Mercado Libre Chile, para que compares sin abrir veinte
          pestañas.
        </p>
        <p>
          Todo sale de las fichas de Mercado Libre y puede cambiar: el precio
          que vale es el que ves ahí al momento de comprar.
        </p>
      </div>

      <h2 className="mt-10 font-heading text-lg font-semibold text-fg">Cómo funciona</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.title} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <Icon size={16} />
                </span>
                <span className="font-heading text-xs font-semibold text-muted">
                  {String(i + 1).padStart(2, '0')}
                </span>
              </div>
              <p className="mt-3 font-heading text-sm font-semibold text-fg">{s.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{s.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-10">
        <BrandFace compact />
        <SocialLinks className="mt-4 justify-center" />
      </div>

      <div className="mt-10 space-y-4 text-sm leading-relaxed text-muted">
        <h2 className="font-heading text-lg font-semibold text-fg">
          Cómo ganamos dinero
        </h2>
        <p>
          Participamos en el Programa de Afiliados y Creadores de Mercado
          Libre. Si compras a través de uno de nuestros links, podemos recibir
          una comisión, sin costo extra para ti. Esa comisión influye en qué
          productos aparecen en el sitio.
        </p>
      </div>
    </div>
  );
}
