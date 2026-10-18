import { describe, expect, it } from 'vitest';
import { latestDate, productLastModified } from './sitemap-dates';

describe('productLastModified', () => {
  const product = { id: 'a', created_at: '2026-10-05T12:00:00.000Z' };

  it('usa el último cambio de precio del historial', () => {
    const changes = new Map([['a', '2026-10-16T09:30:00.000Z']]);
    expect(productLastModified(product, changes)?.toISOString()).toBe('2026-10-16T09:30:00.000Z');
  });

  it('sin cambios registrados (o sin historial), la fecha de alta', () => {
    expect(productLastModified(product, new Map())?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
    expect(productLastModified(product, null)?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });

  it('nunca una fecha anterior al alta', () => {
    const changes = new Map([['a', '2026-10-01T00:00:00.000Z']]);
    expect(productLastModified(product, changes)?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });

  it('ignora fechas que no se pueden leer', () => {
    expect(productLastModified({ id: 'a', created_at: 'mañana' }, null)).toBeUndefined();
    const changes = new Map([['a', 'no es fecha']]);
    expect(productLastModified(product, changes)?.toISOString()).toBe('2026-10-05T12:00:00.000Z');
  });
});

describe('latestDate', () => {
  it('la más nueva, saltándose las vacías', () => {
    const a = new Date('2026-10-01T00:00:00Z');
    const b = new Date('2026-10-17T00:00:00Z');
    expect(latestDate([a, undefined, b])).toBe(b);
    expect(latestDate([])).toBeUndefined();
  });
});
