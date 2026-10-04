export const SOCIAL_LINKS = [
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/comparatech.cl',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
      </svg>
    ),
  },
  {
    // En TikTok "comparatech.cl" no estaba disponible: la cuenta es con guion bajo.
    name: 'TikTok',
    href: 'https://www.tiktok.com/@comparatech_cl',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M16.5 3c.3 1.9 1.6 3.4 3.5 3.8v2.7c-1.3 0-2.5-.4-3.5-1.1v6.4a5.4 5.4 0 1 1-5.4-5.4c.2 0 .4 0 .6.1v2.8a2.6 2.6 0 1 0 1.8 2.5V3h3z" />
      </svg>
    ),
  },
  {
    name: 'YouTube',
    href: 'https://www.youtube.com/@ComparaTechCL',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
        <path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 5 12 5 12 5s-7 0-8.9.4A3 3 0 0 0 1 7.5 31 31 0 0 0 .6 12a31 31 0 0 0 .4 4.5 3 3 0 0 0 2.1 2.1C5 19 12 19 12 19s7 0 8.9-.4a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-4.5 31 31 0 0 0-.4-4.5zM9.75 15.02V8.98L15.5 12l-5.75 3.02z" />
      </svg>
    ),
  },
];

/**
 * Íconos de redes sociales. Son las mismas cuentas declaradas como medios
 * en la Central de Afiliados: si cambia un usuario, hay que actualizarlo en
 * los dos lados.
 */
export function SocialLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex gap-3 ${className}`}>
      {SOCIAL_LINKS.map((social) => (
        <a
          key={social.name}
          href={social.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={social.name}
          className="text-muted transition hover:text-accent"
        >
          {social.icon}
        </a>
      ))}
    </div>
  );
}
