import { NextRequest, NextResponse } from 'next/server';
import { checkBasicAuth, getAdminCredentials } from '@/lib/basic-auth';

/**
 * Protege /admin con Basic Auth, una clave por persona (ADMIN_USERS). Es
 * una herramienta interna de pocas personas, no hace falta un sistema de
 * sesiones — el navegador recuerda las credenciales.
 *
 * Las acciones del admin vuelven a verificar por su cuenta (requireAdmin):
 * este middleware solo cubre las páginas.
 */

// Ni en un iframe, ni en Google, ni en el caché de un proxy: la respuesta
// de /admin (aunque sea el 401) no tiene nada que hacer fuera del navegador
// de quien la pidió.
const PRIVATE_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

export function middleware(req: NextRequest) {
  // Falla cerrado: sin credenciales configuradas no se entra, en vez de
  // dejar el admin abierto por una variable olvidada en Vercel.
  if (getAdminCredentials().length === 0) {
    return new NextResponse('Admin no configurado (falta ADMIN_USERS)', {
      status: 500,
      headers: PRIVATE_HEADERS,
    });
  }

  if (checkBasicAuth(req.headers.get('authorization'))) {
    return NextResponse.next();
  }

  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: {
      ...PRIVATE_HEADERS,
      'WWW-Authenticate': 'Basic realm="ComparaTech Admin", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: '/admin/:path*',
};
