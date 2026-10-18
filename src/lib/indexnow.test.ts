import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INDEXNOW_KEY, indexNowBody, notifyIndexNow } from './indexnow';

const SITE = 'https://www.comparatech.cl';

describe('archivo de la clave', () => {
  it('está publicado en la raíz del sitio con la misma clave', () => {
    // Bing lo lee en https://www.comparatech.cl/<clave>.txt para aceptar los avisos.
    const file = readFileSync(join(process.cwd(), 'public', `${INDEXNOW_KEY}.txt`), 'utf8');
    expect(file.trim()).toBe(INDEXNOW_KEY);
  });
});

describe('indexNowBody', () => {
  it('solo direcciones del dominio propio, sin repetir', () => {
    const body = indexNowBody(
      [`${SITE}/producto/a`, `${SITE}/producto/a`, 'https://comparatech-web.vercel.app/producto/b', 'no es url', `${SITE}/producto/c`],
      SITE,
    );
    expect(body).toEqual({
      host: 'www.comparatech.cl',
      key: INDEXNOW_KEY,
      keyLocation: `https://www.comparatech.cl/${INDEXNOW_KEY}.txt`,
      urlList: [`${SITE}/producto/a`, `${SITE}/producto/c`],
    });
  });

  it('null si no queda nada que avisar', () => {
    expect(indexNowBody([], SITE)).toBeNull();
    expect(indexNowBody(['https://otro.cl/x'], SITE)).toBeNull();
  });
});

describe('notifyIndexNow', () => {
  const urls = [`${SITE}/producto/a`];

  it('no avisa fuera de producción ni desde el dominio de Vercel', async () => {
    const fetchImpl = vi.fn();
    expect(await notifyIndexNow(urls, { siteUrl: SITE, env: 'preview', fetchImpl })).toEqual({ omitido: 'no es producción' });
    expect(await notifyIndexNow(urls, { siteUrl: 'https://comparatech-web.vercel.app', env: 'production', fetchImpl })).toEqual({
      omitido: 'sin dominio propio',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('manda el aviso y cuenta las direcciones', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    expect(await notifyIndexNow(urls, { siteUrl: SITE, env: 'production', fetchImpl })).toEqual({ enviadas: 1, http: 202 });
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('https://api.indexnow.org/indexnow');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).urlList).toEqual(urls);
  });

  it('nunca lanza: un rechazo o una caída quedan como error', async () => {
    const rejected = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    expect(await notifyIndexNow(urls, { siteUrl: SITE, env: 'production', fetchImpl: rejected })).toEqual({
      error: 'IndexNow respondió HTTP 403',
    });
    const down = vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await notifyIndexNow(urls, { siteUrl: SITE, env: 'production', fetchImpl: down })).toEqual({ error: 'timeout' });
  });
});
