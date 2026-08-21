import type { Metadata } from 'next';
import { Search, GitCompareArrows, ClipboardCheck, ThumbsUp } from 'lucide-react';
import { FounderBio } from '@/components/brand/FounderBio';
import { SocialLinks } from '@/components/brand/SocialLinks';

const STEPS = [
  { icon: Search, title: 'Buscamos', desc: 'Rastreamos los productos más vendidos en las categorías que nos importan.' },
  { icon: GitCompareArrows, title: 'Comparamos', desc: 'Precio, specs y vendedor, uno al lado del otro, sin letra chica.' },
  { icon: ClipboardCheck, title: 'Analizamos', desc: 'Descartamos vendedores sin reputación verde y precios que no cuadran.' },
  { icon: ThumbsUp, title: 'Tú decides', desc: 'Te dejamos la comparación lista — la decisión de compra es tuya.' },
];

export const metadata: Metadata = {
  title: 'Nosotros',
  description: 'Quiénes están detrás de ComparaTech y cómo elegimos qué recomendar.',
};

export default function NosotrosPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 font-heading text-2xl font-bold">Nosotros</h1>

      <FounderBio compact />
      <SocialLinks className="mt-4 justify-center" />

      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <div className="mt-10 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          ComparaTech nace para simplificar la decisión de compra de
          tecnología y artículos para el hogar en Chile: reunimos precios,
          descuentos y especificaciones en un solo lugar para que compares
          sin tener que abrir veinte pestañas.
        </p>
        <p>
          Detrás del proyecto está Roxana, quien revisa cada producto que
          aparece en el sitio: compara precios, lee las especificaciones y
          descarta lo que no cumple. La idea no es venderte lo primero que
          aparece, sino ahorrarte el tiempo de comparar por tu cuenta y
          explicarte en simple qué conviene comprar y por qué — sin letra
          chica ni tecnicismos.
        </p>
        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">
          Cómo ganamos dinero
        </h2>
        <p>
          Somos afiliados del Programa de Afiliados y Creadores de Mercado
          Libre. Cuando compras un producto a través de uno de nuestros
          links, podemos recibir una comisión — sin costo adicional para ti.
          Esto no cambia el precio que pagas ni influye en qué producto
          recomendamos: solo trabajamos con vendedores de reputación verde y
          no publicamos afirmaciones sobre productos que no podamos
          verificar.
        </p>
      </div>
    </div>
  );
}
