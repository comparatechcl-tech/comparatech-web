import Link from 'next/link';
import Image from 'next/image';

/**
 * Componente de posicionamiento personal. Ancla la imagen de la persona
 * detrás de ComparaTech en el sitio (para linkear desde bio de Instagram/
 * TikTok) y sirve de referencia de "autoridad" para SEO (E-E-A-T).
 */
export function FounderBio({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6 text-center sm:flex-row sm:text-left ${
        compact ? '' : 'sm:p-8'
      }`}
    >
      <Image
        src="/roxana.jpg"
        alt="Roxana, fundadora de ComparaTech"
        width={80}
        height={80}
        className="h-20 w-20 shrink-0 rounded-full object-cover ring-2 ring-accent/40"
      />
      <div>
        <p className="font-heading text-lg font-semibold text-white">
          Roxana — Fundadora de ComparaTech
        </p>
        <p className="mt-1 text-sm text-muted">
          Cada producto que ves acá lo revisamos a fondo: precio, specs y
          opiniones reales, para ahorrarte el tiempo de comparar por tu
          cuenta. La idea es simple: explicarte qué conviene comprar y por
          qué, sin letra chica ni tecnicismos.
        </p>
        {!compact && (
          <Link href="/nosotros" className="mt-3 inline-block text-sm text-accent hover:underline">
            Conoce la historia completa →
          </Link>
        )}
      </div>
    </div>
  );
}
