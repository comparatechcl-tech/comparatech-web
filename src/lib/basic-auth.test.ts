import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkBasicAuth, getAdminCredentials } from '@/lib/basic-auth';
import { safeEqual } from '@/lib/safe-equal';
import { isCronAuthorized } from '@/lib/cron-auth';
import { isMissingSchemaError } from '@/lib/supabase/errors';
import { pingHealthcheck, startCronRun } from '@/lib/cron-runs';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Cabecera Basic con UTF-8, igual que la arma el navegador. */
function basic(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('safeEqual', () => {
  it('compara contenido y largo', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('', '')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('abcd', 'abc')).toBe(false);
    expect(safeEqual('abc', '')).toBe(false);
    expect(safeEqual('clave-ñ', 'clave-ñ')).toBe(true);
    expect(safeEqual('clave-ñ', 'clave-n')).toBe(false);
  });
});

describe('checkBasicAuth', () => {
  it('reconoce a cada persona de ADMIN_USERS con su propia clave', () => {
    vi.stubEnv('ADMIN_USERS', 'cristopher:clave-uno,socia:otra:clave');
    vi.stubEnv('ADMIN_USER', '');
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(checkBasicAuth(basic('cristopher', 'clave-uno'))).toBe('cristopher');
    // Separa en el PRIMER ':' de la cabecera: la clave puede llevar ':'.
    expect(checkBasicAuth(basic('socia', 'otra:clave'))).toBe('socia');
    // La clave de una persona no sirve para la otra.
    expect(checkBasicAuth(basic('socia', 'clave-uno'))).toBeNull();
    expect(checkBasicAuth(basic('cristopher', 'otra:clave'))).toBeNull();
  });

  it('rechaza cabeceras ausentes, mal armadas o con otro esquema', () => {
    vi.stubEnv('ADMIN_USERS', 'ana:secreto');
    expect(checkBasicAuth(null)).toBeNull();
    expect(checkBasicAuth('')).toBeNull();
    expect(checkBasicAuth('Bearer abc')).toBeNull();
    expect(checkBasicAuth('Basic')).toBeNull();
    expect(checkBasicAuth('Basic %%%no-es-base64')).toBeNull();
    expect(checkBasicAuth(`Basic ${btoa('sin-dos-puntos')}`)).toBeNull();
    expect(checkBasicAuth(basic('ana', 'secret'))).toBeNull();
    expect(checkBasicAuth(basic('ana', 'secreto2'))).toBeNull();
    expect(checkBasicAuth(basic('Ana', 'secreto'))).toBeNull();
    expect(checkBasicAuth(basic('ana', 'secreto'))).toBe('ana');
  });

  it('acepta claves con tildes y ñ', () => {
    vi.stubEnv('ADMIN_USERS', 'josé:contraseña:ñandú');
    expect(checkBasicAuth(basic('josé', 'contraseña:ñandú'))).toBe('josé');
  });

  it('usa ADMIN_USER / ADMIN_PASSWORD si ADMIN_USERS está vacía', () => {
    vi.stubEnv('ADMIN_USERS', '');
    vi.stubEnv('ADMIN_USER', 'admin');
    vi.stubEnv('ADMIN_PASSWORD', 'a:b:c');
    expect(checkBasicAuth(basic('admin', 'a:b:c'))).toBe('admin');
    expect(checkBasicAuth(basic('admin', 'a'))).toBeNull();
  });

  it('sin credenciales configuradas no deja entrar a nadie', () => {
    vi.stubEnv('ADMIN_USERS', '');
    vi.stubEnv('ADMIN_USER', '');
    vi.stubEnv('ADMIN_PASSWORD', '');
    expect(getAdminCredentials()).toEqual([]);
    expect(checkBasicAuth(basic('', ''))).toBeNull();
    expect(checkBasicAuth(basic('admin', ''))).toBeNull();
  });

  it('ignora entradas sin clave o sin nombre en ADMIN_USERS', () => {
    vi.stubEnv('ADMIN_USERS', 'vacio:, :sin-nombre,sololetras, bien:ok ');
    expect(getAdminCredentials()).toEqual([{ name: 'bien', password: 'ok ' }]);
    expect(checkBasicAuth(basic('vacio', ''))).toBeNull();
  });
});

