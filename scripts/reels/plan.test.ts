import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolverProducto } from './datos.mjs';
import { noCommands, oneLine, photoUrlProblem, planItemProblem, readPlan, reelInput, uploadUrlProblem } from './plan.mjs';
import { cargarPlantilla, existePlantilla, nombresDePlantillas } from './plantillas/index.mjs';
import { fileName, offerFingerprint, sampleItems } from './pruebas/sitio-de-mentira.mjs';

/**
 * El plan llega por la red y de él salen una descarga, un video público y dos subidas. Aquí se prueba que se
 * lee con desconfianza y que lo que va a la pantalla es lo que el plan dice, ni más ni menos.
 */

const DIR = mkdtempSync(path.join(os.tmpdir(), 'comparatech-plan-test-'));
const PHOTO = path.join(DIR, 'foto.jpg');
writeFileSync(PHOTO, 'aquí solo se mira que el archivo exista');
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const ID = 'bb2d3803-a43b-4aa2-bd82-f73ae7ecb246';
/** El nombre que tenía el archivo antes de llevar huella. */
const OLD_FILE = `2026-10-13/${ID}-219990-estudio`;
/** El de ahora: lo mismo más la huella de la oferta, que calcula el sitio. */
const FILE = `${OLD_FILE}-05758542`;
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
    const other = 'bb540d67-d995-4efd-893d-29d7cef9f4d3';
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${ID}-199990-estudio-05758542` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${ID}-219990-otra-05758542` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${other}-219990-estudio-05758542` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `${ID}-219990-estudio-05758542` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `13-10-2026/${ID}-219990-estudio-05758542` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `2026-10-13/../${ID}-219990-estudio-05758542` }))).toContain('no calza');
    expect(planItemProblem(planItem({ archivo: `${FILE}\n` }))).toContain('no calza');
    // El precio del nombre se compara tal cual: "0219990" no es 219990.
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${ID}-0219990-estudio-05758542` }))).toContain('no calza');
  });

  it('la huella no se calcula aquí, pero tiene que venir y con su forma: 8 signos del 0 al 9 y de la a a la f', () => {
    // Cualquier huella bien formada vale: cuál es la correcta lo sabe solo el sitio.
    for (const good of ['05758542', '00000000', 'ffffffff', 'a1b2c3d4']) {
      expect(planItemProblem(planItem({ archivo: `${OLD_FILE}-${good}` })), good).toBeNull();
    }
    for (const bad of ['0575854', '057585421', '0575854g', '05758542-05758542', '', '05758542/x', '../../otro', ' 05758542', '05758542.mp4']) {
      expect(planItemProblem(planItem({ archivo: `${OLD_FILE}-${bad}` })), JSON.stringify(bad)).toContain('no trae una huella válida');
    }
    // En mayúsculas tampoco: el almacén las distingue, y sería otro archivo.
    expect(planItemProblem(planItem({ archivo: `${OLD_FILE}-ABCDEF12` }))).toContain('no trae una huella válida');
  });

  it('un nombre con la forma anterior, sin huella, se rechaza diciendo que el sitio es de otra versión', () => {
    const problem = planItemProblem(planItem({ archivo: OLD_FILE }));
    expect(problem).toContain('el sitio y el generador no son de la misma versión');
    expect(problem).toContain('sin la huella de la oferta');
    // También cuando el sitio dice que ese video ya existe: con el nombre anterior no lo mostraría nadie.
    expect(planItemProblem(planItem({ archivo: OLD_FILE, ya_existe: true, subir: null }))).toContain('no son de la misma versión');
    // Y aunque el resto del nombre tampoco calce: la forma anterior es lo primero que hay que arreglar.
    expect(planItemProblem(planItem({ archivo: `2026-10-13/${ID}-199990-estudio` }))).toContain('no son de la misma versión');
  });
});

