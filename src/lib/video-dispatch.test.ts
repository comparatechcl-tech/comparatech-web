import { describe, expect, it, vi } from 'vitest';
import { dispatchVideoBuild, videoDispatchToken } from './video-dispatch';

/*
 * Nunca hay red: GitHub es falso. Lo que importa es que el pedido vaya bien
 * armado, que la llave no aparezca en ninguna respuesta y que un rechazo se
 * explique sin reintentar.
 */

const TOKEN = 'github_pat_11AAAAAAA0aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ENV = { GITHUB_VIDEOS_TOKEN: TOKEN };

describe('videoDispatchToken', () => {
  it('entrega la llave si está puesta, sin espacios', () => {
    expect(videoDispatchToken({ GITHUB_VIDEOS_TOKEN: `  ${TOKEN}\n` })).toBe(TOKEN);
  });

  it('sin la variable, vacía o demasiado corta, no hay llave', () => {
    expect(videoDispatchToken({})).toBeNull();
    expect(videoDispatchToken({ GITHUB_VIDEOS_TOKEN: '' })).toBeNull();
    expect(videoDispatchToken({ GITHUB_VIDEOS_TOKEN: '   ' })).toBeNull();
    expect(videoDispatchToken({ GITHUB_VIDEOS_TOKEN: 'pendiente' })).toBeNull();
  });
});

describe('dispatchVideoBuild', () => {
  it('le pide a GitHub que corra el workflow de los videos en main, con la llave', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(dispatchVideoBuild({ env: ENV, fetchImpl })).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/comparatechcl-tech/comparatech-web/actions/workflows/reels.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main' });
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.accept).toBe('application/vnd.github+json');
    expect(headers['user-agent']).toBeTruthy();
  });

  it('en seco pide la pasada que no arma ni sube nada', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(dispatchVideoBuild({ env: ENV, fetchImpl, dry: true })).resolves.toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main', inputs: { seco: 'true' } });
  });

  it('cualquier respuesta 2xx es un pedido aceptado', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"workflow_run_id":1}', { status: 200 }));
    await expect(dispatchVideoBuild({ env: ENV, fetchImpl })).resolves.toEqual({ ok: true });
  });

  it('sin la llave no le pide nada a GitHub', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(dispatchVideoBuild({ env: {}, fetchImpl })).resolves.toMatchObject({ ok: false, reason: 'sin_llave' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('una llave vencida, borrada o sin permiso se explica y no se reintenta', async () => {
    for (const status of [401, 403, 404]) {
      const fetchImpl = vi.fn(async () => new Response('{"message":"Bad credentials"}', { status }));
      const result = await dispatchVideoBuild({ env: ENV, fetchImpl });
      expect(result).toMatchObject({ ok: false, reason: 'rechazada' });
      expect(!result.ok && result.detail).toContain(String(status));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('otro error de GitHub trae su mensaje; una caída de red, el motivo', async () => {
    const invalid = vi.fn(async () => new Response('{"message":"Workflow does not have workflow_dispatch trigger"}', { status: 422 }));
    await expect(dispatchVideoBuild({ env: ENV, fetchImpl: invalid })).resolves.toEqual({
      ok: false,
      reason: 'error',
      detail: 'GitHub respondió 422: Workflow does not have workflow_dispatch trigger',
    });
    const down = vi.fn(async () => {
      throw new Error('timeout');
    });
    await expect(dispatchVideoBuild({ env: ENV, fetchImpl: down })).resolves.toEqual({ ok: false, reason: 'error', detail: 'timeout' });
    const empty = vi.fn(async () => new Response('no es json', { status: 500 }));
    await expect(dispatchVideoBuild({ env: ENV, fetchImpl: empty })).resolves.toEqual({ ok: false, reason: 'error', detail: 'GitHub respondió 500' });
  });

  it('la llave nunca aparece en lo que responde', async () => {
    for (const fetchImpl of [
      async () => new Response(null, { status: 204 }),
      async () => new Response(`{"message":"token ${TOKEN} inválido"}`.slice(0, 40), { status: 401 }),
      async () => new Response('{"message":"x"}', { status: 422 }),
    ]) {
      expect(JSON.stringify(await dispatchVideoBuild({ env: ENV, fetchImpl }))).not.toContain(TOKEN);
    }
  });
});
