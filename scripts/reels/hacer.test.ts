import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { leerProducto } from './datos.mjs';
import { cargarPlantilla, existePlantilla, nombresDePlantillas } from './plantillas/index.mjs';
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
        // Sin descuento pero con baja del historial, y sin ninguna de las dos (sin gancho).
        { n: 5, nombre: 'Samsung Galaxy A56 5G 256 GB Negro', marca: 'Samsung', precio: 329990, baja_historial: 12, precio_revisado: '2026-09-06T04:30:00Z', envio_gratis: true, full: false, foto_local: 'foto.jpg' },
        { n: 6, nombre: 'Parlante Bluetooth portátil', precio: 29990, foto_local: 'foto.jpg' },
      ],
    })
  );
});

/**
 * Lo que la marca no dice nunca (ni en el video): "recomendado" (se dice "destacado"), que alguien revisó o
 * probó el producto, "verificado" (se dice "precio revisado"), la etiqueta "Publicidad", frases de urgencia o de
 * "el mejor", un precio "antes", "normal" o "de lista" (la cifra tachada la pone el vendedor: se dice "sin
 * descuento"), preguntas que adivinan qué busca la gente y direcciones web (en un reel no se pueden tocar). Se
 * compara sin tildes y sin mayúsculas.
 */
const PROHIBIDAS = [/recomendad/, /mejor precio/, /mas barat/, /imperdible/, /oferton/, /solo hoy/, /ultimas unidades/, /antes \$/, /rebajad/, /ahorra/, /verificad/, /publicidad/, /\bbuscas\b/, /revisamos/, /probamos/, /probad/, /precio normal/, /precio de lista/, /https?:/, /www\./, /\.(cl|com)\b/];
const sinTildes = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const prohibidasEn = (texto: string) => PROHIBIDAS.filter((re) => re.test(sinTildes(texto))).map(String);

