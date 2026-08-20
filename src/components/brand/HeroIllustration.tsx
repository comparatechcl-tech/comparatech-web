/**
 * Composición vectorial propia (no fotos, no render 3D) que evoca la idea de
 * "dispositivos sobre una plataforma iluminada": siluetas geométricas de
 * laptop, celular, audífonos y earbuds, con gradientes azul→cyan y glow. Es
 * una ilustración plana con degradados, no un intento de fotorrealismo.
 */
export function HeroIllustration({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 420 340" className={className} role="img" aria-label="">
      <defs>
        <linearGradient id="hi-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#087EFF" />
          <stop offset="1" stopColor="#00D4FF" />
        </linearGradient>
        <linearGradient id="hi-blue-soft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1C3A66" />
          <stop offset="1" stopColor="#0B1220" />
        </linearGradient>
        <radialGradient id="hi-platform" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#00D4FF" stopOpacity="0.35" />
          <stop offset="70%" stopColor="#087EFF" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#087EFF" stopOpacity="0" />
        </radialGradient>
        <filter id="hi-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      {/* Glow de la plataforma */}
      <ellipse cx="210" cy="270" rx="170" ry="55" fill="url(#hi-platform)" filter="url(#hi-blur)" />
      {/* Anillo de la plataforma */}
      <ellipse cx="210" cy="278" rx="130" ry="16" fill="none" stroke="url(#hi-blue)" strokeWidth="1.5" opacity="0.5" />
      <ellipse cx="210" cy="278" rx="130" ry="16" fill="#00D4FF" opacity="0.06" />

      {/* Headphones (atrás, izquierda) */}
      <g transform="translate(58,90)" opacity="0.95">
        <path d="M8 78 C8 30 40 4 74 4 C108 4 140 30 140 78" fill="none" stroke="url(#hi-blue)" strokeWidth="9" strokeLinecap="round" />
        <rect x="0" y="70" width="24" height="46" rx="12" fill="url(#hi-blue-soft)" stroke="url(#hi-blue)" strokeWidth="2" />
        <rect x="124" y="70" width="24" height="46" rx="12" fill="url(#hi-blue-soft)" stroke="url(#hi-blue)" strokeWidth="2" />
      </g>

      {/* Laptop (centro-atrás) */}
      <g transform="translate(150,60)">
        <path d="M20 132 L34 20 Q35 12 44 12 L146 12 Q155 12 156 20 L170 132 Z" fill="url(#hi-blue-soft)" stroke="url(#hi-blue)" strokeWidth="2" />
        <rect x="46" y="24" width="98" height="96" rx="4" fill="#050914" stroke="url(#hi-blue)" strokeWidth="1.2" opacity="0.9" />
        <rect x="54" y="34" width="82" height="4" rx="2" fill="url(#hi-blue)" opacity="0.7" />
        <rect x="54" y="44" width="60" height="4" rx="2" fill="url(#hi-blue)" opacity="0.4" />
        <path d="M4 132 L186 132 L196 152 Q198 158 190 158 L0 158 Q-8 158 -6 152 Z" fill="url(#hi-blue-soft)" stroke="url(#hi-blue)" strokeWidth="1.5" />
      </g>

      {/* Teléfono (frente, centro) */}
      <g transform="translate(184,96) rotate(-4 40 100)">
        <rect x="0" y="0" width="80" height="168" rx="18" fill="url(#hi-blue-soft)" stroke="url(#hi-blue)" strokeWidth="2.2" />
        <rect x="8" y="10" width="64" height="148" rx="11" fill="#050914" />
        <rect x="8" y="10" width="64" height="90" rx="11" fill="url(#hi-blue)" opacity="0.22" />
        <circle cx="40" cy="10" r="2.4" fill="url(#hi-blue)" />
      </g>

      {/* Earbuds case (frente, derecha) */}
      <g transform="translate(288,210) rotate(8 30 30)">
        <rect x="0" y="14" width="62" height="42" rx="14" fill="url(#hi-blue-soft)" stroke="url(#hi-blue)" strokeWidth="2" />
        <rect x="4" y="0" width="54" height="20" rx="10" fill="none" stroke="url(#hi-blue)" strokeWidth="2" opacity="0.7" />
        <circle cx="20" cy="35" r="8" fill="#050914" stroke="url(#hi-blue)" strokeWidth="1.5" />
        <circle cx="42" cy="35" r="8" fill="#050914" stroke="url(#hi-blue)" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
