import Link from 'next/link';

/**
 * Componente de posicionamiento personal. Ancla la imagen de la persona
 * detrás de ComparaTech en el sitio (para linkear desde bio de Instagram/
 * TikTok) y sirve de referencia de "autoridad" para SEO (E-E-A-T).
 *
 * TODO antes de publicar: reemplazar nombre, foto y handles por los reales.
 */
export function FounderBio({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-6 text-center sm:flex-row sm:text-left ${
        compact ? '' : 'sm:p-8'
      }`}
    >
      <div className="h-20 w-20 shrink-0 rounded-full bg-surface2 ring-2 ring-accent/40" />
      <div>
        <p className="font-heading text-lg font-semibold text-white">
          [Nombre] — Fundadora de ComparaTech
        </p>
        <p className="mt-1 text-sm text-muted">
          Sin años de experiencia en tecnología, pero con toda la curiosidad y
          las ganas de probar, comparar y explicar en simple qué producto
          conviene comprar y por qué — sin tecnicismos innecesarios.
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
