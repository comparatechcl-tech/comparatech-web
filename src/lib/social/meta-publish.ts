import 'server-only';
import {
  GRAPH_VERSION,
  MetaApiError,
  graphGet,
  graphPost,
  pageAuth,
  redactTokens,
  type FetchLike,
  type MetaConnection,
  type MetaCredentials,
} from './meta';

/**
 * Publicar en Instagram y en la página de Facebook con la app propia de Meta
 * (lib/social/meta). Lo llaman solo acciones del admin que el dueño toca: nada
 * de esto corre solo.
 *
 * Instagram (guía "Content publishing", Facebook Login, token de página):
 * un contenedor por imagen (is_carousel_item), uno CAROUSEL con sus hijos y
 * el texto, se espera a que su status_code sea FINISHED y se publica con
 * media_publish. Solo JPEG, en una dirección pública en el momento del
 * pedido: Meta la baja desde ahí.
 *
 * Facebook: cada foto se sube sin publicar (published=false) y después una
 * sola publicación del feed las lleva todas con attached_media, en orden.
 *
 * El paso que publica de verdad es el último. Si falla por una caída de red o
 * un tiempo agotado no se sabe si salió: PublishError.uncertain lo dice, para
 * no volver a publicar sin mirar antes.
 */

export class PublishError extends Error {
  constructor(
    message: string,
    /** true: falló el último paso sin respuesta; puede haber salido. */
    readonly uncertain: boolean
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface PublishDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Cuánto esperar como máximo a que Instagram procese el carrusel. */
  waitMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function idOf(body: Record<string, unknown>, what: string): string {
  const id = body.id;
  if (typeof id === 'string' && id) return id;
  if (typeof id === 'number') return String(id);
  throw new MetaApiError(`Meta no devolvió el id de ${what}`, null, null, 200);
}

/** El último paso: una caída sin respuesta (status 0) puede haber publicado igual. */
async function finalStep<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof MetaApiError && err.status === 0) {
      throw new PublishError(
        'No llegó la respuesta de Meta al publicar: puede que haya salido igual. Revisa la red antes de volver a intentar.',
        true
      );
    }
    throw err;
  }
}

/**
 * La guía pide mirar el estado de un contenedor antes de publicarlo. Con
 * imágenes suele estar listo enseguida.
 */
async function waitUntilFinished(
  container: string,
  auth: Record<string, string>,
  what: string,
  fetchImpl: FetchLike,
  sleep: (ms: number) => Promise<void>,
  waitMs = 25_000
): Promise<void> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const status = await graphGet(container, { fields: 'status_code', ...auth }, fetchImpl);
    const code = typeof status.status_code === 'string' ? status.status_code : '';
    if (code === 'FINISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new PublishError(`Instagram no pudo procesar ${what} (${code}). No se publicó nada.`, false);
    }
    if (Date.now() >= deadline) {
      throw new PublishError(`Instagram tardó más de lo normal en procesar ${what}. No se publicó nada: prueba otra vez en unos minutos.`, false);
    }
    await sleep(2_000);
  }
}

export const IG_CAROUSEL_MIN = 2;
/** La guía permite hasta 20 hijos; el carrusel del sitio lleva a lo más 10 láminas. */
export const IG_CAROUSEL_MAX = 20;

export async function publishInstagramCarousel(
  conn: Pick<MetaConnection, 'igUserId' | 'pageToken'>,
  creds: MetaCredentials,
  input: { imageUrls: string[]; caption: string },
  deps: PublishDeps = {}
): Promise<{ mediaId: string; permalink: string | null }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const { imageUrls } = input;
  if (imageUrls.length < IG_CAROUSEL_MIN || imageUrls.length > IG_CAROUSEL_MAX) {
    throw new PublishError(`Un carrusel de Instagram lleva entre ${IG_CAROUSEL_MIN} y ${IG_CAROUSEL_MAX} imágenes.`, false);
  }
  const auth = pageAuth(conn, creds);

  // Las láminas en paralelo: Meta baja cada una del sitio, y el orden lo da children.
  const children = await Promise.all(
    imageUrls.map(async (url) =>
      idOf(await graphPost(`${conn.igUserId}/media`, { image_url: url, is_carousel_item: 'true', ...auth }, fetchImpl), 'una imagen')
    )
  );
  const container = idOf(
    await graphPost(
      `${conn.igUserId}/media`,
      { media_type: 'CAROUSEL', children: children.join(','), caption: input.caption, ...auth },
      fetchImpl
    ),
    'el carrusel'
  );

  await waitUntilFinished(container, auth, 'el carrusel', fetchImpl, sleep, deps.waitMs);

  const mediaId = await finalStep(async () =>
    idOf(await graphPost(`${conn.igUserId}/media_publish`, { creation_id: container, ...auth }, fetchImpl), 'la publicación')
  );
  let permalink: string | null = null;
  try {
    const media = await graphGet(mediaId, { fields: 'permalink', ...auth }, fetchImpl);
    permalink = typeof media.permalink === 'string' ? media.permalink : null;
  } catch {
    // Ya está publicado: sin el link igual sirve.
  }
  return { mediaId, permalink };
}

