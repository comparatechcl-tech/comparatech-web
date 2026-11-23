#!/usr/bin/env node
/**
 * Arma el video de la historia automática de Instagram: la imagen de la oferta, 10 segundos, con música.
 *
 *   node scripts/reels/historia.mjs         → arma y sube lo que falte para hoy
 *   node scripts/reels/historia.mjs --seco  → dice qué haría, sin armar ni subir
 *
 * El sitio decide qué ofertas van (GET /api/social/videos/historia) y entrega la imagen, la canción del día y
 * dónde subir cada video. Aquí no se publica nada: a las 12:40 el sitio publica el video si sigue calzando con
 * la oferta, y si no, la imagen (src/lib/social/meta-story.ts).
 *
 * Corre en GitHub Actions después de los reels (.github/workflows/reels.yml). Lo que imprime queda en un
 * registro PÚBLICO: el nombre, el precio y el peso de cada video. Jamás una dirección firmada ni el secreto.
 */

import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PRODUCTION, readSecret, resolveSite } from './generar.mjs';
import { musicUrlProblem, noCommands, oneLine, uploadUrlProblem } from './plan.mjs';
import { buscarFfmpeg, revisarMusica } from './video.mjs';

const PLAN_PATH = '/api/social/videos/historia';
const SECONDS = 10;
const FPS = 30;
/** El mismo volumen de los reels. */
const MUSIC_VOLUME = 0.9;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MUSIC_MAX_BYTES = 15 * 1024 * 1024;
const PLAN_ATTEMPTS = 3;
const USAGE = 'Uso: node scripts/reels/historia.mjs [--seco] [--sitio http://localhost:3000]';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OBJECT_RE = new RegExp(`^\\d{4}-\\d{2}-\\d{2}/historia-(${UUID})-([1-9]\\d{0,9})-[0-9a-f]{8}\\.mp4$`);
const IMAGE_RE = new RegExp(`^/social/pieza/(${UUID})/perfil-[0-9a-f-]+\\.jpg$`);

const execFileAsync = promisify(execFile);
const reason = (err) => (err instanceof Error ? err.message : String(err));

/** Un error apto para el registro público: sin direcciones y sin el secreto. */
export function publicError(err, secret = '') {
  let text = reason(err);
  if (secret) text = text.split(secret).join('[oculto]');
  return oneLine(text.replace(/https?:\/\/\S+/g, '[dirección]'), 200);
}

export function parseArgs(argv) {
  const options = { dry: false, site: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--seco') options.dry = true;
    else if (argv[i] === '--sitio' && argv[i + 1] && !argv[i + 1].startsWith('--')) options.site = argv[++i];
    else throw new Error(`No conozco la opción ${oneLine(argv[i], 40)}.\n${USAGE}`);
  }
  return options;
}

/** ¿Sirve este elemento del plan? null si está bien, o qué le falta. */
export function storyItemProblem(item, { dry = false, allowLocal = false } = {}) {
  if (!item || typeof item !== 'object') return 'el sitio mandó un elemento vacío';
  const parts = typeof item.archivo === 'string' ? OBJECT_RE.exec(item.archivo) : null;
  if (!parts || parts[1] !== item.id || parts[2] !== String(item.precio)) return 'el nombre del archivo no calza con el producto y el precio';
  const image = typeof item.imagen === 'string' ? IMAGE_RE.exec(item.imagen) : null;
  if (!image || image[1] !== item.id) return 'la imagen no es la de este producto';
  if (typeof item.ya_existe !== 'boolean') return 'no dice si el video ya existe';
  if (!item.ya_existe && !dry) return uploadUrlProblem(item.subir, item.archivo, { allowLocal });
  return null;
}

/** Lo que se le pide a ffmpeg: H.264 y AAC dentro de lo que Instagram acepta para una historia en video. */
export function encoderArgs({ image, music, output }) {
  const fadeOut = (SECONDS - 0.9).toFixed(1);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-framerate', String(FPS), '-t', String(SECONDS), '-i', image,
    '-stream_loop', '-1', '-i', music,
    '-filter_complex',
    '[0:v]scale=1080:1920:in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p[v];' +
      `[1:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${SECONDS},asetpts=PTS-STARTPTS,` +
      `volume=${MUSIC_VOLUME},afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOut}:d=0.9[a]`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-tune', 'stillimage', '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-flags', '+cgop',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-t', String(SECONDS), '-movflags', '+faststart', '-f', 'mp4',
    output,
  ];
}

