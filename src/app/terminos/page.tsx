import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Términos de uso',
  alternates: { canonical: '/terminos' },
  description: 'Cómo funciona ComparaTech: precios informados por Mercado Libre y links de afiliado.',
};

const CONTACT_EMAIL = 'comparatech.cl@gmail.com';

export default function TerminosPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-heading text-2xl font-bold">Términos de uso</h1>
      <p className="mt-2 text-xs text-muted">Última actualización: octubre de 2026</p>

      <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted">
        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Qué es ComparaTech</h2>
        <p>
          ComparaTech es un comparador de precios de tecnología y hogar en Chile. No vendemos productos, no
          despachamos ni cobramos nada: la compra la haces directamente en Mercado Libre, con el vendedor que
          elijas, y se rige por sus condiciones.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Precios y disponibilidad</h2>
        <p className="rounded-xl border border-border bg-surface p-4 text-fg">
          Los precios son informados por Mercado Libre y pueden cambiar en cualquier momento.
        </p>
        <p>
          Los revisamos varias veces al día, pero entre una revisión y otra el vendedor puede cambiar el precio, el
          stock o las condiciones de despacho. Lo que vale es lo que ves en Mercado Libre al momento de comprar. El
          precio, la entrega, la garantía y las devoluciones son responsabilidad del vendedor y de Mercado Libre.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Links de afiliado</h2>
        <p>
          ComparaTech es afiliado del Programa de Afiliados y Creadores de Mercado Libre. Los botones &quot;Ver en
          Mercado Libre&quot; son links de afiliado: si compras después de tocarlos, podemos recibir una comisión,
          sin costo adicional para ti. La comisión no cambia el precio que pagas. Para decidir qué productos revisar y
          publicar consideramos, entre otras cosas, el precio, la reputación del vendedor y la comisión que paga
          Mercado Libre.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Contenido</h2>
        <p>
          Las especificaciones, fotos y descripciones vienen de las fichas de Mercado Libre y de los fabricantes, y
          las comparaciones son orientativas: antes de comprar, revisa la ficha del producto. Las marcas y logos
          pertenecen a sus respectivos dueños.
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Privacidad</h2>
        <p>
          Qué medimos y para qué está explicado en la{' '}
          <Link href="/privacidad" className="text-accent hover:underline">
            política de privacidad
          </Link>
          .
        </p>

        <h2 className="pt-2 font-heading text-lg font-semibold text-fg">Contacto</h2>
        <p>
          Si ves un precio o un dato equivocado, escríbenos a{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>{' '}
          y lo corregimos.
        </p>
      </div>
    </div>
  );
}
