import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * La política de seguridad del sitio publicado, leída de la cabecera que arma
 * next.config.js: los videos de /admin/videos están en el Storage de
 * Supabase, y sin su carpeta el reproductor queda en negro y Compartir falla.
 * En local no hay CSP, así que este es el único lugar donde se nota.
 */

// lib/social/videos se importa de verdad, solo para comparar la carpeta del
// bucket. Dos de los módulos que arrastra usan cache() de React, que solo
// existe dentro de Next: se reemplazan, acá no se llaman.
vi.mock('@/lib/settings', () => ({ readAffiliateSettings: vi.fn() }));
vi.mock('@/lib/queries/price-history', () => ({ getPriceStatsMany: vi.fn(), getPriceStatsManyChecked: vi.fn() }));

import { VIDEO_BUCKET, videoPublicUrl } from '@/lib/social/videos';

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

// next.config.js es CommonJS y lee las variables al armar las cabeceras, no al cargarse.
const nextConfig = createRequire(import.meta.url)('../../../next.config.js') as { headers: () => Promise<HeaderRule[]> };

const SUPABASE = 'https://abcd1234.supabase.co';
/** Lo único del proyecto de Supabase que el navegador puede pedir: la carpeta pública del bucket de videos. */
const FOLDER = `${SUPABASE}/storage/v1/object/public/reels/`;

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

/**
 * ¿Una fuente de la CSP deja pasar esta dirección? Lo justo de la regla del
 * navegador: mismo origen, y si la fuente trae ruta, la dirección tiene que
 * colgar de ella (ruta terminada en "/") o ser exactamente esa.
 */
function allows(source: string, address: string): boolean {
  const from = new URL(source);
  const to = new URL(address);
  if (from.origin !== to.origin) return false;
  if (from.pathname === '/' && !source.endsWith('/')) return true;
  return from.pathname.endsWith('/') ? to.pathname.startsWith(from.pathname) : to.pathname === from.pathname;
}

/** Las fuentes de una directiva que apuntan al proyecto de Supabase. */
const supabaseSources = (sources: string) => sources.split(' ').filter((source) => source.includes('supabase'));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('CSP: los videos del Storage de Supabase', () => {
  it('con el proyecto de Supabase definido, la carpeta del bucket entra en imágenes, video y descargas', async () => {
    const d = directives(await policy({ supabase: SUPABASE }));
    // La portada.
    expect(d['img-src']).toBe(`'self' data: https://*.mlstatic.com ${FOLDER}`);
    // El reproductor.
    expect(d['media-src']).toBe(`'self' ${FOLDER}`);
    // Bajar el archivo para compartirlo o guardarlo.
    expect(d['connect-src']).toBe(`'self' ${FOLDER}`);
  });

  it('abre solo esa carpeta, no el proyecto entero: la API de la base queda fuera', async () => {
    const d = directives(await policy({ supabase: SUPABASE }));
    for (const name of ['img-src', 'media-src', 'connect-src']) {
      const sources = supabaseSources(d[name]);
      // Una sola fuente de Supabase por directiva, y nunca el origen pelado.
      expect(sources, name).toEqual([FOLDER]);
      expect(d[name].split(' '), name).not.toContain(SUPABASE);
      expect(d[name].split(' '), name).not.toContain(`${SUPABASE}/`);

      // Lo que la página pide de verdad pasa: el video y su portada, en la carpeta del día.
      expect(allows(sources[0], `${FOLDER}2026-10-13/producto-49990-estudio-0a1b2c3d.mp4`), name).toBe(true);
      expect(allows(sources[0], `${FOLDER}2026-10-13/producto-49990-estudio-0a1b2c3d.jpg`), name).toBe(true);
      // Lo demás del mismo dominio, no: la base, el inicio de sesión, otros buckets, subir o firmar archivos.
      for (const path of [
        '/rest/v1/products?select=*',
        '/auth/v1/token',
        '/storage/v1/object/public/otro-bucket/a.jpg',
        '/storage/v1/object/public/reels',
        '/storage/v1/object/public/reels-privado/a.mp4',
        '/storage/v1/object/reels/2026-10-13/a.mp4',
        '/storage/v1/object/sign/reels/2026-10-13/a.mp4',
        '/storage/v1/object/upload/sign/reels/2026-10-13/a.mp4',
        '/',
      ]) {
        expect(allows(sources[0], `${SUPABASE}${path}`), `${name} ${path}`).toBe(false);
      }
      // Ni el mismo camino en otro proyecto.
      expect(allows(sources[0], 'https://otro.supabase.co/storage/v1/object/public/reels/a.mp4'), name).toBe(false);
    }
  });

  it('la carpeta es la del bucket de verdad: ahí están las direcciones que la página le pasa al reproductor', async () => {
    const d = directives(await policy({ supabase: SUPABASE }));
    // next.config.js no puede importar el nombre del bucket: si cambia en lib/social/videos, esto lo avisa.
    expect(FOLDER).toBe(`${SUPABASE}/storage/v1/object/public/${VIDEO_BUCKET}/`);
    for (const file of ['2026-10-13/producto-49990-estudio-0a1b2c3d.mp4', '2026-10-13/producto-49990-estudio-0a1b2c3d.jpg']) {
      const address = videoPublicUrl(file, SUPABASE);
      for (const name of ['img-src', 'media-src', 'connect-src']) {
        expect(allows(supabaseSources(d[name])[0], address), `${name} ${file}`).toBe(true);
      }
    }
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

  it('de la dirección toma solo el origen, y la carpeta la pone el sitio', async () => {
    for (const url of [
      `${SUPABASE}/`,
      `${SUPABASE}/storage/v1/object/public/reels`,
      `${SUPABASE}/storage/v1/object/public/reels/`,
      `${SUPABASE}/rest/v1`,
      `  ${SUPABASE}  `,
      'https://ABCD1234.supabase.co',
    ]) {
      expect(directives(await policy({ supabase: url }))['media-src'], url).toBe(`'self' ${FOLDER}`);
    }
    // Un Supabase propio en otro puerto conserva el puerto.
    expect(directives(await policy({ supabase: 'https://db.ejemplo.cl:8443/x' }))['media-src']).toBe(
      "'self' https://db.ejemplo.cl:8443/storage/v1/object/public/reels/"
    );
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

  it('en los deploys de Preview conserva lo de la barra de Vercel junto a la carpeta', async () => {
    const d = directives(await policy({ supabase: SUPABASE, vercel: 'preview' }));
    expect(d['img-src']).toBe(`'self' data: https://*.mlstatic.com ${FOLDER} https://vercel.live https://vercel.com blob:`);
    expect(d['connect-src']).toBe(`'self' ${FOLDER} https://vercel.live wss://ws-us3.pusher.com`);
    expect(d['media-src']).toBe(`'self' ${FOLDER}`);
    expect(d['frame-src']).toBe('https://vercel.live');
  });

  it('fuera de producción sigue sin CSP: next dev no funciona con una estricta', async () => {
    expect(await policy({ supabase: SUPABASE, node: 'development' })).toBeNull();
  });

  it('la cabecera no trae saltos de línea ni caracteres que la rompan', async () => {
    const csp = (await policy({ supabase: SUPABASE })) ?? '';
    expect(csp).toMatch(/^[\x20-\x7e]+$/);
    expect(csp.split(';')).toHaveLength(11);
    // La ruta de la carpeta no trae nada que la CSP lea como separador.
    expect(FOLDER).toMatch(/^https:\/\/[a-z0-9.-]+\/[a-z0-9/]+\/$/);
  });
});
