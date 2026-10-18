import Link from 'next/link';
import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/product/Breadcrumbs';
import { MIN_DEAL_DISCOUNT } from '@/lib/deal-rank';

export const metadata: Metadata = {
  title: 'Cómo funciona',
  alternates: { canonical: '/como-funciona' },
  description:
    'De dónde salen los productos y los precios de ComparaTech, cómo se arma el historial de precios, qué significa cada etiqueta y cómo gana dinero el sitio.',
};

/**
 * Cómo funciona el sitio, en detalle (SEO etapa 2, punto 8: Google confía
 * más en un sitio que explica de dónde salen sus datos, cómo gana dinero y
 * quién responde).
 *
 * Cada frase tiene que ser cierta para lo que el código hace hoy. Si cambia
 * de dónde salen los productos (lib/prospect-source), cómo se elige el precio
 * (lib/pricing), cómo se decide "Bajó" (lib/deals, lib/deal-rank) o lo que
 * muestra el historial (lib/price-chart), se cambia acá también. Nadie revisa
 * ni prueba los productos uno por uno: nada acá puede prometerlo.
 */
export default function ComoFuncionaPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Breadcrumbs items={[{ name: 'Inicio', href: '/' }, { name: 'Cómo funciona' }]} />
      <h1 className="font-heading text-2xl font-bold sm:text-3xl">Cómo funciona ComparaTech</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        ComparaTech muestra precios de tecnología y hogar de Mercado Libre Chile, y cómo se han movido en el tiempo.
        No vendemos nada: la compra se hace en Mercado Libre.
      </p>

      <Section id="productos" title="De dónde salen los productos">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Salen de listas de Mercado Libre Chile, como lo más vendido y lo más buscado de cada categoría, por un proceso
            automático. Algunos los agregamos nosotros.
          </li>
          <li>
            Solo aparecen los que tienen un vendedor con reputación verde en Mercado Libre. Si nadie con reputación verde
            lo vende, el producto deja de aparecer en los listados hasta que vuelva.
          </li>
          <li>
            Los colores de un mismo modelo van en una sola tarjeta, con el precio del más barato. En la ficha están los
            demás.
          </li>
          <li>
            Nadie prueba ni revisa los productos uno por uno. Las especificaciones y la descripción son las que publica
            Mercado Libre.
          </li>
          <li>
            La comisión que ganamos influye en qué productos aparecen (ver{' '}
            <a href="#dinero" className="text-accent hover:underline">
              cómo ganamos dinero
            </a>
            ).
          </li>
        </ul>
      </Section>

      <Section id="precios" title="De dónde sale el precio">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Es el de la oferta que Mercado Libre muestra primero en la ficha del producto, la que se compra con su botón de
            compra. Si hay varios vendedores, es el precio de ese vendedor.
          </li>
          <li>
            Se actualiza solo, varias veces al día, y entre una actualización y otra puede cambiar. El precio que vale es
            el que ves en Mercado Libre al momento de comprar.
          </li>
          <li>El envío gratis y la reputación del vendedor también los informa Mercado Libre en cada actualización.</li>
        </ul>
      </Section>

      <Section id="historial" title="El historial de precios">
        <p>
          Desde octubre de 2026 anotamos cada cambio de precio que vemos en cada producto. Con eso, la ficha muestra:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>un gráfico de cómo se movió el precio en los últimos 90 días, o desde que lo seguimos;</li>
          <li>
            el promedio de los últimos 30 días, que cuenta cuánto tiempo duró cada precio: uno que duró una hora pesa
            menos que uno que duró una semana;
          </li>
          <li>el precio más bajo y el más alto que registramos, y cuánto duró el más bajo si fue menos de un día;</li>
          <li>un aviso cuando el precio cambia muchas veces en poco tiempo, que pasa cuando dos vendedores se turnan la venta;</li>
          <li>los últimos cambios, con fecha y hora.</li>
        </ul>
        <p>Mostramos solo lo que registramos: no decimos si conviene comprar.</p>
      </Section>

      <Section id="etiquetas" title="Qué significa cada etiqueta">
        <dl className="space-y-4">
          <Term name="% de descuento">
            Lo informa el vendedor en Mercado Libre, calculado sobre un precio que él mismo indica, y la cifra tachada
            también. No lo verificamos: hay productos con el mismo descuento todo el año. En Ofertas aparecen los que
            tienen {MIN_DEAL_DISCOUNT}% o más.
          </Term>
          <Term name="Bajó $X">
            El precio de hoy es menor que el que registramos antes, según nuestro historial. Solo aparece si el precio
            anterior duró lo suficiente y si no es un precio que va y viene.
          </Term>
          <Term name="El precio más bajo que registramos en los últimos 30 días">
            Necesita al menos 30 días de historial y que en ese tiempo haya habido un precio más alto. Con menos historial
            decimos &quot;desde que lo seguimos&quot; y cuántos días van.
          </Term>
          <Term name="Destacado">Productos que elegimos mostrar primero. No quiere decir que los hayamos probado.</Term>
          <Term name="Envío gratis">Lo informa Mercado Libre para la oferta que mostramos, en la última actualización.</Term>
        </dl>
      </Section>

      <Section id="dinero" title="Cómo ganamos dinero">
        <p>
          Participamos en el Programa de Afiliados y Creadores de Mercado Libre. Si compras con uno de nuestros links,
          Mercado Libre nos paga una comisión, sin costo extra para ti. Esa comisión influye en qué productos aparecen en
          el sitio.
        </p>
      </Section>

      <Section id="quienes" title="Quiénes somos">
        <p>
          ComparaTech es un proyecto independiente hecho en Chile: no somos parte de Mercado Libre. En redes sociales nos
          presenta Roxy, un personaje creado con inteligencia artificial.
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
    <section aria-labelledby={id} className="mt-10">
      {/* scroll-mt: el ancla (/como-funciona#historial) deja el título a la vista, bajo el encabezado fijo. */}
      <h2 id={id} className="mb-3 scroll-mt-24 font-heading text-lg font-semibold text-fg">
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
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