export async function publishFacebookPhotos(
  conn: Pick<MetaConnection, 'pageId' | 'pageToken'>,
  creds: MetaCredentials,
  input: { imageUrls: string[]; message: string },
  deps: PublishDeps = {}
): Promise<{ postId: string; permalink: string | null }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (input.imageUrls.length < 1) throw new PublishError('No hay imágenes para publicar.', false);
  const auth = pageAuth(conn, creds);

  const photos = await Promise.all(
    input.imageUrls.map(async (url) =>
      idOf(await graphPost(`${conn.pageId}/photos`, { url, published: 'false', ...auth }, fetchImpl), 'una foto')
    )
  );
  const params: Record<string, string> = { message: input.message, ...auth };
  photos.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const postId = await finalStep(async () => idOf(await graphPost(`${conn.pageId}/feed`, params, fetchImpl), 'la publicación'));

  let permalink: string | null = null;
  try {
    const post = await graphGet(postId, { fields: 'permalink_url', ...auth }, fetchImpl);
    permalink = typeof post.permalink_url === 'string' ? post.permalink_url : null;
  } catch {
    // Ya está publicado: sin el link igual sirve.
  }
  return { postId, permalink };
}

/**
 * Una imagen sola en Instagram (los cupones, /admin/historias/cupones): al
 * feed con su texto, o como historia. La historia no lleva texto ni sticker:
 * la API no los pone.
 */
export async function publishInstagramImage(
  conn: Pick<MetaConnection, 'igUserId' | 'pageToken'>,
  creds: MetaCredentials,
  input: { imageUrl: string; caption?: string; story?: boolean },
  deps: PublishDeps = {}
): Promise<{ mediaId: string; permalink: string | null }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const auth = pageAuth(conn, creds);
  const params: Record<string, string> = { image_url: input.imageUrl, ...auth };
  if (input.story) params.media_type = 'STORIES';
  else if (input.caption) params.caption = input.caption;
  const what = input.story ? 'la historia' : 'la imagen';
  const container = idOf(await graphPost(`${conn.igUserId}/media`, params, fetchImpl), what);
  await waitUntilFinished(container, auth, what, fetchImpl, deps.sleep ?? defaultSleep, deps.waitMs);
  return publishInstagramContainer(conn, creds, container, deps);
}

// ---------------------------------------------------------------------------
// Reels (la publicación diaria automática, lib/social/meta-daily).

/**
 * Paso 1 del reel de Instagram: el contenedor. Meta baja el video de
 * video_url por su cuenta y lo procesa (suele tardar entre 30 segundos y
 * unos minutos): se publica después con publishInstagramContainer, cuando
 * instagramContainerStatus diga FINISHED.
 */
export async function createInstagramReel(
  conn: Pick<MetaConnection, 'igUserId' | 'pageToken'>,
  creds: MetaCredentials,
  input: { videoUrl: string; caption: string; coverUrl?: string | null },
  deps: PublishDeps = {}
): Promise<string> {
  const params: Record<string, string> = {
    media_type: 'REELS',
    video_url: input.videoUrl,
    caption: input.caption,
    // También en el feed del perfil, no solo en la pestaña de Reels.
    share_to_feed: 'true',
    ...pageAuth(conn, creds),
  };
  if (input.coverUrl) params.cover_url = input.coverUrl;
  return idOf(await graphPost(`${conn.igUserId}/media`, params, deps.fetchImpl ?? fetch), 'el reel');
}

