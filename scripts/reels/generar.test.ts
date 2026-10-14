import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION, generate, parseArgs, readSecret, resolveSite } from './generar.mjs';
import { sampleItems, startFakeSite } from './pruebas/sitio-de-mentira.mjs';
import { buscarFfmpeg } from './video.mjs';

/**
 * El proceso del día contra un sitio de mentira en 127.0.0.1 (el plan y las subidas firmadas). Nada de esto
 * sale a la red: las fotos de mlstatic las entrega el propio test, y cualquier otro destino es un error.
 * Lo que imprime el proceso queda en un registro público, así que cada prueba revisa también eso.
 */

type FakeSite = Awaited<ReturnType<typeof startFakeSite>>;
type Call = { host: string; method: string; authorization: string | null };

const SECRET = 'secreto-de-prueba-0123456789abcdef-0123456789';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TMP = mkdtempSync(path.join(os.tmpdir(), 'comparatech-generar-test-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let site: FakeSite | null = null;
afterEach(async () => {
  await site?.close();
  site = null;
});

/** Una foto de producto inventada: un rectángulo oscuro sobre blanco, como las de Mercado Libre. */
async function fakePhoto(): Promise<Buffer> {
  const product = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="640"><rect width="420" height="640" rx="48" fill="#1f2a44"/><rect x="40" y="60" width="340" height="460" rx="12" fill="#3b82f6"/></svg>');
  return sharp({ create: { width: 900, height: 900, channels: 3, background: '#ffffff' } })
    .composite([{ input: product, left: 240, top: 130 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * El fetch de las pruebas: las fotos de mlstatic se responden aquí mismo, el sitio de mentira se atiende de
 * verdad y cualquier otro destino falla. Anota a quién se le habló y con qué permiso.
 */
function offlineFetch(calls: Call[], photo: (url: URL) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    calls.push({ host: url.host, method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') });
    if (url.hostname.endsWith('.mlstatic.com')) return photo(url);
    if (url.hostname !== '127.0.0.1') throw new Error(`una prueba intentó salir a la red: ${url.host}`);
    return fetch(input, init);
  };
}

const jpegResponse = (bytes: Uint8Array) => new Response(new Uint8Array(bytes), { headers: { 'content-type': 'image/jpeg' } });

/** Un armador de mentira: deja dos archivos chicos donde irían el video y la portada. No necesita ffmpeg. */
async function fakeRender({ video, cover }: { video: string; cover: string }) {
  await writeFile(video, 'video de mentira');
  await writeFile(cover, 'portada de mentira');
  return { bytes: 3_500_000, lowered: false, notes: [] as string[] };
}

/** Corre generate() contra el sitio de mentira y junta lo que imprimió y a quién le habló. */
async function run(options: Partial<NonNullable<Parameters<typeof generate>[0]>> = {}) {
  const photo = await fakePhoto();
  const calls: Call[] = [];
  const lines: string[] = [];
  const result = await generate({
    site: site!.origin,
    secret: SECRET,
    fetch: offlineFetch(calls, () => jpegResponse(photo)),
    log: (line: string) => lines.push(line),
    render: fakeRender,
    retryDelayMs: 0,
    tmpRoot: TMP,
    ...options,
  });
  // `products`: solo los renglones de cada producto ("1/3 ...").
  return { result, calls, lines, products: lines.filter((line) => /^\d+\/\d+ /.test(line)), printed: lines.join('\n') };
}

/** Nada de lo impreso puede traer el secreto, una dirección firmada o su token. */
function expectPublic(printed: string) {
  expect(printed).not.toContain(SECRET);
  expect(printed).not.toContain('token=');
  expect(printed).not.toContain('/upload/sign/');
  expect(printed).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
  for (const token of site?.tokens.values() ?? []) expect(printed).not.toContain(token);
}

/** Corre el comando de verdad (otro proceso). Siempre con --sitio apuntando al sitio de mentira. */
function runCli(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/reels/generar.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, CRON_SECRET: SECRET },
    });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('parseArgs', () => {
  it('sin opciones pide 4 videos al sitio publicado', () => {
    expect(parseArgs([])).toEqual({ count: 4, dry: false, site: null });
  });

  it('lee --n, --seco y --sitio', () => {
    expect(parseArgs(['--n', '2', '--seco', '--sitio', 'http://localhost:3000'])).toEqual({ count: 2, dry: true, site: 'http://localhost:3000' });
    expect(parseArgs(['--n=6'])).toMatchObject({ count: 6 });
  });

  it('una opción que no conoce, o un valor fuera de rango, es un error', () => {
    for (const bad of [['--n', '0'], ['--n', '7'], ['--n', 'dos'], ['--n'], ['--sitio'], ['--sitio', '--seco'], ['--todo'], ['4'], ['--seco=si']]) {
      expect(() => parseArgs(bad), bad.join(' ')).toThrow();
    }
  });
});

describe('readSecret', () => {
  const envFile = (content: string) => {
    const file = path.join(TMP, `env-${Math.random().toString(36).slice(2)}`);
    writeFileSync(file, content);
    return file;
  };

  it('usa el de las variables de entorno, sin mirar el archivo', () => {
    expect(readSecret({ env: { CRON_SECRET: ` ${SECRET}\n` }, envFile: path.join(TMP, 'no-existe') })).toBe(SECRET);
  });

  it('si no está, lo lee del archivo de variables locales', () => {
    expect(readSecret({ env: {}, envFile: envFile(`OTRA=1\r\nCRON_SECRET="${SECRET}"\r\nMAS=2\r\n`) })).toBe(SECRET);
    expect(readSecret({ env: { CRON_SECRET: '' }, envFile: envFile(`  CRON_SECRET = ${SECRET}  \n`) })).toBe(SECRET);
  });

  it('si no está en ninguna parte, lo dice sin mostrar nada del archivo', () => {
    expect(() => readSecret({ env: {}, envFile: path.join(TMP, 'no-existe') })).toThrow('Falta CRON_SECRET');
    const other = 'OTRO_SECRETO=valor-que-no-debe-salir';
    let message = '';
    try {
      readSecret({ env: {}, envFile: envFile(other) });
    } catch (err) {
      message = String(err);
    }
    expect(message).toContain('Falta CRON_SECRET');
    expect(message).not.toContain('valor-que-no-debe-salir');
  });
});

describe('resolveSite', () => {
  it('sin --sitio es el sitio publicado', () => {
    expect(resolveSite(null)).toBe(PRODUCTION);
    expect(resolveSite(`${PRODUCTION}/cualquier/ruta`)).toBe(PRODUCTION);
  });

  it('acepta un servidor local', () => {
    expect(resolveSite('http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveSite('http://127.0.0.1:4010/algo')).toBe('http://127.0.0.1:4010');
    expect(resolveSite('http://[::1]:3000')).toBe('http://[::1]:3000');
  });

  it('no acepta ningún otro, aunque se parezca', () => {
    const bad = [
      'https://evil.example',
      'http://comparatech-web.vercel.app',
      'https://comparatech-web.vercel.app.evil.example',
      'https://comparatech-web.vercel.app@evil.example',
      'http://localhost.evil.example:3000',
      'http://localhost@evil.example',
      'http://192.168.1.20:3000',
      'ftp://localhost/plan',
      'no es una dirección',
    ];
    for (const value of bad) expect(() => resolveSite(value), value).toThrow('--sitio');
  });
});

describe('generate: lo que arma y lo que salta', () => {
  it('arma y sube lo que falta, y no rehace lo que ya existe', async () => {
    const items = sampleItems();
    site = await startFakeSite({ secret: SECRET, items, existing: [items[1].id] });
    const { result, calls, lines, printed } = await run();

    expect(result).toEqual({ ok: true, made: 2, existing: 1, failed: 0, pending: 0 });
    // Subió portada y video de los dos que faltaban; del que ya existía, nada.
    const stored = Array.from(site.stored.keys());
    expect(stored).toEqual([
      `2026-10-13/${items[0].id}-219990-estudio.jpg`,
      `2026-10-13/${items[0].id}-219990-estudio.mp4`,
      `2026-10-13/${items[2].id}-189990-estudio.jpg`,
      `2026-10-13/${items[2].id}-189990-estudio.mp4`,
    ]);
    expect(site.stored.get(stored[1])?.toString()).toBe('video de mentira');
    // Tampoco bajó la foto del que ya existía.
    expect(calls.filter((call) => call.host === 'http2.mlstatic.com')).toHaveLength(2);

    expect(lines[0]).toBe('Videos del día 2026-10-13: el sitio sugiere 3.');
    expect(lines).toContain('2/3 Smart TV LED Caixun Roku TV 43" Full HD · $182.990 · plantilla estudio · ya estaba, no se rehace');
    expect(printed).toMatch(/1\/3 Moto G86 power 256GB · \$219\.990 · plantilla estudio · armado y subido en \d+,\d s · 3,3 MB/);
    expect(lines[lines.length - 1]).toBe('Resumen: 2 videos nuevos, 1 que ya estaba.');
    expectPublic(printed);
  });

  it('sube como lo hace la librería de Supabase: PUT con el archivo tal cual, y la portada antes que el video', async () => {
    site = await startFakeSite({ secret: SECRET, items: sampleItems().slice(0, 1) });
    await run();

    const uploads = site.requests.filter((request) => request.method === 'PUT');
    expect(uploads.map((upload) => path.extname(upload.path))).toEqual(['.jpg', '.mp4']);
    expect(uploads[0]).toMatchObject({ contentType: 'image/jpeg', cacheControl: 'max-age=3600', upsert: 'false', bytes: 18 });
    expect(uploads[1]).toMatchObject({ contentType: 'video/mp4', cacheControl: 'max-age=3600', upsert: 'false', bytes: 16 });
  });

  it('con --n pide esa cantidad', async () => {
    site = await startFakeSite({ secret: SECRET });
    const { result } = await run({ count: 1 });
    expect(result).toMatchObject({ made: 1, existing: 0 });
    expect(site.stored.size).toBe(2);
  });

  it('en seco pide el plan y no baja, arma ni sube nada', async () => {
    const items = sampleItems();
    site = await startFakeSite({ secret: SECRET, items, existing: [items[0].id] });
    let rendered = 0;
    const { result, calls, lines, printed } = await run({
      dry: true,
      render: async (job) => {
        rendered++;
        return fakeRender(job);
      },
    });

    expect(result).toEqual({ ok: true, made: 0, existing: 1, failed: 0, pending: 2 });
    expect(rendered).toBe(0);
    expect(calls).toHaveLength(1);
    expect(site.stored.size).toBe(0);
    expect(lines[0]).toContain('En seco: no se arma ni se sube nada.');
    expect(lines).toContain('3/3 Tablet Lenovo Tab 128gb · $189.990 · plantilla estudio · falta: se armaría y se subiría');
    expect(lines[lines.length - 1]).toBe('Resumen: 2 por armar, 1 que ya estaba.');
    expectPublic(printed);
  });

  it('si el archivo ya estaba arriba (otra corrida llegó antes), no es una falla', async () => {
    const items = sampleItems().slice(0, 1);
    site = await startFakeSite({ secret: SECRET, items });
    // La portada quedó subida en un intento anterior que no alcanzó a subir el video.
    site.stored.set(`2026-10-13/${items[0].id}-219990-estudio.jpg`, Buffer.from('portada anterior'));
    const { result } = await run();

    expect(result).toMatchObject({ ok: true, made: 1, failed: 0 });
    expect(site.stored.get(`2026-10-13/${items[0].id}-219990-estudio.mp4`)?.toString()).toBe('video de mentira');
  });

  it('no deja carpetas temporales, ni cuando un producto falla', async () => {
    site = await startFakeSite({ secret: SECRET });
    await run({
      render: async (job) => {
        if (job.product.precio === 182990) throw new Error('falla de prueba');
        return fakeRender(job);
      },
    });
    expect(readdirSync(TMP).filter((name) => name.startsWith('comparatech-reel-'))).toEqual([]);
  });
});

describe('generate: el secreto', () => {
  it('solo va en el pedido del plan, nunca a la foto ni a las subidas', async () => {
    site = await startFakeSite({ secret: SECRET });
    const { calls } = await run();

    const withSecret = calls.filter((call) => call.authorization !== null);
    expect(withSecret).toEqual([{ host: new URL(site.origin).host, method: 'GET', authorization: `Bearer ${SECRET}` }]);
    expect(site.requests.filter((request) => request.method === 'PUT' && request.authorization !== null)).toEqual([]);
  });

  it('no se manda a un sitio que no sea el publicado o uno local', async () => {
    const calls: Call[] = [];
    const never = offlineFetch(calls, () => new Response(null, { status: 500 }));
    for (const other of ['https://evil.example', 'http://comparatech-web.vercel.app', 'http://localhost.evil.example:3000']) {
      await expect(generate({ site: other, secret: SECRET, fetch: never, log: () => {}, render: fakeRender })).rejects.toThrow('--sitio solo acepta');
    }
    expect(calls).toEqual([]);
  });

  it('el comando tampoco: con otro --sitio termina con código 1 sin hablarle a nadie', async () => {
    const { code, out } = await runCli(['--seco', '--sitio', 'https://evil.example']);
    expect(code).toBe(1);
    expect(out).toContain('--sitio solo acepta un servidor local');
    expect(out).not.toContain(SECRET);
  });

  it('si el sitio rechaza el secreto, lo dice y no hace nada más', async () => {
    site = await startFakeSite({ secret: 'otro-secreto-distinto-0123456789abcdef' });
    const { result, calls, printed } = await run();

    expect(result).toMatchObject({ ok: false, made: 0 });
    expect(calls).toHaveLength(1);
    expect(printed).toContain('el sitio rechazó el secreto (401)');
    expectPublic(printed);
  });
});

describe('generate: la foto', () => {
  it('rechaza una foto que no es de mlstatic, sin intentar bajarla', async () => {
    const items = sampleItems();
    items[0].foto = 'https://evil.example/foto.jpg';
    items[1].foto = 'http://http2.mlstatic.com/foto.jpg';
    site = await startFakeSite({ secret: SECRET, items });
    const { result, calls, lines, printed } = await run();

    expect(result).toEqual({ ok: false, made: 1, existing: 0, failed: 2, pending: 0 });
    expect(calls.map((call) => call.host)).not.toContain('evil.example');
    expect(calls.filter((call) => call.host === 'http2.mlstatic.com')).toHaveLength(1);
    expect(lines).toContain('1/3 Moto G86 power 256GB · $219.990 · plantilla estudio · NO SE PUDO: la foto no es de Mercado Libre (mlstatic.com)');
    expect(lines).toContain('2/3 Smart TV LED Caixun Roku TV 43" Full HD · $182.990 · plantilla estudio · NO SE PUDO: la foto no viene por https');
    expect(Array.from(site.stored.keys()).every((name) => name.includes(items[2].id))).toBe(true);
    expectPublic(printed);
  });

  it('rechaza lo que no es una imagen, lo que pesa demasiado y lo que no se pudo bajar', async () => {
    site = await startFakeSite({ secret: SECRET });
    const photo = await fakePhoto();
    const answers: Record<string, () => Response> = {
      // Dice ser una imagen, pero el contenido es una página.
      '814687': () => new Response('<html>No encontrado</html>', { headers: { 'content-type': 'image/jpeg' } }),
      // Más de 8 MB, sin avisarlo en la cabecera.
      '878845': () => jpegResponse(Buffer.concat([photo, Buffer.alloc(8 * 1024 * 1024)])),
      '805620': () => new Response('no está', { status: 404, headers: { 'content-type': 'text/plain' } }),
    };
    const calls: Call[] = [];
    const fetchPhotos = offlineFetch(calls, (url) => {
      const key = Object.keys(answers).find((part) => url.pathname.includes(part));
      return answers[key!]();
    });
    const { result, products, printed } = await run({ fetch: fetchPhotos });

    expect(result).toMatchObject({ ok: false, made: 0, failed: 3 });
    expect(products[0]).toContain('NO SE PUDO: la foto no es una imagen');
    expect(products[1]).toContain('NO SE PUDO: la foto pesa más de 8,0 MB');
    expect(products[2]).toContain('NO SE PUDO: no se pudo bajar la foto (respondió 404)');
    expect(site.stored.size).toBe(0);
    expectPublic(printed);
  });

  it('una "imagen" que anuncia un tipo que no es de imagen tampoco pasa', async () => {
    site = await startFakeSite({ secret: SECRET, items: sampleItems().slice(0, 1) });
    const photo = await fakePhoto();
    const calls: Call[] = [];
    const { result, printed } = await run({ fetch: offlineFetch(calls, () => new Response(new Uint8Array(photo), { headers: { 'content-type': 'text/html' } })) });
    expect(result).toMatchObject({ ok: false, failed: 1 });
    expect(printed).toContain('la foto no es una imagen (text/html)');
  });
});

describe('generate: cuando algo falla', () => {
  it('si un producto falla, sigue con los demás y avisa con ok: false', async () => {
    const items = sampleItems();
    site = await startFakeSite({ secret: SECRET, items, rejectUploads: [items[0].id] });
    const { result, lines, products, printed } = await run({
      render: async (job) => {
        if (job.product.precio === 182990) throw new Error('ffmpeg terminó con error 1: no se pudo comprimir');
        return fakeRender(job);
      },
    });

    expect(result).toEqual({ ok: false, made: 1, existing: 0, failed: 2, pending: 0 });
    expect(products[0]).toContain('1/3 Moto G86 power 256GB · $219.990 · plantilla estudio · NO SE PUDO: el almacén respondió 500 al subir: no se pudo guardar [oculto]');
    expect(products[1]).toContain('NO SE PUDO: ffmpeg terminó con error 1: no se pudo comprimir');
    expect(products[2]).toMatch(/^3\/3 Tablet Lenovo Tab 128gb .* armado y subido en /);
    expect(lines[lines.length - 1]).toBe('Resumen: 1 video nuevo, 0 que ya estaban, 2 que no se pudieron.');
    // El tercero quedó completo; del primero no quedó el video (la portada se rechazó antes).
    expect(Array.from(site.stored.keys())).toEqual([`2026-10-13/${items[2].id}-189990-estudio.jpg`, `2026-10-13/${items[2].id}-189990-estudio.mp4`]);
    // El almacén de mentira repite la dirección firmada y el token en su mensaje de error: no pueden salir.
    expectPublic(printed);
  });

  it('un elemento del plan mal armado falla solo él', async () => {
    const items = sampleItems();
    site = await startFakeSite({
      secret: SECRET,
      items: [
        { ...items[0], archivo: `2026-10-13/${items[1].id}-1-estudio` },
        { ...items[1], plantilla: 'otra' },
        { ...items[2], subir: { video: 'https://evil.example/reels/x.mp4?token=abc', portada: 'https://evil.example/reels/x.jpg?token=abc' } },
        { ...items[2], id: 'c65c6a4c-42c4-42fd-b14f-8b908ca1e2b3', nombre_corto: 'Uno que sí\n::error::se arma' },
      ],
    });
    const { result, calls, lines, products, printed } = await run();

    expect(result).toEqual({ ok: false, made: 1, existing: 0, failed: 3, pending: 0 });
    expect(products[0]).toContain('NO SE PUDO: el nombre del archivo no calza');
    expect(products[1]).toContain('NO SE PUDO: este proceso no tiene la plantilla "otra"');
    expect(products[2]).toContain('NO SE PUDO: la dirección de subida no es la de este archivo');
    // Un nombre con saltos de línea no puede empezar un renglón propio en el registro.
    expect(products[3]).toMatch(/^4\/4 Uno que sí ::error::se arma · /);
    expect(lines.every((line) => !line.includes('\n'))).toBe(true);
    expect(calls.map((call) => call.host)).not.toContain('evil.example');
    expectPublic(printed);
  });

  it('si el sitio responde un error, lo muestra sin la respuesta completa y no hace nada', async () => {
    const signed = 'https://abcdefgh.supabase.co/storage/v1/object/upload/sign/reels/x.mp4?token=eyJhbGciOiJIUzI1NiJ9.cGF5bG9hZA.ZmlybWE';
    site = await startFakeSite({ secret: SECRET, planFailures: [{ status: 500, body: { error: `No se pudo firmar ${signed}`, seleccion: ['no debe salir'] } }] });
    const { result, calls, lines, printed } = await run();

    expect(result).toMatchObject({ ok: false, made: 0, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(lines).toEqual(['No se pudo pedir el plan de videos: el sitio respondió 500: No se pudo firmar https://abcdefgh.supabase.co/storage/v1/object/upload/sign/reels/x.mp4?[oculto]']);
    expect(printed).not.toContain('no debe salir');
    expect(printed).not.toContain('token=');
  });

  it('reintenta el plan ante una caída de pasarela, pero no ante un error del sitio', async () => {
    site = await startFakeSite({ secret: SECRET, planFailures: [{ status: 503 }, { status: 502 }] });
    const flaky = await run();
    expect(flaky.result).toMatchObject({ ok: true, made: 3 });
    expect(flaky.calls.filter((call) => call.method === 'GET' && call.host.startsWith('127.0.0.1'))).toHaveLength(3);
    await site.close();

    site = await startFakeSite({ secret: SECRET, planFailures: [{ status: 503 }, { status: 503 }, { status: 503 }] });
    const down = await run();
    expect(down.result).toMatchObject({ ok: false, made: 0 });
    expect(down.printed).toContain('el sitio respondió 503');
  });

  it('una respuesta que no es un plan no arma nada', async () => {
    site = await startFakeSite({ secret: SECRET, planFailures: [{ status: 200, body: { ok: false } }] });
    const { result, printed } = await run();
    expect(result).toMatchObject({ ok: false, made: 0 });
    expect(printed).toContain('El sitio no respondió un plan de videos que se pueda leer');
  });

  it('sin productos que cumplan termina bien', async () => {
    site = await startFakeSite({ secret: SECRET, items: [], deleted: 8, unreadHistory: 1 });
    const { result, lines } = await run();
    expect(result).toEqual({ ok: true, made: 0, existing: 0, failed: 0, pending: 0 });
    expect(lines).toEqual([
      'Videos del día 2026-10-13: el sitio sugiere 0.',
      `Aviso: el plan se pidió a un servidor local (${site.origin}), no al sitio publicado.`,
      'El sitio borró 8 archivos de días anteriores.',
      'Aviso: 1 producto quedó fuera porque no se pudo leer su historial de precios.',
      'Ahora no hay productos que cumplan para un video. Resumen: 0 videos nuevos, 0 que ya estaban.',
    ]);
  });
});

describe('el comando generar.mjs', () => {
  it('en seco termina con código 0 y no imprime nada secreto', async () => {
    const items = sampleItems();
    site = await startFakeSite({ secret: SECRET, items, existing: [items[1].id] });
    const { code, out } = await runCli(['--seco', '--n', '3', '--sitio', site.origin]);

    expect(code).toBe(0);
    expect(out).toContain('1/3 Moto G86 power 256GB · $219.990 · plantilla estudio · falta: se armaría y se subiría');
    expect(out).toContain('Resumen: 2 por armar, 1 que ya estaba.');
    expect(site.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /api/social/videos/plan']);
    expectPublic(out);
  });

  it('si un producto tiene un problema termina con código 1, después de revisar los demás', async () => {
    const items = sampleItems();
    items[0].foto = 'https://evil.example/foto.jpg';
    site = await startFakeSite({ secret: SECRET, items });
    const { code, out } = await runCli(['--seco', '--sitio', site.origin]);

    expect(code).toBe(1);
    expect(out).toContain('NO SE PUDO: la foto no es de Mercado Libre (mlstatic.com)');
    expect(out).toContain('3/3 Tablet Lenovo Tab 128gb · $189.990 · plantilla estudio · falta: se armaría y se subiría');
    expect(out).toContain('Resumen: 2 por armar, 0 que ya estaban, 1 que no se pudo.');
    expectPublic(out);
  });

  it('si no puede pedir el plan termina con código 1', async () => {
    site = await startFakeSite({ secret: 'otro-secreto-distinto-0123456789abcdef' });
    const { code, out } = await runCli(['--seco', '--sitio', site.origin]);
    expect(code).toBe(1);
    expect(out).toContain('el sitio rechazó el secreto (401)');
    expectPublic(out);
  });
});

/** ffmpeg no viene instalado en el job de CI: ahí la prueba que arma un video de verdad se salta. */
function findFfmpeg(): string | null {
  try {
    return buscarFfmpeg() ?? null;
  } catch {
    return null;
  }
}
const ffmpeg = findFfmpeg();
if (!ffmpeg) console.warn('ffmpeg no está instalado: se salta la prueba que arma un video de verdad (scripts/reels/generar.test.ts).');

describe('de punta a punta, con ffmpeg', () => {
  it.skipIf(!ffmpeg)(
    'baja la foto, arma el video con la plantilla y sube un MP4 y su portada',
    async () => {
      const items = sampleItems().slice(0, 1);
      site = await startFakeSite({ secret: SECRET, items });
      // Sin `render`: se usa el armador de verdad.
      const { result, products, printed } = await run({ render: undefined });

      expect(result).toEqual({ ok: true, made: 1, existing: 0, failed: 0, pending: 0 });
      expect(products[0]).toMatch(/^1\/1 Moto G86 power 256GB · \$219\.990 · plantilla estudio · armado y subido en \d+,\d s · \d,\d MB/);
      expectPublic(printed);

      const base = `2026-10-13/${items[0].id}-219990-estudio`;
      const cover = site.stored.get(`${base}.jpg`)!;
      expect(await sharp(cover).metadata()).toMatchObject({ format: 'jpeg', width: 1080, height: 1920 });

      const video = site.stored.get(`${base}.mp4`)!;
      expect(video.toString('latin1', 4, 8)).toBe('ftyp');
      expect(video.length).toBeGreaterThan(200_000);
      expect(video.length).toBeLessThanOrEqual(4 * 1024 * 1024);
      // ffmpeg lee lo subido: vertical, H.264 con audio AAC y los 305 cuadros de un reel con gancho.
      const file = path.join(TMP, 'subido.mp4');
      writeFileSync(file, video);
      const probe = spawnSync(ffmpeg!, ['-hide_banner', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' });
      expect(probe.status).toBe(0);
      expect(probe.stderr).toMatch(/Video: h264 .*yuv420p.* 1080x1920/);
      expect(probe.stderr).toMatch(/Audio: aac/);
      expect(probe.stderr).toMatch(/frame=\s*305\b/);
    },
    300_000
  );
});
