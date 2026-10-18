/**
 * IndexNow: avisarle a Bing (y a Yandex, Seznam y Naver, que comparten el
 * aviso) qué páginas cambiaron, para que las vuelva a leer sin esperar a su
 * próxima pasada. Google no lo usa: a Google le llega el sitemap.
 *
 * La clave no es secreta. El protocolo pide publicarla en un archivo en la
 * raíz del sitio (public/<clave>.txt): así comprueba Bing que el aviso viene
 * del dueño del dominio. Si se cambia, se cambian los dos (un test los
 * compara).
 *
 * Solo avisa desde producción y solo de direcciones del dominio propio: un
 * aviso desde una vista previa, o con otro dominio, Bing lo rechaza (y
 * repetirlo puede hacer que deje de aceptar los avisos del sitio).
 */
import { SITE_URL } from '@/lib/site';

export const INDEXNOW_KEY = '11672abb6cbd5fb736fb43a925f906cc';
const ENDPOINT = 'https://api.indexnow.org/indexnow';
/** El máximo de direcciones por aviso que acepta el protocolo. */
const MAX_URLS = 10_000;
const TIMEOUT_MS = 3_000;

export type IndexNowResult = { enviadas: number; http: number } | { omitido: string } | { error: string };

/** El cuerpo del aviso: solo direcciones del mismo dominio, sin repetir. Null si no queda ninguna. */
export function indexNowBody(urls: string[], siteUrl: string = SITE_URL) {
  let host: string;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return null;
  }
  const list = [
    ...new Set(
      urls.filter((url) => {
        try {
          return new URL(url).host === host;
        } catch {
          return false;
        }
      }),
    ),
  ].slice(0, MAX_URLS);
  if (list.length === 0) return null;
  return { host, key: INDEXNOW_KEY, keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`, urlList: list };
}

/**
 * Avisa los cambios. Nunca lanza: un aviso que falla no puede tumbar a quien
 * lo manda (el refresco de precios), y la página igual está en el sitemap.
 */
export async function notifyIndexNow(
  urls: string[],
  { siteUrl = SITE_URL, env = process.env.VERCEL_ENV, fetchImpl = fetch } = {},
): Promise<IndexNowResult> {
  if (env !== 'production') return { omitido: 'no es producción' };
  if (!siteUrl.startsWith('https://') || /vercel\.app/.test(siteUrl)) return { omitido: 'sin dominio propio' };
  const body = indexNowBody(urls, siteUrl);
  if (!body) return { omitido: 'nada que avisar' };
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 200 y 202 son "recibido"; 403 es la clave, 422 direcciones de otro dominio, 429 demasiados avisos.
    if (res.status === 200 || res.status === 202) return { enviadas: body.urlList.length, http: res.status };
    return { error: `IndexNow respondió HTTP ${res.status}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
