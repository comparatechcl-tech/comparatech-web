import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolverProducto } from './datos.mjs';
import { oneLine, photoUrlProblem, planItemProblem, readPlan, reelInput, uploadUrlProblem } from './plan.mjs';
import { cargarPlantilla, existePlantilla, nombresDePlantillas } from './plantillas/index.mjs';
import { sampleItems } from './pruebas/sitio-de-mentira.mjs';

/**
 * El plan llega por la red y de él salen una descarga, un video público y dos subidas. Aquí se prueba que se
 * lee con desconfianza y que lo que va a la pantalla es lo que el plan dice, ni más ni menos.
 */

const DIR = mkdtempSync(path.join(os.tmpdir(), 'comparatech-plan-test-'));
const PHOTO = path.join(DIR, 'foto.jpg');
writeFileSync(PHOTO, 'aquí solo se mira que el archivo exista');
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const ID = 'bb2d3803-a43b-4aa2-bd82-f73ae7ecb246';
const FILE = `2026-10-13/${ID}-219990-estudio`;
const STORAGE = 'https://abcdefgh.supabase.co/storage/v1/object/upload/sign/reels';

/** Un elemento del plan como lo entrega el sitio para un video que falta. */
function planItem(extra: Record<string, unknown> = {}) {
  return {
    ...sampleItems()[0],
    archivo: FILE,
    ya_existe: false,
    subir: { video: `${STORAGE}/${FILE}.mp4?token=abc`, portada: `${STORAGE}/${FILE}.jpg?token=def` },
    ...extra,
  };
}

describe('readPlan', () => {
  it('lee una respuesta con la forma acordada', () => {
    const plan = readPlan({ ok: true, fecha: '2026-10-13', historial_sin_leer: 2, borrados: 8, seleccion: [planItem()] });
    expect(plan).toMatchObject({ date: '2026-10-13', unreadHistory: 2, deleted: 8 });
    expect(plan.items).toHaveLength(1);
  });

  it('una selección vacía es un plan válido: hoy no hay nada que armar', () => {
    expect(readPlan({ ok: true, seleccion: [] })).toEqual({ date: null, items: [], unreadHistory: 0, deleted: 0 });
  });

  it('rechaza lo que no es un plan', () => {
    for (const bad of [null, 'ok', [], {}, { ok: true }, { ok: false, seleccion: [] }, { ok: true, seleccion: 'nada' }, { error: 'Unauthorized' }]) {
      expect(() => readPlan(bad), JSON.stringify(bad)).toThrow('no respondió un plan');
    }
  });
});

describe('planItemProblem', () => {
  it('acepta un elemento completo, falte o no su video', () => {
    expect(planItemProblem(planItem())).toBeNull();
    expect(planItemProblem(planItem({ ya_existe: true, subir: null }))).toBeNull();
  });

  it('dice qué le falta a uno incompleto', () => {
    expect(planItemProblem(null)).toContain('vacío');
    expect(planItemProblem(planItem({ id: '../../otro' }))).toContain('id de producto');
    expect(planItemProblem(planItem({ precio: '219990' }))).toContain('precio');
    expect(planItemProblem(planItem({ precio: 0 }))).toContain('precio');
    expect(planItemProblem(planItem({ plantilla: 'Estudio 2' }))).toContain('plantilla');
    expect(planItemProblem(planItem({ plantilla: '../estudio' }))).toContain('plantilla');
    expect(planItemProblem(planItem({ archivo: undefined }))).toContain('nombre del archivo');
    expect(planItemProblem(planItem({ ya_existe: 'no' }))).toContain('ya existe');
  });

  it('el nombre del archivo tiene que ser el de ese producto, a ese precio y con esa plantilla', () => {
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${ID}-199990-estudio` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${ID}-219990-otra` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `${ID}-219990-estudio` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `13-10-2026/${ID}-219990-estudio` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `2026-10-13/../${ID}-219990-estudio` }))).toContain('no calza');
  });
});

