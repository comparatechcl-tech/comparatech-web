import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pedido del token de ML. La bitácora de los crons mostró que el refresco de
 * las horas en punto fallaba casi siempre con "sin token": ML rechaza
 * pedidos en los momentos de más carga y no había reintento.
 *
 * El módulo guarda el token en memoria, así que cada test lo carga de nuevo.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function load() {
  vi.resetModules();
  return import('@/lib/ml-enrichment');
}

describe('getMlToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('si ML rechaza el pedido, reintenta y sigue con el token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(429, { error: 'local_rate_limited', message: 'no se guarda' }))
      .mockResolvedValueOnce(json(200, { access_token: 'tok-1', expires_in: 21600 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getMlToken, mlTokenError } = await load();

    const pending = getMlToken();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mlTokenError()).toBeNull();

    // El token queda en memoria: la siguiente llamada no le pide otro a ML.
    expect(await getMlToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('después de tres intentos se rinde y deja el motivo para la bitácora', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(429, { error: 'local_rate_limited' }));
    vi.stubGlobal('fetch', fetchMock);
    const { getMlToken, mlTokenError } = await load();

    const pending = getMlToken();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mlTokenError()).toBe('HTTP 429 local_rate_limited (3 intentos)');
  });

  it('con credenciales rechazadas no insiste', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(401, { error: 'invalid_client', message: 'detalle que no se guarda' }));
    vi.stubGlobal('fetch', fetchMock);
    const { getMlToken, mlTokenError } = await load();

    expect(await getMlToken()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mlTokenError()).toBe('HTTP 401 invalid_client');
  });

  it('una caída de la red también se reintenta', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(200, { access_token: 'tok-2', expires_in: 21600 }));
    vi.stubGlobal('fetch', fetchMock);
    const { getMlToken } = await load();

    const pending = getMlToken();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await pending).toBe('tok-2');
  });
});
