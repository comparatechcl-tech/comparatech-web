import Link from 'next/link';
import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';

export const metadata: Metadata = {
  title: 'Cómo funciona',
  alternates: { canonical: '/como-funciona' },
  description:
    'De dónde salen los productos y los precios de ComparaTech, cómo funciona el historial de precios y qué significa cada etiqueta.',
};

/**
 * Cómo funciona el sitio, en corto (SEO etapa 2, punto 8: Google confía más
 * en un sitio que explica de dónde salen sus datos y quién responde).
 *
 * El dueño pidió poco detalle y no hablar de la comisión (18-10-2026): eso
 * queda solo en /terminos. Cada frase tiene que seguir siendo cierta para lo
 * que hace el código (de dónde salen los productos, cómo se elige el precio,
 * cuándo se dice "Bajó"); si eso cambia, se cambia acá también. Nada acá
 * puede prometer que alguien revise o pruebe los productos.
 */
export default function ComoFuncionaPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Breadcrumbs items={[{ name: 'Inicio', href: '/' }, { name: 'Cómo funciona' }]} />
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">Cómo funciona ComparaTech</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Mostramos precios de tecnología y hogar de Mercado Libre Chile y cómo se han movido en el tiempo. La compra se
        hace en Mercado Libre.
      </p>

      <Section id="productos" title="Los productos">
        {/* En pasado: desde el 23-11-2026 Mercado Libre no deja volver a mirar quién vende cada producto. */}
        <p>
          Salen de lo más vendido y lo más buscado en Mercado Libre Chile. Los agregamos cuando su vendedor tenía
          reputación verde. Las especificaciones son las que publica Mercado Libre.
        </p>
      </Section>

      <Section id="precios" title="El precio">
        <p>
          Es el que mostraba Mercado Libre en la ficha del producto la última vez que lo revisamos, o el que Mercado
          Libre informó ese día en su canal para afiliados: esa fecha va junto al precio. El de hoy es el que ves en
          Mercado Libre al momento de comprar.
        </p>
      </Section>

      <Section id="historial" title="El historial de precios">
        <p>
          Anotamos cada cambio de precio que vimos, hasta la última revisión. En cada ficha hay un gráfico, el promedio
          y el precio más bajo y más alto que registramos.
        </p>
      </Section>

      <Section id="etiquetas" title="Qué significa cada etiqueta">
        <dl className="space-y-3">
          <Term name="Precio del… (con una fecha)">
            El precio de la última revisión, con su día. El de hoy está en Mercado Libre.
          </Term>
          <Term name="% de descuento">Lo informa el vendedor en Mercado Libre.</Term>
          <Term name="Bajó $X">El precio de hoy es menor que el que registramos antes.</Term>
          <Term name="Destacado">Productos que elegimos mostrar primero.</Term>
          <Term name="Envío gratis">Lo informa Mercado Libre.</Term>
        </dl>
      </Section>

      <Section id="quienes" title="Quiénes somos">
        <p>
          ComparaTech es un proyecto independiente hecho en Chile: no somos parte de Mercado Libre.
        </p>
        <p>
          ¿Una duda o un precio que no coincide?{' '}
          <Link href="/contacto" className="text-accent hover:underline">
            Escríbenos
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      {/* scroll-mt: el ancla (/como-funciona#historial) deja el título a la vista, bajo el encabezado fijo. */}
      <h2 id={id} className="mb-2 scroll-mt-24 font-heading text-lg font-semibold text-fg">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function Term({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-fg">{name}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