describe('photoUrlProblem', () => {
  it('acepta las fotos de Mercado Libre por https', () => {
    expect(photoUrlProblem('https://http2.mlstatic.com/D_NQ_NP_814687-MLA106501833995_022026-F.jpg')).toBeNull();
    expect(photoUrlProblem('https://HTTP2.MLSTATIC.COM/foto.webp')).toBeNull();
    expect(photoUrlProblem('https://mlstatic.com/foto.jpg')).toBeNull();
  });

  it('no baja nada de otra parte', () => {
    const bad = [
      'http://http2.mlstatic.com/foto.jpg',
      'https://evil.example/foto.jpg',
      'https://evilmlstatic.com/foto.jpg',
      'https://http2.mlstatic.com.evil.example/foto.jpg',
      'https://http2.mlstatic.com@evil.example/foto.jpg',
      'https://usuario:clave@http2.mlstatic.com/foto.jpg',
      'https://http2.mlstatic.com:8443/foto.jpg',
      'https://127.0.0.1/foto.jpg',
      'file:///etc/passwd',
      'data:image/jpeg;base64,AAAA',
      '/foto.jpg',
      '',
      null,
      undefined,
    ];
    for (const url of bad) expect(photoUrlProblem(url), String(url)).not.toBeNull();
  });
});

describe('uploadUrlProblem', () => {
  const good = `${STORAGE}/${FILE}.mp4?token=abc`;

  it('acepta la dirección firmada de ese mismo archivo', () => {
    expect(uploadUrlProblem(good, `${FILE}.mp4`)).toBeNull();
  });

  it('no sube a una dirección que no sea la de ese archivo', () => {
    expect(uploadUrlProblem(good, `${FILE}.jpg`)).toContain('no es la de este archivo');
    expect(uploadUrlProblem(`${STORAGE}/2026-10-13/otro.mp4?token=abc`, `${FILE}.mp4`)).toContain('no es la de este archivo');
    expect(uploadUrlProblem(`https://abcdefgh.supabase.co/storage/v1/object/upload/sign/otro/${FILE}.mp4?token=abc`, `${FILE}.mp4`)).toContain('no es la de este archivo');
    expect(uploadUrlProblem(`${STORAGE}/${FILE}.mp4`, `${FILE}.mp4`)).toContain('firma');
    expect(uploadUrlProblem(`${STORAGE}/${FILE}.mp4?token=`, `${FILE}.mp4`)).toContain('firma');
    expect(uploadUrlProblem(null, `${FILE}.mp4`)).toContain('no trae una dirección');
    expect(uploadUrlProblem(undefined, `${FILE}.mp4`)).toContain('no trae una dirección');
  });

  it('sin https solo vale un servidor local, y solo cuando el plan también se pidió a uno', () => {
    const local = `http://127.0.0.1:4010/storage/v1/object/upload/sign/reels/${FILE}.mp4?token=abc`;
    expect(uploadUrlProblem(local, `${FILE}.mp4`)).toContain('https');
    expect(uploadUrlProblem(local, `${FILE}.mp4`, { allowLocal: true })).toBeNull();
    expect(uploadUrlProblem(good.replace('https:', 'http:'), `${FILE}.mp4`, { allowLocal: true })).toContain('https');
  });
});

