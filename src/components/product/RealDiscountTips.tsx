/**
 * "Cómo saber si un descuento es de verdad": los mismos puntos en
 * /black-friday y en /historial-de-precios, para que digan lo mismo.
 */
export function RealDiscountTips({ id = 'descuento-real' }: { id?: string }) {
  return (
    <section aria-labelledby={id} className="mt-10 max-w-3xl">
      <h2 id={id} className="mb-3 font-heading text-lg font-semibold">
        Cómo saber si un descuento es de verdad
      </h2>
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
        <li>
          El porcentaje de descuento lo calcula cada vendedor en Mercado Libre, sobre un precio que él mismo informa. Por
          eso un producto puede tener &quot;50% de descuento&quot; todo el año.
        </li>
        <li>
          Mira el historial de precios en la ficha del producto: si el precio de hoy en Mercado Libre está igual al
          promedio que registramos, no bajó.
        </li>
        <li>Compáralo con el más bajo registrado: la ficha dice cuándo fue y cuánto duró.</li>
        <li>
          Si el precio cambia muchas veces en pocas horas (pasa cuando dos vendedores se turnan la venta), míralo de
          nuevo en Mercado Libre justo antes de comprar.
        </li>
        {/* Sin "solo aparecen vendedores con reputación verde": desde el 23-11-2026 no se puede volver a revisar quién vende. */}
        <li>Fíjate en el vendedor: en Mercado Libre, la reputación verde es la más alta.</li>
      </ol>
    </section>
  );
}
