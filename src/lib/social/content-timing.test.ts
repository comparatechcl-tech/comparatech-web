import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Cuándo hay contenido nuevo en /admin/historias y /admin/videos
 * (lib/social/content-timing): la próxima revisión de precios, la próxima
 * pasada de los videos y la hora de Chile con sus cambios de hora. Y que el
 * horario de las pasadas sea el mismo que el de .github/workflows/reels.yml.
 */

import { PRICE_REFRESH_MINUTES, REEL_PASSES_UTC, chileTime, nextPriceRefresh, nextReelPass } from '@/lib/social/content-timing';

const at = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

describe('nextPriceRefresh: la próxima revisión de precios (pg_cron a las :00 y :30)', () => {
  it('cada 30 minutos', () => {
    expect(PRICE_REFRESH_MINUTES).toBe(30);
  });

  it('la siguiente media hora en punto, nunca la de este mismo instante', () => {
    expect(iso(nextPriceRefresh(at('2026-10-17T13:10:00.000Z')))).toBe('2026-10-17T13:30:00.000Z');
    expect(iso(nextPriceRefresh(at('2026-10-17T13:29:59.999Z')))).toBe('2026-10-17T13:30:00.000Z');
    // En punto ya corrió (o está corriendo): la próxima es la siguiente.
    expect(iso(nextPriceRefresh(at('2026-10-17T13:30:00.000Z')))).toBe('2026-10-17T14:00:00.000Z');
    expect(iso(nextPriceRefresh(at('2026-10-17T13:00:00.001Z')))).toBe('2026-10-17T13:30:00.000Z');
  });

  it('cruza la medianoche, el fin de mes y el fin de año', () => {
    expect(iso(nextPriceRefresh(at('2026-10-17T23:45:00.000Z')))).toBe('2026-10-18T00:00:00.000Z');
    expect(iso(nextPriceRefresh(at('2026-10-31T23:59:59.000Z')))).toBe('2026-11-01T00:00:00.000Z');
    expect(iso(nextPriceRefresh(at('2026-12-31T23:30:00.000Z')))).toBe('2027-01-01T00:00:00.000Z');
  });

  it('en hora de Chile caen también a las :00 y :30, con o sin horario de verano', () => {
    // Verano (UTC-3): 10:10 de Chile → la de las 10:30.
    expect(chileTime(nextPriceRefresh(at('2026-10-17T13:10:00Z')))).toBe('10:30');
    // Invierno (UTC-4): 11:45 de Chile → la de las 12:00.
    expect(chileTime(nextPriceRefresh(at('2026-06-17T15:45:00Z')))).toBe('12:00');
  });
});

describe('chileTime: la hora de Chile, con el cambio de hora que corresponda', () => {
  it('verano (UTC-3) e invierno (UTC-4)', () => {
    expect(chileTime(at('2026-10-17T10:10:00Z'))).toBe('07:10');
    expect(chileTime(at('2026-01-15T22:10:00Z'))).toBe('19:10');
    expect(chileTime(at('2026-06-17T10:10:00Z'))).toBe('06:10');
    expect(chileTime(at('2026-08-01T01:10:00Z'))).toBe('21:10');
  });

  it('el fin del horario de verano 2026: la noche del sábado 4 de abril, de 24:00 vuelve a 23:00', () => {
    expect(chileTime(at('2026-04-05T02:59:00Z'))).toBe('23:59');
    expect(chileTime(at('2026-04-05T03:00:00Z'))).toBe('23:00');
    expect(chileTime(at('2026-04-05T03:59:00Z'))).toBe('23:59');
    expect(chileTime(at('2026-04-05T04:00:00Z'))).toBe('00:00');
  });

  it('el inicio del horario de verano 2026: la noche del sábado 5 de septiembre, de 24:00 salta a 01:00', () => {
    expect(chileTime(at('2026-09-06T03:59:00Z'))).toBe('23:59');
    expect(chileTime(at('2026-09-06T04:00:00Z'))).toBe('01:00');
  });

  it('la medianoche se escribe 00:00, nunca 24:00', () => {
    expect(chileTime(at('2026-10-17T03:00:00Z'))).toBe('00:00');
    expect(chileTime(at('2026-06-17T04:00:00Z'))).toBe('00:00');
  });

  it('una fecha que no sirve da vacío', () => {
    expect(chileTime(new Date(Number.NaN))).toBe('');
    expect(chileTime('2026-10-17T10:00:00Z' as unknown as Date)).toBe('');
    expect(chileTime(null as unknown as Date)).toBe('');
  });
});

