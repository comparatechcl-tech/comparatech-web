import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * La política de seguridad del sitio publicado, leída de la cabecera que arma
 * next.config.js: los videos de /admin/videos están en el Storage de
 * Supabase, y sin su origen el reproductor queda en negro y Compartir falla.
 * En local no hay CSP, así que este es el único lugar donde se nota.
 */

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

// next.config.js es CommonJS y lee las variables al armar las cabeceras, no al cargarse.
const nextConfig = createRequire(import.meta.url)('../../../next.config.js') as { headers: () => Promise<HeaderRule[]> };

const SUPABASE = 'https://abcd1234.supabase.co';

/** La política de siempre, tal como estaba antes de los videos. */
const BEFORE =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: https://*.mlstatic.com; font-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

async function policy(env: { supabase?: string; node?: string; vercel?: string } = {}): Promise<string | null> {
  vi.stubEnv('NODE_ENV', env.node ?? 'production');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.supabase ?? '');
  vi.stubEnv('VERCEL_ENV', env.vercel ?? 'production');
  const rules = await nextConfig.headers();
  const site = rules.find((rule) => rule.source === '/:path*');
  return site?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? null;
}

/** La política por directiva: nombre → sus fuentes. */
function directives(csp: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (csp ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out[name] = sources.join(' ');
  }
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CSP: los videos del Storage de Supabase', () => {
  it('con el proyecto de Supabase definido, su origen entra en imágenes, video y descargas', async () => {
    const d = directives(await policy({ supabase: SUPABASE }));
    // La portada.
    expect(d['img-src']).toBe(`'self' data: https://*.mlstatic.com ${SUPABASE}`);
    // El reproductor.
    expect(d['media-src']).toBe(`'self' ${SUPABASE}`);
    // Bajar el archivo para compartirlo o guardarlo.
    expect(d['connect-src']).toBe(`'self' ${SUPABASE}`);
  });

  it('nada más se abre: el resto de la política queda igual', async () => {
    const before = directives(BEFORE);
    const after = directives(await policy({ supabase: SUPABASE }));
    expect(Object.keys(after).sort()).toEqual([...Object.keys(before), 'media-src'].sort());
    for (const name of Object.keys(before)) {
      if (name === 'img-src' || name === 'connect-src') continue;
      expect(after[name]).toBe(before[name]);
    }
    // Ni scripts, ni marcos, ni formularios desde ese origen; y ningún comodín de Supabase.
    expect(after['script-src']).not.toContain('supabase');
    expect(after['default-src']).toBe("'self'");
    expect(await policy({ supabase: SUPABASE })).not.toContain('*.supabase');
  });

  it('sin la variable, la política es exactamente la de antes', async () => {
    expect(await policy()).toBe(BEFORE);
    expect(await policy({ supabase: '   ' })).toBe(BEFORE);
  });

  it('de la dirección toma solo el origen', async () => {
    for (const url of [`${SUPABASE}/`, `${SUPABASE}/storage/v1/object/public/reels`, `  ${SUPABASE}  `, 'https://ABCD1234.supabase.co']) {
      expect(directives(await policy({ supabase: url }))['media-src']).toBe(`'self' ${SUPABASE}`);
    }
    // Un Supabase propio en otro puerto conserva el puerto.
    expect(directives(await policy({ supabase: 'https://db.ejemplo.cl:8443/x' }))['media-src']).toBe("'self' https://db.ejemplo.cl:8443");
  });

  it('una dirección sin https o mal escrita no abre nada', async () => {
    const bad = [
      'http://abcd1234.supabase.co',
      'abcd1234.supabase.co',
      'no es una dirección',
      'javascript:alert(1)',
      'data:text/html,hola',
      'https://',
      // Intentos de colar otra directiva o otro origen en la cabecera.
      "https://abcd1234.supabase.co;script-src",
      'https://abcd1234.supabase.co,https://otro.test',
      "https://abcd1234.supabase.co; script-src *",
      'https://*.supabase.co',
    ];
    for (const url of bad) expect(await policy({ supabase: url }), url).toBe(BEFORE);
  });

  it('en los deploys de Preview conserva lo de la barra de Vercel junto al origen', async () => {
    const d = directives(await policy({ supabase: SUPABASE, vercel: 'preview' }));
    expect(d['img-src']).toBe(`'self' data: https://*.mlstatic.com ${SUPABASE} https://vercel.live https://vercel.com blob:`);
    expect(d['connect-src']).toBe(`'self' ${SUPABASE} https://vercel.live wss://ws-us3.pusher.com`);
    expect(d['media-src']).toBe(`'self' ${SUPABASE}`);
    expect(d['frame-src']).toBe('https://vercel.live');
  });

  it('fuera de producción sigue sin CSP: next dev no funciona con una estricta', async () => {
    expect(await policy({ supabase: SUPABASE, node: 'development' })).toBeNull();
  });

  it('la cabecera no trae saltos de línea ni caracteres que la rompan', async () => {
    const csp = (await policy({ supabase: SUPABASE })) ?? '';
    expect(csp).toMatch(/^[\x20-\x7e]+$/);
    expect(csp.split(';')).toHaveLength(11);
  });
});
