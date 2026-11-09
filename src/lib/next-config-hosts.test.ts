import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Las reglas por dominio de next.config.js para la mudanza a Railway:
 * - comparatech.cl (sin www) → https://www.comparatech.cl con 308, menos /api;
 * - una copia que no está en el dominio propio (la de prueba en
 *   *.up.railway.app) lleva X-Robots-Tag: noindex.
 *
 * Se prueban con las mismas piezas de Next que usa `next start` para decidir
 * (getPathMatch, matchHas y prepareDestination), no con una imitación.
 */

const require = createRequire(import.meta.url);

interface Rule {
  source: string;
  destination?: string;
  statusCode?: number;
  permanent?: boolean;
  has?: { type: string; key?: string; value?: string }[];
  missing?: { type: string; key?: string; value?: string }[];
  headers?: { key: string; value: string }[];
}

const nextConfig = require('../../next.config.js') as { redirects: () => Promise<Rule[]>; headers: () => Promise<Rule[]> };
const { getPathMatch } = require('next/dist/shared/lib/router/utils/path-match') as {
  getPathMatch: (source: string, opts: object) => (pathname: string) => false | Record<string, string>;
};
const { matchHas, prepareDestination } = require('next/dist/shared/lib/router/utils/prepare-destination') as {
  matchHas: (req: { headers: Record<string, string> }, query: Record<string, string>, has?: Rule['has'], missing?: Rule['missing']) => false | Record<string, string>;
  prepareDestination: (args: object) => {
    parsedDestination: { protocol?: string; hostname?: string; port?: string; pathname: string; query: Record<string, string> };
  };
};
const { modifyRouteRegex, getRedirectStatus } = require('next/dist/lib/redirect-status') as {
  modifyRouteRegex: (regex: string, restricted?: string[]) => string;
  getRedirectStatus: (route: Rule) => number;
};

/** Como buildCustomRoute de next/dist/server/lib/router-utils/filesystem. */
function matcher(rule: Rule, type: 'redirect' | 'header') {
  return getPathMatch(rule.source, {
    strict: true,
    removeUnnamedParams: true,
    regexModifier: (regex: string) => modifyRouteRegex(regex, type === 'redirect' ? ['/_next'] : undefined),
  });
}

function parse(url: string) {
  const u = new URL(url);
  return { host: u.host, pathname: u.pathname, query: Object.fromEntries(u.searchParams) };
}

/** La primera redirección que aplica, como la resuelve Next: { status, location } o null. */
async function redirectFor(url: string, extra: Record<string, string> = {}) {
  const { host, pathname, query } = parse(url);
  for (const rule of await nextConfig.redirects()) {
    const params = matcher(rule, 'redirect')(pathname);
    if (!params) continue;
    const hasParams = matchHas({ headers: { host, ...extra } }, query, rule.has, rule.missing);
    if (!hasParams) continue;
    const { parsedDestination } = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params: { ...params, ...hasParams },
      query,
    });
    const search = new URLSearchParams(parsedDestination.query).toString();
    const { protocol, hostname, port } = parsedDestination;
    const location = `${protocol}//${hostname}${port ? `:${port}` : ''}${parsedDestination.pathname}${search ? `?${search}` : ''}`;
    return { status: getRedirectStatus(rule), location };
  }
  return null;
}

