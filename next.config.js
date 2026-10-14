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
 * El origen del proyecto de Supabase (https://xxxx.supabase.co), o null.
 *
 * Solo el origen, y solo si es un dominio común con https: lo que venga de
 * más en la variable (una ruta, un punto y coma, una coma) no llega a la
 * cabecera, donde podría abrir otra directiva. Con una dirección http o mal
 * escrita la política queda como estaba, sin abrir nada.
 */
function supabaseOrigin() {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  if (!raw) return null;
  try {
    const { origin } = new URL(raw);
    return /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

/**
 * CSP solo en producción: `next dev` usa eval y websockets para recargar en
 * caliente, y una CSP estricta lo rompe. Sin nonces a propósito: un nonce
 * cambia en cada request y obligaría a renderizar todo en cada visita,
 * perdiendo el ISR. 'unsafe-inline' cubre los scripts que Next incrusta en
 * el HTML y el script de next-themes que evita el parpadeo del modo oscuro.
 * Las imágenes de productos vienen directo del CDN de Mercado Libre.
 *
 * Los videos de /admin/videos y sus portadas están en el Storage del propio
 * proyecto de Supabase, que es otro dominio. Ese origen (y nada más) se
 * agrega en tres lugares: img-src para la portada, media-src para reproducir
 * el video, y connect-src porque para compartirlo o guardarlo la página lo
 * baja entero con fetch (el atributo download no sirve entre dominios). Sin
 * esto, en el sitio publicado el reproductor queda en negro y Compartir
 * falla, y en local no se nota porque ahí no hay CSP.
 */
function buildContentSecurityPolicy() {
  // En los deploys de Preview, Vercel inyecta su barra de comentarios desde
  // vercel.live. Sin esto la consola de Preview se llena de avisos de CSP
  // que no existen en producción y tapan los que sí importan.
  const toolbar = process.env.VERCEL_ENV === 'preview';
  const extra = (sources) => (toolbar ? ` ${sources}` : '');

  const storage = supabaseOrigin();
  const media = storage ? ` ${storage}` : '';

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${extra('https://vercel.live')}`,
    `style-src 'self' 'unsafe-inline'${extra('https://vercel.live')}`,
    `img-src 'self' data: https://*.mlstatic.com${media}${extra('https://vercel.live https://vercel.com blob:')}`,
    // Sin el origen no se escribe: default-src ya deja el video solo en 'self'.
    ...(storage ? [`media-src 'self' ${storage}`] : []),
    `font-src 'self'${extra('https://vercel.live https://assets.vercel.com')}`,
    `connect-src 'self'${media}${extra('https://vercel.live wss://ws-us3.pusher.com')}`,
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
  // Las piezas de historia se dibujan con fuentes que se leen del disco
  // (lib/content/og-fonts): hay que decir con qué rutas viajan, o en Vercel
  // el archivo no existe y la imagen falla.
  outputFileTracingIncludes: {
    '/social/pieza/[productId]/[file]': ['./src/lib/content/fonts/*.woff'],
    '/admin/kit/[productId]': ['./src/lib/content/fonts/*.woff'],
  },
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
