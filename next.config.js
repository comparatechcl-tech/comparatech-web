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
 * La carpeta pública del bucket de los videos, dentro del Storage. El nombre
 * del bucket es VIDEO_BUCKET de src/lib/social/videos.ts (este archivo no
 * puede importarlo): si cambia allá, cambia acá, y un test los compara.
 */
const VIDEO_FOLDER = '/storage/v1/object/public/reels/';

/**
 * CSP solo en producción: `next dev` usa eval y websockets para recargar en
 * caliente, y una CSP estricta lo rompe. Sin nonces a propósito: un nonce
 * cambia en cada request y obligaría a renderizar todo en cada visita,
 * perdiendo el ISR. 'unsafe-inline' cubre los scripts que Next incrusta en
 * el HTML y el script de next-themes que evita el parpadeo del modo oscuro.
 * Las imágenes de productos vienen directo del CDN de Mercado Libre.
 *
 * Los videos de /admin/videos y sus portadas están en el Storage del propio
 * proyecto de Supabase, que es otro dominio. Se abre solo la carpeta pública
 * de ese bucket, no el proyecto entero: en el mismo dominio está la API de la
 * base (/rest/v1), y el navegador del sitio nunca tiene por qué hablarle. La
 * carpeta se agrega en tres lugares: img-src para la portada, media-src para
 * reproducir el video, y connect-src porque para compartirlo o guardarlo la
 * página lo baja entero con fetch (el atributo download no sirve entre
 * dominios). Sin esto, en el sitio publicado el reproductor queda en negro y
 * Compartir falla, y en local no se nota porque ahí no hay CSP.
 */
function buildContentSecurityPolicy() {
  // En los deploys de Preview, Vercel inyecta su barra de comentarios desde
  // vercel.live. Sin esto la consola de Preview se llena de avisos de CSP
  // que no existen en producción y tapan los que sí importan.
  const toolbar = process.env.VERCEL_ENV === 'preview';
  const extra = (sources) => (toolbar ? ` ${sources}` : '');

  const origin = supabaseOrigin();
  // Termina en "/": así la CSP la toma como carpeta y deja pasar lo que cuelga de ella, y nada más.
  const storage = origin ? `${origin}${VIDEO_FOLDER}` : null;
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

/** El dominio de Vercel donde vivió el sitio hasta el 17-10-2026. */
const OLD_PRODUCTION_HOST = 'comparatech-web.vercel.app';
/** El dominio propio. */
const CANONICAL_ORIGIN = 'https://www.comparatech.cl';

/**
 * Los nombres con que se puede llegar al sitio de verdad: el dominio propio y
 * el PC. Como expresión regular para `has`/`missing` de Next, que la compara
 * entera con el host (sin el puerto) o con la cabecera (tal cual, por eso el
 * puerto opcional).
 */
const KNOWN_HOSTS = String.raw`(?:www\.comparatech\.cl|comparatech\.cl|localhost|127\.0\.0\.1)`;
const APEX_HOST = String.raw`comparatech\.cl`;
/**
 * El host con que llegó la visita. Railway lo deja además en X-Forwarded-Host
 * ("the original host header", según su documentación): se mira también ahí,
 * por si su proxy le cambiara el Host a la app. Así un Host cambiado nunca
 * deja al dominio propio con noindex ni sin su redirección.
 */
const knownHost = [
  { type: 'host', value: KNOWN_HOSTS },
  { type: 'header', key: 'x-forwarded-host', value: String.raw`${KNOWN_HOSTS}(?::\d+)?` },
];

/**
 * Lo que hace la plataforma y no el código. Vercel manda HSTS por su cuenta
 * en el dominio propio; Railway no (07-11-2026). Los navegadores ya lo
 * recibieron de Vercel por 2 años, así que en Railway se sigue mandando igual.
 */
const hstsHeaders =
  process.env.VERCEL === '1' ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }];

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
    '/social/carrusel/[ids]/[file]': ['./src/lib/content/fonts/*.woff'],
    '/social/cupones/[data]/[file]': ['./src/lib/content/fonts/*.woff'],
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
  async redirects() {
    // Mudanza al dominio propio (17-10-2026): las páginas públicas del
    // dominio viejo de Vercel llevan al propio con 301, que es lo que Google
    // y Bing piden para un cambio permanente (y la herramienta "Cambio de
    // dirección" de Search Console revisa). Se quedan donde están:
    // - /api: pg_cron (migración 0011, hasta que la 0019 lo pase a www) llama
    //   ahí con el secreto, y curl ni sigue la redirección ni reenvía la
    //   clave a otro host: el refresco de precios se cortaría. GitHub Actions
    //   y los scripts ya llaman a www.
    // - /social: las imágenes de lo que ya está programado en Metricool.
    // - /admin: los accesos guardados del dueño (la clave es por dominio).
    // - /_next: los archivos del propio sitio.
    // Las vistas previas de Vercel tienen otro host y no se tocan.
    const oldHost = [{ type: 'host', value: OLD_PRODUCTION_HOST }];
    // comparatech.cl (sin www) → www, con 308 como lo hacía Vercel → Domains.
    // En Vercel nunca llega acá (Vercel redirige antes, en su borde); en
    // Railway sí. Sin /api: los que llaman con el secreto no siguen
    // redirecciones, y ahí no hay nada que indexar. Next pasa la consulta
    // (?x=1) tal cual y nunca redirige /_next.
    const apexHost = [{ type: 'host', value: APEX_HOST }];
    const apexForwarded = [{ type: 'header', key: 'x-forwarded-host', value: String.raw`${APEX_HOST}(?::\d+)?` }];
    return [
      { source: '/', has: oldHost, destination: `${CANONICAL_ORIGIN}/`, statusCode: 301 },
      {
        source: '/:path((?!api(?:/|$)|social(?:/|$)|admin(?:/|$)|_next/).*)',
        has: oldHost,
        destination: `${CANONICAL_ORIGIN}/:path`,
        statusCode: 301,
      },
      ...[apexHost, apexForwarded].flatMap((has) => [
        { source: '/', has, destination: `${CANONICAL_ORIGIN}/`, permanent: true },
        { source: '/:path((?!api(?:/|$)).*)', has, destination: `${CANONICAL_ORIGIN}/:path`, permanent: true },
      ]),
    ];
  },
  async headers() {
    const siteHeaders =
      process.env.NODE_ENV === 'production'
        ? [...securityHeaders, ...hstsHeaders, { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() }]
        : securityHeaders;

    return [
      { source: '/:path*', headers: siteHeaders },
      { source: '/admin/:path*', headers: privateHeaders },
      { source: '/api/:path*', headers: privateHeaders },
      // Una copia que no está en el dominio propio (la de prueba en
      // *.up.railway.app, una vista previa de Vercel) no se indexa: si Google
      // la encontrara, competiría con el sitio. Va acá y no en el middleware a
      // propósito: el middleware correría en cada visita (en Vercel, CPU e
      // invocaciones), y esto lo resuelve el enrutador sin código.
      {
        source: '/:path*',
        missing: knownHost,
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

module.exports = nextConfig;