describe('reelInput', () => {
  it('arma la entrada del reel con los datos del plan', () => {
    const input = reelInput(planItem());
    expect(input).toEqual({
      id: ID,
      nombre: 'Moto G86 power 256GB 256 GB verde 8 GB RAM',
      nombre_corto: 'Moto G86 power 256GB',
      marca: 'Motorola',
      precio: 219990,
      precio_lista: 399990,
      descuento: 45,
      baja_historial: null,
      precio_revisado: '2026-10-13T12:30:11.699+00:00',
      envio_gratis: true,
      full: true,
    });
    expect(resolverProducto(input, { foto: PHOTO })).toEqual({
      nombre: 'Moto G86 power 256GB',
      marca: 'Motorola',
      precio: 219990,
      precioLista: 399990,
      descuento: 45,
      bajaHistorial: null,
      revisado: { fecha: '13/10', hora: '09:30' },
      envioGratis: true,
      full: true,
      foto: PHOTO,
      avisos: [],
    });
  });

  it('un producto sin precio de lista sale con su baja del historial y sin descuento', () => {
    const product = resolverProducto(reelInput(planItem({ ...sampleItems()[2] })), { foto: PHOTO });
    expect(product).toMatchObject({ precioLista: null, descuento: null, bajaHistorial: 12, envioGratis: false, full: false, avisos: [] });
  });

  it('"Full" y "Envío gratis" salen solo de sus campos, nunca de una frase', () => {
    const said = { motivo: 'Llega con Full y envío gratis', textos: { instagram: 'Envío gratis' } };
    const quiet = resolverProducto(reelInput(planItem({ ...said, envio_gratis: false, full: false })), { foto: PHOTO });
    expect(quiet).toMatchObject({ envioGratis: false, full: false });
    // Si el campo no viene, o viene como texto, tampoco se da por cierto.
    const missing = resolverProducto(reelInput(planItem({ ...said, envio_gratis: undefined, full: 'true' })), { foto: PHOTO });
    expect(missing).toMatchObject({ envioGratis: false, full: false });
    expect(reelInput(planItem(said))).not.toHaveProperty('motivo');
    expect(reelInput(planItem(said))).not.toHaveProperty('textos');
  });
});

describe('oneLine', () => {
  it('deja el texto en un renglón, para que nada ajeno empiece una línea de lo que se imprime', () => {
    expect(oneLine('Moto G86\n::error::algo\r\n\tmás')).toBe('Moto G86 ::error::algo más');
    expect(oneLine(`uno${String.fromCharCode(0x2028)}dos${String.fromCharCode(0x1b)}[31mtres`)).toBe('uno dos [31mtres');
    expect(oneLine(null)).toBe('');
  });

  it('corta lo que es demasiado largo', () => {
    const cut = oneLine('a'.repeat(200), 20);
    expect(cut).toHaveLength(20);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('plantillas', () => {
  it('hoy existe "estudio" y es la que se usa si no se pide otra', () => {
    expect(nombresDePlantillas()).toContain('estudio');
    expect(existePlantilla('estudio')).toBe(true);
  });

  it('un nombre que no es de una plantilla no carga nada', async () => {
    for (const name of ['Estudio', 'estudio/', '../estudio', 'constructor', 'toString', '__proto__', '', null, undefined, 7]) {
      expect(existePlantilla(name), String(name)).toBe(false);
    }
    await expect(cargarPlantilla('constructor')).rejects.toThrow('No existe la plantilla "constructor". Las que hay: estudio');
  });

  it('cada plantilla entrega lo que el armador necesita', async () => {
    for (const name of nombresDePlantillas()) {
      // El nombre va en el nombre del archivo que se sube: solo letras minúsculas y números.
      expect(name).toMatch(/^[a-z0-9]+$/);
      const template = await cargarPlantilla(name);
      expect(template.FPS, name).toBeGreaterThan(0);
      expect(typeof template.CTA_POR_DEFECTO, name).toBe('string');
      for (const fn of ['preparar', 'tiempos', 'momentos', 'pintor', 'describir'] as const) {
        expect(typeof template[fn], `${name}.${fn}`).toBe('function');
      }
    }
  });

  it('"estudio" dura unos 10 segundos, con o sin gancho', async () => {
    const { tiempos, FPS, momentos } = await cargarPlantilla('estudio');
    const withHook = tiempos({ A: {} });
    const withoutHook = tiempos({ A: null });
    expect(Math.round(withHook.fin * FPS)).toBe(305);
    expect(Math.round(withoutHook.fin * FPS)).toBe(293);
    // La portada es un cuadro del propio video, con el precio ya completo.
    for (const T of [withHook, withoutHook]) {
      expect(T.portada).toBeGreaterThan(T.golpe);
      expect(T.portada).toBeLessThan(T.cierre);
      expect(momentos(T)).toHaveLength(8);
      for (const moment of momentos(T)) expect(moment.t).toBeLessThan(T.fin);
    }
  });
});