describe('nextReelPass: la próxima pasada de los videos', () => {
  it('seis pasadas al día, en orden y en minuto 10 (no en punto, cuando GitHub más atrasa)', () => {
    expect([...REEL_PASSES_UTC]).toEqual(['01:10', '10:10', '13:10', '16:10', '19:10', '22:10']);
    expect([...REEL_PASSES_UTC].sort()).toEqual([...REEL_PASSES_UTC]);
  });

  it('la siguiente del día; justo a la hora de una, la que sigue', () => {
    expect(iso(nextReelPass(at('2026-10-17T00:00:00.000Z')))).toBe('2026-10-17T01:10:00.000Z');
    expect(iso(nextReelPass(at('2026-10-17T10:09:59.999Z')))).toBe('2026-10-17T10:10:00.000Z');
    expect(iso(nextReelPass(at('2026-10-17T10:10:00.000Z')))).toBe('2026-10-17T13:10:00.000Z');
    expect(iso(nextReelPass(at('2026-10-17T19:10:00.001Z')))).toBe('2026-10-17T22:10:00.000Z');
  });

  it('después de la última del día, la primera del día siguiente, también a fin de mes y de año', () => {
    expect(iso(nextReelPass(at('2026-10-17T22:10:00.000Z')))).toBe('2026-10-18T01:10:00.000Z');
    expect(iso(nextReelPass(at('2026-10-17T23:59:59.999Z')))).toBe('2026-10-18T01:10:00.000Z');
    expect(iso(nextReelPass(at('2026-10-31T23:00:00.000Z')))).toBe('2026-11-01T01:10:00.000Z');
    expect(iso(nextReelPass(at('2026-12-31T22:30:00.000Z')))).toBe('2027-01-01T01:10:00.000Z');
  });

  it('en hora de Chile: en verano 07:10 a 22:10; en invierno, una hora antes', () => {
    const passesOn = (day: string) => {
      const out: string[] = [];
      let now = at(`${day}T00:00:00Z`);
      for (let i = 0; i < REEL_PASSES_UTC.length; i++) {
        now = nextReelPass(now);
        out.push(chileTime(now));
      }
      return out;
    };
    // La de 01:10 UTC es la de las 22:10 de la noche anterior en Chile.
    expect(passesOn('2026-10-17')).toEqual(['22:10', '07:10', '10:10', '13:10', '16:10', '19:10']);
    expect(passesOn('2026-06-17')).toEqual(['21:10', '06:10', '09:10', '12:10', '15:10', '18:10']);
  });

  it('el día de un cambio de hora la próxima pasada sale con la hora nueva', () => {
    // Sábado 4 de abril, 23:00 de Chile todavía en verano: la próxima es la de 10:10 UTC, ya en invierno.
    const april = nextReelPass(at('2026-04-05T02:00:00Z'));
    expect(iso(april)).toBe('2026-04-05T10:10:00.000Z');
    expect(chileTime(april)).toBe('06:10');
    // Sábado 5 de septiembre, 22:00 de Chile en invierno: la de 10:10 UTC ya es de verano.
    const september = nextReelPass(at('2026-09-06T02:00:00Z'));
    expect(chileTime(september)).toBe('07:10');
  });
});

describe('.github/workflows/reels.yml calza con REEL_PASSES_UTC', () => {
  const yml = readFileSync(fileURLToPath(new URL('../../../.github/workflows/reels.yml', import.meta.url)), 'utf8');
  const crons = [...yml.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((match) => match[1]);

  it('tiene un solo horario programado, todos los días', () => {
    expect(crons).toHaveLength(1);
    const fields = crons[0].trim().split(/\s+/);
    expect(fields).toHaveLength(5);
    // Día del mes, mes y día de la semana: todos.
    expect(fields.slice(2)).toEqual(['*', '*', '*']);
  });

  it('sus horas y su minuto son exactamente las pasadas que dice la página', () => {
    const [minute, hours] = crons[0].trim().split(/\s+/);
    expect(minute).toMatch(/^\d{1,2}$/);
    expect(hours).toMatch(/^\d{1,2}(,\d{1,2})*$/);
    const passes = hours
      .split(',')
      .map((hour) => `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`)
      .sort();
    expect(passes).toEqual([...REEL_PASSES_UTC]);
  });

  it('el comentario del workflow avisa que hay que cambiar los dos lados', () => {
    expect(yml).toContain('REEL_PASSES_UTC');
    expect(yml).toContain('src/lib/social/content-timing.ts');
  });
});