describe('isCronAuthorized', () => {
  const req = (auth?: string) =>
    new Request('https://comparatech.test/api/cron/refresh-prices', {
      headers: auth ? { authorization: auth } : {},
    });

  it("rechaza 'Bearer undefined' cuando falta CRON_SECRET", () => {
    vi.stubEnv('CRON_SECRET', undefined);
    expect(isCronAuthorized(req('Bearer undefined'))).toBe(false);
    expect(isCronAuthorized(req('Bearer '))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });

  it('rechaza todo si el secreto mide menos de 16 caracteres', () => {
    vi.stubEnv('CRON_SECRET', 'corto123');
    expect(isCronAuthorized(req('Bearer corto123'))).toBe(false);
  });

  it('acepta solo el secreto exacto', () => {
    vi.stubEnv('CRON_SECRET', '0123456789abcdef-largo');
    expect(isCronAuthorized(req('Bearer 0123456789abcdef-largo'))).toBe(true);
    expect(isCronAuthorized(req('Bearer 0123456789abcdef-larg'))).toBe(false);
    expect(isCronAuthorized(req('0123456789abcdef-largo'))).toBe(false);
    expect(isCronAuthorized(req())).toBe(false);
  });
});

describe('isMissingSchemaError', () => {
  it('reconoce tablas y columnas que faltan', () => {
    for (const code of ['42P01', '42703', 'PGRST204', 'PGRST205']) {
      expect(isMissingSchemaError({ code, message: 'x' })).toBe(true);
    }
    expect(isMissingSchemaError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingSchemaError({ message: 'sin código' })).toBe(false);
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
  });
});

/** Cliente de Supabase falso: solo lo que usa cron-runs. */
function fakeAdmin(insertResult: { data: unknown; error: unknown }) {
  const updates: unknown[] = [];
  const admin = {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => insertResult }) }),
      update: (values: unknown) => {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  } as unknown as SupabaseClient;
  return { admin, updates };
}

describe('startCronRun', () => {
  it('no hace nada si falta la tabla cron_runs', async () => {
    const { admin, updates } = fakeAdmin({ data: null, error: { code: 'PGRST205', message: 'no existe' } });
    const run = await startCronRun(admin, 'refresh-prices');
    await run.finish(true, { revisados: 3 });
    expect(updates).toEqual([]);
  });

  it('cierra la corrida una sola vez con el resultado', async () => {
    const { admin, updates } = fakeAdmin({ data: { id: 7 }, error: null });
    const run = await startCronRun(admin, 'prospect');
    await run.finish(false, { revisados: 3 }, 'ML no respondió');
    await run.finish(true, {});
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ ok: false, summary: { revisados: 3 }, error: 'ML no respondió' });
  });

  it('no lanza aunque la base explote', async () => {
    const admin = {
      from: () => {
        throw new Error('sin red');
      },
    } as unknown as SupabaseClient;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = await startCronRun(admin, 'prospect');
    await expect(run.finish(true, null)).resolves.toBeUndefined();
  });
});

describe('pingHealthcheck', () => {
  it('llama a la URL, o a /fail si el cron falló', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await pingHealthcheck('https://hc.example.test/abc/', true);
    await pingHealthcheck('https://hc.example.test/abc/', false);
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      'https://hc.example.test/abc/',
      'https://hc.example.test/abc/fail',
    ]);
  });

  it('sin URL no llama a nada, y nunca lanza', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('timeout');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await pingHealthcheck(undefined, true);
    await pingHealthcheck('  ', false);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(pingHealthcheck('https://hc.example.test/abc', false)).resolves.toBeUndefined();
  });
});
