#!/usr/bin/env node
/**
 * Arma los videos del día (los reels de oferta) y los deja en el almacén del sitio, listos para subirlos a
 * las redes desde el admin.
 *
 *   node scripts/reels/generar.mjs          → los sugeridos de ahora (4)
 *   node scripts/reels/generar.mjs --n 2    → otra cantidad (1 a 6)
 *   node scripts/reels/generar.mjs --seco   → pide el plan y dice qué haría, sin armar ni subir
 *
 * El sitio decide qué productos van (GET /api/social/videos/plan) y entrega, por cada uno, sus datos, la
 * foto y dos direcciones firmadas para subir el video y su portada. Este proceso baja la foto, arma el video
 * con la plantilla pedida y sube los dos archivos. Lo que ya existe no se rehace. Si un producto falla, sigue
 * con los demás y termina con código 1.
 *
 * Corre tres veces al día en GitHub Actions (.github/workflows/reels.yml) y también a mano en el PC.
 * Lee CRON_SECRET de las variables de entorno (así llega en GitHub Actions) y, si no está, de .env.local
 * (así corre en el PC). Nunca lo imprime, y solo lo manda al sitio en producción o a un servidor local
 * (--sitio http://localhost:3000). La dirección de producción está escrita acá y no se toma de una variable
 * a propósito, igual que en scripts/redes.mjs: una variable puede apuntar a un dominio que todavía no es
 * nuestro, y el secreto terminaría en manos de otro.
 *
 * Todo lo que imprime queda en un registro PÚBLICO (el repositorio lo es, y sus registros de Actions
 * también): por cada video, el nombre, el precio, la plantilla, cuánto demoró y cuánto pesa. Jamás una
 * dirección firmada, el secreto ni la respuesta del plan.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { precio as formatPrice, resolverProducto } from './datos.mjs';
import { existePlantilla } from './plantillas/index.mjs';
import {
  isLocalHost,
  oneLine,
  photoUrlProblem,
  planItemProblem,
  readPlan,
  reelInput,
  uploadUrlProblem,
} from './plan.mjs';

/** El sitio publicado. Cambiar acá (y en scripts/redes.mjs) cuando el dominio propio esté funcionando. */
export const PRODUCTION = 'https://comparatech-web.vercel.app';
const PLAN_PATH = '/api/social/videos/plan';
const ENV_FILE = fileURLToPath(new URL('../../.env.local', import.meta.url));
const DEFAULT_COUNT = 4;
const MAX_COUNT = 6;
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
const PLAN_ATTEMPTS = 3;
const HIDDEN = '[oculto]';
const USAGE = 'Uso: node scripts/reels/generar.mjs [--n 4] [--seco] [--sitio http://localhost:3000]';

const comma = (n, digits = 1) => n.toFixed(digits).replace('.', ',');
const megabytes = (bytes) => `${comma(bytes / 1048576)} MB`;
const reason = (err) => (err instanceof Error ? err.message : String(err));
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Lee la línea de comando. Una opción que no se conoce es un error: mejor avisar que ignorarla. */
export function parseArgs(argv) {
  const options = { count: DEFAULT_COUNT, dry: false, site: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const key = eq > 0 ? arg.slice(0, eq) : arg;
    const value = () => {
      if (eq > 0) return arg.slice(eq + 1);
      const next = argv[++i];
      if (next === undefined || next.startsWith('--')) throw new Error(`Falta el valor de ${key}.\n${USAGE}`);
      return next;
    };
    if (key === '--seco' && eq < 0) {
      options.dry = true;
    } else if (key === '--n') {
      const raw = value();
      const count = Number(raw);
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
        throw new Error(`--n va de 1 a ${MAX_COUNT} (llegó "${oneLine(raw, 20)}").`);
      }
      options.count = count;
    } else if (key === '--sitio') {
      options.site = value();
    } else {
      throw new Error(`No conozco la opción ${oneLine(arg, 40)}.\n${USAGE}`);
    }
  }
  return options;
}