async function requestPlan({ origin, secret, dry, fetchFn, retryDelayMs }) {
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= PLAN_ATTEMPTS;
    let res;
    try {
      res = await fetchFn(`${origin}${PLAN_PATH}${dry ? '?seco=1' : ''}`, {
        headers: { Authorization: `Bearer ${secret}` },
        // El secreto va solo a la dirección pedida.
        redirect: 'error',
        signal: AbortSignal.timeout(70_000),
      });
    } catch (err) {
      if (last) throw new Error(`no se pudo hablar con el sitio (${reason(err)})`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    if ([502, 503, 504].includes(res.status) && !last) {
      await res.body?.cancel().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true || !Array.isArray(data.seleccion)) {
      throw new Error(`el sitio no entregó el plan de la historia (respondió ${res.status})`);
    }
    return data;
  }
}

async function download(fetchFn, url, maxBytes, what) {
  const res = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(40_000) });
  if (res.status !== 200 || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`no se pudo bajar ${what} (respondió ${res.status})`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) throw new Error(`${what} pesa demasiado`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function upload(fetchFn, url, file) {
  const res = await fetchFn(url, {
    method: 'PUT',
    headers: { 'cache-control': 'max-age=3600', 'content-type': 'video/mp4', 'x-upsert': 'false' },
    body: await readFile(file),
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text().catch(() => '');
  // Ya estaba arriba: es la misma oferta, y sirve el que hay.
  if (res.ok || res.status === 409 || /"(statusCode|error)":\s*"(409|Duplicate)"/.test(text)) return;
  throw new Error(`el almacén respondió ${res.status} al subir`);
}

async function encodeWithFfmpeg(paths) {
  const ffmpeg = buscarFfmpeg();
  const problem = revisarMusica(ffmpeg, paths.music);
  if (problem) throw new Error(`la canción: ${problem}`);
  await execFileAsync(ffmpeg, encoderArgs(paths), { timeout: 120_000, maxBuffer: 1024 * 1024 });
}

/**
 * Arma y sube lo que falte. Si una oferta falla sigue con las demás, y `ok` queda en false.
 *
 * @param {{
 *   site?: string | null, secret: string, dry?: boolean, fetchFn?: typeof fetch,
 *   encode?: (paths: { image: string, music: string, output: string }) => Promise<void>,
 *   say?: (line: string) => unknown, retryDelayMs?: number,
 * }} options
 */
export async function makeStoryVideos({
  site = null,
  secret,
  dry = false,
  fetchFn = fetch,
  encode = encodeWithFfmpeg,
  say = console.log,
  retryDelayMs = 3_000,
}) {
  const origin = resolveSite(site);
  const allowLocal = origin !== PRODUCTION;
  const plan = await requestPlan({ origin, secret, dry, fetchFn, retryDelayMs });
  const totals = { made: 0, existing: 0, pending: 0, failed: 0 };
  if (plan.omitida) {
    say(`Historia: ${oneLine(plan.omitida, 120)}`);
    return { ok: true, ...totals };
  }

  const todo = [];
  for (const item of plan.seleccion) {
    const name = oneLine(item?.nombre, 60);
    const problem = storyItemProblem(item, { dry, allowLocal });
    if (problem) {
      totals.failed++;
      say(`Historia: ${name}: ${problem}.`);
    } else if (item.ya_existe) {
      totals.existing++;
      say(`Historia: ${name}: ya está armada.`);
    } else if (dry) {
      totals.pending++;
      say(`Historia: ${name}: por armar.`);
    } else {
      todo.push(item);
    }
  }
  if (todo.length === 0) return { ok: totals.failed === 0, ...totals };

  const musicProblem = musicUrlProblem(plan.musica?.url, { allowLocal });
  const extension = path.extname(String(plan.musica?.nombre ?? '')).toLowerCase();
  if (musicProblem || !/^\.(mp3|m4a|aac|wav|ogg)$/.test(extension)) {
    say(`Historia: la canción no sirve (${musicProblem ?? 'formato'}): hoy sale la imagen.`);
    return { ok: false, ...totals, failed: totals.failed + todo.length };
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'historia-'));
  try {
    const music = path.join(dir, `cancion${extension}`);
    await writeFile(music, await download(fetchFn, plan.musica.url, MUSIC_MAX_BYTES, 'la canción'));
    for (const [i, item] of todo.entries()) {
      const name = oneLine(item.nombre, 60);
      try {
        const bytes = await download(fetchFn, `${origin}${item.imagen}`, IMAGE_MAX_BYTES, 'la imagen');
        if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('la imagen no es un JPG');
        const image = path.join(dir, `imagen-${i}.jpg`);
        const output = path.join(dir, `historia-${i}.mp4`);
        await writeFile(image, bytes);
        await encode({ image, music, output });
        const { size } = await stat(output);
        await upload(fetchFn, item.subir, output);
        totals.made++;
        say(`Historia: ${name}: lista (${(size / 1048576).toFixed(1).replace('.', ',')} MB).`);
      } catch (err) {
        totals.failed++;
        say(`Historia: ${name}: no se pudo (${publicError(err, secret)}).`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  return { ok: totals.failed === 0, ...totals };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]).toLowerCase() === realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
  } catch {
    return false;
  }
}

if (isMainModule()) {
  let secret = '';
  try {
    const options = parseArgs(process.argv.slice(2));
    secret = readSecret();
    const result = await makeStoryVideos({ ...options, secret });
    process.exitCode = result.ok ? 0 : 1;
  } catch (err) {
    console.error(noCommands(`Historia: ${publicError(err, secret)}`));
    process.exitCode = 1;
  }
}