describe('plantillas: "bloques"', () => {
  it('está registrada al lado de "estudio" y entrega lo mismo que ella', async () => {
    expect(nombresDePlantillas()).toEqual(['estudio', 'bloques']);
    expect(existePlantilla('bloques')).toBe(true);
    const estudio = await cargarPlantilla('estudio');
    const bloques = await cargarPlantilla('bloques');
    expect(Object.keys(bloques).sort()).toEqual(Object.keys(estudio).sort());
    expect(bloques.FPS).toBe(30);
    expect(bloques.CTA_POR_DEFECTO).toBe('Más ofertas en el perfil');
  });

  it('dura entre 9 y 11 segundos, con o sin gancho, y su portada es la escena del precio completa', async () => {
    const { tiempos, FPS, momentos } = await cargarPlantilla('bloques');
    const withHook = tiempos({ A: {} });
    const withoutHook = tiempos({ A: null });
    expect(Math.round(withHook.fin * FPS)).toBe(288);
    expect(Math.round(withoutHook.fin * FPS)).toBe(281);
    for (const T of [withHook, withoutHook]) {
      expect(T.fin).toBeGreaterThanOrEqual(9);
      expect(T.fin).toBeLessThanOrEqual(11);
      expect(T.portada).toBeGreaterThan(T.notas + 0.4); // ya salió todo lo del precio
      expect(T.portada).toBeLessThan(T.cierre);
      expect(momentos(T)).toHaveLength(8);
      for (const moment of momentos(T)) expect(moment.t).toBeLessThan(T.fin);
    }
  });

  it('las dos plantillas dicen solo lo que trae el dato y nada que la marca no diga', async () => {
    const antes = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error('Sin red'));
    try {
      for (const plantilla of ['estudio', 'bloques']) {
        const P = await cargarPlantilla(plantilla);
        const dicho: Record<number, string[]> = {};
        for (const n of [1, 5, 6]) {
          const escena = await P.preparar(leerProducto(DATA, n), P.CTA_POR_DEFECTO);
          dicho[n] = escena.dicho.map((d: string | { texto: string }) => (typeof d === 'string' ? d : d.texto));
          expect(prohibidasEn(dicho[n].join(' | ')), `${plantilla}, producto ${n}`).toEqual([]);
          expect(dicho[n][0]).toBe('ComparaTech');
          expect(dicho[n]).toContain('Precios en Mercado Libre');
          expect(dicho[n][dicho[n].length - 1]).toBe('Más ofertas en el perfil');
        }
        // Con descuento: "45%" / "de descuento", la cifra tachada con su rótulo "sin descuento" y las dos etiquetas.
        expect(dicho[1].slice(1, 3), plantilla).toEqual(['45%', 'de descuento']);
        expect(dicho[1], plantilla).toEqual(expect.arrayContaining(['$219.990', '−45%', 'sin descuento', '$399.990', 'Envío gratis', 'Full', 'Precio revisado 13/10 09:30']));
        // Con baja del historial: "Bajó 12%" y de dónde sale; sin "Full" porque no viene. Una baja medida con el
        // historial no es un descuento: la palabra no sale.
        expect(dicho[5].slice(1, 3), plantilla).toEqual(['Bajó 12%', 'según nuestro historial']);
        expect(dicho[5]).toContain('Envío gratis');
        expect(dicho[5]).not.toContain('Full');
        expect(dicho[5].join(' | '), plantilla).not.toMatch(/descuento/);
        // Sin ninguna de las dos: no hay gancho ni descuento, ni etiquetas, ni fecha (no viene).
        expect(dicho[6], plantilla).toEqual(['ComparaTech', 'Parlante Bluetooth portátil', '$29.990', 'Precios en Mercado Libre', 'Más ofertas en el perfil']);
      }
    } finally {
      globalThis.fetch = antes;
    }
  }, SLOW);
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
    expect(r.out).toContain('No existe la plantilla "neon". Las que hay: estudio, bloques.');
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
        'En pantalla: "ComparaTech" | "45%" | "de descuento" | "MOTOROLA" | "Moto G86 power 256GB" | "$219.990" | "−45%" | "sin descuento" | "$399.990" (tachado) | "Envío gratis" | "Full" | "Precio revisado 13/10 09:30" | "Precios en Mercado Libre" | "Más ofertas en el perfil"'
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

  it.skipIf(!ffmpeg)(
    'con "bloques" arma un reel de 1080x1920 a 30 cuadros por segundo, de 9 a 11 segundos y 4 MB o menos',
    async () => {
      const salida = path.join(DIR, 'bloques.mp4');
      const portada = path.join(DIR, 'bloques.jpg');
      try {
        const r = hacer(DATA, '1', 'bloques.mp4', '--plantilla', 'bloques', '--portada', 'bloques.jpg');
        expect(r.out).toContain('Producto 1: Moto G86 power 256GB · $219.990');
        const enPantalla = r.out.split('\n').find((linea) => linea.includes('En pantalla:')) ?? '';
        expect(enPantalla).toContain(
          'En pantalla: "ComparaTech" | "45%" | "de descuento" | "MOTOROLA" | "Moto G86 power 256GB" | "$219.990" | "−45%" | "sin descuento" | "$399.990" (tachado) | "Envío gratis" | "Full" | "Precio revisado 13/10 09:30" | "Precios en Mercado Libre" | "Más ofertas en el perfil"'
        );
        expect(prohibidasEn(enPantalla)).toEqual([]);
        expect(r.out).toContain('9,6 s (288 cuadros)');
        expect(r.code).toBe(0);

        // Lo que de verdad quedó en el archivo, según ffmpeg: H.264 yuv420p de 1080x1920 a 30 cuadros por
        // segundo, 288 cuadros (9,6 s) y una pista de audio AAC (en silencio).
        const probe = spawnSync(ffmpeg as string, ['-hide_banner', '-i', salida, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' });
        const info = probe.stderr;
        expect(info).toMatch(/Video: h264 .*yuv420p.*, 1080x1920[ ,].*\b30 fps\b/);
        expect(info).toMatch(/Audio: aac/);
        const duracion = /Duration: (\d+):(\d+):([\d.]+)/.exec(info);
        const segundos = duracion ? Number(duracion[1]) * 3600 + Number(duracion[2]) * 60 + Number(duracion[3]) : NaN;
        expect(segundos).toBeGreaterThanOrEqual(9);
        expect(segundos).toBeLessThanOrEqual(11);
        const cuadros = /frame=\s*(\d+)\s[^\r\n]*$/.exec(info.trimEnd()); // el último conteo que imprime
        expect(Number(cuadros?.[1])).toBe(288);

        const size = statSync(salida).size;
        expect(size).toBeGreaterThan(200_000);
        expect(size).toBeLessThanOrEqual(4 * 1024 * 1024);
        expect(existsSync(`${salida}.parcial`)).toBe(false);
        const meta = await sharp(portada).metadata();
        expect([meta.width, meta.height]).toEqual([1080, 1920]);
      } finally {
        for (const f of [salida, portada]) rmSync(f, { force: true });
      }
    },
    300_000
  );
});
