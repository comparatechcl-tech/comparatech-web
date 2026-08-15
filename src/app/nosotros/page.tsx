import type { Metadata } from 'next';
import { FounderBio } from '@/components/brand/FounderBio';
import { SocialLinks } from '@/components/brand/SocialLinks';

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

      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
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
        <h2 className="pt-2 font-heading text-lg font-semibold text-white">
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
