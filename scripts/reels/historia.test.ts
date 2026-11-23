import { writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { encoderArgs, makeStoryVideos, parseArgs, publicError, storyItemProblem } from './historia.mjs';

/** El video de la historia contra un sitio de mentira: nada sale a la red y no hace falta ffmpeg. */

const ID = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0a';
const OTHER = '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0b';
const SECRET = 'un-secreto-de-prueba-de-mas-de-32-caracteres';
const SITE = 'http://localhost:3999';
const archivo = (id = ID, precio = 59990) => `2026-11-23/historia-${id}-${precio}-abcdef12.mp4`;
const imagen = (id = ID) => `/social/pieza/${id}/perfil-59990-79990-1795000000-1-1796000000-${'a'.repeat(32)}.jpg`;
const subir = (id = ID) => `https://almacen.example/storage/v1/object/upload/sign/reels/${archivo(id)}?token=firma-secreta`;
const MUSIC_URL = 'https://almacen.example/storage/v1/object/sign/musica/navidad-1.mp3?token=firma-musica';
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const item = (over = {}) => ({ id: ID, nombre: 'Control', precio: 59990, archivo: archivo(), imagen: imagen(), ya_existe: false, subir: subir(), ...over });

function fakeSite(plan: Record<string, unknown>, { image = JPG, uploadStatus = 200 } = {}) {
  const uploads: string[] = [];
  const fetchFn = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SITE}/api/social/videos/historia`)) {
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
      return new Response(JSON.stringify({ ok: true, fecha: '2026-11-23', musica: { nombre: 'navidad-1.mp3', url: MUSIC_URL }, ...plan }));
    }
    if (url === MUSIC_URL) return new Response(Buffer.from('musica'));
    if (url.startsWith(`${SITE}/social/pieza/`)) return new Response(image);
    if (init?.method === 'PUT') {
      uploads.push(url);
      return new Response('{}', { status: uploadStatus });
    }
    throw new Error(`destino inesperado ${url}`);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, uploads };
}

const encode = vi.fn(async ({ output }: { output: string }) => writeFile(output, Buffer.alloc(2048)));

function run(fetchFn: typeof fetch, over = {}) {
  const lines: string[] = [];
  return makeStoryVideos({ site: SITE, secret: SECRET, fetchFn, encode, say: (l: string) => lines.push(l), retryDelayMs: 1, ...over }).then((result) => ({
    result,
    log: lines.join('\n'),
  }));
}

describe('makeStoryVideos', () => {
  it('arma y sube solo lo que falta, sin imprimir direcciones ni el secreto', async () => {
    const site = fakeSite({ seleccion: [item(), item({ id: OTHER, archivo: archivo(OTHER), imagen: imagen(OTHER), ya_existe: true, subir: null })] });
    const { result, log } = await run(site.fetchFn);
    expect(result).toMatchObject({ ok: true, made: 1, existing: 1, failed: 0 });
    expect(site.uploads).toEqual([subir()]);
    expect(log).toContain('lista');
    for (const secret of [SECRET, 'firma-secreta', 'firma-musica', 'almacen.example']) expect(log).not.toContain(secret);
  });

  it('si el sitio dice que hoy no toca, no baja ni arma nada', async () => {
    const site = fakeSite({ omitida: 'La historia automática está en pausa.', musica: null, seleccion: [] });
    const { result, log } = await run(site.fetchFn);
    expect(result).toMatchObject({ ok: true, made: 0 });
    expect(log).toContain('en pausa');
    expect(site.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('en seco no baja, no arma y no sube', async () => {
    encode.mockClear();
    const site = fakeSite({ musica: null, seleccion: [item({ subir: null })] });
    const { result } = await run(site.fetchFn, { dry: true });
    expect(result).toMatchObject({ ok: true, pending: 1, made: 0 });
    expect(encode).not.toHaveBeenCalled();
    expect(site.uploads).toEqual([]);
    expect(String(vi.mocked(site.fetchFn).mock.calls[0][0])).toContain('?seco=1');
  });

  it('una imagen que no es JPG no se arma, y la corrida avisa', async () => {
    encode.mockClear();
    const site = fakeSite({ seleccion: [item()] }, { image: Buffer.from('<html>') });
    const { result } = await run(site.fetchFn);
    expect(result).toMatchObject({ ok: false, failed: 1, made: 0 });
    expect(encode).not.toHaveBeenCalled();
    expect(site.uploads).toEqual([]);
  });

  it('si el video ya estaba arriba (409), cuenta como listo', async () => {
    const site = fakeSite({ seleccion: [item()] }, { uploadStatus: 409 });
    expect((await run(site.fetchFn)).result).toMatchObject({ ok: true, made: 1 });
  });
});

describe('lo que llega en el plan', () => {
  it('acepta un elemento bien formado', () => {
    expect(storyItemProblem(item())).toBeNull();
    expect(storyItemProblem(item({ ya_existe: true, subir: null }))).toBeNull();
    expect(storyItemProblem(item({ subir: null }), { dry: true })).toBeNull();
  });

  it('rechaza nombres, imágenes o subidas que no son de esa oferta', () => {
    expect(storyItemProblem(item({ archivo: archivo(OTHER) }))).toContain('nombre del archivo');
    expect(storyItemProblem(item({ precio: 1 }))).toContain('nombre del archivo');
    expect(storyItemProblem(item({ archivo: `2026-11-23/${ID}-59990-navidad-abcdef12.mp4` }))).toContain('nombre del archivo');
    expect(storyItemProblem(item({ imagen: imagen(OTHER) }))).toContain('imagen');
    expect(storyItemProblem(item({ imagen: 'https://otro.example/x.jpg' }))).toContain('imagen');
    expect(storyItemProblem(item({ subir: subir(OTHER) }))).toBeTruthy();
    expect(storyItemProblem(item({ subir: null }))).toBeTruthy();
  });
});

describe('el video', () => {
  it('cumple lo que Instagram pide para una historia: 10 s, H.264, AAC a 128k, arranque rápido', () => {
    const args = encoderArgs({ image: 'i.jpg', music: 'm.mp3', output: 'o.mp4' });
    const value = (flag: string) => args[args.lastIndexOf(flag) + 1];
    expect(value('-c:v')).toBe('libx264');
    expect(value('-pix_fmt')).toBe('yuv420p');
    expect(value('-r')).toBe('30');
    expect(value('-c:a')).toBe('aac');
    expect(value('-b:a')).toBe('128k');
    expect(value('-t')).toBe('10');
    expect(value('-movflags')).toBe('+faststart');
    expect(value('-flags')).toBe('+cgop');
    expect(args.at(-1)).toBe('o.mp4');
  });
});

describe('línea de comando y registro público', () => {
  it('lee sus opciones y rechaza las demás', () => {
    expect(parseArgs([])).toEqual({ dry: false, site: null });
    expect(parseArgs(['--seco', '--sitio', SITE])).toEqual({ dry: true, site: SITE });
    expect(() => parseArgs(['--otra'])).toThrow('No conozco');
  });

  it('un error no muestra direcciones ni el secreto', () => {
    const text = publicError(new Error(`falló ${subir()} con ${SECRET}`), SECRET);
    expect(text).not.toContain('firma-secreta');
    expect(text).not.toContain(SECRET);
    expect(text).toContain('[dirección]');
  });
});