/** IN_PROGRESS, FINISHED, PUBLISHED, ERROR o EXPIRED (o '' si Meta no lo dice). */
export async function instagramContainerStatus(
  conn: Pick<MetaConnection, 'pageToken'>,
  creds: MetaCredentials,
  containerId: string,
  deps: PublishDeps = {}
): Promise<string> {
  const body = await graphGet(containerId, { fields: 'status_code', ...pageAuth(conn, creds) }, deps.fetchImpl ?? fetch);
  return typeof body.status_code === 'string' ? body.status_code : '';
}

/** El último paso de Instagram: publica un contenedor listo. */
export async function publishInstagramContainer(
  conn: Pick<MetaConnection, 'igUserId' | 'pageToken'>,
  creds: MetaCredentials,
  containerId: string,
  deps: PublishDeps = {}
): Promise<{ mediaId: string; permalink: string | null }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const auth = pageAuth(conn, creds);
  const mediaId = await finalStep(async () =>
    idOf(await graphPost(`${conn.igUserId}/media_publish`, { creation_id: containerId, ...auth }, fetchImpl), 'la publicación')
  );
  let permalink: string | null = null;
  try {
    const media = await graphGet(mediaId, { fields: 'permalink', ...auth }, fetchImpl);
    permalink = typeof media.permalink === 'string' ? media.permalink : null;
  } catch {
    // Ya está publicado: sin el link igual sirve.
  }
  return { mediaId, permalink };
}

const RUPLOAD_HOST = 'rupload.facebook.com';

/**
 * Reel en la página de Facebook (guía "Reels publishing"): se abre la subida,
 * Meta baja el video desde su dirección (file_url) y se publica con
 * video_state=PUBLISHED. Facebook lo procesa después por su cuenta.
 */
export async function publishFacebookReel(
  conn: Pick<MetaConnection, 'pageId' | 'pageToken'>,
  creds: MetaCredentials,
  input: { videoUrl: string; description: string },
  deps: PublishDeps = {}
): Promise<{ videoId: string }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const auth = pageAuth(conn, creds);
  const start = await graphPost(`${conn.pageId}/video_reels`, { upload_phase: 'start', ...auth }, fetchImpl);
  const videoId = typeof start.video_id === 'string' ? start.video_id : typeof start.video_id === 'number' ? String(start.video_id) : '';
  if (!videoId) throw new MetaApiError('Meta no devolvió el id del video', null, null, 200);

  // El token va solo a la dirección de subida de Meta: nunca a otra que venga en la respuesta.
  let uploadUrl = `https://${RUPLOAD_HOST}/video-upload/${GRAPH_VERSION}/${videoId}`;
  if (typeof start.upload_url === 'string') {
    try {
      if (new URL(start.upload_url).hostname === RUPLOAD_HOST) uploadUrl = start.upload_url;
    } catch {
      // Se usa la de siempre.
    }
  }
  let uploaded: Response;
  try {
    uploaded = await fetchImpl(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `OAuth ${conn.pageToken}`, file_url: input.videoUrl },
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
  } catch (err) {
    throw new MetaApiError(`No se pudo subir el video a Facebook (${redactTokens(err instanceof Error ? err.message : String(err))})`, null, null, 0);
  }
  const body = (await uploaded.json().catch(() => ({}))) as { success?: unknown; error?: { message?: unknown; code?: unknown } };
  if (!uploaded.ok || body.success !== true) {
    const message = typeof body.error?.message === 'string' ? body.error.message : `HTTP ${uploaded.status}`;
    throw new MetaApiError(`Facebook no aceptó el video: ${redactTokens(message)}`, typeof body.error?.code === 'number' ? body.error.code : null, null, uploaded.status);
  }

  await finalStep(async () => {
    const done = await graphPost(
      `${conn.pageId}/video_reels`,
      { upload_phase: 'finish', video_id: videoId, video_state: 'PUBLISHED', description: input.description, ...auth },
      fetchImpl
    );
    if (done.success !== true) throw new MetaApiError('Facebook no confirmó la publicación del reel', null, null, 200);
  });
  return { videoId };
}
