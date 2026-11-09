import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(await notifyIndexNow(urls, { siteUrl: SITE, production: false, fetchImpl })).toEqual({ omitido: 'no es producción' });
    expect(await notifyIndexNow(urls, { siteUrl: 'https://comparatech-web.vercel.app', production: true, fetchImpl })).toEqual({
      omitido: 'sin dominio propio',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('manda el aviso y cuenta las direcciones', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    expect(await notifyIndexNow(urls, { siteUrl: SITE, production: true, fetchImpl })).toEqual({ enviadas: 1, http: 202 });
    const [endpoint, init] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('https://api.indexnow.org/indexnow');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).urlList).toEqual(urls);
  });

  it('nunca lanza: un rechazo o una caída quedan como error', async () => {
    const rejected = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    expect(await notifyIndexNow(urls, { siteUrl: SITE, production: true, fetchImpl: rejected })).toEqual({
      error: 'IndexNow respondió HTTP 403',
    });
    const down = vi.fn().mockRejectedValue(new Error('timeout'));
    expect(await notifyIndexNow(urls, { siteUrl: SITE, production: true, fetchImpl: down })).toEqual({ error: 'timeout' });
  });

  describe('sin decirle si es producción, lo ve en las variables', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('en Railway (APP_ENV=production) avisa; sin VERCEL_ENV ni APP_ENV, no', async () => {
      vi.stubEnv('VERCEL_ENV', '');
      vi.stubEnv('APP_ENV', '');
      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      expect(await notifyIndexNow(urls, { siteUrl: SITE, fetchImpl })).toEqual({ omitido: 'no es producción' });

      vi.stubEnv('APP_ENV', 'production');
      expect(await notifyIndexNow(urls, { siteUrl: SITE, fetchImpl })).toEqual({ enviadas: 1, http: 200 });
    });

    it('en Vercel (VERCEL_ENV=production) sigue avisando como antes', async () => {
      vi.stubEnv('APP_ENV', '');
      vi.stubEnv('VERCEL_ENV', 'production');
      const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
      expect(await notifyIndexNow(urls, { siteUrl: SITE, fetchImpl })).toEqual({ enviadas: 1, http: 202 });
    });
  });
});
