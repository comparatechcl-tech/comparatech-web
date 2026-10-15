import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fechaChile, leerProducto, numero, precio, resolverProducto, revisarLlamada } from './datos.mjs';

/**
 * Lo que el reel dice en pantalla sale de estos datos. Un número mal leído o una fecha corrida en una hora
 * terminan escritos en un video público, y "Full" o "Envío gratis" de más son una promesa falsa.
 */

const DIR = mkdtempSync(path.join(os.tmpdir(), 'comparatech-datos-test-'));
const PHOTO = path.join(DIR, 'foto.jpg');
writeFileSync(PHOTO, 'no hace falta que sea una imagen: aquí solo se mira que el archivo exista');
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const BASE = { nombre: 'Moto G86 power 256GB', precio: 219990, precio_revisado: '2026-10-13T12:30:11.699+00:00' };
const resolve = (extra: Record<string, unknown>) => resolverProducto({ ...BASE, ...extra }, { foto: PHOTO, quien: 'producto 1' });

describe('numero', () => {
  it('acepta números y textos como los escribe la gente', () => {
    const cases: [unknown, number | null][] = [
      [219990, 219990],
      ['579990', 579990],
      ['579.990', 579990],
      ['$1.299.990', 1299990],
      ['219,990', 219990],
      ['27.5', 27.5],
      ['27,5', 27.5],
      [' 45 % ', 45],
      ['', null],
      ['abc', null],
      ['12abc', null],
      [null, null],
      [undefined, null],
      [NaN, null],
      [Infinity, null],
      [true, null],
    ];
    for (const [value, expected] of cases) expect(numero(value), JSON.stringify(value) ?? String(value)).toBe(expected);
  });
});

describe('precio', () => {
  it('escribe los pesos con puntos de miles', () => {
    expect(precio(990)).toBe('$990');
    expect(precio(219990)).toBe('$219.990');
    expect(precio(1299990)).toBe('$1.299.990');
    expect(precio(12345678)).toBe('$12.345.678');
  });
});

