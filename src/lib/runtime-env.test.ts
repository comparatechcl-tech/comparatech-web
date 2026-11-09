import { describe, expect, it } from 'vitest';
import { isProductionRuntime, isVercel } from './runtime-env';
import { resolveSiteUrl } from './site';

/**
 * Mudanza a Railway (noviembre de 2026): "el sitio publicado" ya no es solo
 * VERCEL_ENV=production. En Railway se marca con APP_ENV=production, y todo lo
 * demás (vistas previas, copia de prueba, el PC del dueño) sigue sin publicar.
 */
describe('isProductionRuntime', () => {
  it('es el sitio publicado en Vercel (VERCEL_ENV=production) y en Railway (APP_ENV=production)', () => {
    expect(isProductionRuntime({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe(true);
    expect(isProductionRuntime({ APP_ENV: 'production' })).toBe(true);
  });

  it.each([
    ['sin nada (el PC del dueño o las pruebas)', {}],
    ['una vista previa de Vercel', { VERCEL: '1', VERCEL_ENV: 'preview' }],
    ['el .env bajado de Vercel (development)', { VERCEL: '1', VERCEL_ENV: 'development' }],
    ['solo VERCEL=1', { VERCEL: '1' }],
    ['APP_ENV de otra cosa', { APP_ENV: 'staging' }],
    ['valores que no son exactamente "production"', { VERCEL_ENV: 'Production', APP_ENV: 'production ' }],
  ])('no lo es con %s', (_label, env) => {
    expect(isProductionRuntime(env)).toBe(false);
  });
});

describe('isVercel', () => {
  it('solo con VERCEL=1, la variable que Vercel pone al armar y al correr', () => {
    expect(isVercel({ VERCEL: '1' })).toBe(true);
    expect(isVercel({})).toBe(false);
    expect(isVercel({ APP_ENV: 'production' })).toBe(false);
    expect(isVercel({ VERCEL: '0' })).toBe(false);
  });
});

describe('resolveSiteUrl', () => {
  it('usa NEXT_PUBLIC_SITE_URL, sin la barra final', () => {
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: 'https://www.comparatech.cl/' })).toBe('https://www.comparatech.cl');
    expect(resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: ' https://www.comparatech.cl ', APP_ENV: 'production' })).toBe(
      'https://www.comparatech.cl',
    );
  });

  it('en Vercel, sin la variable, cae al dominio que Vercel conoce (como siempre)', () => {
    expect(resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'www.comparatech.cl' })).toBe('https://www.comparatech.cl');
    expect(resolveSiteUrl({ VERCEL_URL: 'comparatech-abc.vercel.app' })).toBe('https://comparatech-abc.vercel.app');
  });

  it('en el PC o en las pruebas cae a localhost', () => {
    expect(resolveSiteUrl({})).toBe('http://localhost:3000');
  });

  it('en Railway (APP_ENV=production) sin la variable corta el build en vez de apuntar a localhost', () => {
    expect(() => resolveSiteUrl({ APP_ENV: 'production' })).toThrow('Falta NEXT_PUBLIC_SITE_URL');
    expect(() => resolveSiteUrl({ APP_ENV: 'production', NEXT_PUBLIC_SITE_URL: '   ' })).toThrow('Railway → Variables');
  });
});
