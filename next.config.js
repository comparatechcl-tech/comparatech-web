/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'picsum.photos' },
      // Imágenes reales de fichas de Mercado Libre (CDN oficial):
      { protocol: 'https', hostname: 'http2.mlstatic.com' },
      { protocol: 'https', hostname: 'mlstatic.com' },
    ],
  },
};

module.exports = nextConfig;
