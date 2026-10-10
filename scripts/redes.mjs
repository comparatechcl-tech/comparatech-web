#!/usr/bin/env node
/**
 * Pide al sitio el plan de publicaciones para redes y anota lo programado.
 *
 *   node scripts/redes.mjs plan [cantidad]      → qué publicar (JSON)
 *   node scripts/redes.mjs registrar <archivo>  → anota lo programado en Metricool
 *
 * El archivo de `registrar` es { "publicaciones": [{ "product_id", "canal",
 * "programado_para" (con zona horaria), "metricool_id" (el uuid de la
 * publicación), "precio", "texto" }] }. Conviene escribirlo en _local/, que
 * no se sube al repositorio.
 *
 * Lee CRON_SECRET de .env.local y nunca lo imprime. El secreto solo se manda
 * al sitio en producción o a un servidor local (--sitio http://localhost:3000).
 * La dirección de producción está escrita acá y no se toma de
 * NEXT_PUBLIC_SITE_URL a propósito: esa variable puede apuntar a un dominio
 * que todavía no es nuestro, y el secreto terminaría en manos de otro.
 *
 * Antes de entregar el plan baja cada imagen: Metricool no avisa si no pudo
 * bajarla (publica sin imagen), así que se comprueba acá. Un plan pedido a
 * un servidor local sirve para mirar, no para programar.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** El sitio publicado. Cambiar acá cuando el dominio propio esté funcionando. */
const PRODUCTION = 'https://comparatech-web.vercel.app';
const PIECE_MAX_BYTES = 4 * 1024 * 1024;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readEnvFile() {
  const path = fileURLToPath(new URL('../.env.local', import.meta.url));
  const env = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail('No encuentro .env.local en la raíz del proyecto.');
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

function isLocal(url) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function resolveSite(override) {
  if (!override) return PRODUCTION;
  let url;
  try {
    url = new URL(override);
  } catch {
    fail('--sitio no es una dirección válida.');
  }
  if (!isLocal(url) && url.origin !== PRODUCTION) {
    fail(`--sitio solo acepta un servidor local o ${PRODUCTION}.`);
  }
  return url.origin;
}

async function call(site, secret, path, init = {}) {
  const res = await fetch(`${site}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret}`, ...(init.headers ?? {}) },
    // Sin seguir redirecciones: el secreto va solo a la dirección pedida.
    redirect: 'error',
    signal: AbortSignal.timeout(70_000),
  });
  const text = await res.text();
  if (res.status === 401) {
    fail('El sitio rechazó el secreto (401): el CRON_SECRET de .env.local no es el de ese sitio.');
  }
  if (!res.ok) fail(`El sitio respondió ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

/** Baja la imagen y dice si sirve para publicar. */
async function checkPiece(url) {
  try {
    const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(40_000) });
    if (res.status !== 200) return `respondió ${res.status}`;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (type !== 'image/jpeg') return `no es JPG (${type || 'sin tipo'})`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return 'el contenido no es un JPG';
    if (bytes.length > PIECE_MAX_BYTES) return `pesa demasiado (${bytes.length} bytes)`;
    return null;
  } catch (err) {
    return `no se pudo bajar (${err instanceof Error ? err.message : 'error'})`;
  }
}

async function plan(site, secret, count) {
  const n = count ? `?n=${encodeURIComponent(count)}` : '';
  const data = JSON.parse(await call(site, secret, `/api/social/plan${n}`));

  // Solo se programa con imágenes servidas por el sitio en producción.
  const publishable = site === PRODUCTION && data.sitio === PRODUCTION;
  data.se_puede_programar = publishable;
  if (!publishable) {
    data.aviso =
      site !== PRODUCTION
        ? `Plan solo para mirar: se pidió a ${site}, no a ${PRODUCTION}.`
        : `Plan solo para mirar: las imágenes y los links apuntan a ${data.sitio}, no a ${PRODUCTION}.`;
  }

  for (const item of data.seleccion ?? []) {
    if (!String(item.pieza).startsWith(`${PRODUCTION}/social/pieza/`)) {
      item.pieza_ok = false;
      item.pieza_problema = 'la imagen no está en el sitio en producción';
      continue;
    }
    const problem = await checkPiece(item.pieza);
    item.pieza_ok = problem === null;
    if (problem) item.pieza_problema = problem;
  }
  return data;
}

const args = process.argv.slice(2);
const siteFlag = args.indexOf('--sitio');
const siteOverride = siteFlag >= 0 ? args.splice(siteFlag, 2)[1] : null;
const [command, value] = args;

const env = readEnvFile();
const secret = env.CRON_SECRET;
if (!secret) fail('Falta CRON_SECRET en .env.local.');
const site = resolveSite(siteOverride);

if (command === 'plan') {
  console.log(JSON.stringify(await plan(site, secret, value), null, 2));
} else if (command === 'registrar' && value) {
  let body;
  try {
    body = readFileSync(value, 'utf8');
    JSON.parse(body);
  } catch {
    fail(`No pude leer ${value} como JSON.`);
  }
  console.log(
    await call(site, secret, '/api/social/registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  );
} else {
  fail('Uso: node scripts/redes.mjs plan [cantidad]  |  node scripts/redes.mjs registrar <archivo.json>');
}