describe('el sitio de mentira', () => {
  it('calcula la huella como dice el contrato con el sitio: 8 signos del SHA-256 de lo que el video dice', () => {
    // Escritas a mano, sacadas con otra herramienta (sha256sum) sobre el texto del contrato:
    // JSON.stringify([nombre_corto, marca, precio_lista, descuento, baja_historial, envio_gratis, full]).
    const [phone, tv, tablet] = sampleItems();
    expect(offerFingerprint(phone)).toBe('05758542'); // ["Moto G86 power 256GB","Motorola",399990,45,null,true,true]
    expect(offerFingerprint(tv)).toBe('571e62bb');
    expect(offerFingerprint(tablet)).toBe('ce5849cd'); // ["Tablet Lenovo Tab 128gb","Lenovo",null,0,12,false,false]
    expect(fileName(phone)).toBe(FILE);
    expect(fileName(tablet, '2026-10-14')).toBe('2026-10-14/c65c6a4c-42c4-42fd-b14f-8b908ca1e2b2-189990-estudio-ce5849cd');
  });

  it('la huella cambia con cada cosa que el video dice, y no con lo que no dice', () => {
    const [phone] = sampleItems();
    const base = offerFingerprint(phone);
    const said = { nombre_corto: 'Moto G86', marca: null, precio_lista: 259990, descuento: 15, baja_historial: 8, envio_gratis: false, full: false };
    for (const [field, value] of Object.entries(said)) {
      expect(offerFingerprint({ ...phone, [field]: value }), field).not.toBe(base);
    }
    // El precio va aparte en el nombre; el motivo, los puntos y la hora de revisión no cambian el archivo.
    expect(offerFingerprint({ ...phone, precio: 1, motivo: 'otro', puntos: 1, precio_revisado: '2026-10-14T00:00:00Z', foto: 'https://http2.mlstatic.com/otra.jpg' })).toBe(base);
    // Sin marca o sin precio de lista, el valor es null (como lo entrega el plan), no un campo que falta.
    expect(offerFingerprint({ ...phone, marca: undefined })).toBe(offerFingerprint({ ...phone, marca: null }));
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

  it('rompe la forma antigua de las órdenes de GitHub Actions ("##[orden]"), que vale en cualquier parte del renglón', () => {
    expect(oneLine('Parlante ##[error]Falla inventada')).toBe('Parlante # #[error]Falla inventada');
    expect(oneLine('Audífonos ##[add-mask]219')).toBe('Audífonos # #[add-mask]219');
    // Con más signos, repetida o pegada a otra: en lo que sale no queda ningún "##[".
    for (const text of ['###[error]x', '####[error]x', '##[##[error]x', '##[error]##[warning]x', '#' + '#[group]x', 'x##[', '##[[error]]']) {
      expect(oneLine(text), text).not.toContain('##[');
    }
    // Lo demás no se toca: un "#" suelto, dos sin corchete o un corchete sin "##" son texto corriente.
    expect(oneLine('Cable #1 [2 m] ## USB-C #[negro]')).toBe('Cable #1 [2 m] ## USB-C #[negro]');
  });

  it('tampoco deja la orden partida con un signo que no se ve', () => {
    // Guion opcional, espacios y uniones de ancho cero, marcas de dirección, selector de variante, BOM.
    for (const code of [0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x202e, 0x2060, 0x2066, 0xfe0f, 0xfeff]) {
      const hidden = String.fromCharCode(code);
      expect(oneLine(`a #${hidden}#[error]x`), code.toString(16)).toBe('a # #[error]x');
      expect(oneLine(`a ##${hidden}[error]x`), code.toString(16)).toBe('a ## [error]x');
      expect(oneLine(`${hidden}::error::x`), code.toString(16)).toBe(': :error::x');
    }
  });

  it('rompe la forma nueva ("::orden::") cuando el texto empieza con ella, que es cuando vale', () => {
    expect(oneLine('::error::Falla inventada')).toBe(': :error::Falla inventada');
    expect(oneLine('  \t::warning file=a.ts::x')).toBe(': :warning file=a.ts::x');
    expect(oneLine('\n::add-mask::219')).toBe(': :add-mask::219');
    expect(oneLine(':::error::x')).toBe(': ::error::x');
    // En medio del renglón no es una orden y se deja como está.
    expect(oneLine('Moto G86 ::error::algo')).toBe('Moto G86 ::error::algo');
    expect(oneLine('C++ std::vector')).toBe('C++ std::vector');
  });
});

describe('noCommands', () => {
  it('revisa cada renglón de un texto de varios', () => {
    expect(noCommands('No conozco la opción ##[error]x.\n::error::y\r\n  ::notice::z\rUso: node generar.mjs')).toBe(
      'No conozco la opción # #[error]x.\n: :error::y\r\n  : :notice::z\rUso: node generar.mjs'
    );
  });

  it('no toca un renglón corriente, tampoco una dirección local con "::"', () => {
    const line = 'Aviso: el plan se pidió a un servidor local (http://[::1]:3000), no al sitio publicado.';
    expect(noCommands(line)).toBe(line);
    expect(noCommands('1/3 Moto G86 power 256GB · $219.990 · plantilla estudio · ya estaba, no se rehace')).toBe('1/3 Moto G86 power 256GB · $219.990 · plantilla estudio · ya estaba, no se rehace');
    expect(noCommands('')).toBe('');
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
