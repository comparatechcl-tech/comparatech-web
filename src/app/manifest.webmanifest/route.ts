import { NextResponse } from 'next/server';

/**
 * Manifiesto del sitio: el nombre y los íconos que usan Android y Chrome al
 * "Agregar a la pantalla de inicio", y que también miran los buscadores para
 * reconocer la marca. Los íconos salen de _local/herramientas/iconos.
 *
 * Es una ruta y no el archivo especial app/manifest.ts a propósito: el link
 * que Next arma solo para ese archivo no se puede cambiar en una sección, y
 * el admin necesita su propio manifiesto para instalarse como app aparte
 * (app/app-admin.webmanifest). Con la ruta, el link va en `metadata.manifest`
 * del layout raíz y el del admin lo reemplaza.
 */

export const dynamic = 'force-static';

const MANIFEST = {
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

export function GET() {
  return NextResponse.json(MANIFEST, { headers: { 'content-type': 'application/manifest+json; charset=utf-8' } });
}
