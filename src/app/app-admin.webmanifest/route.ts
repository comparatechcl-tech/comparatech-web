import { NextResponse } from 'next/server';

/**
 * Manifiesto del admin como app aparte.
 *
 * El manifiesto del sitio (app/manifest.ts) parte en "/": un acceso directo
 * creado desde el admin abría la portada pública. Con este, "Agregar a la
 * pantalla de inicio" desde cualquier página del admin instala una app
 * distinta ("ComparaTech Admin") que abre directo en /admin.
 *
 * Vive fuera de /admin a propósito: el navegador pide el manifiesto sin la
 * clave del admin, y detrás de ella respondería 401. No tiene nada privado:
 * solo el nombre, los íconos y la dirección de inicio, que igual pide clave.
 */

export const dynamic = 'force-static';

const MANIFEST = {
  id: '/admin',
  name: 'ComparaTech Admin',
  short_name: 'CT Admin',
  description: 'Administración de ComparaTech.',
  start_url: '/admin',
  scope: '/admin',
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
