import { describe, expect, it } from 'vitest';
import { GRAPH_VERSION } from './meta';
import { PublishError, publishFacebookPhotos, publishInstagramCarousel, publishInstagramImage } from './meta-publish';

/**
 * Publicar en Instagram y Facebook con la app de Meta, contra un Graph API de
 * mentira: qué se pide, en qué orden, y qué pasa si algo falla. Lo que más
 * importa: si el último paso queda sin respuesta, se dice que puede haber
 * salido, para no publicar dos veces.
 */

const TOKEN = 'EAA' + 'P'.repeat(90);
const CONN = { igUserId: '1784', pageId: '111', pageToken: TOKEN };
const CREDS = { appId: '1', appSecret: 's' };
const URLS = ['https://www.comparatech.cl/social/carrusel/a/0.jpg', 'https://www.comparatech.cl/social/carrusel/a/1.jpg', 'https://www.comparatech.cl/social/carrusel/a/2.jpg'];

interface Call {
  method: string;
  path: string;
  url: string;
  params: Record<string, string>;
}

function graph(handler: (call: Call) => { status?: number; body?: unknown; fail?: boolean }) {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const params: Record<string, string> = {};
    url.searchParams.forEach((v, k) => (params[k] = v));
    if (init?.body instanceof URLSearchParams) init.body.forEach((v, k) => (params[k] = v));
    const call = { method: init?.method ?? 'GET', path: url.pathname.replace(`/${GRAPH_VERSION}/`, ''), url: input, params };
    calls.push(call);
    const { status = 200, body = {}, fail } = handler(call);
    if (fail) throw new TypeError('fetch failed');
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

const noSleep = async () => {};

describe('publishInstagramCarousel', () => {
  function happy(statuses = ['FINISHED']) {
    let poll = 0;
    return graph((c) => {
      if (c.path === '1784/media' && c.params.is_carousel_item) return { body: { id: `child-${URLS.indexOf(c.params.image_url)}` } };
      if (c.path === '1784/media' && c.params.media_type === 'CAROUSEL') return { body: { id: 'carousel1' } };
      if (c.path === 'carousel1') return { body: { status_code: statuses[Math.min(poll++, statuses.length - 1)] } };
      if (c.path === '1784/media_publish') return { body: { id: 'media9' } };
      if (c.path === 'media9') return { body: { permalink: 'https://www.instagram.com/p/abc/' } };
      return { status: 400, body: { error: { message: `inesperado ${c.path}`, code: 100 } } };
    });
  }

  it('crea una imagen por lámina, el carrusel con el texto, espera y publica', async () => {
    const { fetchImpl, calls } = happy(['IN_PROGRESS', 'FINISHED']);
    const result = await publishInstagramCarousel(CONN, CREDS, { imageUrls: URLS, caption: 'Top 3' }, { fetchImpl, sleep: noSleep });
    expect(result).toEqual({ mediaId: 'media9', permalink: 'https://www.instagram.com/p/abc/' });

    const children = calls.filter((c) => c.params.is_carousel_item === 'true');
    expect(children.map((c) => c.params.image_url).sort()).toEqual([...URLS].sort());
    const container = calls.find((c) => c.params.media_type === 'CAROUSEL');
    expect(container?.params.caption).toBe('Top 3');
    // El orden de las láminas lo da children, aunque las imágenes se creen en paralelo.
    expect(container?.params.children).toBe('child-0,child-1,child-2');
    expect(calls.filter((c) => c.path === 'carousel1')).toHaveLength(2);
    expect(calls.find((c) => c.path === '1784/media_publish')?.params.creation_id).toBe('carousel1');
  });

  it('el token y el texto van en el cuerpo de los POST, nunca en la dirección', async () => {
    const { fetchImpl, calls } = happy();
    await publishInstagramCarousel(CONN, CREDS, { imageUrls: URLS, caption: 'Top 3' }, { fetchImpl, sleep: noSleep });
    for (const c of calls.filter((x) => x.method === 'POST')) {
      expect(c.url).not.toContain('EAA');
      expect(c.url).not.toContain('caption');
      expect(c.params.access_token).toBe(TOKEN);
      expect(c.params.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('si Instagram no puede procesar el carrusel, no publica y lo dice', async () => {
    const { fetchImpl, calls } = happy(['ERROR']);
    const err = await publishInstagramCarousel(CONN, CREDS, { imageUrls: URLS, caption: 'x' }, { fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.uncertain).toBe(false);
    expect(calls.some((c) => c.path === '1784/media_publish')).toBe(false);
  });

  it('si tarda demasiado, no publica', async () => {
    const { fetchImpl, calls } = happy(['IN_PROGRESS']);
    const err = await publishInstagramCarousel(CONN, CREDS, { imageUrls: URLS, caption: 'x' }, { fetchImpl, sleep: noSleep, waitMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.message).toMatch(/tardó/);
    expect(calls.some((c) => c.path === '1784/media_publish')).toBe(false);
  });

  it('si el último paso queda sin respuesta, avisa que puede haber salido', async () => {
    // Todo bien salvo media_publish, que se corta.
    const cut = graph((c) => {
      if (c.path === '1784/media_publish') return { fail: true };
      if (c.params.is_carousel_item) return { body: { id: `c-${URLS.indexOf(c.params.image_url)}` } };
      if (c.params.media_type === 'CAROUSEL') return { body: { id: 'carousel1' } };
      if (c.path === 'carousel1') return { body: { status_code: 'FINISHED' } };
      return { status: 400, body: { error: { message: 'x', code: 100 } } };
    });
    const err = await publishInstagramCarousel(CONN, CREDS, { imageUrls: URLS, caption: 'x' }, { fetchImpl: cut.fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.uncertain).toBe(true);
  });

  it('un error de Meta antes de publicar no es "incierto": no salió nada', async () => {
    const { fetchImpl } = graph(() => ({ status: 400, body: { error: { message: 'Media download has failed', code: 9004 } } }));
    const err = await publishInstagramCarousel(CONN, CREDS, { imageUrls: URLS, caption: 'x' }, { fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err).not.toBeInstanceOf(PublishError);
    expect(err.message).toMatch(/download/);
  });

  it('pide entre 2 y 20 imágenes', async () => {
    const { fetchImpl, calls } = happy();
    await expect(publishInstagramCarousel(CONN, CREDS, { imageUrls: [URLS[0]], caption: 'x' }, { fetchImpl })).rejects.toBeInstanceOf(PublishError);
    expect(calls).toHaveLength(0);
  });
});

describe('publishFacebookPhotos', () => {
  it('sube las fotos sin publicar y una sola publicación las lleva en orden', async () => {
    const { fetchImpl, calls } = graph((c) => {
      if (c.path === '111/photos') return { body: { id: `photo-${URLS.indexOf(c.params.url)}` } };
      if (c.path === '111/feed') return { body: { id: '111_999' } };
      if (c.path === '111_999') return { body: { permalink_url: 'https://www.facebook.com/111/posts/999' } };
      return { status: 400, body: { error: { message: 'x', code: 100 } } };
    });
    const result = await publishFacebookPhotos(CONN, CREDS, { imageUrls: URLS, message: 'Top 3' }, { fetchImpl });
    expect(result).toEqual({ postId: '111_999', permalink: 'https://www.facebook.com/111/posts/999' });
    for (const c of calls.filter((x) => x.path === '111/photos')) expect(c.params.published).toBe('false');
    const feed = calls.find((c) => c.path === '111/feed') as Call;
    expect(feed.params.message).toBe('Top 3');
    expect([0, 1, 2].map((i) => JSON.parse(feed.params[`attached_media[${i}]`]).media_fbid)).toEqual(['photo-0', 'photo-1', 'photo-2']);
  });

  it('si la publicación del feed queda sin respuesta, avisa que puede haber salido', async () => {
    const { fetchImpl } = graph((c) => (c.path === '111/feed' ? { fail: true } : { body: { id: 'p' } }));
    const err = await publishFacebookPhotos(CONN, CREDS, { imageUrls: URLS, message: 'x' }, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.uncertain).toBe(true);
  });
});

describe('publishInstagramImage', () => {
  const IMG = 'https://www.comparatech.cl/social/cupones/abc/feed-1-x.jpg';

  function api(statuses = ['FINISHED']) {
    let poll = 0;
    return graph((c) => {
      if (c.path === '1784/media') return { body: { id: 'img1' } };
      if (c.path === 'img1') return { body: { status_code: statuses[Math.min(poll++, statuses.length - 1)] } };
      if (c.path === '1784/media_publish') return { body: { id: 'media7' } };
      if (c.path === 'media7') return { body: { permalink: 'https://www.instagram.com/p/xyz/' } };
      return { status: 400, body: { error: { message: `inesperado ${c.path}`, code: 100 } } };
    });
  }

  it('al feed: la imagen con su texto, espera y publica', async () => {
    const { fetchImpl, calls } = api(['IN_PROGRESS', 'FINISHED']);
    const r = await publishInstagramImage(CONN, CREDS, { imageUrl: IMG, caption: 'Cupones' }, { fetchImpl, sleep: noSleep });
    expect(r).toEqual({ mediaId: 'media7', permalink: 'https://www.instagram.com/p/xyz/' });
    const created = calls.find((c) => c.path === '1784/media');
    expect(created?.params).toMatchObject({ image_url: IMG, caption: 'Cupones' });
    expect(created?.params.media_type).toBeUndefined();
    expect(calls.filter((c) => c.path === 'img1')).toHaveLength(2);
    expect(calls.find((c) => c.path === '1784/media_publish')?.params.creation_id).toBe('img1');
  });

  it('como historia: STORIES y sin texto', async () => {
    const { fetchImpl, calls } = api();
    await publishInstagramImage(CONN, CREDS, { imageUrl: IMG, caption: 'no va', story: true }, { fetchImpl, sleep: noSleep });
    const created = calls.find((c) => c.path === '1784/media');
    expect(created?.params.media_type).toBe('STORIES');
    expect(created?.params.caption).toBeUndefined();
  });

  it('si Instagram no la procesa, no publica nada', async () => {
    const { fetchImpl, calls } = api(['ERROR']);
    await expect(publishInstagramImage(CONN, CREDS, { imageUrl: IMG, story: true }, { fetchImpl, sleep: noSleep })).rejects.toThrow(
      'Instagram no pudo procesar la historia (ERROR)'
    );
    expect(calls.some((c) => c.path === '1784/media_publish')).toBe(false);
  });

  it('si el último paso queda sin respuesta, dice que puede haber salido', async () => {
    const { fetchImpl } = graph((c) => {
      if (c.path === '1784/media') return { body: { id: 'img1' } };
      if (c.path === 'img1') return { body: { status_code: 'FINISHED' } };
      if (c.path === '1784/media_publish') return { fail: true };
      return { status: 400, body: {} };
    });
    const err = await publishInstagramImage(CONN, CREDS, { imageUrl: IMG }, { fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.uncertain).toBe(true);
  });
});
