import { useId } from 'react';

/**
 * Isotipo minimalista: anillo abierto (lente / "C" de ComparaTech) con mango
 * de lupa, y dos flechas opuestas adentro representando "comparar". Sin
 * ilustraciones complejas — funciona igual de bien a 16px (favicon) que a
 * 96px (hero).
 *
 * El id del degradado sale de useId: el logo aparece en el header y en el
 * footer de la misma página, y con un id fijo quedaban dos elementos con el
 * mismo id en el HTML. Se limpian los caracteres que React usa en sus ids
 * («», :) para que url(#...) los lea igual en todos los navegadores.
 */
export function Logo({ className = '', size = 32 }: { className?: string; size?: number }) {
  const id = `ct-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="ComparaTech"
    >
      <defs>
        <linearGradient id={id} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#087EFF" />
          <stop offset="1" stopColor="#00D4FF" />
        </linearGradient>
      </defs>
      <circle
        cx="14"
        cy="14"
        r="10.5"
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeDasharray="56 10"
        strokeDashoffset="-7"
      />
      <line
        x1="21.4"
        y1="21.4"
        x2="27"
        y2="27"
        stroke={`url(#${id})`}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M9.3 12.3h8.4M17.7 12.3l-2.2-2.2M17.7 12.3l-2.2 2.2" />
        <path d="M18.7 16.3h-8.4M10.3 16.3l2.2-2.2M10.3 16.3l2.2 2.2" />
      </g>
    </svg>
  );
}
