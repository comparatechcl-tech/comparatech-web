import type { MetadataRoute } from 'next';

/**
 * Manifiesto del sitio: el nombre y los íconos que usan Android y Chrome al
 * "Agregar a la pantalla de inicio", y que también miran los buscadores para
 * reconocer la marca. Los íconos salen de _local/herramientas/iconos.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ComparaTech — Compara precios de tecnología en Chile',
    short_name: 'ComparaTech',
    description: 'Precios de tecnología y hogar de Mercado Libre Chile, con historial de precios.',
    start_url: '/',
    display: 'standalone',
    background_color: '#070B14',
    theme_color: '#070B14',
    lang: 'es-CL',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
