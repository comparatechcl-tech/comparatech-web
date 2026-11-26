/**
 * Lanza a pedido la pasada que arma los videos del día.
 *
 * Los videos se arman fuera del sitio, en GitHub Actions (workflow "Videos
 * del día", .github/workflows/reels.yml), porque necesitan ffmpeg. Ese
 * workflow tiene su horario, pero GitHub atrasa o se salta casi todas las
 * pasadas programadas de este repositorio: el 26-11-2026, de las 4 que
 * tocaban hasta las 14:00, corrió una y con tres horas de atraso. Antes daba
 * lo mismo (los precios se revisaban cada hora); ahora un video solo se arma
 * con un precio revisado en las últimas horas, y si la pasada no corre a
 * tiempo, no hay video.
 *
 * Por eso el sitio le pide a GitHub que la corra: a sus horas (pg_cron llama
 * a /api/cron/videos, migración 0023) y cuando el dueño toca "Armar los
 * videos ahora" en /admin/videos. Una pasada de más no hace nada: lo que ya
 * está armado no se vuelve a armar.
 *
 * Necesita una llave de GitHub con permiso para lanzar workflows de este
 * repositorio (variable GITHUB_VIDEOS_TOKEN, solo en Railway). Sin ella no
 * hace nada. La llave nunca se escribe en un log ni en una respuesta.
 */

/** El repositorio, que es público, y el archivo del workflow. */
const REPO = 'comparatechcl-tech/comparatech-web';
export const VIDEO_WORKFLOW = 'reels.yml';
const BRANCH = 'main';
const TIMEOUT_MS = 15_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type DispatchFailure =
  /** Falta la variable GITHUB_VIDEOS_TOKEN. */
  | 'sin_llave'
  /** GitHub no aceptó la llave: venció, se borró o le falta el permiso. */
  | 'rechazada'
  /** Red, tiempo, o una respuesta de GitHub que no se esperaba. */
  | 'error';

export type DispatchResult = { ok: true } | { ok: false; reason: DispatchFailure; detail: string };

/** La llave de GitHub, si está puesta. Una llave de verdad mide mucho más que esto. */
export function videoDispatchToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = env.GITHUB_VIDEOS_TOKEN?.trim();
  return token && token.length >= 20 ? token : null;
}

/** Le pide a GitHub que corra ahora la pasada de los videos. Nunca lanza y nunca reintenta. */
export async function dispatchVideoBuild(
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: Fetch;
    /**
     * Pasada en seco (la opción `seco` del workflow): GitHub corre la pasada,
     * pero no arma ni sube nada. Sirve para probar que la llave funciona.
     */
    dry?: boolean;
  } = {}
): Promise<DispatchResult> {
  const token = videoDispatchToken(options.env);
  if (!token) return { ok: false, reason: 'sin_llave', detail: 'Falta la llave de GitHub (variable GITHUB_VIDEOS_TOKEN en Railway).' };

  let res: Response;
  try {
    res = await (options.fetchImpl ?? fetch)(`https://api.github.com/repos/${REPO}/actions/workflows/${VIDEO_WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'comparatech-web',
        'x-github-api-version': '2022-11-28',
      },
      // Los valores de `inputs` van como texto: así los recibe la API de GitHub.
      body: JSON.stringify(options.dry ? { ref: BRANCH, inputs: { seco: 'true' } } : { ref: BRANCH }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : 'GitHub no respondió' };
  }
  if (res.ok) return { ok: true };

  // Lo que dice GitHub ("Bad credentials", "Resource not accessible by personal
  // access token"…). Es un texto fijo suyo: no trae la llave.
  let message = '';
  try {
    message = String(((await res.json()) as { message?: unknown }).message ?? '').slice(0, 200);
  } catch {
    // Sin cuerpo legible: basta con el código.
  }
  const said = `GitHub respondió ${res.status}${message ? `: ${message}` : ''}`;

  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return { ok: false, reason: 'rechazada', detail: `GitHub no aceptó la llave. ${KEY_HINTS[res.status]} (${said}.)` };
  }
  return { ok: false, reason: 'error', detail: said };
}

/** Qué revisar en la llave según lo que respondió GitHub. */
const KEY_HINTS: Record<number, string> = {
  401: 'La llave no es válida: quedó mal copiada, venció o se borró.',
  403: 'Le falta el permiso: en la llave, "Repository permissions → Actions" tiene que decir "Read and write".',
  // GitHub responde 404, y no 403, cuando la llave no alcanza a ver el repositorio.
  404: 'No alcanza a ver este repositorio: en la llave, "Repository access" tiene que tener elegido comparatech-web.',
};
