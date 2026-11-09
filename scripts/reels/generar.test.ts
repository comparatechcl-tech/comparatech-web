import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { PRODUCTION, discardOpenWork, generate, parseArgs, readSecret, resolveSite } from './generar.mjs';
import { fileName, sampleItems, startFakeSite } from './pruebas/sitio-de-mentira.mjs';
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
// Las pruebas que lanzan el comando más de una vez: en un equipo ocupado cada arranque puede pasar del segundo.
const SLOW = 30_000;
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

let site: FakeSite | null = null;
/** Un segundo sitio de mentira, para las pruebas en que el primero manda para allá. */
let otherSite: FakeSite | null = null;
afterEach(async () => {
  await site?.close();
  await otherSite?.close();
  site = null;
  otherSite = null;
});

/** Las carpetas temporales de videos a medias que hay ahora en la carpeta de las pruebas. */
const openDirs = () => readdirSync(TMP).filter((name) => name.startsWith('comparatech-reel-'));

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

/** La copia sin música de mentira: un archivo chico con otro contenido que el video. No necesita ffmpeg. */
async function fakeMute({ output }: { video: string; output: string }) {
  await writeFile(output, 'video sin música de mentira');
}
const SILENT_BYTES = Buffer.byteLength('video sin música de mentira');

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
    mute: fakeMute,
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

/**
 * Corre el comando de verdad (otro proceso), con la red cortada: la precarga pruebas/sin-red.mjs deja pasar
 * solo lo que va al sitio de mentira, así que ninguna de estas pruebas puede llegar al sitio publicado ni
 * por error. La carpeta temporal del proceso es la de las pruebas, para poder mirar qué deja.
 */
