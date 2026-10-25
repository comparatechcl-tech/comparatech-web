import 'server-only';
import {
  MetaApiError,
  graphGet,
  graphPost,
  pageAuth,
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

  // La guía pide mirar el estado antes de publicar. Con imágenes suele estar listo enseguida.
  const deadline = Date.now() + (deps.waitMs ?? 25_000);
  for (;;) {
    const status = await graphGet(container, { fields: 'status_code', ...auth }, fetchImpl);
    const code = typeof status.status_code === 'string' ? status.status_code : '';
    if (code === 'FINISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new PublishError(`Instagram no pudo procesar el carrusel (${code}). No se publicó nada.`, false);
    }
    if (Date.now() >= deadline) {
      throw new PublishError('Instagram tardó más de lo normal en procesar el carrusel. No se publicó nada: prueba otra vez en unos minutos.', false);
    }
    await sleep(2_000);
  }

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
