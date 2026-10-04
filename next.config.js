/**
 * Cabeceras de seguridad para todo el sitio.
 *
 * - X-Frame-Options / frame-ancestors: nadie puede meter el sitio en un
 *   iframe (evita que otro sitio disfrace los botones de compra o el admin).
 * - nosniff: el navegador no adivina tipos de archivo.
 * - Referrer-Policy: Mercado Libre sigue viendo que el clic viene de
 *   ComparaTech (sirve para la atribución), pero sin la ruta completa.
 * - Permissions-Policy: el sitio no usa cámara, micrófono ni ubicación.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
];

/**
 * CSP solo en producción: `next dev` usa eval y websockets para recargar en
 * caliente, y una CSP estricta lo rompe. Sin nonces a propósito: un nonce
 * cambia en cada request y obligaría a renderizar todo en cada visita,
 * perdiendo el ISR. 'unsafe-inline' cubre los scripts que Next incrusta en
 * el HTML y el script de next-themes que evita el parpadeo del modo oscuro.
 * Las imágenes de productos vienen directo del CDN de Mercado Libre.
 */
function buildContentSecurityPolicy() {
  // En los deploys de Preview, Vercel inyecta su barra de comentarios desde
  // vercel.live. Sin esto la consola de Preview se llena de avisos de CSP
  // que no existen en producción y tapan los que sí importan.
  const toolbar = process.env.VERCEL_ENV === 'preview';
  const extra = (sources) => (toolbar ? ` ${sources}` : '');

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${extra('https://vercel.live')}`,
    `style-src 'self' 'unsafe-inline'${extra('https://vercel.live')}`,
    `img-src 'self' data: https://*.mlstatic.com${extra('https://vercel.live https://vercel.com blob:')}`,
    `font-src 'self'${extra('https://vercel.live https://assets.vercel.com')}`,
    `connect-src 'self'${extra('https://vercel.live wss://ws-us3.pusher.com')}`,
    ...(toolbar ? ['frame-src https://vercel.live'] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** El admin y la API no se indexan ni se guardan en cachés intermedios. */
const privateHeaders = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'no-store' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // No anunciar con qué está hecho el sitio: solo ayuda a quien busca
  // versiones con vulnerabilidades conocidas.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      // Imágenes reales de fichas de Mercado Libre (CDN oficial). ML sirve
      // imágenes desde varios subdominios por shard (http2, mla-s1-p,
      // mla-s2-p, etc.) — el comodín cubre cualquiera de ellos.
      { protocol: 'https', hostname: '*.mlstatic.com' },
      { protocol: 'https', hostname: 'mlstatic.com' },
    ],
  },
  async headers() {
    const siteHeaders =
      process.env.NODE_ENV === 'production'
        ? [...securityHeaders, { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() }]
        : securityHeaders;

    return [
      { source: '/:path*', headers: siteHeaders },
      { source: '/admin/:path*', headers: privateHeaders },
      { source: '/api/:path*', headers: privateHeaders },
    ];
  },
};

module.exports = nextConfig;