describe('fechaChile', () => {
  it('da la fecha y la hora de Chile, siempre con dos cifras', () => {
    const cases: [string | null, string][] = [
      ['2026-10-13T12:30:11.699+00:00', '13/10 09:30'], // horario de verano (UTC-3)
      ['2026-07-05T03:05:00.000+00:00', '04/07 23:05'], // invierno (UTC-4), cruza la medianoche
      ['2026-11-03T12:05:00.000+00:00', '03/11 09:05'], // día, mes... y hora de un dígito: van con cero
      ['2026-01-01T02:30:00.000+00:00', '31/12 23:30'], // cruza el año
      ['2026-04-05T03:30:00.000+00:00', '04/04 23:30'], // la noche del cambio de hora de abril
      ['2026-09-06T04:30:00.000+00:00', '06/09 01:30'], // después del cambio de hora de septiembre
      ['2026-10-13T09:30:00-03:00', '13/10 09:30'], // con el desfase escrito
      ['2026-10-13T00:05:00-03:00', '13/10 00:05'], // pasada la medianoche es 00, no 24
    ];
    for (const [iso, expected] of cases) {
      const r = fechaChile(iso);
      expect(r && `${r.fecha} ${r.hora}`, String(iso)).toBe(expected);
    }
  });

  it('sin una fecha que se pueda leer no inventa una', () => {
    expect(fechaChile('no es fecha')).toBeNull();
    expect(fechaChile('')).toBeNull();
    expect(fechaChile(null)).toBeNull();
    expect(fechaChile(undefined)).toBeNull();
  });

  it('no depende de la hora del equipo donde corre', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'Asia/Tokyo';
      expect(fechaChile('2026-10-13T12:30:11.699+00:00')).toEqual({ fecha: '13/10', hora: '09:30' });
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe('resolverProducto: Full y Envío gratis', () => {
  it('si vienen los campos de sí o no, mandan ellos y no el texto', () => {
    const said = 'llega con Full y envío gratis';
    expect(resolve({ envio_gratis: false, full: false, motivo: said })).toMatchObject({ envioGratis: false, full: false });
    expect(resolve({ envio_gratis: true, full: true, motivo: 'sin nada que decir' })).toMatchObject({ envioGratis: true, full: true });
    expect(resolve({ envio_gratis: 'si', full: 'no' })).toMatchObject({ envioGratis: true, full: false });
    expect(resolve({ envio_gratis: 0, full: 1 })).toMatchObject({ envioGratis: false, full: true });
  });

  it('sin los campos, solo cuenta lo que el texto dice a secas', () => {
    expect(resolve({ motivo: 'Celular Motorola, llega con Full y envío gratis' })).toMatchObject({ envioGratis: true, full: true });
    expect(resolve({ textos: { instagram: 'Oferta\nEnvío gratis\nLink en la bio' } })).toMatchObject({ envioGratis: true, full: false });
    expect(resolve({ motivo: 'sin datos de despacho' })).toMatchObject({ envioGratis: false, full: false });
  });

  it('"Full HD", "Full Frame" y un envío gratis con condiciones no cuentan', () => {
    expect(resolve({ motivo: 'Televisor con Full HD y envío gratis sobre $30.000' })).toMatchObject({ envioGratis: false, full: false });
    expect(resolve({ motivo: 'Cámara con Full Frame, sin envío gratis' })).toMatchObject({ envioGratis: false, full: false });
    expect(resolve({ motivo: 'envío gratis desde $19.990' })).toMatchObject({ envioGratis: false });
    // El nombre se quita antes de buscar: lo que diga el nombre del producto no es un dato de despacho.
    const name = 'Parlante con Full Bass 40 W';
    expect(resolve({ nombre: name, motivo: `${name}, de tienda oficial` })).toMatchObject({ full: false });
    expect(resolve({ nombre: name, motivo: `${name}, llega con Full` })).toMatchObject({ full: true });
  });
});

describe('resolverProducto: precio, descuento y fecha', () => {
  it('lee los números aunque vengan como texto', () => {
    const r = resolve({ precio: '219.990', precio_lista: '$399.990', descuento: '45', baja_historial: '12,4' });
    expect(r).toMatchObject({ precio: 219990, precioLista: 399990, descuento: 45, bajaHistorial: 12 });
    expect(r.avisos).toEqual([]);
  });

  it('muestra el descuento solo si calza con los dos precios', () => {
    expect(resolve({ precio_lista: 399990, descuento: 45 })).toMatchObject({ precioLista: 399990, descuento: 45 });
    const wrong = resolve({ precio_lista: 399990, descuento: 70 });
    expect(wrong).toMatchObject({ precioLista: null, descuento: null });
    expect(wrong.avisos.join(' ')).toContain('no calza');
    // Un precio_lista más bajo que el precio no es un descuento.
    const lower = resolve({ precio_lista: 199990, descuento: 10 });
    expect(lower).toMatchObject({ precioLista: null, descuento: null });
    expect(lower.avisos).toEqual(['el precio sin descuento (precio_lista) o el descuento del dato no calzan con el precio: no se muestra descuento.']);
    expect(resolve({ precio_lista: null, descuento: 0 })).toMatchObject({ precioLista: null, descuento: null, avisos: [] });
  });

  it('la baja del historial va de 1 a 99 o no va', () => {
    expect(resolve({ baja_historial: 15 })).toMatchObject({ bajaHistorial: 15 });
    expect(resolve({ baja_historial: 0 })).toMatchObject({ bajaHistorial: null });
    expect(resolve({ baja_historial: 100 })).toMatchObject({ bajaHistorial: null });
    expect(resolve({ baja_historial: null })).toMatchObject({ bajaHistorial: null });
  });

  it('la fecha del precio sale del dato, en hora de Chile', () => {
    expect(resolve({}).revisado).toEqual({ fecha: '13/10', hora: '09:30' });
    const undated = resolve({ precio_revisado: null });
    expect(undated.revisado).toBeNull();
    expect(undated.avisos.join(' ')).toContain('precio_revisado');
  });

  it('prefiere el nombre corto y quita lo que la letra no puede dibujar', () => {
    expect(resolve({ nombre_corto: 'Moto G86' }).nombre).toBe('Moto G86');
    expect(resolve({ nombre: 'Termo 🔥 Stanley 中文 1,4 L' }).nombre).toBe('Termo Stanley 1,4 L');
    expect(resolve({ marca: '  Motorola ' }).marca).toBe('Motorola');
    expect(resolve({ marca: null }).marca).toBeNull();
  });

  it('sin precio, sin nombre o sin foto no hay video', () => {
    expect(() => resolve({ precio: 0 })).toThrow('El producto 1 no tiene precio');
    expect(() => resolve({ precio: null })).toThrow('no tiene precio');
    expect(() => resolve({ precio: 219990.5 })).toThrow('no es un número entero de pesos');
    expect(() => resolve({ nombre: '   ' })).toThrow('El producto 1 no tiene nombre');
    expect(() => resolverProducto(BASE, { foto: path.join(DIR, 'no-existe.jpg'), quien: 'producto 1' })).toThrow('Falta la foto del producto 1');
    expect(() => resolverProducto(BASE, { foto: null, quien: 'producto 1' })).toThrow('Falta la foto del producto 1');
  });
});

describe('leerProducto', () => {
  const write = (name: string, content: unknown, bom = false) => {
    const file = path.join(DIR, name);
    writeFileSync(file, `${bom ? String.fromCharCode(0xfeff) : ''}${JSON.stringify(content)}`);
    return file;
  };

  it('busca el producto por su número y la foto al lado del archivo', () => {
    const file = write('productos.json', {
      productos: [
        { n: 1, ...BASE, foto_local: 'foto.jpg' },
        { n: 2, nombre: 'Tablet Lenovo', precio: '189.990', foto_local: 'foto.jpg' },
      ],
    });
    expect(leerProducto(file, 2)).toMatchObject({ numero: 2, nombre: 'Tablet Lenovo', precio: 189990, foto: PHOTO });
    expect(() => leerProducto(file, 3)).toThrow('No existe el producto 3');
  });

  it('acepta una lista suelta y un archivo guardado con BOM', () => {
    const file = write('lista.json', [{ ...BASE, foto_local: 'foto.jpg' }], true);
    expect(leerProducto(file, 1)).toMatchObject({ numero: 1, precio: 219990 });
  });

  it('dice qué falta', () => {
    const file = write('sin-foto.json', [{ ...BASE }, { ...BASE, precio: 0 }]);
    expect(() => leerProducto(file, 1)).toThrow('Falta la foto del producto 1 (no trae foto_local)');
    // Sin precio y sin foto, el error que se muestra es el del precio.
    expect(() => leerProducto(file, 2)).toThrow('El producto 2 no tiene precio');
    expect(() => leerProducto(path.join(DIR, 'nada.json'), 1)).toThrow('No encuentro el archivo de productos');
  });
});

describe('revisarLlamada', () => {
  it('deja pasar una llamada normal', () => {
    expect(() => revisarLlamada('Más ofertas en el perfil')).not.toThrow();
    expect(() => revisarLlamada('Síguenos para ver las ofertas de cada día')).not.toThrow();
  });

  it('no acepta direcciones web ni frases que la marca no usa', () => {
    expect(() => revisarLlamada('Entra a comparatech.cl')).toThrow('dirección web');
    expect(() => revisarLlamada('Mira https://ejemplo.test')).toThrow('dirección web');
    for (const banned of ['Solo hoy', 'El mejor precio', 'Imperdible', 'Últimas unidades', 'Antes $399.990', 'Recomendado', 'Ahorra ya', 'Precio normal $399.990', 'Bajo el precio de lista']) {
      expect(() => revisarLlamada(banned), banned).toThrow('no puede decir');
    }
  });
});
