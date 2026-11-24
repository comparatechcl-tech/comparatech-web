import Link from 'next/link';
import type { Metadata } from 'next';
import { ListOrdered, ShieldCheck, RefreshCw, ThumbsUp } from 'lucide-react';
import { SocialLinks } from '@/components/brand/SocialLinks';

/**
 * Cómo funciona el sitio, en cuatro pasos. Cada frase dice solo lo que el
 * sitio hace de verdad y de forma automática: nadie revisa ni prueba los
 * productos uno por uno, así que nada acá puede prometerlo.
 */
const STEPS = [
  // Desde el 17-10-2026 también de lo más buscado: ML cerró la lista de más vendidos (ver lib/prospect-source).
  { icon: ListOrdered, title: 'Traemos', desc: 'Los productos salen de lo más vendido y lo más buscado en Mercado Libre Chile.' },
  // En pasado y sin "se actualiza solo": desde el 23-11-2026 Mercado Libre no deja volver a revisar vendedor ni precio.
  { icon: ShieldCheck, title: 'Filtramos', desc: 'Agregamos cada producto cuando su vendedor tenía buena reputación en Mercado Libre.' },
  { icon: RefreshCw, title: 'Anotamos', desc: 'Cada precio va con la fecha en que lo revisamos, y guardamos su historial.' },
  { icon: ThumbsUp, title: 'Tú decides', desc: 'Comparas acá. El precio de hoy y la compra están en Mercado Libre.' },
];

export const metadata: Metadata = {
  title: 'Nosotros',
  alternates: { canonical: '/nosotros' },
  description: 'Qué es ComparaTech y de dónde salen los productos y los precios que mostramos.',
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
      <p className="mt-4 text-sm text-muted">
        El detalle, con el historial de precios y qué significa cada etiqueta, está en{' '}
        <Link href="/como-funciona" className="text-accent hover:underline">
          Cómo funciona
        </Link>
        .
      </p>

      <div className="mt-10">
        <SocialLinks className="justify-center" />
      </div>

      <div className="mt-10 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          ¿Una duda o un precio que no coincide?{' '}
          <Link href="/contacto" className="text-accent hover:underline">
            Escríbenos
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
