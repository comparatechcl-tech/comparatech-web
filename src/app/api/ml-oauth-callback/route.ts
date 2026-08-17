import { NextRequest, NextResponse } from 'next/server';

/**
 * Destino del redirect_uri registrado en la app de Mercado Libre. Uso único
 * y manual: Roxana visita la URL de autorización, ML redirige acá con un
 * `code`, lo canjeamos por access_token/refresh_token y los mostramos una
 * sola vez en pantalla para copiarlos a Make. No se persisten en ningún lado.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const authError = req.nextUrl.searchParams.get('error');

  if (authError) {
    return NextResponse.json({ error: authError }, { status: 400 });
  }
  if (!code) {
    return NextResponse.json({ error: 'Falta el parámetro "code"' }, { status: 400 });
  }

  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: 'Faltan ML_CLIENT_ID / ML_CLIENT_SECRET / ML_REDIRECT_URI en las variables de entorno' },
      { status: 500 }
    );
  }

  const tokenRes = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await tokenRes.json();

  if (!tokenRes.ok) {
    return NextResponse.json({ error: 'Mercado Libre rechazó el canje del code', detail: data }, { status: 502 });
  }

  const html = `<!doctype html>
<html><body style="font-family:monospace;padding:24px;background:#080C14;color:#00D4FF">
<h2>Autorización completada</h2>
<p>Copia estos valores a Make ahora — esta pantalla no los guarda en ningún lado y no vas a poder volver a verlos (tendrías que repetir la autorización):</p>
<pre style="white-space:pre-wrap;background:#0d1420;padding:16px;border-radius:8px">access_token:  ${data.access_token}
refresh_token: ${data.refresh_token}
expires_in:    ${data.expires_in} segundos
user_id:       ${data.user_id}</pre>
</body></html>`;

  return new NextResponse(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
