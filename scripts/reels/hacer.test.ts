import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buscarFfmpeg } from './video.mjs';

/**
 * El comando para armar un video a mano. Quien lo corre mira el código de salida: con código 1 no tiene que
 * quedar ningún video, ni entero ni a medias.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = mkdtempSync(path.join(os.tmpdir(), 'comparatech-hacer-test-'));
const DATA = path.join(DIR, 'productos.json');
// Cada caso lanza el comando varias veces, y en un equipo ocupado cada arranque puede pasar del segundo.
const SLOW = 60_000;
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

beforeAll(async () => {
  // Una foto de producto inventada: un rectángulo oscuro sobre blanco, como las de Mercado Libre.
  const product = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="420" height="640"><rect width="420" height="640" rx="48" fill="#1f2a44"/><rect x="40" y="60" width="340" height="460" rx="12" fill="#3b82f6"/></svg>');
  await sharp({ create: { width: 900, height: 900, channels: 3, background: '#ffffff' } })
    .composite([{ input: product, left: 240, top: 130 }])
    .jpeg({ quality: 90 })
    .toFile(path.join(DIR, 'foto.jpg'));
  writeFileSync(path.join(DIR, 'rota.jpg'), 'esto no es una imagen');
  const base = { nombre: 'Moto G86 power 256GB', marca: 'Motorola', precio: 219990, precio_lista: 399990, descuento: 45, precio_revisado: '2026-10-13T12:30:11.699+00:00', envio_gratis: true, full: true };
  writeFileSync(
    DATA,
    JSON.stringify({
      productos: [
        { n: 1, ...base, foto_local: 'foto.jpg' },
        { n: 2, ...base, foto_local: 'no-existe.jpg' },
        { n: 3, ...base, foto_local: 'rota.jpg' },
        { n: 4, ...base, precio: 0, foto_local: 'foto.jpg' },
      ],
    })
  );
});

function hacer(...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/reels/hacer.mjs'), ...args], { cwd: DIR, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Lo que quedó en la carpeta aparte de los datos de la prueba. */
const leftovers = () => readdirSync(DIR).filter((name) => !['productos.json', 'foto.jpg', 'rota.jpg'].includes(name));

describe('hacer.mjs: cuando no se puede armar', () => {
  it('sin la foto, con una foto que no se puede leer o sin precio termina con código 1 y no deja nada', () => {
    const missing = hacer(DATA, '2', 'salida.mp4', '--portada', 'portada.jpg');
    expect(missing).toMatchObject({ code: 1 });
    expect(missing.out).toContain('No se pudo armar el video: Falta la foto del producto 2');

    expect(hacer(DATA, '3', 'salida.mp4', '--portada', 'portada.jpg').code).toBe(1);

    const unpriced = hacer(DATA, '4', 'salida.mp4');
    expect(unpriced.code).toBe(1);
    expect(unpriced.out).toContain('El producto 4 no tiene precio');

    expect(hacer(DATA, '9', 'salida.mp4').out).toContain('No existe el producto 9');
    expect(leftovers()).toEqual([]);
  }, SLOW);

  it('una opción que no conoce, o datos de menos, es un error y muestra cómo se usa', () => {
    for (const args of [[DATA, '1', 'salida.mp4', '--rapido'], [DATA, '1'], [DATA, 'uno', 'salida.mp4'], [DATA, '1', 'salida.mov'], [DATA, '1', 'salida.mp4', '--volumen', '0.5']]) {
      const r = hacer(...args);
      expect(r.code, args.slice(1).join(' ')).toBe(1);
      expect(r.out, args.slice(1).join(' ')).toContain('No se pudo armar el video:');
    }
    expect(hacer(DATA, '1', 'salida.mp4', '--rapido').out).toContain('Uso: node scripts/reels/hacer.mjs');
    expect(leftovers()).toEqual([]);
  }, SLOW);

  it('una plantilla que no existe se dice antes de armar nada', () => {
    const r = hacer(DATA, '1', 'salida.mp4', '--plantilla', 'neon');
    expect(r.code).toBe(1);
    expect(r.out).toContain('No existe la plantilla "neon". Las que hay: estudio');
    expect(leftovers()).toEqual([]);
  }, SLOW);

  it('la llamada del cierre no acepta frases que la marca no usa', () => {
    const r = hacer(DATA, '1', 'salida.mp4', '--cta', 'Solo hoy: el mejor precio');
    expect(r.code).toBe(1);
    expect(r.out).toContain('La llamada del cierre no puede decir');
    expect(leftovers()).toEqual([]);
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
if (!ffmpeg) console.warn('ffmpeg no está instalado: se salta la prueba que arma un video de verdad (scripts/reels/hacer.test.ts).');

describe('hacer.mjs: un video de verdad, con ffmpeg', () => {
  it.skipIf(!ffmpeg)(
    'arma el video y su portada, y dice todo lo que va a salir escrito',
    () => {
      const r = hacer(DATA, '1', 'salida.mp4', '--plantilla', 'estudio', '--portada', 'portada.jpg');
      expect(r.out).toContain('Producto 1: Moto G86 power 256GB · $219.990');
      expect(r.out).toContain(
        'En pantalla: "ComparaTech" | "45%" | "por debajo del precio de lista" | "MOTOROLA" | "Moto G86 power 256GB" | "$219.990" | "−45%" | "precio de lista" | "$399.990" (tachado) | "Envío gratis" | "Full" | "Precio revisado 13/10 09:30" | "Precios en Mercado Libre" | "Más ofertas en el perfil"'
      );
      expect(r.out).toContain('10,2 s (305 cuadros)');
      expect(r.code).toBe(0);
      expect(leftovers().sort()).toEqual(['portada.jpg', 'salida.mp4']);
      const size = statSync(path.join(DIR, 'salida.mp4')).size;
      expect(size).toBeGreaterThan(200_000);
      expect(size).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(existsSync(path.join(DIR, 'salida.mp4.parcial'))).toBe(false);
    },
    300_000
  );
});
