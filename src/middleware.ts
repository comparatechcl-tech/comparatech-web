import { NextRequest, NextResponse } from 'next/server';

/**
 * Protege /admin con Basic Auth simple (usuario/clave en variables de
 * entorno). Es una herramienta interna de 2 personas, no hace falta un
 * sistema de sesiones — el navegador recuerda las credenciales.
 */
export function middleware(req: NextRequest) {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;

  if (!user || !password) {
    return new NextResponse('Admin no configurado (faltan ADMIN_USER / ADMIN_PASSWORD)', { status: 500 });
  }

  const auth = req.headers.get('authorization');
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [reqUser, reqPassword] = Buffer.from(encoded, 'base64').toString().split(':');
      if (reqUser === user && reqPassword === password) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Autenticación requerida', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="ComparaTech Admin"' },
  });
}

export const config = {
  matcher: '/admin/:path*',
};
