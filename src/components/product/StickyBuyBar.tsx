'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import mlImageLoader from '@/lib/ml-image-loader';
import { formatCLP, formatDiscountPct } from '@/lib/format';
import { AffiliateButton } from './AffiliateButton';

/**
 * Barra de compra fija al pie de la ficha, solo en celulares.
 *
 * En un celular, al abrir la ficha el botón de compra suele quedar cortado o
 * bajo el borde de la pantalla, y más abajo desaparece mientras se lee la
 * descripción o las specs. La barra se ve siempre que ningún botón de la
 * página esté completo a la vista, descontando el espacio que ocupa la propia
 * barra (para no mostrar dos botones iguales a la vez). Se esconde también
 * sobre el pie de página: fija ahí tapaba sus últimas líneas, entre ellas el
 * aviso de que los precios pueden variar, y no había cómo desplazarlas a la
 * vista.
 *
 * Recibe solo datos sueltos y públicos: todo lo que se pasa a un componente
 * de cliente queda escrito en el HTML.
 */
export function StickyBuyBar({
  href,
  productId,
  productName,
  price,
  originalPrice,
  imageUrl,
  primaryCtaId,
  otherCtaIds = [],
}: {
  href: string;
  productId: string;
  productName: string;
  price: number;
  originalPrice: number | null;
  imageUrl: string;
  /** id del elemento que envuelve el botón principal. */
  primaryCtaId: string;
  /** Otros botones de compra de la página (el segundo CTA, tras las specs). */
  otherCtaIds?: string[];
}) {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const otherIdsKey = otherCtaIds.join(',');

  useEffect(() => {
    const primary = document.getElementById(primaryCtaId);
    if (!primary || typeof IntersectionObserver === 'undefined') return;

    const others = otherIdsKey
      .split(',')
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const ctas = [primary, ...others];

    // El pie no es un botón: solo cuenta como señal para esconder la barra.
    const footer = document.querySelector('footer');

    const ctaCompleto = new Map<Element, boolean>();
    let footerVisible = false;
    // Hasta que el observador informe cada botón, la barra no se muestra.
    const actualizar = () => {
      const todosInformados = ctas.every((el) => ctaCompleto.has(el));
      const algunoCompleto = ctas.some((el) => ctaCompleto.get(el));
      setVisible(todosInformados && !algunoCompleto && !footerVisible);
    };

    // Un botón cuenta como visible solo si se ve entero por encima de la barra.
    // 0,99 y no 1: el navegador redondea y a veces nunca informa 1 exacto.
    const alturaBarra = Math.ceil(barRef.current?.offsetHeight ?? 0);
    const ctaObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ctaCompleto.set(entry.target, entry.isIntersecting && entry.intersectionRatio >= 0.99);
        }
        actualizar();
      },
      { rootMargin: `0px 0px -${alturaBarra}px 0px`, threshold: [0, 0.99] },
    );
    ctas.forEach((el) => ctaObserver.observe(el));

    const footerObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) footerVisible = entry.isIntersecting;
      actualizar();
    });
    if (footer) footerObserver.observe(footer);

    return () => {
      ctaObserver.disconnect();
      footerObserver.disconnect();
    };
  }, [primaryCtaId, otherIdsKey]);

  const discount = formatDiscountPct(price, originalPrice);

  return (
    <div
      ref={barRef}
      // `invisible` además la saca del orden de tabulación y de los lectores
      // de pantalla mientras está fuera de la vista. Al ocultarse, la
      // visibilidad cambia al final de la transición, así se alcanza a ver
      // cómo baja.
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.18)] backdrop-blur-md transition-[transform,visibility] duration-200 sm:hidden ${
        visible ? 'visible translate-y-0' : 'invisible translate-y-full'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-white">
          <Image loader={mlImageLoader} src={imageUrl} alt="" fill sizes="44px" className="object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-base font-bold leading-tight text-fg">{formatCLP(price)}</p>
          {discount ? <p className="text-xs font-medium text-accent">-{discount}%</p> : null}
        </div>
        <AffiliateButton
          href={href}
          productId={productId}
          productName={productName}
          placement="ficha-sticky"
          label="Ver oferta en Mercado Libre"
          className="shrink-0 px-3 py-2.5 text-xs"
        />
      </div>
    </div>
  );
}

/**
 * Foto principal de la ficha. Vive acá, en un archivo de cliente, porque
 * <Image loader={...}> recibe una función y una función no puede pasar de un
 * componente de servidor a uno de cliente (next/image lo es). Con el loader
 * la foto sale directo del CDN de ML, sin gastar optimizaciones de Vercel.
 */
export function ProductHeroImage({ src, alt }: { src: string; alt: string }) {
  return (
    <Image
      loader={mlImageLoader}
      src={src}
      alt={alt}
      fill
      priority
      sizes="(min-width: 640px) 430px, 100vw"
      className="object-contain"
    />
  );
}