/**
 * El secreto de los crons: primero el de las variables de entorno y, si no está, el de .env.local (mismo
 * formato que lee scripts/redes.mjs). Nunca se imprime.
 *
 * @param {{ env?: Record<string, string | undefined>, envFile?: string }} [options]
 */
export function readSecret({ env = process.env, envFile = ENV_FILE } = {}) {
  const fromEnv = String(env.CRON_SECRET ?? '').trim();
  if (fromEnv) return fromEnv;
  let text;
  try {
    text = readFileSync(envFile, 'utf8');
  } catch {
    throw new Error('Falta CRON_SECRET: no está en las variables de entorno y no encuentro .env.local en la raíz del proyecto.');
  }
  let secret = '';
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && match[1] === 'CRON_SECRET') secret = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  if (!secret) throw new Error('Falta CRON_SECRET en .env.local.');
  return secret;
}

/** A qué sitio se le habla (y se le manda el secreto): producción, o un servidor local si se pide con --sitio. */
export function resolveSite(override) {
  if (!override) return PRODUCTION;
  let url;
  try {
    url = new URL(override);
  } catch {
    throw new Error('--sitio no es una dirección válida.');
  }
  const local = isLocalHost(url.hostname) && (url.protocol === 'http:' || url.protocol === 'https:');
  if (!local && url.origin !== PRODUCTION) {
    throw new Error(`--sitio solo acepta un servidor local o ${PRODUCTION}.`);
  }
  return url.origin;
}

/**
 * Deja un texto apto para el registro público: tapa los secretos conocidos (el de los crons, las direcciones
 * firmadas y sus tokens), lo que venga después del "?" en cualquier dirección y cualquier cosa con forma de
 * token. Todo lo que se imprime pasa por aquí, también los mensajes de error que vienen de otra parte.
 */
