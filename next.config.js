/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      // Imágenes reales de fichas de Mercado Libre (CDN oficial). ML sirve
      // imágenes desde varios subdominios por shard (http2, mla-s1-p,
      // mla-s2-p, etc.) — el comodín cubre cualquiera de ellos.
      { protocol: 'https', hostname: '*.mlstatic.com' },
      { protocol: 'https', hostname: 'mlstatic.com' },
    ],
  },
};

module.exports = nextConfig;