/** El valor final de una cabecera: si varias reglas la ponen, gana la última (como en Next). */
async function headerFor(url: string, key: string, extra: Record<string, string> = {}) {
  const { host, pathname, query } = parse(url);
  let value: string | null = null;
  for (const rule of await nextConfig.headers()) {
    if (!matcher(rule, 'header')(pathname)) continue;
    if (!matchHas({ headers: { host, ...extra } }, query, rule.has, rule.missing)) continue;
    for (const h of rule.headers ?? []) if (h.key.toLowerCase() === key.toLowerCase()) value = h.value;
  }
  return value;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('comparatech.cl (sin www) → www', () => {
  it('con 308, el mismo camino y la misma consulta', async () => {
    expect(await redirectFor('https://comparatech.cl/')).toEqual({ status: 308, location: 'https://www.comparatech.cl/' });
    expect(await redirectFor('https://comparatech.cl/ofertas?x=1')).toEqual({
      status: 308,
      location: 'https://www.comparatech.cl/ofertas?x=1',
    });
    expect(await redirectFor('https://comparatech.cl/producto/consola-nintendo-switch-2?src=instagram&utm_medium=social')).toEqual({
      status: 308,
      location: 'https://www.comparatech.cl/producto/consola-nintendo-switch-2?src=instagram&utm_medium=social',
    });
    expect(await redirectFor('https://comparatech.cl/categoria/gaming/consolas')).toEqual({
      status: 308,
      location: 'https://www.comparatech.cl/categoria/gaming/consolas',
    });
    // Con puerto en el host igual calza (Next lo saca antes de comparar).
    expect((await redirectFor('http://comparatech.cl:8080/ofertas'))?.location).toBe('https://www.comparatech.cl/ofertas');
  });

  it('menos /api: los crons y los scripts llaman con el secreto y no siguen redirecciones', async () => {
    expect(await redirectFor('https://comparatech.cl/api/health')).toBeNull();
    expect(await redirectFor('https://comparatech.cl/api/cron/refresh-prices')).toBeNull();
    expect(await redirectFor('https://comparatech.cl/api')).toBeNull();
    // Una página que solo empieza con "api" sí se redirige.
    expect((await redirectFor('https://comparatech.cl/apis-de-precio'))?.location).toBe('https://www.comparatech.cl/apis-de-precio');
  });

  it('no puede quedar en un ciclo: www, la copia de prueba y el chequeo de Railway no se redirigen', async () => {
    for (const url of [
      'https://www.comparatech.cl/',
      'https://www.comparatech.cl/ofertas?x=1',
      'https://comparatech-web-production.up.railway.app/ofertas',
      'https://healthcheck.railway.app/robots.txt',
      'http://localhost:3000/ofertas',
      // Parecidos que no son el dominio.
      'https://comparatech.cl.evil.example/ofertas',
      'https://xcomparatech.cl/ofertas',
    ]) {
      expect(await redirectFor(url), url).toBeNull();
    }
  });

  it('la redirección del dominio viejo de Vercel sigue igual (301, sin /api, /social ni /admin)', async () => {
    expect(await redirectFor('https://comparatech-web.vercel.app/ofertas')).toEqual({
      status: 301,
      location: 'https://www.comparatech.cl/ofertas',
    });
    expect(await redirectFor('https://comparatech-web.vercel.app/api/cron/refresh-prices')).toBeNull();
    expect(await redirectFor('https://comparatech-web.vercel.app/social/pieza/abc/feed.jpg')).toBeNull();
  });
});

describe('X-Robots-Tag: la copia que no está en el dominio propio no se indexa', () => {
  it('en *.up.railway.app (y en cualquier otro host) lleva noindex, también en robots.txt y los archivos', async () => {
    for (const path of ['/', '/producto/x', '/robots.txt', '/sitemap.xml', '/_next/static/chunks/main.js']) {
      expect(await headerFor(`https://comparatech-web-production.up.railway.app${path}`, 'X-Robots-Tag'), path).toBe(
        'noindex, nofollow',
      );
    }
    expect(await headerFor('https://comparatech-web-git-rama.vercel.app/', 'X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await headerFor('https://www.comparatech.cl.evil.example/', 'X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('en el dominio propio y en el PC, las páginas públicas se indexan', async () => {
    for (const url of [
      'https://www.comparatech.cl/',
      'https://www.comparatech.cl/producto/x',
      'https://www.comparatech.cl/robots.txt',
      'https://comparatech.cl/api/health',
      'http://localhost:3000/',
      'http://127.0.0.1:3006/ofertas',
    ]) {
      const value = await headerFor(url, 'X-Robots-Tag');
      if (new URL(url).pathname.startsWith('/api')) expect(value, url).toBe('noindex, nofollow');
      else expect(value, url).toBeNull();
    }
  });

  it('el admin y la API siguen con noindex en el dominio propio', async () => {
    expect(await headerFor('https://www.comparatech.cl/admin', 'X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await headerFor('https://www.comparatech.cl/api/health', 'X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('si el proxy de Railway le cambiara el Host a la app', () => {
  // Railway deja el host original en X-Forwarded-Host. Con un Host interno, el
  // dominio propio tiene que seguir sin noindex y el apex con su redirección.
  const INTERNAL = 'http://comparatech-web.railway.internal:8080';

  it('www sigue indexable', async () => {
    expect(await headerFor(`${INTERNAL}/producto/x`, 'X-Robots-Tag', { 'x-forwarded-host': 'www.comparatech.cl' })).toBeNull();
    expect(await redirectFor(`${INTERNAL}/producto/x`, { 'x-forwarded-host': 'www.comparatech.cl' })).toBeNull();
  });

  it('el apex sigue redirigiendo a www, con la consulta y sin tocar /api', async () => {
    expect(await redirectFor(`${INTERNAL}/ofertas?x=1`, { 'x-forwarded-host': 'comparatech.cl' })).toEqual({
      status: 308,
      location: 'https://www.comparatech.cl/ofertas?x=1',
    });
    expect(await redirectFor(`${INTERNAL}/api/health`, { 'x-forwarded-host': 'comparatech.cl' })).toBeNull();
  });

  it('la copia de prueba sigue con noindex', async () => {
    expect(
      await headerFor(`${INTERNAL}/`, 'X-Robots-Tag', { 'x-forwarded-host': 'comparatech-web-production.up.railway.app' }),
    ).toBe('noindex, nofollow');
    expect(await headerFor(`${INTERNAL}/`, 'X-Robots-Tag', { 'x-forwarded-host': 'www.comparatech.cl.evil.example' })).toBe(
      'noindex, nofollow',
    );
  });
});

describe('HSTS', () => {
  // next.config.js decide HSTS al cargarse, según dónde se arma el sitio.
  async function freshHsts(env: Record<string, string>) {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const path = require.resolve('../../next.config.js');
    delete require.cache[path];
    try {
      const config = require(path) as typeof nextConfig;
      const site = (await config.headers()).find((rule) => rule.source === '/:path*' && !rule.missing);
      return site?.headers?.find((h) => h.key === 'Strict-Transport-Security')?.value ?? null;
    } finally {
      delete require.cache[path];
    }
  }

  it('fuera de Vercel (Railway) el sitio lo manda, igual que lo mandaba Vercel', async () => {
    expect(await freshHsts({ NODE_ENV: 'production', VERCEL: '' })).toBe('max-age=63072000');
  });

  it('en Vercel no: lo pone Vercel por su cuenta', async () => {
    expect(await freshHsts({ NODE_ENV: 'production', VERCEL: '1' })).toBeNull();
  });
});