function publicText(secrets) {
  return (value) => {
    let text = String(value);
    // Los más largos primero: una dirección firmada contiene a su propio token.
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      if (secret) text = text.split(secret).join(HIDDEN);
    }
    return text
      .replace(/(https?:\/\/[^\s"'<>?#]+)[?#][^\s"'<>]*/g, `$1?${HIDDEN}`)
      .replace(/eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, HIDDEN);
  };
}

/** Pide el plan al sitio. Reintenta solo ante caídas de red o de pasarela; un 500 es el sitio diciendo que algo salió mal. */
async function requestPlan({ origin, secret, count, fetchFn, retryDelayMs }) {
  for (let attempt = 1; ; attempt++) {
    const last = attempt >= PLAN_ATTEMPTS;
    let res;
    try {
      res = await fetchFn(`${origin}${PLAN_PATH}?n=${count}`, {
        headers: { Authorization: `Bearer ${secret}` },
        // Sin seguir redirecciones: el secreto va solo a la dirección pedida.
        redirect: 'error',
        signal: AbortSignal.timeout(70_000),
      });
    } catch (err) {
      if (last) throw new Error(`no se pudo hablar con el sitio (${reason(err)})`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    const text = await res.text();
    if ([502, 503, 504].includes(res.status) && !last) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      continue;
    }
    if (res.status === 401) throw new Error('el sitio rechazó el secreto (401): el CRON_SECRET no es el de ese sitio');
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // se trata abajo: sin JSON no hay plan ni mensaje de error que mostrar
    }
    if (!res.ok) {
      const detail = data && typeof data.error === 'string' ? `: ${oneLine(data.error, 2000)}` : '';
      throw new Error(`el sitio respondió ${res.status}${detail}`);
    }
    return data;
  }
}

/** ¿Qué imagen es? Se mira el contenido, no lo que dice el servidor. */
function imageKind(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Baja la foto del producto a `dir`. Solo de Mercado Libre, hasta 8 MB, y tiene que ser una imagen. */
async function downloadPhoto(fetchFn, url, dir) {
  const urlProblem = photoUrlProblem(url);
  if (urlProblem) throw new Error(`la foto ${urlProblem}`);
  let res;
  try {
    // Sin seguir redirecciones: la foto se baja de la dirección revisada o no se baja.
    res = await fetchFn(url, { headers: { accept: 'image/*' }, redirect: 'error', signal: AbortSignal.timeout(40_000) });
  } catch (err) {
    throw new Error(`no se pudo bajar la foto (${reason(err)})`);
  }
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const tooBig = `la foto pesa más de ${megabytes(PHOTO_MAX_BYTES)}`;
  let problem = null;
  if (res.status !== 200) problem = `no se pudo bajar la foto (respondió ${res.status})`;
  else if (!type.startsWith('image/')) problem = `la foto no es una imagen (${oneLine(type, 40) || 'sin tipo'})`;
  else if (Number(res.headers.get('content-length')) > PHOTO_MAX_BYTES) problem = tooBig;
  else if (!res.body) problem = 'la foto llegó vacía';
  if (problem) {
    // Lo que no se va a leer se suelta, para no dejar la conexión esperando.
    await res.body?.cancel().catch(() => {});
    throw new Error(problem);
  }
  // El tope se cuenta mientras llega: el peso que anuncia el servidor puede faltar o no ser cierto.
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > PHOTO_MAX_BYTES) throw new Error(tooBig);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const kind = imageKind(bytes);
  if (!kind) throw new Error('la foto no es una imagen (el contenido no es JPG, PNG ni WebP)');
  const file = path.join(dir, `foto.${kind}`);
  await writeFile(file, bytes);
  return file;
}

/**
 * Sube un archivo a una dirección firmada de Supabase Storage. Hace lo mismo que uploadToSignedUrl de
 * @supabase/storage-js (node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts) cuando el cuerpo no
 * es un Blob: un PUT a la dirección firmada (el token ya va en ella), con el archivo tal cual como cuerpo y
 * las cabeceras cache-control, content-type y x-upsert; cualquier respuesta que no sea 2xx es un error. Se
 * copió de ahí en vez de usar la librería porque así no hacen falta las llaves del proyecto: la dirección
 * firmada es todo el permiso que este proceso recibe.
 *
 * Devuelve false si el archivo ya estaba arriba (el almacén responde "Duplicate"): es el mismo producto, al
 * mismo precio y con la misma plantilla, así que sirve el que hay.
 */
async function uploadSigned(fetchFn, url, file, contentType) {
  let res;
  try {
    res = await fetchFn(url, {
      method: 'PUT',
      headers: { 'cache-control': 'max-age=3600', 'content-type': contentType, 'x-upsert': 'false' },
      body: await readFile(file),
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new Error(`no se pudo subir (${reason(err)})`);
  }
  const text = await res.text().catch(() => '');
  if (res.ok) return true;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // el almacén no siempre responde JSON
  }
  if (res.status === 409 || String(body?.statusCode) === '409' || body?.error === 'Duplicate') return false;
  const detail = body && typeof body.message === 'string' ? `: ${oneLine(body.message, 2000)}` : '';
  throw new Error(`el almacén respondió ${res.status} al subir${detail}`);
}

/**
 * Arma el video y su portada con la plantilla pedida. El armador se carga recién aquí: trae el dibujante y
 * los hilos, que --seco no necesita.
 */
async function renderReel({ product, template, video, cover }) {
  const { prepararReel } = await import('./armar.mjs');
  const reel = await prepararReel(product, { plantilla: template });
  const result = await reel.armar({ salida: video, portada: cover });
  return { bytes: result.peso, lowered: result.calidadBajada, notes: reel.avisos };
}

/** Un producto: baja la foto, arma el video y su portada en una carpeta temporal y sube los dos archivos. */
async function makeOne(ctx, item) {
  const dir = await mkdtemp(path.join(ctx.tmpRoot, 'comparatech-reel-'));
  try {
    const photo = await downloadPhoto(ctx.fetchFn, item.foto, dir);
    const product = resolverProducto(reelInput(item), { foto: photo, quien: 'producto' });
    const video = path.join(dir, 'reel.mp4');
    const cover = path.join(dir, 'portada.jpg');
    const rendered = await ctx.render({ product, template: item.plantilla, video, cover });
    // La portada primero: el sitio da un video por hecho cuando existe su .mp4, así que ese archivo se sube
    // al final, cuando la portada ya está arriba.
    await uploadSigned(ctx.fetchFn, item.subir.portada, cover, 'image/jpeg');
    const fresh = await uploadSigned(ctx.fetchFn, item.subir.video, video, 'video/mp4');
    return { ...rendered, fresh };
  } finally {
    // Si la carpeta temporal no se deja borrar (en Windows pasa cuando algo la tiene tomada), no es motivo
    // para dar por fallado un video que ya quedó subido.
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
  }
}

/**
 * El proceso completo. Devuelve { ok, made, existing, failed, pending }: `ok` es false si no se pudo pedir el
 * plan o si algún producto falló. `fetch`, `log` y `render` se pueden reemplazar (así se prueba sin red y sin
 * ffmpeg); `site` pasa siempre por resolveSite, así que el secreto no sale a otra parte ni por error de quien
 * llame.
 *
 * @param {{
 *   site?: string | null,
 *   secret?: string,
 *   count?: number,
 *   dry?: boolean,
 *   fetch?: typeof globalThis.fetch,
 *   log?: (line: string) => void,
 *   render?: (job: { product: any, template: string, video: string, cover: string }) => Promise<{ bytes: number, lowered?: boolean, notes?: string[] }>,
 *   retryDelayMs?: number,
 *   tmpRoot?: string,
 * }} [options]
 */
export async function generate({
  site = null,
  secret,
  count = DEFAULT_COUNT,
  dry = false,
  fetch: fetchFn = globalThis.fetch,
  log = console.log,
  render = renderReel,
  retryDelayMs = 20_000,
  tmpRoot = os.tmpdir(),
} = {}) {
  const origin = resolveSite(site);
  if (!secret) throw new Error('Falta CRON_SECRET.');
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`La cantidad de videos va de 1 a ${MAX_COUNT}.`);
  const secrets = new Set([secret]);
  const show = publicText(secrets);
  // Primero se tapa y después se acorta: al revés, un token cortado a la mitad ya no se reconocería.
  const say = (line) => log(clip(show(line), 600));
  const totals = { ok: false, made: 0, existing: 0, failed: 0, pending: 0 };

  let plan;
  try {
    plan = readPlan(await requestPlan({ origin, secret, count, fetchFn, retryDelayMs }));
  } catch (err) {
    say(`No se pudo pedir el plan de videos: ${oneLine(reason(err), 2000)}`);
    return totals;
  }
  // Las direcciones firmadas y sus tokens también son secretos: si un mensaje de error los trajera, salen tapados.
  for (const item of plan.items) {
    for (const url of Object.values(item && typeof item.subir === 'object' && item.subir ? item.subir : {})) {
      if (typeof url !== 'string' || !url) continue;
      secrets.add(url);
      try {
        const token = new URL(url).searchParams.get('token');
        // Uno muy corto no se anota: taparía letras sueltas de cualquier renglón.
        if (token && token.length >= 8) secrets.add(token);
      } catch {
        // una dirección que no se puede leer se rechaza más abajo
      }
    }
  }

  // Nunca más de los que se pueden pedir, mande lo que mande el sitio: armar cada uno ocupa el equipo un buen rato.
  const items = plan.items.slice(0, MAX_COUNT);
  const total = items.length;
  say(`Videos del día${plan.date ? ` ${plan.date}` : ''}: el sitio sugiere ${total}.${dry ? ' En seco: no se arma ni se sube nada.' : ''}`);
  if (origin !== PRODUCTION) say(`Aviso: el plan se pidió a un servidor local (${origin}), no al sitio publicado.`);
  if (plan.deleted) say(`El sitio borró ${plan.deleted} ${plan.deleted === 1 ? 'archivo' : 'archivos'} de días anteriores.`);
  if (plan.unreadHistory) say(`Aviso: ${plan.unreadHistory} ${plan.unreadHistory === 1 ? 'producto quedó' : 'productos quedaron'} fuera porque no se pudo leer su historial de precios.`);

  const ctx = { fetchFn, render, tmpRoot };
  for (let i = 0; i < total; i++) {
    const item = items[i];
    const name = oneLine(item?.nombre_corto || item?.nombre || 'producto sin nombre', 70);
    const price = Number.isInteger(item?.precio) ? formatPrice(item.precio) : 'sin precio';
    const label = `${i + 1}/${total} ${name} · ${price} · plantilla ${oneLine(item?.plantilla ?? '?', 20)}`;
    const fail = (why) => {
      totals.failed++;
      say(`${label} · NO SE PUDO: ${oneLine(why, 2000)}`);
    };

    const problem = planItemProblem(item);
    if (problem) {
      fail(problem);
      continue;
    }
    if (item.ya_existe) {
      totals.existing++;
      say(`${label} · ya estaba, no se rehace`);
      continue;
    }
    if (!existePlantilla(item.plantilla)) {
      fail(`este proceso no tiene la plantilla "${item.plantilla}"`);
      continue;
    }
    const photoProblem = photoUrlProblem(item.foto);
    const uploadProblem =
      uploadUrlProblem(item.subir?.portada, `${item.archivo}.jpg`, { allowLocal: origin !== PRODUCTION }) ??
      uploadUrlProblem(item.subir?.video, `${item.archivo}.mp4`, { allowLocal: origin !== PRODUCTION });
    if (photoProblem || uploadProblem) {
      fail(photoProblem ? `la foto ${photoProblem}` : uploadProblem);
      continue;
    }
    if (dry) {
      totals.pending++;
      say(`${label} · falta: se armaría y se subiría`);
      continue;
    }

    const started = Date.now();
    try {
      const done = await makeOne(ctx, item);
      totals.made++;
      const how = done.fresh ? 'armado y subido' : 'armado; ya había uno igual arriba';
      const quality = done.lowered ? ' (con un poco menos de calidad, para no pasar de 4 MB)' : '';
      say(`${label} · ${how} en ${comma((Date.now() - started) / 1000)} s · ${megabytes(done.bytes)}${quality}`);
      for (const note of done.notes ?? []) say(`    Aviso: ${oneLine(note, 300)}`);
    } catch (err) {
      fail(reason(err));
    }
  }

  totals.ok = totals.failed === 0;
  const parts = [];
  if (dry) parts.push(`${totals.pending} por armar`);
  else parts.push(`${totals.made} ${totals.made === 1 ? 'video nuevo' : 'videos nuevos'}`);
  parts.push(`${totals.existing} que ya ${totals.existing === 1 ? 'estaba' : 'estaban'}`);
  if (totals.failed) parts.push(`${totals.failed} que no se ${totals.failed === 1 ? 'pudo' : 'pudieron'}`);
  say(`${total === 0 ? 'Ahora no hay productos que cumplan para un video. ' : ''}Resumen: ${parts.join(', ')}.`);
  return totals;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const asked = path.resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? asked.toLowerCase() === self.toLowerCase() : asked === self;
}

if (isMainModule()) {
  let show = (text) => text;
  try {
    const options = parseArgs(process.argv.slice(2));
    const secret = readSecret();
    show = publicText(new Set([secret]));
    const result = await generate({ ...options, secret });
    // Sin process.exit: así lo último que se imprimió alcanza a salir completo.
    process.exitCode = result.ok ? 0 : 1;
  } catch (err) {
    console.error(show(reason(err)));
    process.exitCode = 1;
  }
}
