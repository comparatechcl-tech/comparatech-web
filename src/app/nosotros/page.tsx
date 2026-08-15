import type { Metadata } from 'next';
import { FounderBio } from '@/components/brand/FounderBio';

export const metadata: Metadata = {
  title: 'Nosotros',
  description: 'Quiénes están detrás de ComparaTech y cómo elegimos qué recomendar.',
};

export default function NosotrosPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 font-heading text-2xl font-bold">Nosotros</h1>

      <FounderBio compact />

      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          ComparaTech nace para simplificar la decisión de compra de
          tecnología y artículos para el hogar en Chile: reunimos precios,
          descuentos y especificaciones en un solo lugar para que compares
          sin tener que abrir veinte pestañas.
        </p>
        <p>
          {/* TODO: reemplazar con la bio real de la fundadora — nombre,
              trayectoria/motivación y redes sociales (Instagram/TikTok) que
              se usarán también como bio link para el contenido de RRSS. */}
          Detrás del proyecto está [Nombre], quien está dando sus primeros
          pasos en el mundo tech pero le pone toda la actitud: prueba
          productos, compara opciones reales y comparte lo que aprende en
          el camino — sin pretender ser la experta con más años en el rubro,
          sino la persona que hace el trabajo pesado de comparar por ti.
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