function runCli(args: string[], { script = 'scripts/reels/generar.mjs', env = {} }: { script?: string; env?: Record<string, string> } = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const offline = pathToFileURL(path.join(ROOT, 'scripts/reels/pruebas/sin-red.mjs')).href;
    const child = spawn(process.execPath, ['--import', offline, path.resolve(ROOT, script), ...args], {
      cwd: ROOT,
      env: { ...process.env, CRON_SECRET: SECRET, TEMP: TMP, TMP, TMPDIR: TMP, ...env },
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

  it('un --sitio vacío es un error: no puede terminar apuntando al sitio publicado sin avisar', () => {
    // Es lo que llega con --sitio "$VARIABLE" cuando la variable no existe.
    for (const bad of [['--sitio', ''], ['--sitio='], ['--sitio', '   '], ['--seco', '--sitio', '']]) {
      expect(() => parseArgs(bad), JSON.stringify(bad)).toThrow('Falta el valor de --sitio');
    }
    expect(() => parseArgs(['--n', ''])).toThrow('Falta el valor de --n');
    expect(() => parseArgs(['--n='])).toThrow('Falta el valor de --n');
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
  it('el sitio publicado es el dominio propio con www, el mismo de scripts/redes.mjs', () => {
    // Con la mudanza a Railway el dominio de Vercel deja de ser el sitio; www sirve desde los dos.
    expect(PRODUCTION).toBe('https://www.comparatech.cl');
    const redes = readFileSync(fileURLToPath(new URL('../redes.mjs', import.meta.url)), 'utf8');
    expect(/const PRODUCTION = '([^']+)'/.exec(redes)?.[1]).toBe(PRODUCTION);
  });

  it('sin --sitio es el sitio publicado', () => {
    expect(resolveSite(null)).toBe(PRODUCTION);
    expect(resolveSite(undefined)).toBe(PRODUCTION);
    expect(resolveSite(`${PRODUCTION}/cualquier/ruta`)).toBe(PRODUCTION);
  });

  it('un sitio vacío no es "sin --sitio": es un error', () => {
    for (const empty of ['', '   ']) expect(() => resolveSite(empty), JSON.stringify(empty)).toThrow('--sitio llegó vacío');
  });

  it('acepta un servidor local', () => {
    expect(resolveSite('http://localhost:3000')).toBe('http://localhost:3000');
    expect(resolveSite('http://127.0.0.1:4010/algo')).toBe('http://127.0.0.1:4010');
    expect(resolveSite('http://[::1]:3000')).toBe('http://[::1]:3000');
  });

  it('no acepta ningún otro, aunque se parezca', () => {
    const bad = [
      'https://evil.example',
      'http://www.comparatech.cl',
      'https://www.comparatech.cl.evil.example',
      'https://www.comparatech.cl@evil.example',
      // Sin www redirige, y el dominio de Vercel deja de ser el sitio con la mudanza a Railway.
      'https://comparatech.cl',
      'https://comparatech-web.vercel.app',
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
    // Subió portada, copia sin música y video de los dos que faltaban; del que ya existía, nada. Cada archivo
    // queda con el nombre que mandó el sitio, huella incluida (escrita aquí a mano: es la del contrato para
    // estos datos, con la versión 2 del aspecto).
    const stored = Array.from(site.stored.keys());
    expect(stored).toEqual([
      `2026-10-13/${items[0].id}-219990-estudio-c6280e51.jpg`,
      `2026-10-13/${items[0].id}-219990-estudio-c6280e51-sin-musica.mp4`,
      `2026-10-13/${items[0].id}-219990-estudio-c6280e51.mp4`,
      `2026-10-13/${items[2].id}-189990-estudio-ec7645ba.jpg`,
      `2026-10-13/${items[2].id}-189990-estudio-ec7645ba-sin-musica.mp4`,
      `2026-10-13/${items[2].id}-189990-estudio-ec7645ba.mp4`,
    ]);
    expect(site.stored.get(stored[2])?.toString()).toBe('video de mentira');
    expect(site.stored.get(stored[1])?.toString()).toBe('video sin música de mentira');
    // Tampoco bajó la foto del que ya existía.
    expect(calls.filter((call) => call.host === 'http2.mlstatic.com')).toHaveLength(2);

    expect(lines[0]).toBe('Videos del día 2026-10-13: el sitio sugiere 3.');
    expect(lines).toContain('2/3 Smart TV LED Caixun Roku TV 43" Full HD · $182.990 · plantilla estudio · ya estaba, no se rehace');
    expect(printed).toMatch(/1\/3 Moto G86 power 256GB · \$219\.990 · plantilla estudio · armado y subido en \d+,\d s · 3,3 MB · y su copia sin música$/m);
    expect(lines[lines.length - 1]).toBe('Resumen: 2 videos nuevos, 1 que ya estaba.');
    expectPublic(printed);
  });

  it('sube como lo hace la librería de Supabase: PUT con el archivo tal cual; la portada y la copia sin música antes que el video', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item] });
    await run();

    const uploads = site.requests.filter((request) => request.method === 'PUT');
    const base = `/storage/v1/object/upload/sign/reels/${fileName(item)}`;
    expect(uploads.map((upload) => upload.path)).toEqual([`${base}.jpg`, `${base}-sin-musica.mp4`, `${base}.mp4`]);
    expect(uploads[0]).toMatchObject({ contentType: 'image/jpeg', cacheControl: 'max-age=3600', upsert: 'false', bytes: 18 });
    expect(uploads[1]).toMatchObject({ contentType: 'video/mp4', cacheControl: 'max-age=3600', upsert: 'false', bytes: SILENT_BYTES });
    expect(uploads[2]).toMatchObject({ contentType: 'video/mp4', cacheControl: 'max-age=3600', upsert: 'false', bytes: 16 });
  });

  it('con --n pide esa cantidad', async () => {
    site = await startFakeSite({ secret: SECRET });
    const { result } = await run({ count: 1 });
    expect(result).toMatchObject({ made: 1, existing: 0 });
    expect(site.stored.size).toBe(3);
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
    site.stored.set(`${fileName(items[0])}.jpg`, Buffer.from('portada anterior'));
    const { result } = await run();

    expect(result).toMatchObject({ ok: true, made: 1, failed: 0 });
    expect(site.stored.get(`${fileName(items[0])}.mp4`)?.toString()).toBe('video de mentira');
  });

  it('si cambia lo que el video dice sin cambiar el precio, el nombre es otro y se arma de nuevo', async () => {
    const items = sampleItems().slice(0, 1);
    site = await startFakeSite({ secret: SECRET, items });
    const before = fileName(items[0]);
    expect((await run()).result).toMatchObject({ made: 1, existing: 0 });
    expect((await run()).result).toMatchObject({ made: 0, existing: 1 });

    // Mismo precio, pero ya no llega con envío gratis: el sitio manda otra huella y ese video no existe.
    items[0].envio_gratis = false;
    const after = fileName(items[0]);
    expect(after).not.toBe(before);
    expect(after.slice(0, -8)).toBe(before.slice(0, -8));
    expect((await run()).result).toMatchObject({ made: 1, existing: 0 });
    expect(Array.from(site.stored.keys())).toEqual([
      `${before}.jpg`,
      `${before}-sin-musica.mp4`,
      `${before}.mp4`,
      `${after}.jpg`,
      `${after}-sin-musica.mp4`,
      `${after}.mp4`,
    ]);
  });

  it('no deja carpetas temporales, ni cuando un producto falla', async () => {
    site = await startFakeSite({ secret: SECRET });
    await run({
      render: async (job) => {
        if (job.product.precio === 182990) throw new Error('falla de prueba');
        return fakeRender(job);
      },
    });
    expect(openDirs()).toEqual([]);
  });

  it('si cortan el proceso a la mitad, discardOpenWork borra la carpeta del video que se estaba armando', async () => {
    site = await startFakeSite({ secret: SECRET, items: sampleItems().slice(0, 1) });
    let started = () => {};
    let release = () => {};
    const rendering = new Promise<void>((resolve) => (started = resolve));
    const held = new Promise<void>((resolve) => (release = resolve));
    // El armador deja sus dos archivos y se queda ahí, como un video a medio armar.
    const running = run({
      render: async (job) => {
        const done = await fakeRender(job);
        started();
        await held;
        return done;
      },
    });
    await rendering;
    expect(openDirs()).toHaveLength(1);
    expect(readdirSync(path.join(TMP, openDirs()[0])).sort()).toEqual(['foto.jpg', 'portada.jpg', 'reel.mp4']);

    expect(discardOpenWork()).toBe(0);
    expect(openDirs()).toEqual([]);
    // Con nada a medias no hay nada que borrar, y tampoco es un problema.
    expect(discardOpenWork()).toBe(0);

    // En la vida real aquí el proceso sale. En la prueba se lo deja seguir: ya no tiene qué subir.
    release();
    expect((await running).result).toMatchObject({ ok: false, made: 0, failed: 1 });
    expect(site.stored.size).toBe(0);
    expect(openDirs()).toEqual([]);
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
    for (const other of ['https://evil.example', 'http://www.comparatech.cl', 'https://comparatech-web.vercel.app', 'http://localhost.evil.example:3000']) {
      await expect(generate({ site: other, secret: SECRET, fetch: never, log: () => {}, render: fakeRender })).rejects.toThrow('--sitio solo acepta');
    }
    expect(calls).toEqual([]);
  });

  it('el comando tampoco: con otro --sitio termina con código 1 sin hablarle a nadie', async () => {
    const { code, out } = await runCli(['--seco', '--sitio', 'https://evil.example']);
    expect(code).toBe(1);
    expect(out).toContain('--sitio solo acepta un servidor local');
    expect(out).not.toContain('[prueba] intento de salir a la red');
    expect(out).not.toContain(SECRET);
  });

  it('con un --sitio vacío no se va al sitio publicado: es un error antes de hablarle a nadie', async () => {
    const calls: Call[] = [];
    const never = offlineFetch(calls, () => new Response(null, { status: 500 }));
    await expect(generate({ site: '', secret: SECRET, fetch: never, log: () => {}, render: fakeRender })).rejects.toThrow('--sitio llegó vacío');
    expect(calls).toEqual([]);

    for (const args of [['--seco', '--sitio', ''], ['--seco', '--sitio=']]) {
      const { code, out } = await runCli(args);
      expect(code, JSON.stringify(args)).toBe(1);
      expect(out).toContain('Falta el valor de --sitio.');
      expect(out).toContain('Uso: node scripts/reels/generar.mjs');
      expect(out).not.toContain('[prueba] intento de salir a la red');
      expect(out).not.toContain(SECRET);
    }
  }, SLOW);

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

describe('generate: la música de fondo', () => {
  /** Un MP3 de mentira: basta con que pese más de 1 KB (el armador de verdad no corre aquí). */
  const TRACK = Buffer.alloc(4096, 7);

  it('baja la canción firmada del almacén y se la pasa al armado, sin imprimir su dirección', async () => {
    site = await startFakeSite({ secret: SECRET, music: { name: 'pista-1.mp3', bytes: TRACK } });
    const got: { music: string | null; size: number }[] = [];
    const { result, products, printed } = await run({
      render: async (job: { video: string; cover: string; music?: string | null }) => {
        const { readFileSync } = await import('node:fs');
        got.push({ music: job.music ?? null, size: job.music ? readFileSync(job.music).length : 0 });
        return fakeRender(job);
      },
    });
    expect(result.ok).toBe(true);
    expect(got.length).toBeGreaterThan(0);
    for (const g of got) {
      expect(g.music).toMatch(/musica.mp3$/);
      expect(g.size).toBe(TRACK.length);
    }
    expect(products.every((line) => line.includes('con música "pista-1.mp3"'))).toBe(true);
    expectPublic(printed);
    expect(printed).not.toContain('/sign/musica/');
    expect(printed).not.toContain(site.musicToken);
  });

  it('una dirección que no es del almacén no se baja: el video sale igual, en silencio, con un aviso', async () => {
    const items = sampleItems().slice(0, 1).map((item) => ({ ...item, musica: { nombre: 'rara.mp3', url: 'https://otro.example/rara.mp3?token=abc' } }));
    site = await startFakeSite({ secret: SECRET, items });
    const got: (string | null)[] = [];
    const { result, calls, printed } = await run({
      render: async (job: { video: string; cover: string; music?: string | null }) => {
        got.push(job.music ?? null);
        return fakeRender(job);
      },
    });
    expect(result.ok).toBe(true);
    expect(got).toEqual([null]);
    expect(calls.some((c) => c.host === 'otro.example')).toBe(false);
    expect(printed).toContain('Sale en silencio');
    expectPublic(printed);
  });
});

describe('generate: la copia sin música', () => {
  /** Las subidas que llegaron al almacén de mentira, sin el comienzo de la dirección. */
  const putPaths = () =>
    site!.requests.filter((request) => request.method === 'PUT').map((request) => request.path.replace('/storage/v1/object/upload/sign/reels/', ''));

  it('la hace a partir del video ya armado y la sube al lado, con el mismo nombre más "-sin-musica"', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item] });
    const jobs: { video: string; output: string; videoText: string }[] = [];
    const { result, products, printed } = await run({
      mute: async (job: { video: string; output: string }) => {
        jobs.push({ ...job, videoText: readFileSync(job.video, 'utf8') });
        return fakeMute(job);
      },
    });

    expect(result).toEqual({ ok: true, made: 1, existing: 0, failed: 0, pending: 0 });
    // Sale del video que se va a subir, en la misma carpeta temporal.
    expect(jobs).toHaveLength(1);
    expect(jobs[0].videoText).toBe('video de mentira');
    expect(path.dirname(jobs[0].output)).toBe(path.dirname(jobs[0].video));
    expect(site.stored.get(`${fileName(item)}-sin-musica.mp4`)?.toString()).toBe('video sin música de mentira');
    expect(site.stored.get(`${fileName(item)}.mp4`)?.toString()).toBe('video de mentira');
    expect(products[0]).toMatch(/ · y su copia sin música$/);
    expect(printed).not.toContain('Aviso: la copia sin música');
    expectPublic(printed);
  });

  it('si no se puede hacer, el video del día se sube igual y queda un aviso', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item] });
    const { result, lines, products, printed } = await run({
      mute: async () => {
        throw new Error('ffmpeg terminó con error 1: falla de prueba');
      },
    });

    expect(result).toEqual({ ok: true, made: 1, existing: 0, failed: 0, pending: 0 });
    expect(Array.from(site.stored.keys())).toEqual([`${fileName(item)}.jpg`, `${fileName(item)}.mp4`]);
    expect(products[0]).not.toContain('copia sin música');
    expect(lines).toContain(
      '    Aviso: la copia sin música no se pudo hacer: en el admin queda el video con música (ffmpeg terminó con error 1: falla de prueba)'
    );
    expect(lines[lines.length - 1]).toBe('Resumen: 1 video nuevo, 0 que ya estaban.');
    expect(openDirs()).toEqual([]);
    expectPublic(printed);
  });

  it('si no se puede subir, el video del día se sube igual, el aviso no trae la dirección firmada y no queda nada a medias', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item] });
    const photo = await fakePhoto();
    const calls: Call[] = [];
    const offline = offlineFetch(calls, () => jpegResponse(photo));
    // El almacén rechaza solo la copia, y su mensaje repite la dirección firmada con el token.
    const silentFails: typeof fetch = async (input, init) => {
      if (init?.method === 'PUT' && String(input).includes('-sin-musica.mp4')) {
        return new Response(JSON.stringify({ statusCode: '500', error: 'Internal', message: `no se pudo guardar ${String(input)}` }), { status: 500 });
      }
      return offline(input, init);
    };
    const { result, lines, printed } = await run({ fetch: silentFails });

    expect(result).toMatchObject({ ok: true, made: 1, failed: 0 });
    expect(Array.from(site.stored.keys())).toEqual([`${fileName(item)}.jpg`, `${fileName(item)}.mp4`]);
    const note = lines.find((line) => line.startsWith('    Aviso: la copia sin música no se pudo subir: en el admin queda el video con música'));
    // El motivo va entero, con la dirección firmada tapada (no cortada a la mitad, que la dejaría a la vista).
    expect(note).toBe('    Aviso: la copia sin música no se pudo subir: en el admin queda el video con música (el almacén respondió 500 al subir: no se pudo guardar [oculto])');
    expect(openDirs()).toEqual([]);
    expectPublic(printed);
  });

  it('si ya estaba arriba (otra corrida alcanzó a subirla), no es un problema', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item] });
    site.stored.set(`${fileName(item)}-sin-musica.mp4`, Buffer.from('copia anterior'));
    const { result, products, printed } = await run();

    expect(result).toMatchObject({ ok: true, made: 1, failed: 0 });
    expect(site.stored.get(`${fileName(item)}-sin-musica.mp4`)?.toString()).toBe('copia anterior');
    expect(site.stored.get(`${fileName(item)}.mp4`)?.toString()).toBe('video de mentira');
    expect(products[0]).toMatch(/ · y su copia sin música$/);
    expect(printed).not.toContain('Aviso: la copia sin música');
  });

  it('con el plan de un sitio anterior (sin dónde subirla) arma y sube como antes, sin copia y sin avisos', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item], silentCopy: false });
    let muted = 0;
    const { result, products, printed } = await run({
      mute: async (job: { video: string; output: string }) => {
        muted++;
        return fakeMute(job);
      },
    });

    expect(result).toEqual({ ok: true, made: 1, existing: 0, failed: 0, pending: 0 });
    expect(muted).toBe(0);
    expect(putPaths()).toEqual([`${fileName(item)}.jpg`, `${fileName(item)}.mp4`]);
    expect(products[0]).not.toContain('copia sin música');
    expect(printed).not.toContain('Aviso: la copia sin música');
  });

  it('una dirección para la copia que no es la de su archivo no se usa: el video sale igual, sin copia, y se avisa', async () => {
    const [item] = sampleItems();
    site = await startFakeSite({ secret: SECRET, items: [item] });
    const photo = await fakePhoto();
    const calls: Call[] = [];
    const offline = offlineFetch(calls, () => jpegResponse(photo));
    // El plan llega con la copia apuntando a otra parte: a otro servidor, o al .mp4 del propio video.
    for (const bad of ['https://evil.example/reels/x-sin-musica.mp4?token=abcdefgh', 'mismo-video']) {
      site.stored.clear();
      site.requests.length = 0;
      const altered: typeof fetch = async (input, init) => {
        const res = await offline(input, init);
        if (!String(input).includes('/api/social/videos/plan')) return res;
        const body = await res.json();
        for (const row of body.seleccion) row.subir.sinMusica = bad === 'mismo-video' ? row.subir.video : bad;
        return new Response(JSON.stringify(body), { status: res.status, headers: { 'content-type': 'application/json' } });
      };
      let muted = 0;
      const { result, lines, printed } = await run({
        fetch: altered,
        mute: async (job: { video: string; output: string }) => {
          muted++;
          return fakeMute(job);
        },
      });

      expect(result, bad).toMatchObject({ ok: true, made: 1, failed: 0 });
      expect(muted, bad).toBe(0);
      expect(putPaths(), bad).toEqual([`${fileName(item)}.jpg`, `${fileName(item)}.mp4`]);
      expect(site.stored.get(`${fileName(item)}.mp4`)?.toString(), bad).toBe('video de mentira');
      expect(lines, bad).toContain(
        '    Aviso: la copia sin música no se hace: en el admin queda el video con música (la dirección de subida no es la de este archivo)'
      );
      expectPublic(printed);
    }
    expect(calls.map((call) => call.host)).not.toContain('evil.example');
  });

  it('en seco no la hace ni la sube', async () => {
    site = await startFakeSite({ secret: SECRET });
    let muted = 0;
    const { result } = await run({
      dry: true,
      mute: async (job: { video: string; output: string }) => {
        muted++;
        return fakeMute(job);
      },
    });
    expect(result).toMatchObject({ ok: true, made: 0, pending: 3 });
    expect(muted).toBe(0);
    expect(site.stored.size).toBe(0);
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
    // El tercero quedó completo; del primero no quedó nada (la portada se rechazó antes).
    expect(Array.from(site.stored.keys())).toEqual([
      `${fileName(items[2])}.jpg`,
      `${fileName(items[2])}-sin-musica.mp4`,
      `${fileName(items[2])}.mp4`,
    ]);
    // El almacén de mentira repite la dirección firmada y el token en su mensaje de error: no pueden salir.
    expectPublic(printed);
  });

  it('un elemento del plan mal armado falla solo él', async () => {
    const items = sampleItems();
    site = await startFakeSite({
      secret: SECRET,
      items: [
        // El nombre es el de otro producto, a otro precio.
        { ...items[0], archivo: fileName({ ...items[1], precio: 1 }) },
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

  it('un nombre de archivo sin huella es de un sitio de otra versión: no arma nada con ese nombre y lo dice', async () => {
    const items = sampleItems();
    const old = (item: Record<string, any>) => `2026-10-13/${item.id}-${item.precio}-${item.plantilla}`;
    site = await startFakeSite({
      secret: SECRET,
      items: [
        { ...items[0], archivo: old(items[0]) },
        // Tampoco se da por hecho uno que "ya existe" con el nombre anterior: ese video no lo mostraría nadie.
        { ...items[1], archivo: old(items[1]), ya_existe: true, subir: null },
        // La huella tiene que venir con su forma: aquí no se calcula, pero tampoco se acepta cualquier cosa.
        { ...items[2], archivo: `${old(items[2])}-CE5849CD` },
      ],
    });
    const { result, calls, products, printed } = await run();

    expect(result).toEqual({ ok: false, made: 0, existing: 0, failed: 3, pending: 0 });
    const mismatch = 'NO SE PUDO: el sitio y el generador no son de la misma versión: el nombre del archivo llegó sin la huella de la oferta.';
    expect(products[0]).toContain(mismatch);
    expect(products[1]).toContain(mismatch);
    expect(products[2]).toContain('NO SE PUDO: el nombre del archivo no trae una huella válida');
    // Solo se pidió el plan: ni fotos ni subidas.
    expect(calls).toHaveLength(1);
    expect(site.stored.size).toBe(0);
    expectPublic(printed);
  });

  it('las direcciones de subida tienen que terminar en el nombre con huella que mandó el sitio', async () => {
    const [item] = sampleItems();
    const file = fileName(item);
    // Direcciones firmadas del nombre anterior (sin huella) para un archivo que sí la trae.
    const oldUpload = (extension: string) => `http://127.0.0.1:9/storage/v1/object/upload/sign/reels/${file.slice(0, -9)}.${extension}?token=abcdefgh`;
    site = await startFakeSite({ secret: SECRET, items: [{ ...item, archivo: file, subir: { video: oldUpload('mp4'), portada: oldUpload('jpg') } }] });
    const { result, calls, products } = await run();

    expect(result).toMatchObject({ ok: false, made: 0, failed: 1 });
    expect(products[0]).toContain('NO SE PUDO: la dirección de subida no es la de este archivo');
    expect(calls).toHaveLength(1);
  });

  it('un nombre de producto no puede dar órdenes al registro de Actions', async () => {
    const items = sampleItems();
    site = await startFakeSite({
      secret: SECRET,
      items: [
        { ...items[0], nombre_corto: 'Parlante ##[error]Falla inventada' },
        { ...items[1], nombre_corto: 'Audífonos ##[add-mask]182' },
        { ...items[2], nombre_corto: `Tablet #${String.fromCharCode(0x200b)}#[warning]con un signo que no se ve` },
      ],
      // El mensaje de error del sitio también es texto ajeno.
      planFailures: [{ status: 500, body: { error: '##[error]Falla del sitio\n::error::otra' } }],
    });
    const failed = await run();
    expect(failed.lines).toEqual(['No se pudo pedir el plan de videos: el sitio respondió 500: # #[error]Falla del sitio ::error::otra']);

    const { result, lines, products } = await run();
    expect(result).toMatchObject({ ok: true, made: 3 });
    expect(products[0]).toMatch(/^1\/3 Parlante # #\[error\]Falla inventada · \$219\.990 · /);
    expect(products[1]).toMatch(/^2\/3 Audífonos # #\[add-mask\]182 · \$182\.990 · /);
    expect(products[2]).toMatch(/^3\/3 Tablet # #\[warning\]con un signo que no se ve · /);
    // Ningún renglón trae la forma antigua de orden ("##[") ni empieza con la nueva ("::").
    for (const line of [...failed.lines, ...lines]) {
      expect(line).not.toContain('##[');
      expect(line).not.toMatch(/^\s*::/);
    }
  });

  it('tampoco queda armada una orden al tapar un secreto', async () => {
    site = await startFakeSite({ secret: SECRET, items: sampleItems().slice(0, 1) });
    const photo = await fakePhoto();
    const calls: Call[] = [];
    const offline = offlineFetch(calls, () => jpegResponse(photo));
    // El almacén responde un error que pega "##" justo antes del token de la subida: suelto no es una orden,
    // pero al taparlo quedaría "##[oculto]".
    const storageFails: typeof fetch = async (input, init) => {
      if (init?.method !== 'PUT') return offline(input, init);
      const token = new URL(String(input)).searchParams.get('token');
      return new Response(JSON.stringify({ statusCode: '500', error: 'Internal', message: `no se pudo guardar ##${token}` }), { status: 500 });
    };
    const { result, products, printed } = await run({ fetch: storageFails });

    expect(result).toMatchObject({ ok: false, failed: 1 });
    expect(products[0]).toContain('NO SE PUDO: el almacén respondió 500 al subir: no se pudo guardar # #[oculto]');
    expect(printed).not.toContain('##[');
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

  it('si el sitio redirige a otro dominio lo dice de una vez: no reintenta, no sigue la redirección y no manda el secreto allá', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      await site?.close();
      await otherSite?.close();
      otherSite = await startFakeSite({ secret: SECRET });
      site = await startFakeSite({ secret: SECRET, planFailures: [{ status, headers: { location: `${otherSite.origin}/api/social/videos/plan?n=4` } }] });
      const { result, calls, lines, printed } = await run();

      expect(result, String(status)).toEqual({ ok: false, made: 0, existing: 0, failed: 0, pending: 0 });
      // Un solo pedido: una redirección no se arregla insistiendo (antes eran tres, con 40 segundos de espera).
      expect(calls).toEqual([{ host: new URL(site.origin).host, method: 'GET', authorization: `Bearer ${SECRET}` }]);
      expect(site.requests).toHaveLength(1);
      // Al otro sitio no le llegó nada: ni el pedido ni el secreto.
      expect(otherSite.requests).toEqual([]);
      expect(lines).toEqual([
        `No se pudo pedir el plan de videos: el sitio redirige a otro dominio (${otherSite.origin}): hay que revisar la dirección que se pasó en --sitio. No se siguió la redirección: el secreto solo se manda a la dirección pedida`,
      ]);
      expectPublic(printed);
    }
  });

  it('si el que redirige es el sitio publicado, dice que hay que cambiar la dirección de producción', async () => {
    const calls: Call[] = [];
    const lines: string[] = [];
    // Sin red: el "sitio publicado" es este fetch, que responde como el dominio antiguo mandando al nuevo.
    const moved: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ host: url.host, method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') });
      return new Response(null, { status: 308, headers: { location: `https://comparatech.example${url.pathname}${url.search}&clave=no-debe-salir` } });
    };
    const result = await generate({ secret: SECRET, fetch: moved, log: (line: string) => lines.push(line), render: fakeRender, retryDelayMs: 0 });

    expect(result.ok).toBe(false);
    expect(calls).toEqual([{ host: new URL(PRODUCTION).host, method: 'GET', authorization: `Bearer ${SECRET}` }]);
    // Del destino sale solo el dominio, no la dirección completa.
    expect(lines).toEqual([
      'No se pudo pedir el plan de videos: el sitio redirige a otro dominio (https://comparatech.example): hay que actualizar la dirección de producción (PRODUCTION) en scripts/reels/generar.mjs. No se siguió la redirección: el secreto solo se manda a la dirección pedida',
    ]);
  });

  it('una redirección dentro del mismo sitio, o sin destino, tampoco se sigue ni se reintenta', async () => {
    for (const headers of [{ location: '/login' }, undefined]) {
      await site?.close();
      site = await startFakeSite({ secret: SECRET, planFailures: [{ status: 307, headers }] });
      const { result, calls, printed } = await run();
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(1);
      expect(site.requests.map((request) => request.path)).toEqual(['/api/social/videos/plan']);
      expect(printed).toContain('el sitio respondió con una redirección (307) en vez del plan');
    }
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

  it('si el sitio redirige termina con código 1 al tiro, con un mensaje que dice qué hacer', async () => {
    otherSite = await startFakeSite({ secret: SECRET });
    site = await startFakeSite({ secret: SECRET, planFailures: [{ status: 308, headers: { location: `${otherSite.origin}/api/social/videos/plan?n=4` } }] });
    const started = Date.now();
    const { code, out } = await runCli(['--sitio', site.origin]);

    expect(code).toBe(1);
    expect(out).toContain(`el sitio redirige a otro dominio (${otherSite.origin})`);
    expect(out).not.toContain('fetch failed');
    expect(otherSite.requests).toEqual([]);
    // Sin los dos reintentos de 20 segundos que hacía antes.
    expect(Date.now() - started).toBeLessThan(15_000);
    expectPublic(out);
  }, SLOW);

  it('lanzado a través de un enlace de carpeta también corre: antes no hacía nada y terminaba con código 0', async () => {
    // El enlace apunta a una COPIA del generador hecha aquí mismo, no a la carpeta del proyecto: así, pase lo
    // que pase al limpiar, lo único que hay detrás del enlace es desechable. --seco no necesita más que eso.
    const copy = path.join(TMP, 'copia', 'scripts', 'reels');
    cpSync(path.join(ROOT, 'scripts/reels'), copy, { recursive: true });
    const link = path.join(TMP, 'enlace');
    // En Windows, un enlace de carpeta que no pide permisos especiales; en Linux y macOS, uno simbólico.
    symlinkSync(copy, link, 'junction');

    site = await startFakeSite({ secret: SECRET });
    const { code, out } = await runCli(['--seco', '--sitio', site.origin], { script: path.join(link, 'generar.mjs') });
    expect(out).toContain('Resumen: 3 por armar, 0 que ya estaban.');
    expect(code).toBe(0);
    expect(site.requests.map((request) => `${request.method} ${request.path}`)).toEqual(['GET /api/social/videos/plan']);
    expectPublic(out);

    // hacer.mjs no tiene esa comparación (siempre corre), pero se comprueba igual: por el enlace también
    // lee la línea de comando y reclama lo que falta.
    const manual = await runCli([], { script: path.join(link, 'hacer.mjs') });
    expect(manual.code).toBe(1);
    expect(manual.out).toContain('No se pudo armar el video: Faltan datos.');
  }, SLOW);

  it('si lo cortan a la mitad (SIGINT o SIGTERM) borra la carpeta temporal en curso antes de salir', async () => {
    for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
      await site?.close();
      site = await startFakeSite({ secret: SECRET, items: sampleItems().slice(0, 1) });
      // La precarga hace de quien corta: cuando el comando ya creó la carpeta del video y está bajando la
      // foto, deja un archivo a medias dentro y avisa la señal.
      const { code, out } = await runCli(['--n', '1', '--sitio', site.origin], { env: { REELS_PRUEBA_CORTE: signal } });

      expect(out, signal).toContain('[prueba] carpetas temporales al cortar: 1');
      expect(out, signal).toContain(`Corrida cortada antes de terminar (${signal}). No quedaron archivos temporales.`);
      expect(code, signal).toBe(exitCode);
      expect(openDirs(), signal).toEqual([]);
      expect(site.stored.size).toBe(0);
      expectPublic(out);
    }
  }, SLOW);
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
      // Una canción de verdad (un tono de 12 segundos), para ver que la copia sin música de verdad no la lleva.
      const track = path.join(TMP, 'pista.wav');
      const tone = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', track]);
      expect(tone.status).toBe(0);
      site = await startFakeSite({ secret: SECRET, items, music: { name: 'pista-1.wav', bytes: readFileSync(track) } });
      // Sin `render` ni `mute`: se usan el armador y ffmpeg de verdad.
      const { result, products, printed } = await run({ render: undefined, mute: undefined });

      expect(result).toEqual({ ok: true, made: 1, existing: 0, failed: 0, pending: 0 });
      expect(products[0]).toMatch(/^1\/1 Moto G86 power 256GB · \$219\.990 · plantilla estudio · armado y subido en \d+,\d s · \d,\d MB · con música "pista-1\.wav" · y su copia sin música$/);
      expect(printed).not.toContain('Aviso: la copia sin música');
      expectPublic(printed);

      const base = fileName(items[0]);
      expect(Array.from(site.stored.keys())).toEqual([`${base}.jpg`, `${base}-sin-musica.mp4`, `${base}.mp4`]);
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

      // La copia sin música: la misma imagen, paquete por paquete (no se comprimió de nuevo), con una pista
      // AAC del mismo largo, en silencio. El video del día sí lleva la canción.
      const silentFile = path.join(TMP, 'subido-sin-musica.mp4');
      writeFileSync(silentFile, site.stored.get(`${base}-sin-musica.mp4`)!);
      const ff = (args: string[]) => spawnSync(ffmpeg!, ['-hide_banner', ...args], { encoding: 'utf8' });
      const imageHash = (input: string) => ff(['-i', input, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-']).stdout.trim();
      expect(imageHash(silentFile)).toMatch(/^MD5=[0-9a-f]{32}$/);
      expect(imageHash(silentFile)).toBe(imageHash(file));
      const loudness = (input: string) => {
        const out = ff(['-i', input, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-']).stderr;
        return Number(/max_volume: (-?[\d.]+) dB/.exec(out)?.[1]);
      };
      expect(loudness(file)).toBeGreaterThan(-40);
      expect(loudness(silentFile)).toBeLessThanOrEqual(-90);
      const silentProbe = ff(['-i', silentFile, '-map', '0:a:0', '-c', 'copy', '-f', 'null', '-']).stderr;
      expect(silentProbe).toMatch(/Audio: aac/);
      const duration = (text: string) => /Duration: ([\d:.]+)/.exec(text)?.[1];
      expect(duration(silentProbe)).toBe(duration(probe.stderr));
    },
    300_000
  );
});
