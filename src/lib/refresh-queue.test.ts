import { describe, expect, it } from 'vitest';
import { isVisibleDeal, oldestVisibleMinutes, refreshQueue, type QueueRow } from '@/lib/refresh-queue';

function row(id: string, overrides: Partial<QueueRow> = {}): QueueRow {
  return { id, price: 100_000, original_price: null, is_active: true, price_checked_at: null, ...overrides };
}

describe('isVisibleDeal', () => {
  it('es oferta con 20% o más de descuento y a la venta, como en el sitio', () => {
    expect(isVisibleDeal(row('a', { price: 80_000, original_price: 100_000 }))).toBe(true);
    expect(isVisibleDeal(row('b', { price: 81_000, original_price: 100_000 }))).toBe(false);
    // 19,6% se redondea a 20%, igual que discountPercent del sitio.
    expect(isVisibleDeal(row('c', { price: 80_400, original_price: 100_000 }))).toBe(true);
  });

  it('no es oferta sin precio de lista, con uno menor o si no está a la venta', () => {
    expect(isVisibleDeal(row('a'))).toBe(false);
    expect(isVisibleDeal(row('b', { price: 100_000, original_price: 90_000 }))).toBe(false);
    expect(isVisibleDeal(row('c', { price: 50_000, original_price: 100_000, is_active: false }))).toBe(false);
  });
});

describe('refreshQueue', () => {
  const deal = { price: 50_000, original_price: 100_000 };

  it('pasa adelante las ofertas y lo que tuvo clics o redes, sin cambiar el orden de cada grupo', () => {
    // Llegan de la base del precio más viejo al más nuevo.
    const rows = [row('viejo'), row('oferta', deal), row('medio'), row('con-clics'), row('nuevo', deal)];
    const { queue, priority } = refreshQueue(rows, new Set(['con-clics']));
    expect(queue.map((r) => r.id)).toEqual(['oferta', 'con-clics', 'nuevo', 'viejo', 'medio']);
    expect(priority).toBe(3);
  });

  it('con el tope, las prioritarias que sobran van con el resto, por antigüedad', () => {
    const rows = [row('a', deal), row('b'), row('c', deal), row('d', deal)];
    const { queue, priority } = refreshQueue(rows, new Set(), 2);
    expect(queue.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(priority).toBe(2);
  });

  it('sin prioritarias deja la fila como viene', () => {
    const rows = [row('a'), row('b'), row('c')];
    expect(refreshQueue(rows, new Set()).queue).toEqual(rows);
  });
});

describe('oldestVisibleMinutes', () => {
  const NOW = new Date('2026-10-18T15:00:00Z').getTime();

  it('mide lo que está a la venta y no se revisó en esta corrida', () => {
    const rows = [
      row('al-dia', { price_checked_at: '2026-10-18T10:00:00Z' }),
      row('pendiente', { price_checked_at: '2026-10-18T13:30:00Z' }),
      row('en-pausa', { is_active: false, price_checked_at: '2026-10-17T15:00:00Z' }),
      row('nunca', { price_checked_at: null }),
    ];
    expect(oldestVisibleMinutes(rows, new Set(['al-dia']), NOW)).toBe(90);
  });

  it('0 si todo lo visible quedó al día', () => {
    const rows = [row('a', { price_checked_at: '2026-10-18T10:00:00Z' })];
    expect(oldestVisibleMinutes(rows, new Set(['a']), NOW)).toBe(0);
    expect(oldestVisibleMinutes([], new Set(), NOW)).toBe(0);
  });
});
