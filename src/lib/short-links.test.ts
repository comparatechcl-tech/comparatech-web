import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogIdFromUrl, clearShortLinkCache, resolvableShortLink, resolveShortLink } from './short-links';

/*
 * Nunca hay red: el acortador es falso. Lo que importa es que el pedido vaya
 * solo a tinyurl.com, que no se siga la redirección, y que meli.la (que es de
 * Mercado Libre) no se toque.
 */

const TARGET =
  'https://www.mercadolibre.cl/consola-playstation-5-digital-slim-juego-astro-bot-y-gran-turismo-7/p/MLC61403702?utm_medium=notifications&utm_source=telegram&matt_tool=42669385';

function redirectTo(location: string | null, status = 301) {
  return vi.fn(async () => new Response(null, { status, headers: location ? { location } : {} }));
}

beforeEach(() => clearShortLinkCache());

describe('catalogIdFromUrl', () => {
  it('saca la ficha de una dirección de Mercado Libre Chile, con o sin nombre y parámetros', () => {
    expect(catalogIdFromUrl(TARGET)).toBe('MLC61403702');
    expect(catalogIdFromUrl('https://www.mercadolibre.cl/p/MLC63071662')).toBe('MLC63071662');
    expect(catalogIdFromUrl('https://mercadolibre.cl/algo/p/mlc12345678#fotos')).toBe('MLC12345678');
  });

  it('no inventa una ficha donde no la hay', () => {
    expect(catalogIdFromUrl('https://www.mercadolibre.cl/ofertas')).toBeNull();
    expect(catalogIdFromUrl('https://www.mercadolibre.cl/up/MLCU379728559')).toBeNull();
    expect(catalogIdFromUrl('https://articulo.mercadolibre.cl/MLC-123456789-algo-_JM')).toBeNull();
    expect(catalogIdFromUrl('https://www.mercadolibre.com.ar/p/MLA12345678')).toBeNull();
    expect(catalogIdFromUrl('https://otro-sitio.cl/?u=https://www.mercadolibre.cl/p/MLC12345678')).toBeNull();
    expect(catalogIdFromUrl('')).toBeNull();
  });
});

describe('resolvableShortLink', () => {
  it('acepta solo links de tinyurl.com con su código', () => {
    expect(resolvableShortLink('https://tinyurl.com/yc8hrkdp')).toBe('https://tinyurl.com/yc8hrkdp');
    expect(resolvableShortLink('http://www.tinyurl.com/yc8hrkdp/')).toBe('https://tinyurl.com/yc8hrkdp');
  });

  it('meli.la y cualquier otra cosa quedan fuera', () => {
    expect(resolvableShortLink('https://meli.la/2abcDEF')).toBeNull();
    expect(resolvableShortLink('https://www.mercadolibre.cl/p/MLC63071662')).toBeNull();
    expect(resolvableShortLink('https://tinyurl.com/')).toBeNull();
    expect(resolvableShortLink('https://tinyurl.com/app/algo')).toBeNull();
    expect(resolvableShortLink('https://tinyurl.com/abc?x=1')).toBeNull();
    expect(resolvableShortLink('https://tinyurl.com.otro.cl/abc')).toBeNull();
    expect(resolvableShortLink('javascript:alert(1)')).toBeNull();
    expect(resolvableShortLink('no es un link')).toBeNull();
  });
});

describe('resolveShortLink', () => {
  it('pregunta al acortador sin seguir la redirección y devuelve la ficha', async () => {
    const fetchImpl = redirectTo(TARGET);
    await expect(resolveShortLink('https://tinyurl.com/yc8hrkdp', fetchImpl)).resolves.toEqual({
      status: 'ficha',
      mlId: 'MLC61403702',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://tinyurl.com/yc8hrkdp');
    expect(init.method).toBe('HEAD');
    expect(init.redirect).toBe('manual');
  });

  it('no vuelve a preguntar por un link que ya resolvió', async () => {
    const fetchImpl = redirectTo(TARGET);
    await resolveShortLink('https://tinyurl.com/yc8hrkdp', fetchImpl);
    await resolveShortLink('https://tinyurl.com/yc8hrkdp', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('un destino que no es una ficha no identifica un producto', async () => {
    await expect(resolveShortLink('https://tinyurl.com/ofertas1', redirectTo('https://www.mercadolibre.cl/ofertas'))).resolves.toEqual({
      status: 'otro',
    });
    // Aunque el acortador apunte a meli.la, no se le pregunta nada a Mercado Libre.
    const fetchImpl = redirectTo('https://meli.la/2abcDEF');
    await expect(resolveShortLink('https://tinyurl.com/haciameli', fetchImpl)).resolves.toEqual({ status: 'otro' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('meli.la no se pide nunca', async () => {
    const fetchImpl = redirectTo(TARGET);
    await expect(resolveShortLink('https://meli.la/2abcDEF', fetchImpl)).resolves.toMatchObject({ status: 'sin_resolver' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('si el acortador no redirige o no responde, queda sin resolver y se pregunta de nuevo después', async () => {
    const notFound = redirectTo(null, 404);
    await expect(resolveShortLink('https://tinyurl.com/noexiste', notFound)).resolves.toMatchObject({ status: 'sin_resolver' });
    const down = vi.fn(async () => {
      throw new Error('timeout');
    });
    await expect(resolveShortLink('https://tinyurl.com/yc8hrkdp', down)).resolves.toEqual({
      status: 'sin_resolver',
      reason: 'timeout',
    });
    // Nada de eso quedó guardado.
    const ok = redirectTo(TARGET);
    await expect(resolveShortLink('https://tinyurl.com/yc8hrkdp', ok)).resolves.toMatchObject({ status: 'ficha' });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
