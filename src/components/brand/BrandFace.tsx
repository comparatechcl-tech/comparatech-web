import Link from 'next/link';
import Image from 'next/image';

/**
 * Roxy, el rostro de la marca en el sitio y en los videos de redes.
 *
 * Es un personaje creado con inteligencia artificial, no una persona: no
 * fundó el sitio ni revisa productos, y el texto no puede decir ni insinuar
 * ninguna de las dos cosas. La foto es realista, así que el texto lo dice con
 * todas sus letras: "virtual" a secas se lee también como "en línea".
 * Va corto a propósito.
 */
export function BrandFace({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6 text-center sm:flex-row sm:text-left ${
        compact ? '' : 'sm:p-8'
      }`}
    >
      <Image
        src="/roxy.jpg"
        alt="Roxy, personaje virtual de ComparaTech"
        width={80}
        height={80}
        className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-accent/40"
      />
      <div>
        <p className="font-heading text-lg font-semibold text-fg">
          Roxy, presentadora virtual de ComparaTech
        </p>
        <p className="mt-1 text-sm text-muted">
          Es un personaje creado con inteligencia artificial. La vas a ver acá
          y en nuestros videos, mostrando precios y ofertas de Mercado Libre.
        </p>
        {!compact && (
          <Link href="/nosotros" className="mt-3 inline-block text-sm text-accent hover:underline">
            Cómo funciona ComparaTech →
          </Link>
        )}
      </div>
    </div>
  );
}
