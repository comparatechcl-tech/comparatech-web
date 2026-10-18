import { describe, expect, it } from 'vitest';
import {
  CAROUSEL_MAX_ITEMS,
  addDays,
  carouselExpiry,
  carouselKey,
  carouselPath,
  carouselRangeLabel,
  checkCarouselPath,
  chileDay,
  dayRangeLabel,
  isCarouselDay,
  type CarouselItem,
  type CarouselSet,
  type CarouselSlide,
} from '@/lib/social/carousel-url';
import { pieceKey } from '@/lib/social/piece-url';

/**
 * Las láminas del carrusel se sirven en direcciones públicas: lo único que
 * impide dibujar una "baja" inventada con la marca del sitio es la firma.
 */

const ENV = { CRON_SECRET: 'un-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv;
const KEY = carouselKey(ENV)!;
const NOW = 1_800_000_000;

const IDS = [
  '3f2b6c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];
const SET: CarouselSet = { kind: 'bajas', day: 20261018, ids: IDS, expiresAt: NOW + 3600 };
const ITEM: CarouselItem = {
  rank: 2,
  price: 99_990,
  dropAmount: 30_000,
  dropSince: NOW - 86_400 * 3,
  checkedAt: NOW - 600,
  freeShipping: true,
  full: false,
};
const PRODUCT: CarouselSlide = { type: 'producto', set: SET, item: ITEM };

function split(path: string): { ids: string; file: string } {
  const [, , , ids, file] = path.split('/');
  return { ids, file };
}

describe('carouselKey', () => {
  it('sin CRON_SECRET, o con uno corto, no hay clave', () => {
    expect(carouselKey({} as NodeJS.ProcessEnv)).toBeNull();
    expect(carouselKey({ CRON_SECRET: 'x'.repeat(31) } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(carouselKey({ CRON_SECRET: 'x'.repeat(32) } as unknown as NodeJS.ProcessEnv)).not.toBeNull();
  });

  it('no es la clave de las piezas: una firma de un lado no sirve en el otro', () => {
    expect(KEY.equals(pieceKey(ENV)!)).toBe(false);
  });
});

describe('carouselPath / checkCarouselPath', () => {
  it('las tres láminas se leen igual que se escribieron', () => {
    for (const slide of [{ type: 'portada', set: SET }, PRODUCT, { type: 'cierre', set: SET }] as CarouselSlide[]) {
      const path = carouselPath(slide, KEY)!;
      expect(path.startsWith(`/social/carrusel/${IDS.join('.')}/`)).toBe(true);
      const { ids, file } = split(path);
      expect(checkCarouselPath(ids, file, KEY, NOW)).toEqual({ ok: true, slide });
    }
  });

  it('la lámina de un producto lleva su puesto, el precio, la baja, la fecha, la hora y el envío', () => {
    const { file } = split(carouselPath(PRODUCT, KEY)!);
    expect(file).toMatch(new RegExp(`^2-bajas-20261018-99990-30000-${ITEM.dropSince}-${ITEM.checkedAt}-1-${SET.expiresAt}-[0-9a-f]{32}\\.jpg$`));
  });

  it('cambiar cualquier dato invalida la firma', () => {
    const { ids, file } = split(carouselPath(PRODUCT, KEY)!);
    const parts = file.split('-');
    // Cada número del archivo, cambiado por otro válido: puesto, día, precio, baja, fecha, hora, envío y vencimiento.
    for (const [i, value] of [[0, '1'], [2, '20261017'], [3, '9990'], [4, '300000'], [5, '1'], [6, '1'], [7, '3'], [8, '1900000000']] as const) {
      const changed = [...parts];
      changed[i] = value;
      expect(checkCarouselPath(ids, changed.join('-'), KEY, NOW), `campo ${i}`).toEqual({ ok: false, reason: 'firma' });
    }
    // Otra lista de productos, el mismo archivo.
    const other = [IDS[1], IDS[0], IDS[2]].join('.');
    expect(checkCarouselPath(other, file, KEY, NOW)).toEqual({ ok: false, reason: 'firma' });
    // La portada no se puede hacer pasar por el cierre.
    const cover = split(carouselPath({ type: 'portada', set: SET }, KEY)!).file;
    expect(checkCarouselPath(ids, cover.replace(/^portada/, 'cierre'), KEY, NOW)).toEqual({ ok: false, reason: 'firma' });
  });

  it('otra clave no sirve', () => {
    const otherKey = carouselKey({ CRON_SECRET: 'otro-secreto-de-prueba-de-mas-de-32-caracteres' } as unknown as NodeJS.ProcessEnv)!;
    const { ids, file } = split(carouselPath(PRODUCT, KEY)!);
    expect(checkCarouselPath(ids, file, otherKey, NOW)).toEqual({ ok: false, reason: 'firma' });
  });

  it('vencida no sirve, aunque la firma sea buena', () => {
    const { ids, file } = split(carouselPath(PRODUCT, KEY)!);
    expect(checkCarouselPath(ids, file, KEY, SET.expiresAt + 1)).toEqual({ ok: false, reason: 'vencida' });
    expect(checkCarouselPath(ids, file, KEY, SET.expiresAt).ok).toBe(true);
  });

  it('cada lámina tiene una sola forma de escribirse', () => {
    const { ids, file } = split(carouselPath(PRODUCT, KEY)!);
    expect(checkCarouselPath(ids.toUpperCase(), file, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
    expect(checkCarouselPath(ids, file.replace('-99990-', '-099990-'), KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
    expect(checkCarouselPath(ids, file.replace('.jpg', '.png'), KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
    expect(checkCarouselPath(`${ids}.`, file, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
    // Ids en mayúsculas al firmar: se escriben en minúsculas.
    const upper = carouselPath({ ...PRODUCT, set: { ...SET, ids: IDS.map((id) => id.toUpperCase()) } }, KEY)!;
    expect(upper).toBe(carouselPath(PRODUCT, KEY));
  });

  it('no firma datos que no sirven', () => {
    const bad: CarouselSlide[] = [
      { ...PRODUCT, item: { ...ITEM, price: 0 } },
      { ...PRODUCT, item: { ...ITEM, rank: 0 } },
      { ...PRODUCT, item: { ...ITEM, rank: IDS.length + 1 } },
      // Un carrusel de bajas sin baja, o sin la fecha de la baja.
      { ...PRODUCT, item: { ...ITEM, dropAmount: 0 } },
      { ...PRODUCT, item: { ...ITEM, dropSince: 0 } },
      { ...PRODUCT, item: { ...ITEM, price: 1.5 } },
      { type: 'portada', set: { ...SET, day: 20261332 } },
      { type: 'portada', set: { ...SET, ids: [] } },
      { type: 'portada', set: { ...SET, ids: [IDS[0], IDS[0]] } },
      { type: 'portada', set: { ...SET, ids: ['no-es-un-id'] } },
      {
        type: 'portada',
        set: { ...SET, ids: Array.from({ length: CAROUSEL_MAX_ITEMS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) },
      },
      { type: 'portada', set: { ...SET, kind: 'otro' as 'bajas' } },
    ];
    for (const slide of bad) expect(carouselPath(slide, KEY), JSON.stringify(slide)).toBeNull();
  });

  it('un archivo con la forma pero datos imposibles no se acepta', () => {
    const ids = IDS.join('.');
    // Puesto 5 en un carrusel de 3.
    expect(checkCarouselPath(ids, `5-bajas-20261018-99990-30000-1-1-0-${NOW}-${'a'.repeat(32)}.jpg`, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
    // Un día que existe llega hasta la firma; uno que no existe (30 de febrero) ni siquiera.
    expect(checkCarouselPath(ids, `portada-bajas-20261231-${NOW}-${'a'.repeat(32)}.jpg`, KEY, NOW)).toEqual({ ok: false, reason: 'firma' });
    expect(checkCarouselPath(ids, `portada-bajas-20260230-${NOW}-${'a'.repeat(32)}.jpg`, KEY, NOW)).toEqual({ ok: false, reason: 'formato' });
  });
});

describe('las fechas del carrusel', () => {
  it('el día en Chile, también a la medianoche de verano (UTC-3)', () => {
    expect(chileDay(new Date('2026-10-18T02:59:00Z'))).toBe(20261017);
    expect(chileDay(new Date('2026-10-18T03:00:00Z'))).toBe(20261018);
    expect(chileDay(Date.parse('2026-12-31T20:00:00Z'))).toBe(20261231);
  });

  it('suma y resta días cruzando meses y años', () => {
    expect(addDays(20261018, -6)).toBe(20261012);
    expect(addDays(20261103, -6)).toBe(20261028);
    expect(addDays(20270102, -6)).toBe(20261227);
    expect(addDays(20261231, 1)).toBe(20270101);
  });

  it('dice la semana en palabras', () => {
    expect(dayRangeLabel(20261012, 20261018)).toBe('del 12 al 18 de octubre');
    expect(dayRangeLabel(20261028, 20261103)).toBe('del 28 de octubre al 3 de noviembre');
    expect(dayRangeLabel(20261227, 20270102)).toBe('del 27 de diciembre al 2 de enero');
    expect(carouselRangeLabel('bajas', 20261018)).toBe('del 12 al 18 de octubre');
  });

  it('reconoce los días que existen', () => {
    expect(isCarouselDay(20261018)).toBe(true);
    expect(isCarouselDay(20280229)).toBe(true);
    expect(isCarouselDay(20270229)).toBe(false);
    expect(isCarouselDay(20261300)).toBe(false);
    expect(isCarouselDay(2026101)).toBe(false);
  });

  it('las direcciones de un mismo día vencen igual: el mismo carrusel da las mismas direcciones', () => {
    const morning = carouselExpiry(new Date('2026-10-18T12:00:00Z'));
    expect(carouselExpiry(new Date('2026-10-18T23:59:00Z'))).toBe(morning);
    expect(morning).toBe(Date.parse('2026-10-19T00:00:00Z') / 1000 + 14 * 86_400);
  });
});
