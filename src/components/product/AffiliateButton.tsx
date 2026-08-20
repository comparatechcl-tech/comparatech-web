/**
 * Único punto de salida hacia Mercado Libre. Es un <a> estándar: se abre
 * solo por clic explícito del usuario (sin redirects automáticos, sin
 * pop-ups), como exigen las reglas del Programa de Afiliados.
 */
export function AffiliateButton({
  href,
  className = '',
}: {
  href: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="nofollow sponsored noopener"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl bg-mlYellow px-5 py-3 font-heading font-semibold text-[#1a1400] transition hover:brightness-95 ${className}`}
    >
      Ver en Mercado Libre
    </a>
  );
}
